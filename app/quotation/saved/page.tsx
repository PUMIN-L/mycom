"use client";
import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AdminHomeButton from "../../components/AdminHomeButton";
import { useAuth } from "../../context/AuthContext";
import ConfirmDialog from "../../components/ConfirmDialog";
import Toast from "../../components/Toast";
import SearchBox from "../../components/SearchBox";
import DatePicker from "../../components/DatePicker";
import ImageDeleteConfirmDialog, { type OrphanedImage } from "../../components/ImageDeleteConfirmDialog";
import {
  BULK_DELETE_MAX_ITEMS,
  filterSavedDocs,
  isImpossibleRange,
  selectAllPlan,
  visibleSelection,
} from "../../lib/savedDocFilter";
import { splitDocNoVersion } from "../../lib/quotationNumber";
import { daysUntilPurge, retentionLabel } from "../../lib/quotationRetention";
import {
  addDaysToDateString,
  bangkokDateString,
  formatDisplayDate,
  isValidDateString,
  toLocalDateString,
} from "../../lib/dateFormat";

// ── ใบเสนอราคาที่บันทึกไว้ ──────────────────────────────────────────────────
//
// The list of saved quotations: find one, open it, make a new version of it,
// delete one or many. It used to be a tab of /billing/saved, the old billing
// module's list, which went with that module.
//
// The rules a mistaken bulk delete would hang on — which rows a date range
// covers, what เลือกทั้งหมด ticks, that only rows ON SCREEN are ever deleted —
// are lib/savedDocFilter.ts's, unit-tested there.

/** One row, as `GET /api/quotations` answers (`docType` is stamped on here). */
interface QuotationRow {
  id: string;
  docType: "quotation";
  docNo: string;
  /** The LAST save (every save rewrites it) — what the nightly purge counts from. */
  createdAt: string;
  customer: string;
  total: number;
}

/** One quotation a bulk delete could not remove, named with the server's reason. */
interface BulkFailure {
  docNo: string;
  reason: string;
}

/** Within this many days of the purge, a row says it is about to go. */
const PURGE_WARNING_DAYS = 30;

const fmt = (n: number) =>
  n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** A "YYYY-MM-DD" string as the Date react-datepicker wants, or null. */
const parseDateValue = (value: string): Date | null =>
  isValidDateString(value) ? new Date(`${value}T00:00:00`) : null;

const labelOf = (row: QuotationRow) => row.docNo || "ใบเสนอราคา (ไม่มีเลขที่)";

export default function SavedQuotationsPage() {
  const router = useRouter();
  const { isLoggedIn, isLoading } = useAuth();
  const [items, setItems] = useState<QuotationRow[]>([]);
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  /** Bumped by ลองใหม่ to load the list again. */
  const [reload, setReload] = useState(0);
  /** When the list arrived: the purge countdown is counted from it, not from each render. */
  const [loadedAt, setLoadedAt] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  /** The date range, as Bangkok calendar days. Empty = that end is open. */
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [pendingDelete, setPendingDelete] = useState<QuotationRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const [orphanedImages, setOrphanedImages] = useState<OrphanedImage[]>([]);
  /** Ticked ids. Kept across filter changes, but only the rows still on screen
   *  are ever deleted — see `selectedVisible`. */
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  /** Progress while the loop runs: "กำลังลบ 7 / 24". */
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);
  /** The quotations a bulk delete could NOT remove, each with its reason. */
  const [bulkFailures, setBulkFailures] = useState<BulkFailure[]>([]);

  useEffect(() => {
    if (!isLoading && !isLoggedIn) router.replace("/login");
  }, [isLoggedIn, isLoading, router]);

  // The list. State changes only once the answer is in, and an answer that
  // arrives after the page has moved on (a newer load, leaving) is dropped.
  useEffect(() => {
    if (!isLoggedIn) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/quotations", { cache: "no-store" });
        if (!res.ok) throw new Error();
        const list: unknown = await res.json();
        // Anything but a list is a failed load — never an empty one.
        if (!Array.isArray(list)) throw new Error();
        if (cancelled) return;
        setItems(
          list
            .map((q) => ({ ...q, docType: "quotation" as const }) as QuotationRow)
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        );
        setLoadedAt(Date.now());
        setStatus("ok");
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isLoggedIn, reload]);

  const retry = () => {
    setStatus("loading");
    setReload((n) => n + 1);
  };

  function showToast(message: string, type: "success" | "error") {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }

  /** The server's own Thai reason for a refused delete, or ours. */
  async function refusal(res: Response): Promise<string> {
    const data = await res.json().catch(() => null);
    if (typeof data?.error === "string" && data.error) return data.error;
    return res.status === 404 ? "ไม่พบใบเสนอราคานี้แล้ว (อาจถูกลบไปก่อนหน้านี้)" : "ลบไม่สำเร็จ";
  }

  async function handleDelete() {
    const target = pendingDelete;
    if (!target) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/quotations/${encodeURIComponent(target.id)}`, { method: "DELETE" });
      if (res.ok) {
        const data = await res.json().catch(() => null);
        setItems((prev) => prev.filter((x) => x.id !== target.id));
        setSelected((prev) => new Set([...prev].filter((id) => id !== target.id)));
        showToast(`ลบ ${labelOf(target)} แล้ว`, "success");
        if (Array.isArray(data?.orphanedImages) && data.orphanedImages.length > 0) {
          setOrphanedImages(data.orphanedImages.map((url: string) => ({ url, reason: "ลบใบเสนอราคา" })));
        }
      } else {
        showToast(await refusal(res), "error");
      }
    } catch {
      showToast("เชื่อมต่อไม่สำเร็จ ลองใหม่อีกครั้ง", "error");
    } finally {
      setDeleting(false);
      setPendingDelete(null);
    }
  }

  const filtered = useMemo(
    () => filterSavedDocs(items, { search: searchQuery, from: dateFrom, to: dateTo }),
    [items, searchQuery, dateFrom, dateTo]
  );

  /** A range whose start is after its end covers nothing, which on screen is
   *  indistinguishable from "no quotations" — so it is said out loud. */
  const badRange = isImpossibleRange(dateFrom, dateTo);
  const hasDateFilter = isValidDateString(dateFrom) || isValidDateString(dateTo);

  /** What ลบที่เลือก will delete: the ticked rows that are STILL on screen. */
  const selectedVisible = useMemo(() => visibleSelection(filtered, selected), [filtered, selected]);
  const plan = useMemo(() => selectAllPlan(filtered), [filtered]);

  const toggleRow = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const handleSelectAll = () => {
    setSelected(new Set(plan.ids));
    if (plan.cappedOut > 0) {
      showToast(
        `เลือกได้ครั้งละไม่เกิน ${BULK_DELETE_MAX_ITEMS} ใบ จึงเลือกให้ ${plan.selectedCount} ใบ (เหลืออีก ${plan.cappedOut} ใบ ลบรอบนี้เสร็จแล้วกดเลือกทั้งหมดอีกครั้ง)`,
        "success"
      );
    }
  };

  /**
   * Delete every ticked quotation still on screen, ONE AT A TIME: each delete
   * is its own request and a refusal has to come back attached to the
   * quotation it refers to. The ones that went leave the table; the rest are
   * named in a report that stays on screen. Images freed by the deletes are
   * pooled and asked about ONCE, de-duplicated — an "แก้ไข (New Ver.)" clone
   * reuses its original's image URL.
   */
  async function handleBulkDelete() {
    const targets = selectedVisible as QuotationRow[];
    if (targets.length === 0) return;
    setBulkConfirmOpen(false);
    setBulkDeleting(true);
    setBulkFailures([]);
    setBulkProgress({ done: 0, total: targets.length });

    const deletedIds: string[] = [];
    const failures: BulkFailure[] = [];
    const freedImages: string[] = [];

    for (const [index, item] of targets.entries()) {
      try {
        const res = await fetch(`/api/quotations/${encodeURIComponent(item.id)}`, { method: "DELETE" });
        if (res.ok) {
          const data = await res.json().catch(() => null);
          deletedIds.push(item.id);
          if (Array.isArray(data?.orphanedImages)) {
            for (const url of data.orphanedImages) {
              if (typeof url === "string" && url) freedImages.push(url);
            }
          }
        } else {
          failures.push({ docNo: labelOf(item), reason: await refusal(res) });
        }
      } catch {
        failures.push({ docNo: labelOf(item), reason: "เชื่อมต่อไม่สำเร็จ" });
      }
      setBulkProgress({ done: index + 1, total: targets.length });
    }

    const deletedSet = new Set(deletedIds);
    setItems((prev) => prev.filter((x) => !deletedSet.has(x.id)));
    // Un-tick what is gone; a refused one stays ticked, to deal with it without finding it again.
    setSelected((prev) => new Set([...prev].filter((id) => !deletedSet.has(id))));
    setBulkFailures(failures);
    setBulkDeleting(false);
    setBulkProgress(null);

    const parts: string[] = [];
    if (deletedIds.length > 0) parts.push(`ลบแล้ว ${deletedIds.length} ใบ`);
    if (failures.length > 0) parts.push(`ลบไม่ได้ ${failures.length} ใบ (ดูเหตุผลด้านล่าง)`);
    showToast(parts.join(" · ") || "ไม่มีใบเสนอราคาถูกลบ", failures.length > 0 && deletedIds.length === 0 ? "error" : "success");

    const unique = [...new Set(freedImages)];
    if (unique.length > 0) setOrphanedImages(unique.map((url) => ({ url, reason: "ลบใบเสนอราคา" })));
  }

  /** Per document number without its version: the id of its highest version. */
  const latestVersions = useMemo(() => {
    const map = new Map<string, { id: string; version: number }>();
    for (const item of items) {
      if (!item.docNo) continue;
      const { base, version } = splitDocNoVersion(item.docNo);
      const current = map.get(base);
      if (!current || (version ?? 0) > current.version) map.set(base, { id: item.id, version: version ?? 0 });
    }
    return map;
  }, [items]);

  const openQuotation = (item: QuotationRow) => router.push(`/quotation?id=${encodeURIComponent(item.id)}&view=1`);

  if (isLoading || !isLoggedIn) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin h-8 w-8 border-4 border-orange-400 border-t-transparent rounded-full" />
      </div>
    );
  }

  const today = bangkokDateString(new Date());
  const presets: { label: string; from: string; to: string }[] = [
    { label: "วันนี้", from: today, to: today },
    { label: "7 วันที่ผ่านมา", from: addDaysToDateString(today, -6), to: today },
    { label: "30 วันที่ผ่านมา", from: addDaysToDateString(today, -29), to: today },
    { label: "เดือนนี้", from: `${today.slice(0, 8)}01`, to: today },
  ];
  return (
    <>
      <div className="min-h-screen bg-gray-50">
        {toast && <Toast message={toast.message} type={toast.type} />}

        <div className="sticky top-0 z-20 bg-white border-b border-gray-200 shadow-sm">
          <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
            <h1 className="text-xl font-bold text-gray-900">📋 ใบเสนอราคาที่บันทึกไว้</h1>
            <div className="flex items-center gap-2 flex-wrap">
              <AdminHomeButton />
              <Link
                href="/quotation?new=1"
                className="px-4 py-2 rounded-lg bg-orange-500 text-white text-sm font-bold hover:bg-orange-600 transition"
              >
                + สร้างใบเสนอราคาใหม่
              </Link>
            </div>
          </div>
        </div>

        <div className="max-w-5xl mx-auto px-4 py-6">
          <p className="mb-4 text-sm text-gray-500">
            ใบเสนอราคาเก็บไว้ {retentionLabel()} นับจากการบันทึกครั้งล่าสุด แล้วระบบจะลบให้อัตโนมัติ
          </p>

          <SearchBox
            value={searchQuery}
            onChange={setSearchQuery}
            label="ค้นหาใบเสนอราคา"
            placeholder="ค้นหาเลขที่ หรือ ชื่อลูกค้า..."
            className="mb-4"
          />

          {/* Date range — the day the quotation was last SAVED, as a Bangkok
              calendar day. Both ends are inclusive; either can be left empty. */}
          <div className="mb-4 bg-white rounded-xl border border-gray-200 shadow-sm p-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-full sm:w-44">
                <label htmlFor="saved-date-from" className="block text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wider">
                  ตั้งแต่วันที่
                </label>
                <DatePicker
                  id="saved-date-from"
                  selected={parseDateValue(dateFrom)}
                  onChange={(date) => {
                    const next = date ? toLocalDateString(date) : "";
                    setDateFrom(next);
                    // Never leave a range that reads forwards but runs backwards.
                    if (next && isValidDateString(dateTo) && dateTo < next) setDateTo(next);
                  }}
                  placeholderText="วันที่เริ่มต้น"
                  isClearable
                />
              </div>
              <div className="w-full sm:w-44">
                <label htmlFor="saved-date-to" className="block text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wider">
                  ถึงวันที่
                </label>
                <DatePicker
                  id="saved-date-to"
                  selected={parseDateValue(dateTo)}
                  onChange={(date) => setDateTo(date ? toLocalDateString(date) : "")}
                  placeholderText="วันที่สิ้นสุด"
                  isClearable
                />
              </div>
              {hasDateFilter && (
                <button
                  type="button"
                  onClick={() => {
                    setDateFrom("");
                    setDateTo("");
                  }}
                  className="px-4 py-2.5 rounded-xl border border-gray-300 text-gray-700 text-sm font-semibold hover:bg-gray-50 transition"
                >
                  ล้างช่วงวันที่
                </button>
              )}
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-xs text-gray-400">ทางลัด:</span>
              {presets.map((preset) => (
                <button
                  type="button"
                  key={preset.label}
                  onClick={() => {
                    setDateFrom(preset.from);
                    setDateTo(preset.to);
                  }}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition ${
                    dateFrom === preset.from && dateTo === preset.to
                      ? "bg-orange-500 text-white border-orange-500"
                      : "bg-white border-gray-300 text-gray-600 hover:bg-gray-50"
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>

            {badRange ? (
              <p className="mt-3 text-xs font-semibold text-red-600">
                ⚠ วันเริ่มต้น ({formatDisplayDate(dateFrom)}) อยู่หลังวันสิ้นสุด ({formatDisplayDate(dateTo)}) — ช่วงนี้จึงไม่มีใบเสนอราคาใดเลย
              </p>
            ) : hasDateFilter ? (
              <p className="mt-3 text-xs font-semibold text-gray-600">
                กำลังดูใบเสนอราคาที่บันทึก{" "}
                {isValidDateString(dateFrom) && isValidDateString(dateTo)
                  ? `${formatDisplayDate(dateFrom)} ถึง ${formatDisplayDate(dateTo)}`
                  : isValidDateString(dateFrom)
                    ? `ตั้งแต่ ${formatDisplayDate(dateFrom)} เป็นต้นมา`
                    : `ก่อนหรือตรงกับ ${formatDisplayDate(dateTo)}`}{" "}
                · พบ {filtered.length} ใบ
              </p>
            ) : null}
          </div>

          {/* Bulk selection — scoped to the rows on screen, so the search and the
              date range genuinely narrow what ลบที่เลือก can reach. */}
          {status === "ok" && filtered.length > 0 && (
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleSelectAll}
                disabled={bulkDeleting}
                className="px-4 py-2 rounded-xl bg-gray-800 text-white text-sm font-semibold hover:bg-gray-900 transition disabled:opacity-50"
              >
                ☑️ เลือกทั้งหมด
              </button>
              {selected.size > 0 && (
                <button
                  type="button"
                  onClick={() => setSelected(new Set())}
                  disabled={bulkDeleting}
                  className="px-4 py-2 rounded-xl bg-white border border-gray-300 text-gray-700 text-sm font-semibold hover:bg-gray-50 transition disabled:opacity-50"
                >
                  ล้างการเลือก
                </button>
              )}
              {selectedVisible.length > 0 && (
                <button
                  type="button"
                  onClick={() => setBulkConfirmOpen(true)}
                  disabled={bulkDeleting}
                  className="px-4 py-2 rounded-xl bg-red-600 text-white text-sm font-bold hover:bg-red-700 transition disabled:opacity-50"
                >
                  {bulkDeleting
                    ? bulkProgress
                      ? `กำลังลบ ${bulkProgress.done} / ${bulkProgress.total}`
                      : "กำลังลบ..."
                    : `🗑️ ลบที่เลือก (${selectedVisible.length})`}
                </button>
              )}
              <span className="text-xs text-gray-500">
                เลือกไว้ {selectedVisible.length} จาก {plan.scopeCount} ใบที่เห็นอยู่
                {plan.cappedOut > 0 && ` · เลือกทั้งหมดได้ครั้งละ ${BULK_DELETE_MAX_ITEMS} ใบ`}
                {selected.size > selectedVisible.length &&
                  ` · อีก ${selected.size - selectedVisible.length} ใบที่ติ๊กไว้ถูกตัวกรองซ่อนอยู่ จะไม่ถูกลบ`}
              </span>
            </div>
          )}

          {/* Which quotations a bulk delete could not remove, and why. */}
          {bulkFailures.length > 0 && (
            <div role="alert" className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-4">
              <div className="flex items-start justify-between gap-3">
                <h3 className="text-sm font-bold text-amber-900">ลบไม่ได้ {bulkFailures.length} ใบ</h3>
                <button
                  type="button"
                  onClick={() => setBulkFailures([])}
                  className="text-xs font-semibold text-amber-700 hover:text-amber-900 shrink-0"
                >
                  ปิด
                </button>
              </div>
              <ul className="mt-2 space-y-1">
                {bulkFailures.map((failure) => (
                  <li key={failure.docNo} className="text-xs text-amber-900">
                    <span className="font-mono font-bold">{failure.docNo}</span> — {failure.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {status === "loading" ? (
            <div className="bg-white rounded-xl shadow-sm overflow-hidden" aria-busy="true">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex gap-4 border-b px-4 py-4">
                  <div className="h-4 w-4 bg-gray-200 rounded animate-pulse" />
                  <div className="h-4 bg-gray-200 rounded animate-pulse w-32" />
                  <div className="h-4 bg-gray-200 rounded animate-pulse w-40" />
                  <div className="h-4 bg-gray-200 rounded animate-pulse w-24 ml-auto" />
                </div>
              ))}
            </div>
          ) : status === "error" ? (
            <div role="alert" className="text-center py-16">
              <p className="text-red-500 mb-3">โหลดรายการใบเสนอราคาไม่สำเร็จ</p>
              <button
                type="button"
                onClick={retry}
                className="px-4 py-2 rounded-lg bg-orange-500 text-white font-semibold hover:bg-orange-600 transition"
              >
                ลองใหม่
              </button>
            </div>
          ) : items.length === 0 ? (
            <div className="text-center py-16 text-gray-400">
              <p className="text-4xl mb-3">📄</p>
              <p className="text-lg font-semibold">ยังไม่มีใบเสนอราคาที่บันทึกไว้</p>
              <Link
                href="/quotation?new=1"
                className="inline-block mt-3 px-4 py-2 rounded-lg bg-orange-500 text-white font-semibold hover:bg-orange-600 transition"
              >
                สร้างใบเสนอราคาใหม่
              </Link>
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-16 text-gray-500">
              {/* Only a search or a date range can hide every one of them. */}
              <p className="text-lg font-semibold">ไม่พบใบเสนอราคาที่ตรงกับการค้นหาหรือช่วงวันที่</p>
            </div>
          ) : (
            <div className="bg-white rounded-xl shadow-sm overflow-x-auto">
              <table className="w-full" data-testid="quotation-table">
                <thead>
                  <tr className="bg-gray-50 border-b">
                    <th className="px-4 py-3 w-10">
                      <input
                        type="checkbox"
                        aria-label="เลือกทั้งหมดที่เห็นอยู่"
                        checked={filtered.length > 0 && selectedVisible.length === filtered.length}
                        onChange={(e) => (e.target.checked ? handleSelectAll() : setSelected(new Set()))}
                        className="w-4 h-4 rounded border-gray-300 text-red-600 focus:ring-red-500 cursor-pointer"
                      />
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">เลขที่</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">ลูกค้า</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500">ยอดรวม</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">บันทึกล่าสุด</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((item) => {
                    const left = daysUntilPurge(item.createdAt, loadedAt);
                    const latest = item.docNo ? latestVersions.get(splitDocNoVersion(item.docNo).base) : undefined;
                    const versionTag = !latest || latest.version === 0 ? null : latest.id === item.id ? "latest" : "old";
                    return (
                      <tr
                        key={item.id}
                        className={`border-b hover:bg-gray-50/50 cursor-pointer transition ${selected.has(item.id) ? "bg-red-50/60" : ""}`}
                        onClick={() => openQuotation(item)}
                      >
                        {/* stopPropagation: ticking a row must not also open it. */}
                        <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            aria-label={`เลือก ${labelOf(item)}`}
                            checked={selected.has(item.id)}
                            onChange={() => toggleRow(item.id)}
                            className="w-4 h-4 rounded border-gray-300 text-red-600 focus:ring-red-500 cursor-pointer"
                          />
                        </td>
                        <td className="px-4 py-3 font-mono text-sm font-semibold text-gray-800">
                          {/* A real link, so the row can be opened from the keyboard too. */}
                          <Link
                            href={`/quotation?id=${encodeURIComponent(item.id)}&view=1`}
                            onClick={(e) => e.stopPropagation()}
                            className="hover:underline"
                          >
                            {item.docNo || "-"}
                          </Link>
                          {versionTag === "latest" && (
                            <span className="ml-2 inline-block text-[10px] font-bold text-orange-600 bg-orange-100 px-2 py-0.5 rounded-full whitespace-nowrap">
                              (เวอร์ชันล่าสุด)
                            </span>
                          )}
                          {versionTag === "old" && (
                            <span className="ml-2 inline-block text-[10px] font-bold text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full whitespace-nowrap">
                              (เวอร์ชันเก่า)
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-700">{item.customer}</td>
                        <td className="px-4 py-3 text-sm text-right font-semibold text-gray-800 whitespace-nowrap">{fmt(item.total)}</td>
                        <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">
                          {formatDisplayDate(item.createdAt) || "-"}
                          {left !== null && left <= PURGE_WARNING_DAYS && (
                            <span className="block text-[11px] font-semibold text-red-600">
                              {left === 0 ? "ระบบจะลบอัตโนมัติรอบถัดไป" : `ระบบจะลบอัตโนมัติใน ${left} วัน`}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-3">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                router.push(`/quotation?id=${encodeURIComponent(item.id)}&action=clone`);
                              }}
                              className="text-xs text-blue-500 hover:text-blue-700 font-semibold whitespace-nowrap"
                            >
                              ✏️ แก้ไข (New Ver.)
                            </button>
                            <button
                              type="button"
                              aria-label={`ลบ ${labelOf(item)}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                setPendingDelete(item);
                              }}
                              className="text-xs text-red-500 hover:text-red-700 font-semibold whitespace-nowrap"
                            >
                              🗑️ ลบ
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Bulk delete confirmation — the count and the date range, the line that
            gives away a bulk delete aimed at the wrong month. */}
        {bulkConfirmOpen && selectedVisible.length > 0 && (
          <ConfirmDialog
            title={`ลบใบเสนอราคา ${selectedVisible.length} ใบ`}
            message={
              `กำลังจะลบใบเสนอราคา ${selectedVisible.length} ใบ` +
              (hasDateFilter
                ? `\n\nช่วงวันที่: ${isValidDateString(dateFrom) ? formatDisplayDate(dateFrom) : "ไม่กำหนด"} ถึง ${isValidDateString(dateTo) ? formatDisplayDate(dateTo) : "ไม่กำหนด"}`
                : "") +
              `\n\nลบแล้วกู้คืนไม่ได้` +
              `\nรูปที่ไม่ได้ใช้ต่อ จะถามให้ยืนยันลบออกจาก Cloudinary หลังจากนี้`
            }
            confirmText={`ลบ ${selectedVisible.length} ใบ`}
            loadingText="กำลังลบ..."
            cancelText="ยกเลิก"
            onConfirm={handleBulkDelete}
            onCancel={() => setBulkConfirmOpen(false)}
            loading={bulkDeleting}
          />
        )}

        {pendingDelete && (
          <ConfirmDialog
            title="ลบใบเสนอราคา"
            message={`ต้องการลบ ${labelOf(pendingDelete)} หรือไม่?\n\nลบแล้วกู้คืนไม่ได้`}
            confirmText="ลบ"
            cancelText="ยกเลิก"
            onConfirm={handleDelete}
            onCancel={() => setPendingDelete(null)}
            loading={deleting}
          />
        )}
      </div>

      {orphanedImages.length > 0 && (
        <ImageDeleteConfirmDialog images={orphanedImages} onComplete={() => setOrphanedImages([])} />
      )}
    </>
  );
}

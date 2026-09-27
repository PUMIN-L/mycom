"use client";
import { useState, useEffect, Suspense, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "../../context/AuthContext";
import ConfirmDialog from "../../components/ConfirmDialog";
import Toast from "../../components/Toast";
import ImageDeleteConfirmDialog, { type OrphanedImage } from "../../components/ImageDeleteConfirmDialog";
import DatePicker from "../../components/DatePicker";
import { BILLING_LABELS } from "../../lib/billingNumber";
import type { BillingDocType } from "../../lib/billingNumber";
import {
  BULK_DELETE_MAX_ITEMS,
  filterSavedDocs,
  isImpossibleRange,
  selectAllPlan,
  summariseByDocType,
  visibleSelection,
} from "../../lib/savedDocFilter";
import {
  addDaysToDateString,
  bangkokDateString,
  formatDisplayDate,
  isValidDateString,
  toLocalDateString,
} from "../../lib/dateFormat";

type CombinedDocType = BillingDocType | "quotation";

/** One refused document, named with the server's own Thai reason. */
interface BulkFailure {
  docNo: string;
  reason: string;
}

const docTypeLabel = (docType: string): string =>
  docType === "quotation" ? "ใบเสนอราคา" : BILLING_LABELS[docType as BillingDocType]?.th ?? docType;

/** A "YYYY-MM-DD" string as the Date react-datepicker wants, or null. */
const parseDateValue = (value: string): Date | null =>
  isValidDateString(value) ? new Date(`${value}T00:00:00`) : null;

interface BillingSummary {
  id: string;
  docType: CombinedDocType;
  docNo: string;
  createdAt: string;
  customer: string;
  total: number;
}

const fmt = (n: number) =>
  n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function daysLeft(createdAt: string): number {
  const created = new Date(createdAt).getTime();
  if (!Number.isFinite(created)) return 30;
  const elapsedDays = (Date.now() - created) / (24 * 60 * 60 * 1000);
  return Math.max(0, Math.ceil(30 - elapsedDays));
}

const TAB_OPTIONS: { value: CombinedDocType | "all"; label: string }[] = [
  { value: "all", label: "ทั้งหมด" },
  { value: "invoice", label: "🧾 ใบแจ้งหนี้ / ใบกำกับภาษี" },
  { value: "billing_note", label: "📋 ใบวางบิล" },
  { value: "receipt", label: "🧾 ใบเสร็จ" },
  { value: "quotation", label: "📋 ใบเสนอราคา" },
];

function SavedBillingContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isLoggedIn, isLoading } = useAuth();
  const [items, setItems] = useState<BillingSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const initialTab = (searchParams?.get("tab") as CombinedDocType | "all") || "all";
  const [filter, setFilter] = useState<CombinedDocType | "all">(initialTab);
  const [pendingDelete, setPendingDelete] = useState<BillingSummary | null>(null);
  /** A delete the server refused because money is attached, plus its Thai
   *  reason — the admin is offered ยกเลิกเอกสาร here instead of a dead end. */
  const [blockedDelete, setBlockedDelete] = useState<{ item: BillingSummary; message: string } | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const [orphanedImages, setOrphanedImages] = useState<OrphanedImage[]>([]);
  const [createDropdownOpen, setCreateDropdownOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  /** The date range, as Bangkok calendar days. Empty = that end is open. */
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  /** Ticked ids. Kept across filter changes, but only the rows still on screen
   *  are ever deleted — see `selectedVisible`. */
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  /** Progress while the loop runs: "กำลังลบ 7 / 24". */
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);
  /** The documents a bulk delete could NOT remove, each with its reason. A
   *  toast saying "3 ใบลบไม่ได้" without naming them is not a report. */
  const [bulkFailures, setBulkFailures] = useState<BulkFailure[]>([]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (!(e.target as Element).closest(".create-dropdown-container")) {
        setCreateDropdownOpen(false);
      }
    }
    if (createDropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [createDropdownOpen]);

  useEffect(() => {
    if (!isLoading && !isLoggedIn) router.replace("/login");
  }, [isLoggedIn, isLoading, router]);

  async function load() {
    setLoading(true);
    setLoadFailed(false);
    try {
      const [billingRes, quoteRes] = await Promise.all([
        fetch("/api/billing"),
        fetch("/api/quotations")
      ]);
      if (!billingRes.ok || !quoteRes.ok) throw new Error();
      
      const billings: BillingSummary[] = await billingRes.json();
      const quotes: BillingSummary[] = (await quoteRes.json()).map((q: any) => ({
        ...q,
        docType: "quotation"
      }));

      const combined = [...billings, ...quotes].sort((a, b) => 
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      
      setItems(combined);
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (isLoggedIn) load();
  }, [isLoggedIn]);

  function showToast(message: string, type: "success" | "error") {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }

  async function handleDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      const endpoint = pendingDelete.docType === "quotation"
        ? `/api/quotations/${pendingDelete.id}`
        : `/api/billing/${pendingDelete.id}`;

      const res = await fetch(endpoint, { method: "DELETE" });
      if (res.ok) {
        const data = await res.json();
        setItems((prev) => prev.filter((x) => x.id !== pendingDelete.id));
        showToast("ลบเอกสารแล้ว", "success");
        if (data.orphanedImages?.length > 0) {
          setOrphanedImages(data.orphanedImages.map((url: string) => ({
            url,
            reason: "ลบเอกสาร"
          })));
        }
      } else if (res.status === 409) {
        // The document carries payments. Deleting it would orphan financial
        // records (billing_payments deliberately has no FK), so the server
        // refuses and offers ยกเลิกเอกสาร instead — which keeps the payment
        // history and the reserved document number.
        const data = await res.json().catch(() => null);
        setPendingDelete(null);
        setBlockedDelete({
          item: pendingDelete,
          message: data?.error ?? "เอกสารนี้มีการรับชำระเงินแล้ว ไม่สามารถลบได้",
        });
        return;
      } else {
        showToast("ลบไม่สำเร็จ", "error");
      }
    } catch {
      showToast("เกิดข้อผิดพลาด", "error");
    } finally {
      setDeleting(false);
      setPendingDelete(null);
    }
  }

  async function handleCancelDocument() {
    if (!blockedDelete) return;
    setCancelling(true);
    try {
      const res = await fetch(`/api/billing/${blockedDelete.item.id}/receivable`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cancelled: true }),
      });
      if (!res.ok) throw new Error();
      showToast("ยกเลิกเอกสารแล้ว (เอกสารและประวัติการรับชำระยังอยู่)", "success");
      setBlockedDelete(null);
    } catch {
      showToast("ยกเลิกเอกสารไม่สำเร็จ", "error");
    } finally {
      setCancelling(false);
    }
  }

  const filtered = useMemo(
    () => filterSavedDocs(items, { docType: filter, search: searchQuery, from: dateFrom, to: dateTo }),
    [items, filter, searchQuery, dateFrom, dateTo]
  );

  /** A range whose start is after its end covers nothing, which on screen is
   *  indistinguishable from "no documents" — so it is said out loud. */
  const badRange = isImpossibleRange(dateFrom, dateTo);
  const hasDateFilter = isValidDateString(dateFrom) || isValidDateString(dateTo);

  /** What ลบที่เลือก will delete: the ticked rows that are STILL on screen. */
  const selectedVisible = useMemo(() => visibleSelection(filtered, selected), [filtered, selected]);
  const plan = useMemo(() => selectAllPlan(filtered), [filtered]);

  const applyPreset = (from: string, to: string) => {
    setDateFrom(from);
    setDateTo(to);
  };

  const clearDateRange = () => {
    setDateFrom("");
    setDateTo("");
  };

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
   * Delete every ticked document that is still on screen, ONE AT A TIME.
   *
   * Sequential on purpose: each delete is its own transaction, the server
   * refuses some of them (409 — a billing document with money attached), and
   * every refusal has to come back attached to the document it refers to.
   * Partial success is the normal outcome, so the rows that went are removed
   * from the table and the rest are named in a report that stays on screen.
   * Images freed by the deletes are pooled and the confirm dialog is opened
   * ONCE, de-duplicated: an "แก้ไข (New Ver.)" clone reuses its original's
   * image URL, so the same photo can be freed by two documents at once.
   */
  async function handleBulkDelete() {
    const targets = selectedVisible;
    if (targets.length === 0) return;
    setBulkConfirmOpen(false);
    setBulkDeleting(true);
    setBulkFailures([]);
    setBulkProgress({ done: 0, total: targets.length });

    const deletedIds: string[] = [];
    const failures: BulkFailure[] = [];
    const freedImages: string[] = [];

    for (const [index, item] of targets.entries()) {
      const endpoint =
        item.docType === "quotation" ? `/api/quotations/${item.id}` : `/api/billing/${item.id}`;
      const name = item.docNo || docTypeLabel(item.docType);
      try {
        const res = await fetch(endpoint, { method: "DELETE" });
        if (res.ok) {
          const data = await res.json().catch(() => null);
          deletedIds.push(item.id);
          if (Array.isArray(data?.orphanedImages)) {
            for (const url of data.orphanedImages) {
              if (typeof url === "string" && url) freedImages.push(url);
            }
          }
        } else {
          const data = await res.json().catch(() => null);
          failures.push({
            docNo: name,
            reason:
              typeof data?.error === "string" && data.error
                ? data.error
                : res.status === 404
                  ? "ไม่พบเอกสารนี้แล้ว (อาจถูกลบไปก่อนหน้านี้)"
                  : "ลบไม่สำเร็จ",
          });
        }
      } catch {
        failures.push({ docNo: name, reason: "เชื่อมต่อไม่สำเร็จ" });
      }
      setBulkProgress({ done: index + 1, total: targets.length });
    }

    const deletedSet = new Set(deletedIds);
    setItems((prev) => prev.filter((x) => !deletedSet.has(x.id)));
    // Un-tick what is gone; a document that was refused stays ticked so the
    // admin can deal with it without finding it again.
    setSelected((prev) => new Set([...prev].filter((id) => !deletedSet.has(id))));
    setBulkFailures(failures);
    setBulkDeleting(false);
    setBulkProgress(null);

    const parts: string[] = [];
    if (deletedIds.length > 0) parts.push(`ลบแล้ว ${deletedIds.length} ใบ`);
    if (failures.length > 0) parts.push(`ลบไม่ได้ ${failures.length} ใบ (ดูเหตุผลด้านล่าง)`);
    showToast(
      parts.join(" · ") || "ไม่มีเอกสารถูกลบ",
      failures.length > 0 && deletedIds.length === 0 ? "error" : "success"
    );

    const unique = [...new Set(freedImages)];
    if (unique.length > 0) {
      setOrphanedImages(unique.map((url) => ({ url, reason: "ลบเอกสาร" })));
    }
  }

  const latestVersions = useMemo(() => {
    const map = new Map<string, { id: string; version: number }>();
    for (const item of items) {
      if (!item.docNo) continue;
      const match = item.docNo.match(/(?:-V|-v|v|V)(\d+)$/i);
      const base = item.docNo.replace(/(?:-V|-v|v|V)\d+$/i, "");
      const version = match ? parseInt(match[1], 10) : 0;
      
      const current = map.get(base);
      if (!current || version > current.version) {
        map.set(base, { id: item.id, version });
      }
    }
    return map;
  }, [items]);

  if (isLoading || !isLoggedIn) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin h-8 w-8 border-4 border-orange-400 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <>
    <div className="min-h-screen bg-gray-50">
      {toast && <Toast message={toast.message} type={toast.type} />}

      {/* Header */}
      <div className="sticky top-0 z-20 bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
          <h1 className="text-xl font-bold text-gray-900">📋 เอกสารที่บันทึกไว้</h1>
          <div className="flex items-center gap-2 flex-wrap">
            <Link href="/billing/receivables" className="px-4 py-2 rounded-lg border border-amber-400 text-amber-700 text-sm font-semibold hover:bg-amber-50 transition">
              💰 ลูกหนี้ค้างชำระ
            </Link>
            <Link href="/adminpanel" className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm font-semibold hover:bg-gray-50 transition">
              🏠 หน้าระบบจัดการ
            </Link>
            <div className="relative create-dropdown-container">
              <button
                onClick={() => setCreateDropdownOpen(!createDropdownOpen)}
                className="px-4 py-2 rounded-lg bg-orange-500 text-white text-sm font-bold hover:bg-orange-600 transition flex items-center gap-1"
              >
                + สร้างเอกสารใหม่
                <svg className={`w-4 h-4 transition-transform ${createDropdownOpen ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" /></svg>
              </button>
              
              {createDropdownOpen && (
                <div className="absolute right-0 mt-2 w-56 bg-white rounded-xl shadow-xl border border-gray-100 overflow-hidden z-50 animate-in fade-in slide-in-from-top-2">
                  <Link
                    href="/quotation?new=1"
                    className="flex items-center gap-3 px-4 py-3 text-sm text-gray-700 hover:bg-orange-50 hover:text-orange-600 transition"
                    onClick={() => setCreateDropdownOpen(false)}
                  >
                    <span className="text-lg">📋</span>
                    <div>
                      <div className="font-bold">ใบเสนอราคา</div>
                      <div className="text-[10px] text-gray-500 font-normal leading-tight mt-0.5">สร้างใบเสนอราคาให้ลูกค้า</div>
                    </div>
                  </Link>
                  <div className="h-px bg-gray-100" />
                  <Link
                    href="/billing?type=invoice"
                    className="flex items-center gap-3 px-4 py-3 text-sm text-gray-700 hover:bg-orange-50 hover:text-orange-600 transition"
                    onClick={() => setCreateDropdownOpen(false)}
                  >
                    <span className="text-lg">🧾</span>
                    <div>
                      <div className="font-bold">ใบแจ้งหนี้ / ใบกำกับภาษี</div>
                      <div className="text-[10px] text-gray-500 font-normal leading-tight mt-0.5">สร้าง Invoice / Tax Invoice</div>
                    </div>
                  </Link>
                  <Link
                    href="/billing?type=billing_note"
                    className="flex items-center gap-3 px-4 py-3 text-sm text-gray-700 hover:bg-orange-50 hover:text-orange-600 transition"
                    onClick={() => setCreateDropdownOpen(false)}
                  >
                    <span className="text-lg">📋</span>
                    <div>
                      <div className="font-bold">ใบวางบิล</div>
                      <div className="text-[10px] text-gray-500 font-normal leading-tight mt-0.5">สร้าง Billing Note</div>
                    </div>
                  </Link>
                  <Link
                    href="/billing?type=receipt"
                    className="flex items-center gap-3 px-4 py-3 text-sm text-gray-700 hover:bg-orange-50 hover:text-orange-600 transition"
                    onClick={() => setCreateDropdownOpen(false)}
                  >
                    <span className="text-lg">🧾</span>
                    <div>
                      <div className="font-bold">ใบเสร็จรับเงิน</div>
                      <div className="text-[10px] text-gray-500 font-normal leading-tight mt-0.5">สร้าง Receipt</div>
                    </div>
                  </Link>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-6">
        {/* Filter Tabs */}
        <div className="flex gap-2 mb-4 flex-wrap">
          {TAB_OPTIONS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setFilter(tab.value)}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition ${
                filter === tab.value
                  ? "bg-orange-500 text-white shadow-sm"
                  : "bg-white border border-gray-300 text-gray-600 hover:bg-gray-50"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="mb-4">
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="ค้นหาเลขที่เอกสาร หรือ ชื่อลูกค้า..."
              className="w-full pl-10 pr-10 py-2.5 rounded-xl border border-gray-300 bg-white text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-300 focus:border-orange-400 transition shadow-sm"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Date range — the day the document was SAVED, as a Bangkok calendar
            day (lib/savedDocFilter.ts). Both ends are inclusive and either can
            be left empty. */}
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
                onClick={clearDateRange}
                className="px-4 py-2.5 rounded-xl border border-gray-300 text-gray-700 text-sm font-semibold hover:bg-gray-50 transition"
              >
                ล้างช่วงวันที่
              </button>
            )}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-xs text-gray-400">ทางลัด:</span>
            {(() => {
              const today = bangkokDateString(new Date());
              const presets: { label: string; from: string; to: string }[] = [
                { label: "วันนี้", from: today, to: today },
                { label: "7 วันที่ผ่านมา", from: addDaysToDateString(today, -6), to: today },
                { label: "30 วันที่ผ่านมา", from: addDaysToDateString(today, -29), to: today },
                { label: "เดือนนี้", from: `${today.slice(0, 8)}01`, to: today },
              ];
              return presets.map((preset) => (
                <button
                  key={preset.label}
                  onClick={() => applyPreset(preset.from, preset.to)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition ${
                    dateFrom === preset.from && dateTo === preset.to
                      ? "bg-orange-500 text-white border-orange-500"
                      : "bg-white border-gray-300 text-gray-600 hover:bg-gray-50"
                  }`}
                >
                  {preset.label}
                </button>
              ));
            })()}
          </div>

          {badRange ? (
            <p className="mt-3 text-xs font-semibold text-red-600">
              ⚠ วันเริ่มต้น ({formatDisplayDate(dateFrom)}) อยู่หลังวันสิ้นสุด ({formatDisplayDate(dateTo)}) — ช่วงนี้จึงไม่มีเอกสารใดเลย
            </p>
          ) : hasDateFilter ? (
            <p className="mt-3 text-xs font-semibold text-gray-600">
              กำลังดูเอกสารที่บันทึก{" "}
              {isValidDateString(dateFrom) && isValidDateString(dateTo)
                ? `${formatDisplayDate(dateFrom)} ถึง ${formatDisplayDate(dateTo)}`
                : isValidDateString(dateFrom)
                  ? `ตั้งแต่ ${formatDisplayDate(dateFrom)} เป็นต้นมา`
                  : `ก่อนหรือตรงกับ ${formatDisplayDate(dateTo)}`}{" "}
              · พบ {filtered.length} ใบ
            </p>
          ) : null}
        </div>

        {/* Bulk selection — scoped to the rows on screen, so the tab and the
            date range genuinely narrow what ลบที่เลือก can reach. */}
        {!loading && !loadFailed && filtered.length > 0 && (
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <button
              onClick={handleSelectAll}
              disabled={bulkDeleting}
              className="px-4 py-2 rounded-xl bg-gray-800 text-white text-sm font-semibold hover:bg-gray-900 transition disabled:opacity-50"
            >
              ☑️ เลือกทั้งหมด
            </button>
            {selected.size > 0 && (
              <button
                onClick={() => setSelected(new Set())}
                disabled={bulkDeleting}
                className="px-4 py-2 rounded-xl bg-white border border-gray-300 text-gray-700 text-sm font-semibold hover:bg-gray-50 transition disabled:opacity-50"
              >
                ล้างการเลือก
              </button>
            )}
            {selectedVisible.length > 0 && (
              <button
                onClick={() => setBulkConfirmOpen(true)}
                disabled={bulkDeleting}
                className="px-4 py-2 rounded-xl bg-red-600 text-white text-sm font-bold hover:bg-red-700 transition disabled:opacity-50 flex items-center gap-2"
              >
                {bulkDeleting ? (
                  <>
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    {bulkProgress ? `กำลังลบ ${bulkProgress.done} / ${bulkProgress.total}` : "กำลังลบ..."}
                  </>
                ) : (
                  `🗑️ ลบที่เลือก (${selectedVisible.length})`
                )}
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

        {/* Which documents a bulk delete could not remove, and why. */}
        {bulkFailures.length > 0 && (
          <div role="alert" className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-4">
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-sm font-bold text-amber-900">
                ลบไม่ได้ {bulkFailures.length} ใบ
              </h3>
              <button
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
            <p className="mt-2 text-[11px] text-amber-700">
              เอกสารที่มีการรับชำระเงินแล้วลบไม่ได้ ให้กดปุ่ม 🗑️ ของเอกสารนั้นทีละใบ ระบบจะเสนอ “ยกเลิกเอกสาร” ให้แทน
            </p>
          </div>
        )}

        {/* Table */}
        {loading ? (
          <div className="bg-white rounded-xl shadow-sm overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50 border-b">
                  <th className="px-4 py-3 w-10" />
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">ประเภท</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">เลขที่</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">ลูกค้า</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500">ยอดรวม</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500">เหลือ</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: 3 }).map((_, i) => (
                  <tr key={i} className="border-b">
                    <td className="px-4 py-3"><div className="h-4 w-4 bg-gray-200 rounded animate-pulse" /></td>
                    <td className="px-4 py-3"><div className="h-4 bg-gray-200 rounded animate-pulse w-20" /></td>
                    <td className="px-4 py-3"><div className="h-4 bg-gray-200 rounded animate-pulse w-32" /></td>
                    <td className="px-4 py-3"><div className="h-4 bg-gray-200 rounded animate-pulse w-28" /></td>
                    <td className="px-4 py-3"><div className="h-4 bg-gray-200 rounded animate-pulse w-24 ml-auto" /></td>
                    <td className="px-4 py-3"><div className="h-4 bg-gray-200 rounded animate-pulse w-12 ml-auto" /></td>
                    <td className="px-4 py-3"><div className="h-4 bg-gray-200 rounded animate-pulse w-16 ml-auto" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : loadFailed ? (
          <div className="text-center py-16">
            <p className="text-red-500 mb-3">โหลดข้อมูลไม่สำเร็จ</p>
            <button onClick={load} className="px-4 py-2 rounded-lg bg-orange-500 text-white font-semibold hover:bg-orange-600 transition">
              ลองใหม่
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <p className="text-4xl mb-3">📄</p>
            <p className="text-lg font-semibold">ยังไม่มีเอกสาร</p>
            <Link href="/billing" className="inline-block mt-3 px-4 py-2 rounded-lg bg-orange-500 text-white font-semibold hover:bg-orange-600 transition">
              สร้างเอกสารใหม่
            </Link>
          </div>
        ) : (
          <div className="bg-white rounded-xl shadow-sm overflow-hidden">
            <table className="w-full">
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
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">ประเภท</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">เลขที่</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">ลูกค้า</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500">ยอดรวม</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500">เหลือ</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => {
                  const days = daysLeft(item.createdAt);
                  return (
                    <tr
                      key={item.id}
                      className={`border-b hover:bg-gray-50/50 cursor-pointer transition ${
                        selected.has(item.id) ? "bg-red-50/60" : ""
                      }`}
                      onClick={() => {
                        if (item.docType === "quotation") router.push(`/quotation?id=${item.id}&view=1`);
                        else router.push(`/billing?id=${item.id}&view=1`);
                      }}
                    >
                      {/* stopPropagation: ticking a row must not also open it. */}
                      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          aria-label={`เลือก ${item.docNo || docTypeLabel(item.docType)}`}
                          checked={selected.has(item.id)}
                          onChange={() => toggleRow(item.id)}
                          className="w-4 h-4 rounded border-gray-300 text-red-600 focus:ring-red-500 cursor-pointer"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-bold ${
                          item.docType === "quotation" ? "bg-orange-100 text-orange-700" :
                          item.docType === "invoice" ? "bg-blue-100 text-blue-700" :
                          item.docType === "billing_note" ? "bg-purple-100 text-purple-700" :
                          "bg-green-100 text-green-700"
                        }`}>
                          {item.docType === "quotation" ? "ใบเสนอราคา" : BILLING_LABELS[item.docType].th}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono text-sm font-semibold text-gray-800">
                        {item.docNo || "-"}
                        {item.docNo && (() => {
                          const base = item.docNo.replace(/(?:-V|-v|v|V)\d+$/i, "");
                          const latest = latestVersions.get(base);
                          if (!latest || latest.version === 0) return null;
                          if (latest.id === item.id) {
                            return (
                              <span className="ml-2 inline-block text-[10px] font-bold text-orange-600 bg-orange-100 px-2 py-0.5 rounded-full whitespace-nowrap">
                                (เวอร์ชันล่าสุด)
                              </span>
                            );
                          }
                          return (
                            <span className="ml-2 inline-block text-[10px] font-bold text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full whitespace-nowrap">
                              (เวอร์ชันเก่า)
                            </span>
                          );
                        })()}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-700">{item.customer}</td>
                      <td className="px-4 py-3 text-sm text-right font-semibold text-gray-800">{fmt(item.total)}</td>
                      <td className="px-4 py-3 text-right">
                        <span className={`text-xs font-bold ${days <= 5 ? "text-red-500" : "text-gray-400"}`}>
                          {days}d
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-3">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              if (item.docType === "quotation") router.push(`/quotation?id=${item.id}&action=clone`);
                              else router.push(`/billing?id=${item.id}&action=clone`);
                            }}
                            className="text-xs text-blue-500 hover:text-blue-700 font-semibold flex items-center gap-1"
                          >
                            <span>✏️</span> แก้ไข (New Ver.)
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); setPendingDelete(item); }}
                            className="text-xs text-red-500 hover:text-red-700 font-semibold flex items-center gap-1"
                          >
                            <span>🗑️</span> ลบ
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

      {/* The 🗑️ button refused: money is attached. */}
      {blockedDelete && (
        <ConfirmDialog
          title="ลบเอกสารนี้ไม่ได้"
          message={`${blockedDelete.message}\n\nต้องการ "ยกเลิกเอกสาร" แทนหรือไม่? เอกสารและประวัติการรับชำระจะยังอยู่ครบ เพียงแต่จะไม่ถูกนับเป็นลูกหนี้อีก`}
          confirmText="ยกเลิกเอกสาร"
          loadingText="กำลังยกเลิก..."
          cancelText="ปิด"
          onConfirm={handleCancelDocument}
          onCancel={() => setBlockedDelete(null)}
          loading={cancelling}
        />
      )}

      {/* Bulk delete confirmation. It names the KINDS and the date range, not
          just a count: that one line is what gives away a bulk delete aimed at
          the wrong tab or the wrong month. */}
      {bulkConfirmOpen && selectedVisible.length > 0 && (
        <ConfirmDialog
          title={`ลบ ${selectedVisible.length} เอกสาร`}
          message={
            `กำลังจะลบ ${summariseByDocType(selectedVisible, docTypeLabel)}` +
            (hasDateFilter
              ? `\n\nช่วงวันที่: ${isValidDateString(dateFrom) ? formatDisplayDate(dateFrom) : "ไม่กำหนด"} ถึง ${isValidDateString(dateTo) ? formatDisplayDate(dateTo) : "ไม่กำหนด"}`
              : "") +
            `\n\nลบแล้วกู้คืนไม่ได้` +
            `\nเอกสารที่มีการรับชำระเงินแล้วจะถูกข้ามและแจ้งให้ทราบ` +
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

      {/* Delete confirmation */}
      {pendingDelete && (
        <ConfirmDialog
          title="ลบเอกสาร"
          message={`ต้องการลบ ${pendingDelete.docNo || "เอกสารนี้"} หรือไม่?`}
          confirmText="ลบ"
          cancelText="ยกเลิก"
          onConfirm={handleDelete}
          onCancel={() => setPendingDelete(null)}
          loading={deleting}
        />
      )}
    </div>

    {orphanedImages.length > 0 && (
      <ImageDeleteConfirmDialog
        images={orphanedImages}
        onComplete={() => setOrphanedImages([])}
      />
    )}
    </>
  );
}

export default function SavedBillingPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin h-8 w-8 border-4 border-orange-400 border-t-transparent rounded-full" />
      </div>
    }>
      <SavedBillingContent />
    </Suspense>
  );
}

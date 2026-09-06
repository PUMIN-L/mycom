"use client";
import { useState, useEffect, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "../../context/AuthContext";
import Toast from "../../components/Toast";
import ConfirmDialog from "../../components/ConfirmDialog";
import SearchableDropdown from "../../components/SearchableDropdown";
import RecordPaymentModal, {
  type PaymentTargetDoc,
} from "../../components/modals/RecordPaymentModal";
import ReceivablesGuidePanel from "../../components/ReceivablesGuidePanel";
import {
  PAYMENT_STATE_LABELS,
  dueStateLabel,
  type AgeingBucketId,
  type ReceivableEntry,
  type AgeingBucketTotal,
  type CustomerReceivableGroup,
} from "../../lib/receivables";
import { formatDisplayDate, addDaysToDateString } from "../../lib/dateFormat";

/**
 * ลูกหนี้ค้างชำระ — the screen the owner asked for.
 *
 * It answers four questions, in this order, without him opening a single
 * document:
 *   1. ยอดค้างทั้งหมด, and how much of it is already late;
 *   2. how old the debt is (the ageing strip, clickable as a filter);
 *   3. ใครค้างมากที่สุด (grouped by customer — chasing is done per customer, not
 *      per document: one phone call settles four invoices);
 *   4. per row, everything needed to act: เบอร์โทร, เลขที่, ยอดค้าง, ครบกำหนด,
 *      how late, and the single "บันทึกรับชำระ" button.
 *
 * Every number on this page comes from the same pure module the alert card and
 * the SQL eligibility clause use (lib/receivables.ts), so a tile, a badge and
 * the bell can never disagree about the same document.
 */

const fmt = (n: number) =>
  n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface LedgerPayload {
  today: string;
  creditTermDays: number;
  entries: ReceivableEntry[];
  totalOutstanding: number;
  totalOutstandingWithUndated: number;
  overdueOutstanding: number;
  overdueCount: number;
  undatedOutstanding: number;
  undatedCount: number;
  buckets: AgeingBucketTotal[];
  customers: CustomerReceivableGroup[];
  unlinkedBillingNotes: ReceivableEntry[];
  zeroTotalInvoices: ReceivableEntry[];
  undatedTargets: { id: string; docNo: string; customerName: string; docDate: string }[];
}

/** Red for late money, grey for "nobody agreed a term" — the ไม่ได้กำหนด tile
 *  must never look like an overdue one. */
const BUCKET_TONE: Record<AgeingBucketId, string> = {
  not_due: "bg-white border-gray-200 text-gray-700",
  d1_30: "bg-amber-50 border-amber-200 text-amber-800",
  d31_60: "bg-orange-50 border-orange-200 text-orange-800",
  d61_90: "bg-red-50 border-red-200 text-red-700",
  d90_plus: "bg-red-100 border-red-300 text-red-800",
  no_due_date: "bg-gray-100 border-gray-300 text-gray-600",
};

export default function ReceivablesPage() {
  const router = useRouter();
  const { isLoggedIn, isLoading: authLoading } = useAuth();

  const [data, setData] = useState<LedgerPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  const [bucketFilter, setBucketFilter] = useState<AgeingBucketId | "all">("all");
  const [customerFilter, setCustomerFilter] = useState("");
  /** Off by default, so the headline number is never inflated by documents
   *  nobody assigned a term to. */
  const [includeUndated, setIncludeUndated] = useState(false);

  const [paymentTarget, setPaymentTarget] = useState<PaymentTargetDoc | null>(null);
  const [dueDateTarget, setDueDateTarget] = useState<ReceivableEntry | null>(null);
  const [dueDateValue, setDueDateValue] = useState("");
  const [savingDueDate, setSavingDueDate] = useState(false);
  const [confirmBulkDueDates, setConfirmBulkDueDates] = useState(false);
  const [bulkSaving, setBulkSaving] = useState(false);
  /** คู่มือการใช้งาน — a plain boolean, like /crm/alerts and the PDF editor: no
   *  route, no query string, so opening it never disturbs the bucket tile, the
   *  customer filter or the ยังไม่กำหนด tick the admin was reading. */
  const [isGuideOpen, setIsGuideOpen] = useState(false);

  useEffect(() => {
    if (!authLoading && !isLoggedIn) router.replace("/login");
  }, [isLoggedIn, authLoading, router]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      const res = await fetch("/api/billing/receivables");
      if (!res.ok) throw new Error();
      setData(await res.json());
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isLoggedIn) load();
  }, [isLoggedIn, load]);

  function showToast(message: string, type: "success" | "error") {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  }

  const customerOptions = useMemo(() => {
    const names = new Set((data?.entries ?? []).map((e) => e.customerName || "-"));
    return [
      { value: "", label: "ลูกค้าทั้งหมด" },
      ...[...names].sort().map((n) => ({ value: n, label: n })),
    ];
  }, [data]);

  const visibleGroups = useMemo(() => {
    if (!data) return [];
    return data.customers
      .map((group) => ({
        ...group,
        entries: group.entries.filter((entry) => {
          if (!includeUndated && entry.bucket === "no_due_date") return false;
          if (bucketFilter !== "all" && entry.bucket !== bucketFilter) return false;
          if (customerFilter && (entry.customerName || "-") !== customerFilter) return false;
          return true;
        }),
      }))
      .filter((group) => group.entries.length > 0)
      .map((group) => ({
        ...group,
        // Subtotals follow the filter, so what the row shows and what the group
        // header claims always add up on screen.
        outstanding: group.entries.reduce((s, e) => s + e.status.outstanding, 0),
        count: group.entries.length,
      }));
  }, [data, bucketFilter, customerFilter, includeUndated]);

  const headlineOutstanding = data
    ? includeUndated
      ? data.totalOutstandingWithUndated
      : data.totalOutstanding
    : 0;

  /** The date range the bulk action would produce, computed with the SAME
   *  helper the server writes with — so the ConfirmDialog states exactly what
   *  will land, not an approximation of it. */
  const bulkPreview = useMemo(() => {
    const targets = data?.undatedTargets ?? [];
    if (targets.length === 0) return null;
    const term = data?.creditTermDays ?? 30;
    const dates = targets.map((t) => addDaysToDateString(t.docDate, term)).sort();
    return { count: targets.length, from: dates[0], to: dates[dates.length - 1], term };
  }, [data]);

  async function patchReceivable(id: string, body: Record<string, unknown>, okMessage: string) {
    try {
      const res = await fetch(`/api/billing/${encodeURIComponent(id)}/receivable`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        showToast(payload?.error ?? "อัปเดตไม่สำเร็จ", "error");
        return;
      }
      showToast(okMessage, "success");
      await load();
    } catch {
      showToast("อัปเดตไม่สำเร็จ กรุณาลองใหม่", "error");
    }
  }

  async function handleSaveDueDate() {
    if (!dueDateTarget) return;
    setSavingDueDate(true);
    await patchReceivable(dueDateTarget.id, { dueDate: dueDateValue }, "ตั้งวันครบกำหนดแล้ว");
    setSavingDueDate(false);
    setDueDateTarget(null);
  }

  async function handleBulkDueDates() {
    setBulkSaving(true);
    try {
      const res = await fetch("/api/billing/receivables/due-dates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ termDays: data?.creditTermDays }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        showToast(payload?.error ?? "ตั้งวันครบกำหนดไม่สำเร็จ", "error");
        return;
      }
      showToast(`ตั้งวันครบกำหนดให้ ${payload.updated} ใบแล้ว`, "success");
      await load();
    } catch {
      showToast("ตั้งวันครบกำหนดไม่สำเร็จ", "error");
    } finally {
      setBulkSaving(false);
      setConfirmBulkDueDates(false);
    }
  }

  if (authLoading || !isLoggedIn) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin h-8 w-8 border-4 border-orange-400 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {toast && <Toast message={toast.message} type={toast.type} />}

      <div className="sticky top-0 z-20 bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
          <h1 className="text-xl font-bold text-gray-900">💰 ลูกหนี้ค้างชำระ</h1>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => setIsGuideOpen(true)}
              className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm font-semibold hover:bg-gray-50 transition"
              aria-haspopup="dialog"
              aria-expanded={isGuideOpen}
              title="อธิบายว่าหน้านี้นับใบไหนเป็นหนี้ ต้องกดตรงไหน และตรวจว่าตัวเลขถูกได้อย่างไร"
            >
              📖 คู่มือการใช้งาน
            </button>
            <Link
              href="/billing/saved"
              className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm font-semibold hover:bg-gray-50 transition"
            >
              📋 เอกสารที่บันทึกไว้
            </Link>
            <Link
              href="/adminpanel"
              className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm font-semibold hover:bg-gray-50 transition"
            >
              🏠 หน้าระบบจัดการ
            </Link>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        {loading ? (
          <div className="bg-white rounded-2xl shadow-sm p-8">
            <div className="h-8 w-48 bg-gray-200 rounded animate-pulse mb-4" />
            <div className="h-4 w-64 bg-gray-100 rounded animate-pulse" />
          </div>
        ) : loadFailed || !data ? (
          <div className="text-center py-16">
            <p className="text-red-500 mb-3">โหลดข้อมูลไม่สำเร็จ</p>
            <button
              onClick={load}
              className="px-4 py-2 rounded-lg bg-orange-500 text-white font-semibold hover:bg-orange-600 transition"
            >
              ลองใหม่
            </button>
          </div>
        ) : (
          <>
            {/* ── 1. The one number, and how much of it is late ── */}
            <div className="bg-white rounded-2xl shadow-sm p-6">
              <p className="text-sm font-semibold text-gray-500">ยอดค้างทั้งหมด</p>
              <p className="text-4xl font-bold text-gray-900 mt-1">
                ฿{fmt(headlineOutstanding)}
              </p>
              <p className="text-sm mt-2">
                {data.overdueCount > 0 ? (
                  <span className="text-red-600 font-semibold">
                    ในนั้นเกินกำหนดแล้ว ฿{fmt(data.overdueOutstanding)} ({data.overdueCount} ใบ)
                  </span>
                ) : (
                  <span className="text-green-600 font-semibold">
                    ยังไม่มีใบที่เกินกำหนด
                  </span>
                )}
              </p>
              {data.undatedCount > 0 && !includeUndated && (
                <p className="text-xs text-gray-500 mt-2">
                  ไม่รวมอีก {data.undatedCount} ใบ (฿{fmt(data.undatedOutstanding)})
                  ที่ยังไม่ได้กำหนดวันครบกำหนด
                </p>
              )}
            </div>

            {/* ── 2. The ageing strip ── */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              {data.buckets.map((bucket) => {
                const active = bucketFilter === bucket.id;
                return (
                  <button
                    key={bucket.id}
                    onClick={() => {
                      setBucketFilter(active ? "all" : bucket.id);
                      // Clicking the undated tile has to reveal what it counts.
                      if (!active && bucket.id === "no_due_date") setIncludeUndated(true);
                    }}
                    className={`text-left rounded-2xl border p-4 transition ${BUCKET_TONE[bucket.id]} ${
                      active ? "ring-2 ring-orange-400" : "hover:shadow-sm"
                    }`}
                  >
                    <p className="text-[11px] font-bold leading-tight">{bucket.label}</p>
                    <p className="text-lg font-bold mt-1">฿{fmt(bucket.amount)}</p>
                    <p className="text-[11px] opacity-70">{bucket.count} ใบ</p>
                  </button>
                );
              })}
            </div>

            {/* ── Filters ── */}
            <div className="bg-white rounded-2xl shadow-sm p-4 flex flex-wrap items-center gap-3">
              <div className="w-full sm:w-64">
                <SearchableDropdown
                  value={customerFilter}
                  onChange={setCustomerFilter}
                  options={customerOptions}
                  placeholder="ค้นหาลูกค้า..."
                />
              </div>
              {bucketFilter !== "all" && (
                <button
                  onClick={() => setBucketFilter("all")}
                  className="px-3 py-2 rounded-lg border border-gray-300 text-sm font-semibold text-gray-600 hover:bg-gray-50 transition"
                >
                  ล้างตัวกรองช่วงอายุหนี้
                </button>
              )}
              <label className="flex items-center gap-2 text-sm text-gray-600 font-semibold cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeUndated}
                  onChange={(e) => setIncludeUndated(e.target.checked)}
                  className="w-4 h-4 accent-orange-500"
                />
                รวมที่ยังไม่กำหนดวันครบกำหนด
              </label>
              {data.undatedCount > 0 && (
                <button
                  onClick={() => setConfirmBulkDueDates(true)}
                  className="ml-auto px-3 py-2 rounded-lg border border-orange-400 text-orange-600 text-sm font-semibold hover:bg-orange-50 transition"
                >
                  ตั้งให้ทุกใบที่ยังไม่กำหนด
                </button>
              )}
            </div>

            {/* ── 3 + 4. Grouped by customer, actionable per row ── */}
            {visibleGroups.length === 0 ? (
              <div className="text-center py-16 text-gray-400 bg-white rounded-2xl shadow-sm">
                <p className="text-4xl mb-3">🎉</p>
                <p className="text-lg font-semibold">ไม่มีลูกหนี้ค้างชำระตามตัวกรองนี้</p>
              </div>
            ) : (
              <div className="space-y-4">
                {visibleGroups.map((group) => (
                  <div
                    key={group.customerName}
                    className="bg-white rounded-2xl shadow-sm overflow-hidden"
                  >
                    <div className="px-5 py-3 bg-gray-50 border-b border-gray-100 flex items-center justify-between gap-3 flex-wrap">
                      <div className="min-w-0">
                        <p className="font-bold text-gray-900 line-clamp-1">
                          {group.customerName}
                        </p>
                        {group.customerPhone && (
                          <a
                            href={`tel:${group.customerPhone}`}
                            className="text-xs text-blue-600 hover:underline"
                          >
                            📞 {group.customerPhone}
                          </a>
                        )}
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-gray-500">ค้างรวม {group.count} ใบ</p>
                        <p className="text-lg font-bold text-gray-900">
                          ฿{fmt(group.outstanding)}
                        </p>
                      </div>
                    </div>

                    <ul className="divide-y divide-gray-100">
                      {group.entries.map((entry) => (
                        <li
                          key={entry.id}
                          className="px-5 py-4 flex flex-col sm:flex-row sm:items-center gap-3"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-mono text-sm font-semibold text-gray-800">
                                {entry.docNo || "-"}
                              </span>
                              {entry.docType === "billing_note" && (
                                <span className="text-[10px] font-bold bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">
                                  ใบวางบิล (นับเป็นลูกหนี้)
                                </span>
                              )}
                              {entry.status.paymentState === "partial" && (
                                <span className="text-[10px] font-bold bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">
                                  {PAYMENT_STATE_LABELS.partial}
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-gray-500 mt-1">
                              ครบกำหนด{" "}
                              {entry.dueDate ? formatDisplayDate(entry.dueDate) : "ยังไม่กำหนด"}
                              {" · "}
                              <span
                                className={
                                  entry.status.dueState === "overdue"
                                    ? "text-red-600 font-semibold"
                                    : ""
                                }
                              >
                                {dueStateLabel(entry.status)}
                              </span>
                            </p>
                            {entry.status.paymentState === "partial" && (
                              <p className="text-xs text-gray-500">
                                ชำระแล้ว ฿{fmt(entry.paidAmount)} จาก ฿{fmt(entry.totalAmount)}
                              </p>
                            )}
                          </div>

                          <div className="text-right shrink-0">
                            <p className="text-lg font-bold text-gray-900">
                              ฿{fmt(entry.status.outstanding)}
                            </p>
                            {entry.status.overpaidBy > 0 && (
                              <p className="text-xs text-red-600 font-semibold">
                                ชำระเกิน ฿{fmt(entry.status.overpaidBy)}
                              </p>
                            )}
                          </div>

                          <div className="flex gap-2 shrink-0">
                            {!entry.dueDate && (
                              <button
                                onClick={() => {
                                  setDueDateTarget(entry);
                                  setDueDateValue(
                                    entry.docDate
                                      ? addDaysToDateString(entry.docDate, data.creditTermDays)
                                      : ""
                                  );
                                }}
                                className="px-3 py-2 rounded-xl border border-gray-300 text-gray-700 text-sm font-semibold hover:bg-gray-50 transition"
                              >
                                ตั้งวันครบกำหนด
                              </button>
                            )}
                            <button
                              onClick={() =>
                                setPaymentTarget({
                                  id: entry.id,
                                  docNo: entry.docNo,
                                  customerName: entry.customerName,
                                  totalAmount: entry.totalAmount,
                                  paidAmount: entry.paidAmount,
                                })
                              }
                              className="px-3 py-2 rounded-xl bg-green-600 text-white text-sm font-semibold hover:bg-green-700 transition"
                            >
                              บันทึกรับชำระ
                            </button>
                            <Link
                              href={`/billing?id=${encodeURIComponent(entry.id)}&view=1`}
                              className="px-3 py-2 rounded-xl border border-gray-300 text-gray-600 text-sm font-semibold hover:bg-gray-50 transition"
                            >
                              เปิด
                            </Link>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}

            {/* ── Nudge: ใบวางบิลที่ยังไม่มีใบแจ้งหนี้ ──
                Some customers are billed with an ใบวางบิล alone and no invoice is
                ever raised here. That debt is invisible under the docType rule,
                and this list is what catches it — but the decision is ALWAYS one
                click by the admin. The code never guesses. */}
            {data.unlinkedBillingNotes.length > 0 && (
              <div className="bg-white rounded-2xl shadow-sm p-5">
                <h2 className="font-bold text-gray-900">
                  📋 ใบวางบิลที่ยังไม่มีใบแจ้งหนี้ ({data.unlinkedBillingNotes.length})
                </h2>
                <p className="text-xs text-gray-500 mt-1">
                  ปกติหนี้อยู่ที่ใบแจ้งหนี้ ระบบจึงไม่นับใบวางบิลซ้ำ
                  แต่ถ้าใบไหนวางบิลอย่างเดียวโดยไม่ได้ออกใบแจ้งหนี้ ให้กด &quot;นับเป็นลูกหนี้&quot;
                </p>
                <ul className="divide-y divide-gray-100 mt-3">
                  {data.unlinkedBillingNotes.map((bn) => (
                    <li
                      key={bn.id}
                      className="py-3 flex items-center justify-between gap-3 flex-wrap"
                    >
                      <div className="min-w-0">
                        <p className="font-mono text-sm font-semibold text-gray-800">
                          {bn.docNo || "-"}
                        </p>
                        <p className="text-xs text-gray-500 line-clamp-1">
                          {bn.customerName} · ฿{fmt(bn.totalAmount)}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() =>
                            patchReceivable(
                              bn.id,
                              { receivableOverride: 1 },
                              "นับใบวางบิลนี้เป็นลูกหนี้แล้ว"
                            )
                          }
                          className="px-3 py-1.5 rounded-lg bg-purple-600 text-white text-xs font-semibold hover:bg-purple-700 transition"
                        >
                          นับเป็นลูกหนี้
                        </button>
                        <button
                          onClick={() =>
                            patchReceivable(bn.id, { receivableOverride: 0 }, "ไม่นับใบนี้แล้ว")
                          }
                          className="px-3 py-1.5 rounded-lg border border-gray-300 text-gray-600 text-xs font-semibold hover:bg-gray-50 transition"
                        >
                          ไม่นับ
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* ── Nudge: invoices with no amount. A zero invoice is usually an
                unfinished one, so it is surfaced rather than dropped. ── */}
            {data.zeroTotalInvoices.length > 0 && (
              <div className="bg-white rounded-2xl shadow-sm p-5">
                <h2 className="font-bold text-gray-900">
                  🔎 ตรวจสอบ: ใบแจ้งหนี้ที่ยังไม่มียอด ({data.zeroTotalInvoices.length})
                </h2>
                <ul className="divide-y divide-gray-100 mt-3">
                  {data.zeroTotalInvoices.map((inv) => (
                    <li key={inv.id} className="py-3 flex items-center justify-between gap-3">
                      <span className="font-mono text-sm text-gray-800">
                        {inv.docNo || "-"}{" "}
                        <span className="font-sans text-xs text-gray-500">
                          {inv.customerName}
                        </span>
                      </span>
                      <Link
                        href={`/billing?id=${encodeURIComponent(inv.id)}&view=1`}
                        className="px-3 py-1.5 rounded-lg border border-gray-300 text-gray-600 text-xs font-semibold hover:bg-gray-50 transition"
                      >
                        เปิดเอกสาร
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </div>

      {paymentTarget && (
        <RecordPaymentModal
          doc={paymentTarget}
          onClose={() => setPaymentTarget(null)}
          onSaved={(message) => {
            setPaymentTarget(null);
            showToast(message, "success");
            load();
          }}
          onError={(message) => showToast(message, "error")}
        />
      )}

      {dueDateTarget && (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
          onClick={() => setDueDateTarget(null)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold text-gray-900 mb-1">ตั้งวันครบกำหนด</h3>
            <p className="text-sm text-gray-500 mb-4">
              {dueDateTarget.docNo} · {dueDateTarget.customerName}
            </p>
            <input
              type="date"
              value={dueDateValue}
              onChange={(e) => setDueDateValue(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
            />
            <p className="text-xs text-gray-400 mt-1">
              ค่าเริ่มต้น: วันที่เอกสาร + เครดิต {data?.creditTermDays ?? 30} วัน
            </p>
            <div className="flex gap-3 mt-5">
              <button
                onClick={() => setDueDateTarget(null)}
                className="flex-1 px-4 py-2.5 rounded-lg border border-gray-300 text-gray-700 font-semibold hover:bg-gray-50 transition"
              >
                ยกเลิก
              </button>
              <button
                onClick={handleSaveDueDate}
                disabled={savingDueDate || !dueDateValue}
                className="flex-1 px-4 py-2.5 rounded-lg bg-orange-500 text-white font-semibold hover:bg-orange-600 transition disabled:opacity-60"
              >
                {savingDueDate ? "กำลังบันทึก..." : "บันทึก"}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmBulkDueDates && bulkPreview && (
        <ConfirmDialog
          title="ตั้งวันครบกำหนดทั้งหมด"
          message={`จะตั้งวันครบกำหนดให้ ${bulkPreview.count} ใบ โดยใช้วันที่เอกสาร + เครดิต ${bulkPreview.term} วัน\nวันครบกำหนดที่ได้จะอยู่ระหว่าง ${formatDisplayDate(
            bulkPreview.from
          )} ถึง ${formatDisplayDate(bulkPreview.to)}\n\nใบที่กำหนดวันไว้เองอยู่แล้วจะไม่ถูกแก้`}
          confirmText="ตั้งวันครบกำหนด"
          loadingText="กำลังบันทึก..."
          onConfirm={handleBulkDueDates}
          onCancel={() => setConfirmBulkDueDates(false)}
          loading={bulkSaving}
        />
      )}

      {/* ── คู่มือการใช้งาน ─────────────────────────────────────────────────
          Rendered LAST so it stacks above every other layer, and fed the credit
          term THIS page loaded from the settings row — the guide quotes that,
          never a number typed into its own text. */}
      {isGuideOpen && (
        <ReceivablesGuidePanel
          creditTermDays={data?.creditTermDays ?? null}
          onClose={() => setIsGuideOpen(false)}
        />
      )}
    </div>
  );
}

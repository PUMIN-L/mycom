"use client";
import React, { useState, useEffect, useCallback } from "react";
import type { SalesRecord } from "../lib/types";
import SearchableDropdown from "../components/SearchableDropdown";
import Spinner from "../components/Spinner";
import { fmtDec, safeImageUrl, stripHtml, MONTHS_TH } from "./types";

// ── Expandable row: what is actually inside one bill ────────────────────────
// Shapes mirror GET /api/admin/sales/[id]/items exactly (line items from
// `sales_record_items` + the machines from `customer_equipments`). Everything
// is optional/loose because the row is display-only: a field the API stops
// sending must degrade to "—", never blank out the table.

interface DetailLineItem {
  id?: string;
  productName?: string;
  qty?: number;
  unitPrice?: number;
  totalAmount?: number;
  costAmount?: number;
}

interface DetailEquipment {
  id?: string;
  productName?: string;
  serialNumber?: string;
  warrantyType?: string;
  warrantyStartDate?: string | null;
  warrantyEndDate?: string | null;
  status?: string;
}

/**
 * Whether the source quotation is still reachable.
 *
 * `sales_records.quotationId` is a SOFT link — quotations are purged on their
 * own 2-year retention schedule — so a non-null id is no promise that the
 * document still exists. We probe `GET /api/quotations/[id]` once, when the
 * row is expanded, and let the answer decide the button:
 *   none    — no quotationId at all (typed-in sale): no button, just a note
 *   ok      — probe returned 200: real link
 *   missing — probe returned 404: purged, button disabled ("ใบเสนอราคาถูกลบแล้ว")
 *   unknown — probe failed for any other reason (offline, 500): still disabled,
 *             but labelled as a failed check instead of claiming a deletion
 * The user is never navigated into an error page in any of these states.
 */
type QuotationLinkState = "none" | "ok" | "missing" | "unknown";

interface SaleDetail {
  items: DetailLineItem[];
  equipments: DetailEquipment[];
  quotationId: string | null;
  quotationRef: string;
  quotationLink: QuotationLinkState;
}

type DetailEntry =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; data: SaleDetail };

/** DATE-ish values are stored as VARCHAR(10); trim anything longer defensively. */
const fmtDate = (v: string | null | undefined): string =>
  v ? String(v).substring(0, 10) : "—";

const dash = (v: string | null | undefined): string => (v && String(v).trim()) || "—";

/**
 * The "open the source quotation" affordance.
 *
 * Never renders an enabled link to a quotation we have not just confirmed
 * exists: a purged one (2-year retention) gets a disabled button and a reason,
 * so the admin is never dropped onto an error page.
 */
function QuotationLink({
  quotationId,
  quotationRef,
  state,
}: {
  quotationId: string | null;
  quotationRef: string;
  state: QuotationLinkState;
}) {
  if (!quotationId || state === "none") {
    return (
      <span className="text-xs text-gray-400">ใบขายนี้ไม่ได้มาจากใบเสนอราคาในระบบ</span>
    );
  }

  if (state === "ok") {
    return (
      <a
        href={`/quotation?id=${encodeURIComponent(quotationId)}&view=1`}
        target="_blank"
        rel="noopener noreferrer"
        className="px-3 py-1.5 text-xs font-semibold bg-indigo-50 text-indigo-600 hover:bg-indigo-100 rounded-lg transition-colors inline-flex items-center gap-1.5"
        title={quotationRef ? `ใบเสนอราคา ${quotationRef}` : "เปิดใบเสนอราคาต้นทาง"}
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
        เปิดใบเสนอราคาต้นทาง
        {quotationRef && <span className="font-normal text-indigo-400">({quotationRef})</span>}
      </a>
    );
  }

  const reason = state === "missing" ? "ใบเสนอราคาถูกลบแล้ว" : "ตรวจสอบใบเสนอราคาไม่สำเร็จ";
  const hint =
    state === "missing"
      ? "ใบเสนอราคาต้นทางถูกลบตามอายุการเก็บข้อมูล (2 ปี) จึงเปิดไม่ได้"
      : "ยังตรวจสอบใบเสนอราคาต้นทางไม่ได้ในตอนนี้ จึงยังเปิดไม่ได้";
  return (
    <span className="inline-flex items-center gap-2" title={hint}>
      <button
        type="button"
        disabled
        className="px-3 py-1.5 text-xs font-semibold bg-gray-100 text-gray-400 rounded-lg cursor-not-allowed"
      >
        เปิดใบเสนอราคาต้นทาง
      </button>
      <span className="text-xs text-amber-600 bg-amber-50 px-2 py-0.5 rounded">{reason}</span>
    </span>
  );
}

/**
 * Body of one expanded row. Every failure mode lives inside this box — a broken
 * detail fetch shows a retry here and leaves the table (and the sale row above
 * it) untouched.
 */
function SaleDetailPanel({
  entry,
  onRetry,
}: {
  entry: DetailEntry | undefined;
  onRetry: () => void;
}) {
  if (!entry || entry.status === "loading") {
    return (
      <div className="bg-white border border-gray-100 rounded-xl p-4 flex items-center gap-2 text-sm text-gray-500">
        <Spinner className="h-4 w-4 text-indigo-500" />
        กำลังโหลดรายการในบิล...
      </div>
    );
  }

  if (entry.status === "error") {
    return (
      <div className="bg-white border border-red-100 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
        <span className="text-sm text-red-600">โหลดรายการสินค้าในใบขายไม่สำเร็จ</span>
        <button
          type="button"
          onClick={onRetry}
          className="px-3 py-1.5 text-xs font-semibold bg-white border border-gray-200 text-gray-600 rounded-lg hover:bg-gray-50"
        >
          ลองอีกครั้ง
        </button>
      </div>
    );
  }

  const { items, equipments, quotationId, quotationRef, quotationLink } = entry.data;

  return (
    <div className="bg-white border border-gray-100 rounded-xl p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider">
          รายการสินค้าในบิล ({items.length})
        </h4>
        <QuotationLink quotationId={quotationId} quotationRef={quotationRef} state={quotationLink} />
      </div>

      {items.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-140">
            <thead>
              <tr className="text-left text-[11px] font-medium text-gray-400 uppercase tracking-wider">
                <th className="pb-2 pr-3">สินค้า</th>
                <th className="pb-2 pr-3 text-right">จำนวน</th>
                <th className="pb-2 pr-3 text-right">ราคา/หน่วย</th>
                <th className="pb-2 pr-3 text-right">ยอดรวม</th>
                <th className="pb-2 text-right">ต้นทุนสินค้า</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, idx) => (
                <tr key={it.id || idx} className="border-t border-gray-50">
                  <td className="py-2 pr-3 text-sm text-gray-800">
                    {stripHtml(it.productName) || "ไม่ระบุสินค้า"}
                  </td>
                  <td className="py-2 pr-3 text-sm text-right text-gray-600">{Number(it.qty || 0)}</td>
                  <td className="py-2 pr-3 text-sm text-right text-gray-600">฿{fmtDec(it.unitPrice)}</td>
                  <td className="py-2 pr-3 text-sm text-right font-semibold text-gray-800">฿{fmtDec(it.totalAmount)}</td>
                  <td className="py-2 text-sm text-right text-amber-600">฿{fmtDec(it.costAmount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-gray-400">ใบขายนี้ยังไม่มีรายการสินค้าย่อยที่บันทึกไว้</p>
      )}

      <div className="pt-3 border-t border-gray-100">
        <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
          เครื่องในบิลนี้ ({equipments.length})
        </h4>
        {equipments.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-140">
              <thead>
                <tr className="text-left text-[11px] font-medium text-gray-400 uppercase tracking-wider">
                  <th className="pb-2 pr-3">สินค้า</th>
                  <th className="pb-2 pr-3">Serial Number</th>
                  <th className="pb-2 pr-3">ประเภทประกัน</th>
                  <th className="pb-2 pr-3">เริ่มประกัน</th>
                  <th className="pb-2">หมดประกัน</th>
                </tr>
              </thead>
              <tbody>
                {equipments.map((eq, idx) => (
                  <tr key={eq.id || idx} className="border-t border-gray-50">
                    <td className="py-2 pr-3 text-sm text-gray-800">{dash(stripHtml(eq.productName))}</td>
                    <td className="py-2 pr-3 text-sm font-mono text-gray-700">{dash(eq.serialNumber)}</td>
                    <td className="py-2 pr-3 text-sm text-gray-600">{dash(eq.warrantyType)}</td>
                    <td className="py-2 pr-3 text-sm text-gray-600">{fmtDate(eq.warrantyStartDate)}</td>
                    <td className="py-2 text-sm text-gray-600">{fmtDate(eq.warrantyEndDate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-gray-400">ไม่มีเครื่อง/Serial number ที่ผูกกับใบขายนี้</p>
        )}
      </div>
    </div>
  );
}

interface SalesTableProps {
  records: SalesRecord[];
  recordSearch: string;
  setRecordSearch: (v: string) => void;
  recordMonth: string;
  setRecordMonth: (v: string) => void;
  recordYear: string;
  setRecordYear: (v: string) => void;
  onView: (r: SalesRecord) => void;
  onEdit: (r: SalesRecord) => void;
  onDelete: (id: string) => void;
  onHide: () => void;
}

export default function SalesTable({
  records,
  recordSearch,
  setRecordSearch,
  recordMonth,
  setRecordMonth,
  recordYear,
  setRecordYear,
  onView,
  onEdit,
  onDelete,
  onHide,
}: SalesTableProps) {
  // Compute available years from records
  const availableYears = React.useMemo(() => {
    const yearSet = new Set<string>();
    records.forEach((r) => {
      if (r.saleDate) yearSet.add(r.saleDate.substring(0, 4));
    });
    const sorted = Array.from(yearSet).sort((a, b) => b.localeCompare(a));
    return sorted;
  }, [records]);

  // Filter records
  const filtered = records.filter((r) => {
    if (recordYear) {
      const year = r.saleDate?.substring(0, 4);
      if (year !== recordYear) return false;
    }
    if (recordMonth) {
      const month = r.saleDate?.substring(5, 7);
      if (month !== recordMonth) return false;
    }
    if (recordSearch) {
      const q = recordSearch.toLowerCase();
      const haystack = [
        r.productName, r.customerName, r.companyName,
        r.salespersonName, r.saleDate, r.quotationRef,
      ].filter(Boolean).join(" ").toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;
  const totalPages = Math.max(1, Math.ceil(filtered.length / itemsPerPage));

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [recordSearch, recordMonth, recordYear, records]);

  const paginatedRecords = filtered.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  // ── Expandable rows ───────────────────────────────────────────────────────
  // `details` doubles as the per-row cache: a row that has an entry never
  // refetches, so expanding/collapsing repeatedly costs one request. Nothing is
  // fetched until a chevron is actually clicked — loading the page with 50 rows
  // fires zero requests.
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const [details, setDetails] = useState<Record<string, DetailEntry>>({});
  // Ids already requested — guards against a second fetch from a fast
  // expand/collapse/expand (and from StrictMode's double render).
  const requestedRef = React.useRef<Set<string>>(new Set());

  // A refreshed `records` array can carry edited amounts/line items, so drop the
  // cache and collapse rather than keep showing a stale bill.
  useEffect(() => {
    setExpandedIds(new Set());
    setDetails({});
    requestedRef.current = new Set();
  }, [records]);

  const loadDetail = useCallback(async (id: string) => {
    setDetails((prev) => ({ ...prev, [id]: { status: "loading" } }));
    try {
      const res = await fetch(`/api/admin/sales/${encodeURIComponent(id)}/items`);
      if (!res.ok) throw new Error("load failed");
      const body = await res.json();

      const quotationId =
        typeof body?.quotationId === "string" && body.quotationId ? body.quotationId : null;

      // Cheap existence probe, only for rows that claim a source quotation.
      let quotationLink: QuotationLinkState = "none";
      if (quotationId) {
        try {
          const probe = await fetch(`/api/quotations/${encodeURIComponent(quotationId)}`);
          quotationLink = probe.ok ? "ok" : probe.status === 404 ? "missing" : "unknown";
        } catch {
          quotationLink = "unknown";
        }
      }

      setDetails((prev) => ({
        ...prev,
        [id]: {
          status: "ready",
          data: {
            items: Array.isArray(body?.items) ? body.items : [],
            equipments: Array.isArray(body?.equipments) ? body.equipments : [],
            quotationId,
            quotationRef: typeof body?.quotationRef === "string" ? body.quotationRef : "",
            quotationLink,
          },
        },
      }));
    } catch {
      // Contained to this row — the table and every other row keep working.
      setDetails((prev) => ({ ...prev, [id]: { status: "error" } }));
    }
  }, []);

  const toggleExpanded = useCallback(
    (id: string) => {
      setExpandedIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      if (!requestedRef.current.has(id)) {
        requestedRef.current.add(id);
        void loadDetail(id);
      }
    },
    [loadDetail]
  );

  /** Manual retry after a failed detail fetch — the only path that refetches. */
  const retryDetail = useCallback(
    (id: string) => {
      requestedRef.current.add(id);
      void loadDetail(id);
    },
    [loadDetail]
  );

  return (
    <div id="sales-records-section" className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 mb-8 scroll-mt-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-4">
        <div>
          <h2 className="text-lg font-bold text-gray-800">รายการขาย ({filtered.length})</h2>
          <p className="text-xs text-gray-500">คลิกที่แถวหรือกดปุ่ม &quot;แก้ไข&quot; เพื่อแก้ไขรายละเอียดของยอดขาย — กดลูกศร ▸ หน้าแถวเพื่อดูรายการสินค้าและเครื่องในบิลนั้น</p>
        </div>
        <div className="flex gap-2 w-full sm:w-auto items-center">
          <SearchableDropdown
            value={recordYear}
            onChange={setRecordYear}
            options={[
              { value: "", label: "ทุกปี" },
              ...availableYears.map((y) => ({ value: y, label: `พ.ศ. ${Number(y) + 543}` }))
            ]}
            className="w-36"
          />
          <SearchableDropdown
            value={recordMonth}
            onChange={setRecordMonth}
            options={[
              { value: "", label: "ทุกเดือน" },
              ...MONTHS_TH.map((m, i) => ({ value: String(i + 1).padStart(2, '0'), label: m }))
            ]}
            className="w-36"
          />
          <input
            type="text"
            value={recordSearch}
            onChange={(e) => setRecordSearch(e.target.value)}
            placeholder="ค้นหาสินค้า, ลูกค้า, บริษัท, เซลล์..."
            className="px-4 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm w-full sm:w-72 focus:bg-white focus:ring-2 focus:ring-indigo-200 outline-none"
          />
          {recordSearch && (
            <button onClick={() => setRecordSearch("")} className="px-3 py-2 text-xs bg-gray-100 text-gray-600 rounded-xl hover:bg-gray-200">
              ล้าง
            </button>
          )}
          <button
            onClick={onHide}
            className="px-3 py-2 text-xs bg-gray-100 text-gray-500 hover:text-gray-700 hover:bg-gray-200 rounded-xl transition-colors font-medium whitespace-nowrap"
            title="ซ่อนตาราง"
          >
            ✕ ซ่อนตาราง
          </button>
        </div>
      </div>
      {filtered.length > 0 ? (
        <>
          <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
          <table className="w-full">
            <thead>
              <tr className="text-left text-xs font-medium text-gray-400 uppercase tracking-wider sticky top-0 bg-white shadow-xs">
                <th className="pb-3 pr-1 w-8"><span className="sr-only">ดูรายละเอียดบิล</span></th>
                <th className="pb-3 pr-3">วันที่</th>
                <th className="pb-3 pr-3">สินค้า</th>
                <th className="pb-3 pr-3">ลูกค้า/บริษัท</th>
                <th className="pb-3 pr-3">เซลล์</th>
                <th className="pb-3 pr-3 text-right">จำนวน</th>
                <th className="pb-3 pr-3 text-right">ยอดรวม</th>
                <th className="pb-3 pr-3 text-right">กำไร</th>
                <th className="pb-3 pr-3 text-right">Margin</th>
                <th className="pb-3 text-right pr-2">การจัดการ</th>
              </tr>
            </thead>
            <tbody>
              {paginatedRecords.map((r) => {
                const isExpanded = expandedIds.has(r.id);
                return (
                <React.Fragment key={r.id}>
                <tr className="border-t border-gray-50 hover:bg-indigo-50/30 cursor-pointer transition-colors group" onClick={() => onView(r)}>
                  <td className="py-3 pr-1 align-middle">
                    {/* Separate affordance: expanding must not hijack the row
                        click that opens the view modal. */}
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleExpanded(r.id); }}
                      aria-expanded={isExpanded}
                      className={`p-1 rounded-lg transition-colors ${isExpanded ? "text-indigo-600 bg-indigo-50" : "text-gray-300 hover:text-indigo-600 hover:bg-indigo-50"}`}
                      title={isExpanded ? "ซ่อนรายการในบิล" : "ดูรายการสินค้าในบิล"}
                    >
                      <span className="sr-only">{isExpanded ? "ซ่อนรายการในบิล" : "ดูรายการสินค้าในบิล"}</span>
                      <svg className={`w-4 h-4 transition-transform ${isExpanded ? "rotate-90" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" /></svg>
                    </button>
                  </td>
                  <td className="py-3 pr-3 text-sm text-gray-600">{r.saleDate}</td>
                  <td className="py-3 pr-3 text-sm font-medium text-gray-800">

                    {stripHtml(r.productName)}
                    {safeImageUrl(r.productImage) && (
                      <img src={safeImageUrl(r.productImage)!} alt="" className="inline-block ml-2 w-6 h-6 rounded object-cover border border-gray-100 bg-gray-50" />
                    )}
                  </td>
                  <td className="py-3 pr-3">
                    <div className="text-sm text-gray-800">{r.customerName || "—"}</div>
                    <div className="text-xs text-gray-400">{r.companyName || ""}</div>
                  </td>
                  <td className="py-3 pr-3 text-sm text-gray-600">
                    {r.salespersonName ? (
                      <span className="font-medium text-gray-700">{r.salespersonName}</span>
                    ) : (
                      <span className="text-amber-600 bg-amber-50 px-2 py-0.5 rounded text-xs">ไม่ระบุเซลล์</span>
                    )}
                  </td>
                  <td className="py-3 pr-3 text-sm text-right text-gray-600">{r.qty}</td>
                  <td className="py-3 pr-3 text-sm text-right font-semibold text-gray-800">฿{fmtDec(r.totalAmount)}</td>
                  <td className="py-3 pr-3 text-sm text-right">
                    <span className="font-semibold text-emerald-700">฿{fmtDec(r.totalAmount - (r.costAmount || 0))}</span>
                  </td>
                  <td className="py-3 pr-3 text-right">
                    {(() => {
                      const cost = r.costAmount || 0;
                      const margin = r.totalAmount > 0 ? Math.round(((r.totalAmount - cost) / r.totalAmount) * 100) : 0;
                      const color = margin >= 20 ? "bg-emerald-100 text-emerald-700" : margin >= 10 ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700";
                      return <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${color}`}>{margin}%</span>;
                    })()}
                  </td>
                  <td className="py-3 text-right pr-2">
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        onClick={(e) => { e.stopPropagation(); onEdit(r); }}
                        className="px-2.5 py-1 text-xs font-semibold bg-indigo-50 text-indigo-600 hover:bg-indigo-100 rounded-lg transition-colors"
                        title="แก้ไขยอดขาย"
                      >
                        แก้ไข
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); onDelete(r.id); }}
                        className="p-1.5 text-gray-400 hover:text-red-600 transition-colors rounded-lg hover:bg-red-50"
                        title="ลบรายการ"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                      </button>
                    </div>
                  </td>
                </tr>
                {isExpanded && (
                  <tr className="bg-indigo-50/20">
                    <td colSpan={10} className="px-2 pb-4 pt-0">
                      <SaleDetailPanel
                        entry={details[r.id]}
                        onRetry={() => retryDetail(r.id)}
                      />
                    </td>
                  </tr>
                )}
                </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        {totalPages > 1 && (
          <div className="flex justify-between items-center mt-6 border-t border-gray-100 pt-4">
            <div className="text-sm text-gray-500">
              แสดง {((currentPage - 1) * itemsPerPage) + 1} ถึง {Math.min(currentPage * itemsPerPage, filtered.length)} จาก {filtered.length} รายการ
            </div>
            <div className="flex items-center gap-1">
              <button
                disabled={currentPage === 1}
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                className="px-3 py-1.5 text-sm bg-white border border-gray-200 text-gray-600 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                ก่อนหน้า
              </button>
              <div className="px-4 text-sm font-medium text-gray-700">
                หน้า {currentPage} / {totalPages}
              </div>
              <button
                disabled={currentPage === totalPages}
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                className="px-3 py-1.5 text-sm bg-white border border-gray-200 text-gray-600 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                ถัดไป
              </button>
            </div>
          </div>
        )}
        </>
      ) : (
        <div className="text-center text-gray-400 py-8 text-sm">ยังไม่มีรายการขาย</div>
      )}
    </div>
  );
}

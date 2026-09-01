"use client";
import React, { useState, useEffect } from "react";
import type { SalesRecord } from "../lib/types";
import SearchableDropdown from "../components/SearchableDropdown";
import { fmtDec, safeImageUrl, stripHtml, MONTHS_TH } from "./types";

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

  return (
    <div id="sales-records-section" className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 mb-8 scroll-mt-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-4">
        <div>
          <h2 className="text-lg font-bold text-gray-800">รายการขาย ({filtered.length})</h2>
          <p className="text-xs text-gray-500">คลิกที่แถวหรือกดปุ่ม &quot;แก้ไข&quot; เพื่อแก้ไขรายละเอียดของยอดขาย</p>
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
              {paginatedRecords.map((r) => (
                <tr key={r.id} className="border-t border-gray-50 hover:bg-indigo-50/30 cursor-pointer transition-colors group" onClick={() => onView(r)}>
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
              ))}
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

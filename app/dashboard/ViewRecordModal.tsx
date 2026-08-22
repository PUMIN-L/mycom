"use client";
import React from "react";
import type { SalesRecord } from "../lib/types";

interface ViewRecordModalProps {
  record: SalesRecord;
  onClose: () => void;
  onEdit: (record: SalesRecord) => void;
}

export default function ViewRecordModal({ record, onClose, onEdit }: ViewRecordModalProps) {
  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="p-6 border-b border-gray-100 flex justify-between items-center">
          <h3 className="text-xl font-bold text-gray-800">รายละเอียดยอดขาย</h3>
          <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="p-6 space-y-6">
          <div className="grid grid-cols-2 gap-y-4 gap-x-6 text-sm">
            <div>
              <div className="text-gray-500 mb-1">วันที่ขาย</div>
              <div className="font-semibold text-gray-800">{record.saleDate}</div>
            </div>
            <div>
              <div className="text-gray-500 mb-1">ประเภทการขาย</div>
              <div className="font-semibold text-gray-800">{record.saleType === "service" ? "บริการ/อะไหล่" : "สินค้า/เครื่องมือ"}</div>
            </div>
            <div>
              <div className="text-gray-500 mb-1">ลูกค้า</div>
              <div className="font-semibold text-gray-800">{record.customerName || "—"}</div>
            </div>
            <div>
              <div className="text-gray-500 mb-1">บริษัท</div>
              <div className="font-semibold text-gray-800">{record.companyName || "—"}</div>
            </div>
            <div className="col-span-2">
              <div className="text-gray-500 mb-1">สินค้า</div>
              <div className="font-semibold text-gray-800">{record.productName || "—"}</div>
            </div>
            <div>
              <div className="text-gray-500 mb-1">จำนวน</div>
              <div className="font-semibold text-gray-800">{record.qty}</div>
            </div>
            <div>
              <div className="text-gray-500 mb-1">เซลล์</div>
              <div className="font-semibold text-gray-800">{record.salespersonName || "—"}</div>
            </div>
            <div>
              <div className="text-gray-500 mb-1">ยอดขายสุทธิ</div>
              <div className="font-bold text-indigo-600 text-lg">฿{Number(record.totalAmount).toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
            </div>
            <div>
              <div className="text-gray-500 mb-1">ต้นทุนรวม</div>
              <div className="font-bold text-rose-600 text-lg">฿{Number(record.costAmount).toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
            </div>
          </div>

          {record.saleType === "equipment" && record.serialNumbers && record.serialNumbers.length > 0 && (
            <div className="pt-4 border-t border-gray-100">
              <div className="text-gray-500 mb-2 text-sm font-semibold">Serial Numbers</div>
              <div className="flex flex-wrap gap-2">
                {record.serialNumbers.map((sn, idx) => (
                  <span key={idx} className="px-2.5 py-1 bg-gray-100 text-gray-700 text-xs font-mono rounded-lg border border-gray-200">
                    {sn}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="pt-4 border-t border-gray-100 grid grid-cols-2 gap-4 text-sm">
            <div>
              <div className="text-gray-500 mb-1">อ้างอิงใบเสนอราคา</div>
              <div className="font-semibold text-gray-800">{record.quotationRef || "—"}</div>
            </div>
            <div>
              <div className="text-gray-500 mb-1">อ้างอิงใบ PO</div>
              <div className="font-semibold text-gray-800">{record.poRef || "—"}</div>
            </div>
            <div>
              <div className="text-gray-500 mb-1">อ้างอิงใบส่งสินค้า</div>
              <div className="font-semibold text-gray-800">{record.deliveryRef || "—"}</div>
            </div>
            <div>
              <div className="text-gray-500 mb-1">อ้างอิงใบ Invoice</div>
              <div className="font-semibold text-gray-800">{record.invoiceRef || "—"}</div>
            </div>
          </div>
          
          {record.note && (
            <div className="pt-4 border-t border-gray-100">
              <div className="text-gray-500 mb-1 text-sm font-semibold">หมายเหตุ</div>
              <div className="text-sm text-gray-700 bg-amber-50 p-3 rounded-xl border border-amber-100 whitespace-pre-wrap">{record.note}</div>
            </div>
          )}
        </div>

        <div className="p-6 border-t border-gray-100 flex justify-end gap-3 bg-gray-50/50">
          <button onClick={onClose} className="px-5 py-2.5 bg-white border border-gray-200 text-gray-700 rounded-xl font-semibold hover:bg-gray-50 hover:border-gray-300 transition-all text-sm shadow-sm">
            ปิด
          </button>
          <button 
            onClick={() => {
              onClose();
              onEdit(record);
            }} 
            className="px-5 py-2.5 bg-indigo-600 text-white rounded-xl font-semibold hover:bg-indigo-700 transition-all text-sm flex items-center gap-2 shadow-sm"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
            แก้ไขยอดขาย
          </button>
        </div>
      </div>
    </div>
  );
}

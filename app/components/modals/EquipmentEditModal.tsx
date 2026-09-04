"use client";
import React, { useState, useEffect, useMemo } from "react";
import DatePicker from "../DatePicker";
import SearchableDropdown from "../SearchableDropdown";
import type { SearchableDropdownOption } from "../SearchableDropdown";
import type { CustomerEquipment } from "../../lib/types";
import { toLocalDateString } from "../../lib/dateFormat";

// Note: stripHtml is simplified here since we can't easily import it from the dashboard types without creating circular dependencies.
function stripHtml(html?: string): string {
  if (!html) return "";
  return html.replace(/<[^>]*>/g, "");
}

interface EquipmentEditModalProps {
  initialData: Partial<CustomerEquipment>;
  onClose: () => void;
  onSaveSuccess: () => void;
  // Optional pre-fetched data
  customers?: any[];
  companies?: any[];
  products?: any[];
}

export default function EquipmentEditModal({
  initialData,
  onClose,
  onSaveSuccess,
  customers: initialCustomers,
  companies: initialCompanies,
  products: initialProducts,
}: EquipmentEditModalProps) {
  const [editing, setEditing] = useState<Partial<CustomerEquipment>>(initialData);
  const [isSaving, setIsSaving] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);

  // Local lookup state (used if props are not provided)
  const [customers, setCustomers] = useState<any[]>(initialCustomers || []);
  const [companies, setCompanies] = useState<any[]>(initialCompanies || []);
  const [products, setProducts] = useState<any[]>(initialProducts || []);

  useEffect(() => {
    // If we didn't get them from props, fetch them
    if (!initialCustomers || !initialCompanies || !initialProducts) {
      Promise.all([
        !initialCustomers ? fetch("/api/customers").then((r) => r.json()) : Promise.resolve(initialCustomers),
        !initialCompanies ? fetch("/api/companies").then((r) => r.json()) : Promise.resolve(initialCompanies),
        !initialProducts ? fetch("/api/products").then((r) => r.json()) : Promise.resolve(initialProducts),
      ]).then(([cData, compData, pData]) => {
        if (!initialCustomers) setCustomers(cData);
        if (!initialCompanies) setCompanies(compData);
        if (!initialProducts) setProducts(Array.isArray(pData) ? pData : pData.products || []);
      }).catch(console.error);
    }
  }, [initialCustomers, initialCompanies, initialProducts]);

  const companyMap = useMemo(() => new Map(companies.map((c) => [c.id, c.name])), [companies]);

  const customerOptions: SearchableDropdownOption[] = useMemo(() => 
    customers.map((c) => ({
      value: c.id,
      label: c.name,
      subLabel: c.companyName || companyMap.get(c.companyId),
    })),
    [customers, companyMap]
  );

  const productOptions: SearchableDropdownOption[] = useMemo(() => {
    const opts = products.map((p) => ({
      value: p.id,
      label: stripHtml(p.title_th),
      subLabel: stripHtml(p.title_en),
    }));

    // Ensure currently selected product is available even if not in the list
    if (editing.id && !opts.some(o => o.value === editing.productId)) {
      opts.unshift({
        value: editing.productId || "_custom",
        label: stripHtml(editing.productName) || "(สินค้าที่ระบุเอง)",
        subLabel: "กำหนดชื่อเอง",
      });
    }
    return opts;
  }, [products, editing.id, editing.productId, editing.productName]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving) return;
    setSubmitAttempted(true);
    
    if (!editing?.customerId || !editing?.productId) {
      // Basic validation handled by UI
      return;
    }
    
    setIsSaving(true);
    try {
      const method = editing.id ? "PUT" : "POST";
      const url = editing.id
        ? `/api/admin/equipments/${editing.id}`
        : "/api/admin/equipments";

      // "_custom" is a UI-only sentinel standing in for "no catalog product
      // selected" (see productOptions above) — it must never reach the API/DB
      // as a real productId.
      const payload = {
        ...editing,
        productId: editing.productId === "_custom" ? "" : editing.productId,
      };

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      
      if (!res.ok) throw new Error("Failed to save");
      onSaveSuccess(); // Trigger callback
    } catch (err) {
      console.error(err);
      alert("เกิดข้อผิดพลาดในการบันทึก");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[200] flex items-center justify-center p-4 animate-fade-in" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="p-6 border-b border-gray-100 flex justify-between items-center sticky top-0 bg-white z-10">
          <h3 className="text-xl font-bold text-gray-800">{editing?.id ? "แก้ไขอุปกรณ์" : "เพิ่มอุปกรณ์ใหม่"}</h3>
          <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <form onSubmit={handleSave} className="p-6 space-y-5">
          {/* Customer */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">ลูกค้า <span className="text-red-500">*</span></label>
            <SearchableDropdown
              options={customerOptions}
              value={editing?.customerId || ""}
              onChange={(v) => setEditing((prev) => ({ ...prev, customerId: v }))}
              placeholder="เลือกลูกค้า..."
            />
            {submitAttempted && !editing?.customerId && <p className="text-red-500 text-xs mt-1">กรุณาเลือกลูกค้า</p>}
          </div>

          {/* Product */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">สินค้า <span className="text-red-500">*</span></label>
            <SearchableDropdown
              options={productOptions}
              value={editing?.productId || ""}
              onChange={(v) => setEditing((prev) => ({ ...prev, productId: v }))}
              placeholder="เลือกสินค้า..."
            />
            {submitAttempted && !editing?.productId && <p className="text-red-500 text-xs mt-1">กรุณาเลือกสินค้า</p>}
          </div>

          {/* Serial Number */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">Serial Number</label>
            <input
              type="text"
              value={editing?.serialNumber || ""}
              onChange={(e) => setEditing((prev) => ({ ...prev, serialNumber: e.target.value }))}
              className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400"
              placeholder="หมายเลขเครื่อง"
            />
          </div>

          {/* Document refs */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">เลขที่ใบเสนอราคา</label>
              <input
                type="text"
                value={editing?.quotationNumber || ""}
                onChange={(e) => setEditing((prev) => ({ ...prev, quotationNumber: e.target.value }))}
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400"
                placeholder="QT-XXXXX"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">เลขที่ใบรับประกัน</label>
              <input
                type="text"
                value={editing?.warrantyCertNumber || ""}
                onChange={(e) => setEditing((prev) => ({ ...prev, warrantyCertNumber: e.target.value }))}
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400"
                placeholder="WR-XXXXX"
              />
            </div>
          </div>

          {/* Warranty */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">ประเภทประกัน</label>
            <input
              type="text"
              value={editing?.warrantyType || ""}
              onChange={(e) => setEditing((prev) => ({ ...prev, warrantyType: e.target.value }))}
              className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400"
              placeholder="เช่น 1 Year, On-site"
            />
          </div>
          <div className="grid grid-cols-2 gap-4 relative z-50">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">วันเริ่มประกัน</label>
              <DatePicker
                selected={editing?.warrantyStartDate ? new Date(editing.warrantyStartDate) : null}
                onChange={(date) => setEditing((prev) => ({ ...prev, warrantyStartDate: date ? toLocalDateString(date) : "" }))}
                placeholderText="ไม่ระบุ"
                isClearable
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">วันหมดประกัน</label>
              <DatePicker
                selected={editing?.warrantyEndDate ? new Date(editing.warrantyEndDate) : null}
                onChange={(date) => setEditing((prev) => ({ ...prev, warrantyEndDate: date ? toLocalDateString(date) : "" }))}
                placeholderText="ไม่ระบุ"
                isClearable
              />
            </div>
          </div>

          {/* Calibration */}
          <div className="relative z-50">
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">วันที่สอบเทียบ</label>
            <DatePicker
              selected={editing?.calibrationDate ? new Date(editing.calibrationDate) : null}
              onChange={(date) => setEditing((prev) => ({ ...prev, calibrationDate: date ? toLocalDateString(date) : "" }))}
              placeholderText="ไม่ระบุ"
              isClearable
            />
            <p className="text-xs text-gray-400 mt-1">ระบบจะแจ้งเตือนล่วงหน้าเมื่อใกล้ถึงกำหนดสอบเทียบครั้งถัดไป (10 เดือนหลังวันนี้)</p>
          </div>

          {/* Status */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">สถานะ</label>
            <div className="flex gap-4">
              {["Active", "Expired"].map((s) => (
                <label key={s} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="status"
                    checked={(editing?.status || "Active") === s}
                    onChange={() => setEditing((prev) => ({ ...prev, status: s }))}
                    className="accent-indigo-600"
                  />
                  <span className="text-sm text-gray-700">{s === "Active" ? "ใช้งานอยู่ (Active)" : "หมดอายุ (Expired)"}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2.5 text-sm font-semibold text-gray-700 bg-white border border-gray-300 rounded-xl hover:bg-gray-50 transition-colors"
            >
              ยกเลิก
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="px-5 py-2.5 text-sm font-semibold text-white bg-indigo-600 rounded-xl hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {isSaving ? (
                <>
                  <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  กำลังบันทึก...
                </>
              ) : (
                "บันทึกข้อมูล"
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

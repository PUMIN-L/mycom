"use client";
import React, { useState, useEffect } from "react";
import DatePicker from "../DatePicker";
import SearchableDropdown from "../SearchableDropdown";
import FormattedNumberInput from "../FormattedNumberInput";
import type { SalesRecord } from "../../lib/types";

function stripHtml(html?: string): string {
  if (!html) return "";
  return html.replace(/<[^>]*>/g, "");
}

const COST_TYPE_OPTIONS = [
  { value: "product", label: "📦 ต้นทุนค่าสินค้า" },
  { value: "labor", label: "👷 ค่าแรง/ค่าบริการ" },
  { value: "transport", label: "🚚 ค่าเดินทาง/ขนส่ง" },
  { value: "other", label: "อื่นๆ" },
];

function fmtDec(val: number) {
  return new Intl.NumberFormat("th-TH").format(val);
}

const emptyForm = () => ({
  saleType: "equipment" as "equipment" | "service",
  salespersonId: "",
  customerId: "",
  companyId: "",
  productId: "",
  productName: "",
  categoryId: null as number | null,
  qty: 1,
  unitPrice: 0,
  totalAmount: 0,
  saleDate: new Date().toISOString().substring(0, 10),
  quotationRef: "",
  poRef: "",
  deliveryRef: "",
  invoiceRef: "",
  receiptRef: "",
  warrantyStartDate: "",
  warrantyEndDate: "",
  serialNumbers: [] as string[],
  note: "",
});

interface CostItemLocal {
  id?: number;
  costType: string;
  label: string;
  amount: number;
  note: string;
}

interface SalesRecordEditModalProps {
  editingId: string | null;
  onClose: () => void;
  onSaveSuccess: () => void;
  // Optional lookup data
  customers?: any[];
  companies?: any[];
  products?: any[];
  salespeople?: any[];
}

export default function SalesRecordEditModal({
  editingId,
  onClose,
  onSaveSuccess,
  customers: initialCustomers,
  companies: initialCompanies,
  products: initialProducts,
  salespeople: initialSalespeople,
}: SalesRecordEditModalProps) {
  const [form, setForm] = useState(emptyForm());
  const [formErrors, setFormErrors] = useState<Record<string, boolean>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [costItems, setCostItems] = useState<CostItemLocal[]>([]);
  const [showCostCalc, setShowCostCalc] = useState(false);
  const [costSubmitError, setCostSubmitError] = useState(false);
  
  const [customers, setCustomers] = useState<any[]>(initialCustomers || []);
  const [companies, setCompanies] = useState<any[]>(initialCompanies || []);
  const [products, setProducts] = useState<any[]>(initialProducts || []);
  const [salespeople, setSalespeople] = useState<any[]>(initialSalespeople || []);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
      try {
        const promises = [];
        if (!initialCustomers) promises.push(fetch("/api/customers").then((r) => r.json()).then(d => setCustomers(d)));
        if (!initialCompanies) promises.push(fetch("/api/companies").then((r) => r.json()).then(d => setCompanies(d)));
        if (!initialProducts) promises.push(fetch("/api/products").then((r) => r.json()).then(d => setProducts(Array.isArray(d) ? d : d.products || [])));
        if (!initialSalespeople) promises.push(fetch("/api/salespeople").then((r) => r.json()).then(d => setSalespeople(d.salespeople || [])));
        
        await Promise.all(promises);

        if (editingId) {
          const fullRes = await fetch(`/api/admin/sales/${editingId}`);
          if (!fullRes.ok) throw new Error("Load failed");
          const fullRec = await fullRes.json();

          const costsRes = await fetch(`/api/admin/sales/${editingId}/costs`);
          const costsData = costsRes.ok ? await costsRes.json() : { items: [] };

          setForm({
            saleType: fullRec.saleType || "equipment",
            salespersonId: fullRec.salespersonId || "",
            customerId: fullRec.customerId || "",
            companyId: fullRec.companyId || "",
            productId: fullRec.productId || "",
            productName: fullRec.productName || "",
            categoryId: fullRec.categoryId,
            qty: fullRec.qty || 1,
            unitPrice: fullRec.unitPrice || 0,
            totalAmount: fullRec.totalAmount || 0,
            saleDate: fullRec.saleDate ? fullRec.saleDate.substring(0, 10) : "",
            quotationRef: fullRec.quotationRef || "",
            poRef: fullRec.poRef || "",
            deliveryRef: fullRec.deliveryRef || "",
            invoiceRef: fullRec.invoiceRef || "",
            receiptRef: fullRec.receiptRef || "",
            warrantyStartDate: fullRec.warrantyStartDate ? String(fullRec.warrantyStartDate).substring(0, 10) : "",
            warrantyEndDate: fullRec.warrantyEndDate ? String(fullRec.warrantyEndDate).substring(0, 10) : "",
            serialNumbers: Array.isArray(fullRec.serialNumbers) ? [...fullRec.serialNumbers] : [],
            note: fullRec.note || "",
          });

          if (costsData.items && costsData.items.length > 0) {
            setCostItems(costsData.items.map((it: any) => ({
              id: it.id, costType: it.costType, label: it.label,
              amount: Number(it.amount), note: it.note || "",
            })));
            setShowCostCalc(true);
          }
        } else {
            setForm(emptyForm());
        }
      } catch (err) {
        console.error(err);
      } finally {
        setIsLoading(false);
      }
    }
    loadData();
  }, [editingId, initialCustomers, initialCompanies, initialProducts, initialSalespeople]);

  const customerOptions = customers.map((c) => ({ value: c.id, label: c.name }));
  const companyOptions = companies.map((c) => ({ value: c.id, label: c.name }));
  const productOptions = products.map((p) => ({ value: p.id, label: stripHtml(p.title_th) }));
  const salespersonOptions = salespeople.map((s) => ({ value: s.id, label: s.name }));

  const costTotal = costItems.reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);
  const formProfit = form.totalAmount - costTotal;
  const formMargin = form.totalAmount > 0 ? (formProfit / form.totalAmount) * 100 : 0;

  const addLocalCostItem = () => {
    setCostItems([...costItems, { costType: "product", label: "", amount: 0, note: "" }]);
  };

  const updateLocalCostItem = (idx: number, field: keyof CostItemLocal, val: any) => {
    const newItems = [...costItems];
    newItems[idx] = { ...newItems[idx], [field]: val };
    setCostItems(newItems);
    setCostSubmitError(false);
  };

  const removeLocalCostItem = (idx: number) => {
    setCostItems(costItems.filter((_, i) => i !== idx));
  };

  const handleSave = async () => {
    if (isSaving) return;
    const errors: Record<string, boolean> = {};
    if (!form.saleDate) errors.saleDate = true;
    if (!form.productName) errors.productName = true;
    if (!form.qty || form.qty < 1) errors.qty = true;
    if (form.unitPrice === undefined || form.unitPrice === null) errors.unitPrice = true;
    if (!form.poRef) errors.poRef = true;

    if (form.saleType === "equipment") {
      if (!form.warrantyStartDate) errors.warrantyStartDate = true;
      if (!form.warrantyEndDate) errors.warrantyEndDate = true;
    }

    if (showCostCalc) {
      let hasCostError = false;
      costItems.forEach(ci => {
        if (!ci.amount || ci.amount <= 0) {
          hasCostError = true;
        }
      });
      if (hasCostError) {
        errors.costItems = true;
        setCostSubmitError(true);
      }
    }

    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      alert("กรุณากรอกข้อมูลที่จำเป็นให้ครบถ้วน");
      return;
    }
    
    setFormErrors({});
    setIsSaving(true);
    
    try {
      const url = editingId ? `/api/admin/sales/${editingId}` : "/api/admin/sales";
      const method = editingId ? "PUT" : "POST";
      const payload = { ...form };
      
      if (payload.saleType === "equipment" && Array.isArray(payload.serialNumbers)) {
        payload.serialNumbers = payload.serialNumbers.slice(0, Math.max(1, payload.qty || 1));
      }
      
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (res.ok || res.status === 207) {
        const savedData = await res.json();
        const savedRecord = method === "POST" ? savedData.record : savedData;
        const recordId = savedRecord?.id || editingId;

        if (recordId) {
          try {
            const validCostItems = costItems.filter(ci => ci.amount > 0);
            await fetch(`/api/admin/sales/${recordId}/costs/sync`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(validCostItems),
            });
          } catch (err: any) {
            console.error("Failed to sync costs", err);
          }
        }
        
        onSaveSuccess();
      } else {
        const err = await res.json();
        alert(err.error || "เกิดข้อผิดพลาด");
      }
    } catch { 
      alert("เกิดข้อผิดพลาด");
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) return null;

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[200] flex items-center justify-center p-4 animate-fade-in" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="p-6 border-b border-gray-100 flex justify-between items-center sticky top-0 bg-white z-10">
          <h3 className="text-xl font-bold text-gray-800">{editingId ? "แก้ไขรายการขาย" : "บันทึกยอดขาย"}</h3>
          <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="p-6 space-y-5">
            <div className="flex gap-6 mb-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="saleType" value="equipment" checked={form.saleType === "equipment"} onChange={(e) => { const v = e.target.value; setForm(prev => ({ ...prev, saleType: v as any })); }} className="w-4 h-4 text-indigo-600 focus:ring-indigo-500" />
                <span className="text-sm font-semibold text-gray-800">💻 ขายเครื่อง</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="saleType" value="service" checked={form.saleType === "service"} onChange={(e) => { const v = e.target.value; setForm(prev => ({ ...prev, saleType: v as any })); }} className="w-4 h-4 text-amber-600 focus:ring-amber-500" />
                <span className="text-sm font-semibold text-gray-800">🔧 ขายงาน Service</span>
              </label>
            </div>
            
            <div className="grid grid-cols-2 gap-4 relative z-[60]">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">วันที่ขาย <span className="text-red-500">*</span></label>
                <DatePicker
                    selected={form.saleDate ? new Date(form.saleDate) : null}
                    onChange={(date) => { const v = date ? date.toISOString().split('T')[0] : ""; setForm(prev => ({ ...prev, saleDate: v })); }}
                    className={`w-full px-4 py-2.5 border rounded-xl text-sm focus:outline-none focus:ring-2 transition-all ${formErrors.saleDate ? "border-red-500 bg-red-50 focus:border-red-500 focus:ring-red-200" : "bg-gray-50 border-gray-200 focus:ring-indigo-500/20 focus:border-indigo-500"}`}
                  />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">เซลล์</label>
                <SearchableDropdown options={salespersonOptions} value={form.salespersonId} onChange={(v) => setForm(prev => ({ ...prev, salespersonId: v }))} placeholder="เลือกเซลล์..." />
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">ชื่อสินค้าที่แสดง <span className="text-red-500">*</span></label>
              <input
                type="text"
                required
                value={form.productName}
                onChange={(e) => { const v = e.target.value; setForm(prev => ({ ...prev, productName: v })); }}
                placeholder="ชื่อเครื่อง / สินค้า / บริการ"
                className={`w-full px-3 py-2.5 border rounded-xl text-sm focus:ring-2 outline-none ${formErrors.productName ? "border-red-500 bg-red-50 focus:border-red-500 focus:ring-red-200" : "border-gray-200 focus:ring-indigo-200 focus:border-indigo-400"}`}
              />
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">ลูกค้า</label>
                <SearchableDropdown
                  options={customerOptions}
                  value={form.customerId}
                  onChange={(v) => {
                    const c = customers.find((x) => x.id === v);
                    setForm(prev => ({ ...prev, customerId: v, companyId: c?.companyId || prev.companyId }));
                  }}
                  placeholder="เลือกลูกค้า..."
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">บริษัท</label>
                <SearchableDropdown options={companyOptions} value={form.companyId} onChange={(v) => setForm(prev => ({ ...prev, companyId: v }))} placeholder="เลือกบริษัท..." />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">จำนวน <span className="text-red-500">*</span></label>
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={form.qty || ""}
                  onChange={(e) => {
                    const val = e.target.value;
                    const q = val === "" ? 0 : Math.max(0, parseInt(val, 10) || 0);
                    setForm(prev => ({ ...prev, qty: q, totalAmount: q * prev.unitPrice }));
                  }}
                  onWheel={(e) => e.currentTarget.blur()}
                  placeholder="1"
                  className={`w-full px-3 py-2.5 border rounded-xl text-sm focus:ring-2 outline-none ${formErrors.qty ? "border-red-500 bg-red-50 focus:border-red-500 focus:ring-red-200" : "border-gray-200 focus:ring-indigo-200 focus:border-indigo-400"}`}
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">ราคาต่อหน่วย (฿) <span className="text-red-500">*</span></label>
                <FormattedNumberInput
                  value={form.unitPrice || 0}
                  onChange={(val) => {
                    setForm(prev => ({ ...prev, unitPrice: val, totalAmount: (prev.qty || 1) * val }));
                  }}
                  placeholder="0"
                  className={`w-full px-3 py-2.5 border rounded-xl text-sm focus:ring-2 outline-none font-medium text-gray-800 ${formErrors.unitPrice ? "border-red-500 bg-red-50 focus:border-red-500 focus:ring-red-200" : "border-gray-200 focus:ring-indigo-200 focus:border-indigo-400"}`}
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">ยอดรวม (฿)</label>
                <FormattedNumberInput
                  value={form.totalAmount || 0}
                  onChange={(val) => setForm(prev => ({ ...prev, totalAmount: val }))}
                  placeholder="0"
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 outline-none bg-gray-50 font-semibold text-gray-800"
                />
              </div>
            </div>

            {/* Cost Calculator Section */}
            <div className="border border-dashed border-emerald-300 rounded-xl bg-emerald-50/50 p-4 relative z-50">
              <div className="flex justify-between items-center mb-3">
                <button
                  type="button"
                  onClick={() => { setShowCostCalc(!showCostCalc); if (!showCostCalc && costItems.length === 0) addLocalCostItem(); }}
                  className="text-sm font-semibold text-emerald-700 hover:text-emerald-800"
                >
                  💰 {showCostCalc ? "ซ่อน" : "เปิด"} ตัวช่วยคำนวณต้นทุน
                </button>
                {(form.totalAmount > 0 || costTotal > 0) && (
                  <div className="flex items-center gap-3 text-sm">
                    <span className="text-gray-500">กำไร: <span className={`font-bold ${formProfit >= 0 ? "text-emerald-700" : "text-red-600"}`}>฿{fmtDec(formProfit)}</span></span>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${formMargin >= 20 ? "bg-emerald-100 text-emerald-700" : formMargin >= 10 ? "bg-amber-100 text-amber-700" : formMargin >= 0 ? "bg-red-100 text-red-700" : "bg-red-200 text-red-800"}`}>
                      Margin {formMargin.toFixed(1)}%
                    </span>
                  </div>
                )}
              </div>
              {showCostCalc && (
                <div className="space-y-2">
                  {costItems.map((ci, idx) => (
                    <div key={idx} className="flex gap-2 items-start">
                      <SearchableDropdown
                        options={COST_TYPE_OPTIONS}
                        value={ci.costType}
                        onChange={(v) => updateLocalCostItem(idx, "costType", v)}
                        placeholder="ประเภท..."
                        className="w-44 shrink-0"
                        buttonClassName="h-[38px] border-gray-200"
                      />
                      <input type="text" value={ci.label} onChange={(e) => updateLocalCostItem(idx, "label", e.target.value)} placeholder="รายละเอียด" className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-emerald-200 outline-none" />
                      <FormattedNumberInput value={ci.amount || 0} onChange={(val) => updateLocalCostItem(idx, "amount", val)} placeholder="0" className={`w-28 px-3 py-2 border rounded-lg text-sm text-right font-medium outline-none ${costSubmitError && (!ci.amount || ci.amount <= 0) ? "border-red-400 bg-red-50 focus:ring-2 focus:ring-red-200" : "border-gray-200 focus:ring-2 focus:ring-emerald-200"}`} />
                      <button type="button" onClick={() => removeLocalCostItem(idx)} className="p-2 text-gray-400 hover:text-red-500 transition-colors shrink-0">✕</button>
                    </div>
                  ))}
                  <div className="flex justify-between items-center pt-2">
                    <button type="button" onClick={addLocalCostItem} className="text-sm text-emerald-600 hover:text-emerald-700 font-medium">+ เพิ่มรายการต้นทุน</button>
                    <div className="text-sm font-semibold text-gray-700">รวมต้นทุน: <span className="text-amber-700">฿{fmtDec(costTotal)}</span></div>
                  </div>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">อ้างอิงใบเสนอราคา</label>
                <input type="text" value={form.quotationRef} onChange={(e) => setForm(prev => ({ ...prev, quotationRef: e.target.value }))} placeholder="เลขที่ใบเสนอราคา" className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 outline-none" />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">อ้างอิงใบ PO <span className="text-red-500">*</span></label>
                <input type="text" value={form.poRef} onChange={(e) => setForm(prev => ({ ...prev, poRef: e.target.value }))} placeholder="เลขที่ใบ PO" className={`w-full px-3 py-2.5 border rounded-xl text-sm focus:ring-2 outline-none ${formErrors.poRef ? "border-red-500 bg-red-50 focus:border-red-500 focus:ring-red-200" : "border-gray-200 focus:ring-indigo-200 focus:border-indigo-400"}`} />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">อ้างอิงใบส่งสินค้า</label>
                <input type="text" value={form.deliveryRef} onChange={(e) => setForm(prev => ({ ...prev, deliveryRef: e.target.value }))} placeholder="เลขที่ใบส่งสินค้า" className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 outline-none" />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">อ้างอิงใบ Invoice</label>
                <input type="text" value={form.invoiceRef} onChange={(e) => setForm(prev => ({ ...prev, invoiceRef: e.target.value }))} placeholder="เลขที่ใบ Invoice" className={`w-full px-3 py-2.5 border rounded-xl text-sm focus:ring-2 outline-none ${formErrors.invoiceRef ? "border-red-500 bg-red-50 focus:border-red-500 focus:ring-red-200" : "border-gray-200 focus:ring-indigo-200 focus:border-indigo-400"}`} />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">อ้างอิงใบเสร็จ</label>
                <input type="text" value={form.receiptRef} onChange={(e) => setForm(prev => ({ ...prev, receiptRef: e.target.value }))} placeholder="เลขที่ใบเสร็จ" className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 outline-none" />
              </div>
            </div>

            {form.saleType === "equipment" && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 relative z-40">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">วันเริ่มรับประกัน <span className="text-red-500">*</span></label>
                  <DatePicker
                    selected={form.warrantyStartDate ? new Date(form.warrantyStartDate) : null}
                    onChange={(date) => { const v = date ? date.toISOString().split('T')[0] : ""; setForm(prev => ({ ...prev, warrantyStartDate: v })); }}
                    placeholderText="ไม่ระบุ"
                    isClearable
                    className={`w-full px-4 py-2.5 border rounded-xl text-sm focus:outline-none focus:ring-2 transition-all ${formErrors.warrantyStartDate ? "border-red-500 bg-red-50 focus:border-red-500 focus:ring-red-200" : "bg-gray-50 border-gray-200 focus:ring-indigo-500/20 focus:border-indigo-500"}`}
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">วันหมดรับประกัน <span className="text-red-500">*</span></label>
                  <DatePicker
                    selected={form.warrantyEndDate ? new Date(form.warrantyEndDate) : null}
                    onChange={(date) => { const v = date ? date.toISOString().split('T')[0] : ""; setForm(prev => ({ ...prev, warrantyEndDate: v })); }}
                    placeholderText="ไม่ระบุ"
                    isClearable
                    className={`w-full px-4 py-2.5 border rounded-xl text-sm focus:outline-none focus:ring-2 transition-all ${formErrors.warrantyEndDate ? "border-red-500 bg-red-50 focus:border-red-500 focus:ring-red-200" : "bg-gray-50 border-gray-200 focus:ring-indigo-500/20 focus:border-indigo-500"}`}
                  />
                </div>
              </div>
            )}

            {form.saleType === "equipment" && form.qty > 0 && (
              <div className="p-5 bg-gray-50 border border-gray-100 rounded-2xl">
                <label className="block text-sm font-semibold text-gray-700 mb-3">หมายเลขซีเรียล</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {Array.from({ length: Math.min(form.qty, 50) }).map((_, i) => (
                    <div key={i} className="flex items-center gap-3 bg-white p-2 rounded-xl border border-gray-200">
                      <span className="text-xs text-gray-500 font-bold bg-gray-100 px-2 py-1 rounded-md shrink-0">#{i + 1}</span>
                      <input type="text" value={(form.serialNumbers && form.serialNumbers[i]) || ""} onChange={(e) => { const val = e.target.value; setForm(prev => { const newSn = [...(prev.serialNumbers || [])]; newSn[i] = val; return { ...prev, serialNumbers: newSn }; }); }} placeholder="Serial Number..." className="w-full px-2 py-1 text-sm focus:outline-none bg-transparent" />
                    </div>
                  ))}
                </div>
              </div>
            )}
        </div>
        <div className="p-6 border-t border-gray-100 flex justify-end gap-3 sticky bottom-0 bg-white z-10 rounded-b-2xl">
          <button onClick={onClose} className="px-5 py-2.5 bg-white border border-gray-200 text-gray-700 rounded-xl font-semibold hover:bg-gray-50 transition-all text-sm shadow-sm">
            ยกเลิก
          </button>
          <button onClick={handleSave} disabled={isSaving} className="px-5 py-2.5 bg-indigo-600 text-white rounded-xl font-semibold hover:bg-indigo-700 transition-all text-sm shadow-sm flex items-center gap-2 disabled:opacity-50">
            {isSaving ? "กำลังบันทึก..." : "บันทึกข้อมูล"}
          </button>
        </div>
      </div>
    </div>
  );
}

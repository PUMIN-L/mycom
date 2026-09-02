"use client";
import React, { useState, useEffect, useCallback, useMemo, useRef, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import DatePicker from "../components/DatePicker";
import { toLocalDateString } from "../lib/dateFormat";
import { downloadExcel } from "../lib/xlsxExport";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine,
  PieChart, Pie, Cell, Legend,
  LineChart, Line,
} from "recharts";
import SearchableDropdown from "../components/SearchableDropdown";
import type { SearchableDropdownOption } from "../components/SearchableDropdown";
import FormattedNumberInput from "../components/FormattedNumberInput";
import ConfirmDialog from "../components/ConfirmDialog";
import type { SalesRecord, CustomerEquipment } from "../lib/types";
import ViewRecordModal from "./ViewRecordModal";
import SalesTable from "./SalesTable";
import {
  type DashboardData, type TopItem, type SalespersonStat,
  type CostItemLocal, type Product, type Customer, type Company, type Salesperson,
  COST_TYPE_LABELS, COST_TYPE_OPTIONS,
  fmt, fmtDec, MONTHS_TH, PIE_COLORS,
  pctChange, stripHtml, safeImageUrl, emptyForm,
} from "./types";

// emptyForm imported from ./types

// ── Main Component ───────────────────────────────────────────────────────────

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [periodType, setPeriodType] = useState<"month" | "quarter" | "year">("year");
  const [periodValue, setPeriodValue] = useState<string>(
    new Date().getFullYear().toString()
  );
  const [chartMode, setChartMode] = useState<"monthly" | "quarterly">("monthly");

  // Sales record form
  const [showForm, setShowForm] = useState(false);
  const [salesRecords, setSalesRecords] = useState<SalesRecord[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [salespeople, setSalespeople] = useState<Salesperson[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [isSaving, setIsSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [viewingRecord, setViewingRecord] = useState<SalesRecord | null>(null);
  const [showRecords, setShowRecords] = useState(true);
  const [recordSearch, setRecordSearch] = useState("");
  const [recordMonth, setRecordMonth] = useState("");
  const [recordYear, setRecordYear] = useState("");
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);
  const [costItems, setCostItems] = useState<CostItemLocal[]>([]);
  const [showCostCalc, setShowCostCalc] = useState(false);
  const [costLoading, setCostLoading] = useState(false);
  const [costSubmitError, setCostSubmitError] = useState(false);
  const [formErrors, setFormErrors] = useState<Record<string, boolean>>({});
  const [pendingEquipments, setPendingEquipments] = useState<CustomerEquipment[]>([]);

  const handleScrollToRecords = () => {
    setShowRecords(true);
    setTimeout(() => {
      document.getElementById("sales-records-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  };

  const showToast = useCallback((msg: string, type: "success" | "error") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  // Fetch dashboard data
  const fetchDashboard = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/dashboard?periodType=${periodType}&periodValue=${periodValue}`);
      if (res.ok) setData(await res.json());
    } catch { /* ignore */ }
    setLoading(false);
  }, [periodType, periodValue]);

  // Fetch lookups
  const fetchLookups = useCallback(async () => {
    try {
      const [pRes, cRes, coRes, spRes] = await Promise.all([
        fetch("/api/products"), fetch("/api/customers"), fetch("/api/companies"), fetch("/api/salespeople"),
      ]);
      if (pRes.ok) { const d = await pRes.json(); setProducts(Array.isArray(d) ? d : d.products || []); }
      if (cRes.ok) setCustomers(await cRes.json());
      if (coRes.ok) setCompanies(await coRes.json());
      if (spRes.ok) setSalespeople(await spRes.json());
    } catch { /* ignore */ }
  }, []);

  const fetchRecords = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/sales?t=" + Date.now());
      if (res.ok) setSalesRecords(await res.json());
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { fetchDashboard(); }, [fetchDashboard]);
  useEffect(() => { fetchLookups(); fetchRecords(); }, [fetchLookups, fetchRecords]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && showForm) {
        setShowForm(false);
        setEditingId(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showForm]);



  // Dropdown options
  const productOptions: SearchableDropdownOption[] = useMemo(() =>
    products.map((p) => ({ value: p.id, label: stripHtml(p.title_th), subLabel: stripHtml(p.title_en) })),
    [products]
  );
  const customerOptions: SearchableDropdownOption[] = useMemo(() =>
    customers.map((c) => ({ value: c.id, label: c.name, subLabel: c.companyName || "" })),
    [customers]
  );
  const companyOptions: SearchableDropdownOption[] = useMemo(() =>
    companies.map((c) => ({ value: c.id, label: c.name })),
    [companies]
  );
  const salespersonOptions: SearchableDropdownOption[] = useMemo(() =>
    salespeople.map((s) => ({ value: s.id, label: s.name })),
    [salespeople]
  );
  const yearOptions: SearchableDropdownOption[] = useMemo(() =>
    [0, 1, 2, 3, 4].map((i) => {
      const y = String(new Date().getFullYear() - i);
      return { value: y, label: `ปี ${y}` };
    }),
    []
  );

  // Chart data
  const chartData = useMemo(() => {
    if (!data) return [];
    if (chartMode === "monthly") {
      return data.revenueMonthly.map((r) => {
        const parts = r.period.split("-");
        if (parts.length === 3) {
          return { ...r, name: `${parseInt(parts[2], 10)} ${MONTHS_TH[parseInt(parts[1], 10) - 1]}` };
        }
        const monthIndex = parseInt(parts[1], 10) - 1;
        return { ...r, name: MONTHS_TH[monthIndex] };
      });
    }
    return data.revenueQuarterly.map((r) => ({ ...r, name: r.period.split("-")[1] }));
  }, [data, chartMode]);

  // Filtered sales records for table search

  // Save sales record
  const handleSave = async () => {
    if (isSaving) return;

    const errors: Record<string, boolean> = {};
    if (!form.saleDate) errors.saleDate = true;
    if (!form.productName.trim()) errors.productName = true;
    if (!form.qty || form.qty <= 0) errors.qty = true;
    if (!form.unitPrice || form.unitPrice <= 0) errors.unitPrice = true;
    if (!form.poRef.trim()) errors.poRef = true;
    
    if (form.saleType === "equipment") {
      if (!form.warrantyStartDate) errors.warrantyStartDate = true;
      if (!form.warrantyEndDate) errors.warrantyEndDate = true;
    }
    
    if (form.deliveryRef && !form.invoiceRef) errors.invoiceRef = true;

    const totalCost = costItems.reduce((acc, curr) => acc + curr.amount, 0);
    if (!showCostCalc || costItems.length === 0 || totalCost <= 0) {
      setCostSubmitError(true);
      setShowCostCalc(true); 
      if (costItems.length === 0) {
        setCostItems([{ costType: "product_cost", label: "", amount: 0, note: "" }]);
      }
      errors.costItems = true;
    } else {
      const hasEmptyCost = costItems.some(ci => !ci.amount || ci.amount <= 0);
      if (hasEmptyCost) {
        setCostSubmitError(true);
        errors.costItems = true;
      }
    }

    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      // Build specific error message
      const missing: string[] = [];
      if (errors.saleDate) missing.push("วันที่ขาย");
      if (errors.productName) missing.push("ชื่อสินค้า");
      if (errors.qty) missing.push("จำนวน");
      if (errors.unitPrice) missing.push("ราคา");
      if (errors.poRef) missing.push("อ้างอิง PO");
      if (errors.warrantyStartDate) missing.push("วันเริ่มรับประกัน");
      if (errors.warrantyEndDate) missing.push("วันสิ้นสุดรับประกัน");
      if (errors.invoiceRef) missing.push("อ้างอิง Invoice");
      if (errors.costItems) missing.push("ต้นทุน (กรุณาเปิดเครื่องคิดต้นทุน แล้วกรอกยอดต้นทุน)");
      showToast(`กรุณากรอก: ${missing.join(", ")}`, "error");
      setTimeout(() => {
        const firstErrorElement = document.querySelector('.error-border');
        if (firstErrorElement) {
          firstErrorElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 100);
      return;
    }
    
    setFormErrors({});

    setIsSaving(true);
    try {
      const url = editingId ? `/api/admin/sales/${editingId}` : "/api/admin/sales";
      const method = editingId ? "PUT" : "POST";
      // Do not send costAmount here. The sync endpoint will calculate and update it.
      // This prevents a ghost costAmount if the sync endpoint fails.
      const payload = { ...form };
      // Trim serialNumbers to match qty (array may have stale entries beyond current qty)
      if (payload.saleType === "equipment" && Array.isArray(payload.serialNumbers)) {
        payload.serialNumbers = payload.serialNumbers.slice(0, Math.max(1, payload.qty || 1));
      }
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (res.ok || res.status === 207) {
        // 207 = sales record saved but equipment partially failed
        const is207 = res.status === 207;
        const savedData = await res.json();
        const savedRecord = method === "POST" ? savedData.record : savedData;
        const recordId = savedRecord?.id || editingId;

        // Save cost items
        let costSyncSuccess = true;
        if (recordId) {
          try {
            const validCostItems = costItems.filter(ci => ci.amount > 0);
            const syncRes = await fetch(`/api/admin/sales/${recordId}/costs/sync`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(validCostItems),
            });
            if (!syncRes.ok) throw new Error("ไม่สามารถบันทึกต้นทุนใหม่ได้");
          } catch (err: any) {
            showToast(err.message || "เกิดข้อผิดพลาดในการบันทึกต้นทุน โปรดลองบันทึกอีกครั้ง", "error");
            costSyncSuccess = false;
          }
        }

        if (!costSyncSuccess) {
          // If sync fails, shift to edit mode (to prevent duplicates on retry)
          // and keep the form open so the user doesn't lose their typed cost items.
          setEditingId(recordId);
          setIsSaving(false);
          return;
        }

        if (is207 && savedData.warning) {
          showToast(`บันทึกยอดขายสำเร็จ แต่: ${savedData.warning}`, "error");
        } else {
          showToast("บันทึกยอดขายและต้นทุนสำเร็จ", "success");
        }
        setShowForm(false);
        setEditingId(null);
        setForm(emptyForm());
        setCostItems([]);
        setShowCostCalc(false);
        fetchDashboard();
        fetchRecords();
      } else {
        const err = await res.json();
        showToast(err.error || "เกิดข้อผิดพลาด", "error");
      }
    } catch { showToast("เกิดข้อผิดพลาด", "error"); }
    setIsSaving(false);
  };

  // Delete with confirm dialog
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const handleDelete = (id: string) => setDeleteTarget(id);
  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      const res = await fetch(`/api/admin/sales/${deleteTarget}`, { method: "DELETE" });
      if (res.ok) {
        showToast("ลบสำเร็จ", "success");
        fetchDashboard();
        fetchRecords();
      } else {
        const err = await res.json();
        showToast(err.error || "เกิดข้อผิดพลาดในการลบ", "error");
      }
    } catch {
      showToast("เกิดข้อผิดพลาดในการลบ", "error");
    }
    setDeleteTarget(null);
  };

  // View — fetch full record (with serial numbers) before showing modal
  const handleView = async (rec: SalesRecord) => {
    try {
      const res = await fetch(`/api/admin/sales/${rec.id}`);
      if (res.ok) {
        const fullRec = await res.json();
        setViewingRecord(fullRec);
      } else {
        // Fallback to list record if fetch fails
        setViewingRecord(rec);
      }
    } catch {
      setViewingRecord(rec);
    }
  };

  // Edit
  const handleEdit = async (rec: SalesRecord) => {
    try {
      const fullRes = await fetch(`/api/admin/sales/${rec.id}`);
      if (!fullRes.ok) throw new Error("โหลดข้อมูลยอดขายไม่สำเร็จ");
      const fullRec = await fullRes.json();

      const res = await fetch(`/api/admin/sales/${rec.id}/costs`);
      if (!res.ok) throw new Error("โหลดต้นทุนไม่สำเร็จ");
      const data = await res.json();

      setEditingId(fullRec.id);
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

      if (data.items && data.items.length > 0) {
        setCostItems(data.items.map((it: any) => ({
          id: it.id, costType: it.costType, label: it.label,
          amount: Number(it.amount), note: it.note || "",
        })));
        setShowCostCalc(true);
      } else {
        setCostItems([]);
        setShowCostCalc(false);
      }

      // Show form ONLY after all data (including cost items) is fully loaded
      // This prevents the user from clicking Save too early and accidentally wiping out cost items
      setShowForm(true);
    } catch {
      showToast("เกิดข้อผิดพลาดในการดึงข้อมูลต้นทุน กรุณาลองใหม่", "error");
    }
  };

  // Cost calculator helpers
  const costTotal = useMemo(() => costItems.reduce((sum, c) => sum + (c.amount || 0), 0), [costItems]);
  const formProfit = (form.totalAmount || 0) - costTotal;
  const formMargin = form.totalAmount > 0 ? Math.round((formProfit / form.totalAmount) * 10000) / 100 : 0;

  const addLocalCostItem = () => {
    setCostItems([...costItems, { costType: "product_cost", label: "", amount: 0, note: "" }]);
    setShowCostCalc(true);
  };
  const removeLocalCostItem = (idx: number) => {
    setCostItems(costItems.filter((_, i) => i !== idx));
  };
  const updateLocalCostItem = (idx: number, field: keyof CostItemLocal, value: string | number) => {
    setCostSubmitError(false);
    setCostItems(costItems.map((c, i) => i === idx ? { ...c, [field]: value } : c));
  };

  // Quick click-to-edit from rankings
  const handleSalespersonClick = (s: SalespersonStat) => {
    setShowRecords(true);
    setRecordSearch(s.name === "ไม่ระบุเซลล์" ? "" : s.name);
    setTimeout(() => {
      document.getElementById("sales-records-section")?.scrollIntoView({ behavior: "smooth" });
    }, 50);
  };

  const handleProductClick = (p: TopItem) => {
    setShowRecords(true);
    const cleanName = stripHtml(p.name);
    const matching = salesRecords.filter(
      (r) => r.productId === p.id || stripHtml(r.productName) === cleanName
    );
    if (matching.length === 1) {
      handleView(matching[0]);
    } else {
      setRecordSearch(cleanName);
      setTimeout(() => {
        document.getElementById("sales-records-section")?.scrollIntoView({ behavior: "smooth" });
      }, 50);
    }
  };

  const handleCustomerClick = (c: TopItem) => {
    setShowRecords(true);
    const matching = salesRecords.filter(
      (r) => r.companyId === c.id || r.customerName === c.name || r.companyName === c.name
    );
    if (matching.length === 1) {
      handleView(matching[0]);
    } else {
      setRecordSearch(c.name === "ไม่ระบุ" ? "" : c.name);
      setTimeout(() => {
        document.getElementById("sales-records-section")?.scrollIntoView({ behavior: "smooth" });
      }, 50);
    }
  };

  // Export Excel
  const [isExporting, setIsExporting] = useState(false);
  const handleExport = async () => {
    if (isExporting) return;
    // Filter records to match the active table filters (year + month)
    const targetRecords = salesRecords.filter((r) => {
      if (recordYear && r.saleDate?.substring(0, 4) !== recordYear) return false;
      if (recordMonth && r.saleDate?.substring(5, 7) !== recordMonth) return false;
      return true;
    });
    if (targetRecords.length === 0) {
      showToast("ไม่มีข้อมูลยอดขายสำหรับส่งออก", "error");
      return;
    }
    setIsExporting(true);
    try {
      const rows = targetRecords.map((r) => ({
        "วันที่": r.saleDate,
        "สินค้า": stripHtml(r.productName),
        "จำนวน": r.qty,
        "ราคาต่อหน่วย": r.unitPrice,
        "ยอดรวม": r.totalAmount,
        "ต้นทุน": r.costAmount || 0,
        "กำไร": r.totalAmount - (r.costAmount || 0),
        "Margin%": r.totalAmount > 0 ? Math.round(((r.totalAmount - (r.costAmount || 0)) / r.totalAmount) * 100) : 0,
        "ลูกค้า": r.customerName || "",
        "บริษัท": r.companyName || "",
        "เซลล์": r.salespersonName || "",
        "อ้างอิงใบเสนอราคา": r.quotationRef || "",
        "หมายเหตุ": r.note || "",
      }));
      const sheetLabel = recordYear ? `พ.ศ. ${Number(recordYear) + 543}` : "ทั้งหมด";
      const parts = ["sales-report"];
      if (recordYear) parts.push(recordYear);
      if (recordMonth) parts.push(recordMonth);
      const filename = parts.join("-") + ".xlsx";
      await downloadExcel(filename, [{ name: `Sales ${sheetLabel}`, rows }]);
      showToast(`ส่งออกไฟล์ ${filename} เรียบร้อยแล้ว`, "success");
    } catch {
      showToast("ไม่สามารถส่งออกไฟล์ Excel ได้", "error");
    } finally {
      setIsExporting(false);
    }
  };

  // Overview
  const ov = data?.overview;
  const curM = ov?.currentPeriod;
  const prevM = ov?.previousPeriod;

  const conversionRate = curM && curM.quotations > 0
    ? Math.round((curM.deals / curM.quotations) * 100)
    : 0;
  const prevConversionRate = prevM && prevM.quotations > 0
    ? Math.round((prevM.deals / prevM.quotations) * 100)
    : 0;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      <Suspense fallback={null}>
        <AutoEditHandler salesRecords={salesRecords} onEdit={handleEdit} />
      </Suspense>
      {/* Delete Confirmation Dialog */}
      {deleteTarget && (
        <ConfirmDialog
          title="ยืนยันการลบ"
          message="ต้องการลบรายการขายนี้หรือไม่? การลบจะไม่สามารถย้อนกลับได้"
          confirmText="ลบ"
          cancelText="ยกเลิก"
          onConfirm={confirmDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
      {/* Toast */}
      {toast && (
        <div className={`fixed top-6 right-6 z-[100] px-5 py-3 rounded-xl shadow-lg text-white font-semibold animate-fade-in ${toast.type === "success" ? "bg-emerald-500" : "bg-red-500"}`}>
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        <div className="flex flex-col xl:flex-row justify-between items-start xl:items-end gap-6 mb-10">
          <div className="shrink-0 flex flex-col justify-center">
            <div className="flex items-center gap-3 mb-2">
              <img 
                src="/images/profin-logo-3.png" 
                alt="Profin Logo" 
                className="h-10 sm:h-12 object-contain drop-shadow-sm"
              />
              <h1 className="text-3xl sm:text-4xl font-black text-transparent bg-clip-text bg-gradient-to-r from-[#170d3e] to-[#87704d] tracking-tight whitespace-nowrap drop-shadow-sm">
                ภาพรวมยอดขาย
              </h1>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-sm font-medium whitespace-nowrap pl-[52px] sm:pl-[60px]">
              <span className="bg-[#f9f7f4] text-[#87704d] px-3 py-1 rounded-full border border-[#87704d]/20 shadow-sm">
                ภาพรวมธุรกิจประจำปี
              </span>
            </div>
          </div>

          <div className="flex flex-wrap lg:flex-nowrap items-center gap-3 w-full lg:w-auto">
            {/* ปุ่มกลับไประบบจัดการ — มุมขวาบน สไตล์เดียวกับหน้า admin อื่นๆ */}
            <Link href="/adminpanel" className="px-4 py-2 rounded-lg border border-gray-300 bg-white text-gray-700 text-sm font-semibold hover:bg-gray-50 transition whitespace-nowrap">
              🏠 กลับไประบบจัดการ
            </Link>
            {/* Filter Pill (Minimal) */}
            <div className="flex items-center flex-wrap sm:flex-nowrap justify-center w-full sm:w-auto relative z-30">
              <SearchableDropdown
                options={[
                  { value: "month", label: "รายเดือน" },
                  { value: "quarter", label: "รายไตรมาส" },
                  { value: "year", label: "รายปี" }
                ]}
                value={periodType}
                onChange={(v) => {
                  const type = v as "month" | "quarter" | "year";
                  setPeriodType(type);
                  const d = new Date();
                  if (type === "year") setPeriodValue(d.getFullYear().toString());
                  else if (type === "quarter") setPeriodValue(`${d.getFullYear()}-Q${Math.floor(d.getMonth() / 3) + 1}`);
                  else setPeriodValue(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
                }}
                className="w-28 shrink-0 bg-transparent"
                buttonClassName="h-8 border-none bg-transparent hover:bg-white rounded-full shadow-none font-medium text-sm text-gray-700 transition-all"
                searchable={false}
              />
              <div className="h-4 w-px bg-gray-300 mx-1 shrink-0"></div>
              {periodType === "month" && (
                <input
                  type="month"
                  value={periodValue}
                  onChange={(e) => setPeriodValue(e.target.value)}
                  onClick={(e) => {
                    try {
                      if (typeof e.currentTarget.showPicker === 'function') {
                        e.currentTarget.showPicker();
                      }
                    } catch { /* ignore */ }
                  }}
                  className="px-3 py-1 border-none bg-transparent hover:bg-white transition-all rounded-full text-sm focus:ring-2 focus:ring-gray-300 outline-none h-8 font-medium text-gray-700 shrink-0 cursor-pointer"
                />
              )}
              {periodType === "quarter" && (
                <div className="flex gap-1 shrink-0">
                  <SearchableDropdown
                    options={[
                      { value: "Q1", label: "Q1 (ม.ค. - มี.ค.)" },
                      { value: "Q2", label: "Q2 (เม.ย. - มิ.ย.)" },
                      { value: "Q3", label: "Q3 (ก.ค. - ก.ย.)" },
                      { value: "Q4", label: "Q4 (ต.ค. - ธ.ค.)" }
                    ]}
                    value={periodValue.split('-')[1] || "Q1"}
                    onChange={(v) => setPeriodValue(`${periodValue.split('-')[0]}-${v}`)}
                    className="w-32 bg-transparent"
                    buttonClassName="h-8 border-none bg-transparent hover:bg-white rounded-full shadow-none font-medium text-sm text-gray-700 transition-all"
                    searchable={false}
                  />
                  <SearchableDropdown
                    options={yearOptions}
                    value={periodValue.split('-')[0] || String(new Date().getFullYear())}
                    onChange={(v) => setPeriodValue(`${v}-${periodValue.split('-')[1] || "Q1"}`)}
                    className="w-24 bg-transparent"
                    buttonClassName="h-8 border-none bg-transparent hover:bg-white rounded-full shadow-none font-medium text-sm text-gray-700 transition-all"
                    searchable={false}
                  />
                </div>
              )}
              {periodType === "year" && (
                <SearchableDropdown
                  options={yearOptions}
                  value={periodValue}
                  onChange={setPeriodValue}
                  className="w-28 shrink-0 bg-transparent"
                  buttonClassName="h-8 border-none bg-transparent hover:bg-white rounded-full shadow-none font-medium text-sm text-gray-700 transition-all"
                  searchable={false}
                />
              )}
            </div>

            {/* Navigation Tabs (Segmented Control style) */}
            <div className="flex items-center bg-gray-50/80 rounded-full p-1 border border-gray-200/60 w-full sm:w-auto overflow-x-auto no-scrollbar">
              <button
                onClick={handleScrollToRecords}
                className="px-4 py-1.5 text-gray-900 bg-white shadow-sm border border-gray-200/50 font-semibold rounded-full text-sm transition-all flex items-center gap-2 whitespace-nowrap shrink-0"
              >
                รายการขาย {salesRecords.length > 0 && <span className="bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full font-bold text-xs">{salesRecords.length}</span>}
              </button>
              <Link href="/customers?tab=equipment" className="px-4 py-1.5 text-gray-500 font-medium rounded-full hover:text-gray-900 hover:bg-white/60 transition-all text-sm whitespace-nowrap shrink-0 ml-1">
                อุปกรณ์ที่ขาย
              </Link>
              <Link href="/expenses" className="px-4 py-1.5 text-gray-500 font-medium rounded-full hover:text-gray-900 hover:bg-white/60 transition-all text-sm whitespace-nowrap shrink-0 ml-1">
                บันทึกรายจ่าย
              </Link>
              
              <div className="h-4 w-px bg-gray-300 mx-2 shrink-0"></div>
              
              <button onClick={handleExport} className="p-1.5 text-gray-400 hover:text-gray-900 rounded-full hover:bg-white/60 transition-all shrink-0" title="Export Excel">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
              </button>
            </div>
            
            {/* Action Button */}
            <button onClick={() => { setShowForm(true); setEditingId(null); setForm(emptyForm()); setCostItems([]); setShowCostCalc(false); }} className="px-5 py-2 bg-[#065f46] text-white rounded-full text-sm font-semibold hover:bg-[#047857] transition-all shadow-md flex items-center justify-center gap-1.5 whitespace-nowrap w-full sm:w-auto h-[40px] shrink-0 border border-[#064e3b]">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4"/></svg>
              บันทึกยอดขาย
            </button>
          </div>
        </div>

        {/* ── Overview Cards ──────────────────────────────────────────────── */}
        {loading ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} className="bg-white rounded-2xl p-4 shadow-sm animate-pulse border border-gray-100/50">
                <div className="h-3 w-20 bg-gray-200 rounded mb-2" />
                <div className="h-6 w-24 bg-gray-200 rounded mb-2" />
                <div className="h-2 w-12 bg-gray-200 rounded" />
              </div>
            ))}
          </div>
        ) : ov && curM && prevM && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            {[
              { label: `ยอดขาย${ov.periodLabel}`, value: `฿${fmt(curM.revenue)}`, change: pctChange(curM.revenue, prevM.revenue), color: "text-indigo-600", border: "border-indigo-100", bg: "bg-indigo-50/30" },
              { label: "ต้นทุนและรายจ่ายรวม", value: `฿${fmt(curM.cost)}`, change: pctChange(curM.cost, prevM.cost), color: "text-rose-600", border: "border-rose-100", bg: "bg-rose-50/30" },
              { label: `กำไร${ov.periodLabel}`, value: `฿${fmt(curM.profit)}`, change: pctChange(curM.profit, prevM.profit), color: "text-emerald-600", border: "border-emerald-100", bg: "bg-emerald-50/30" },
              { label: "Profit Margin", value: curM.revenue > 0 ? `${Math.round((curM.profit / curM.revenue) * 100)}%` : "—", change: (() => { const curMargin = curM.revenue > 0 ? Math.round((curM.profit / curM.revenue) * 100) : 0; const prevMarginVal = prevM.revenue > 0 ? Math.round((prevM.profit / prevM.revenue) * 100) : 0; return pctChange(curMargin, prevMarginVal); })(), color: "text-purple-600", border: "border-purple-100", bg: "bg-purple-50/30" },
              { label: "จำนวนดีล", value: String(curM.deals), change: pctChange(curM.deals, prevM.deals), color: "text-blue-600", border: "border-blue-100", bg: "bg-blue-50/30" },
              { label: "ลูกค้าใหม่", value: String(curM.newCustomers), change: pctChange(curM.newCustomers, prevM.newCustomers), color: "text-cyan-600", border: "border-cyan-100", bg: "bg-cyan-50/30" },
              { label: "Conversion Rate", value: `${conversionRate}%`, change: pctChange(conversionRate, prevConversionRate), color: "text-amber-600", border: "border-amber-100", bg: "bg-amber-50/30" },
            ].map((card, i) => (
              <div key={i} className={`rounded-2xl p-5 shadow-sm border ${card.border} ${card.bg} hover:shadow-md transition-all hover:-translate-y-1 flex flex-col justify-between`}>
                <div>
                  <div className="text-[13px] font-semibold text-gray-600 mb-1">{card.label}</div>
                  <div className={`text-2xl sm:text-3xl font-black tracking-tight ${card.color}`}>{card.value}</div>
                </div>
                {card.change.label !== "—" && (
                  <div className={`text-xs font-bold mt-2 ${card.change.color}`}>{card.change.label}</div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* ── Charts Row ─────────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
          {/* Revenue Bar Chart */}
          <div className="lg:col-span-2 bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-bold text-gray-800">ยอดขาย {ov?.periodLabel || periodValue.split('-')[0]}</h2>
              <div className="flex bg-gray-100 rounded-lg p-1">
                <button onClick={() => setChartMode("monthly")} className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${chartMode === "monthly" ? "bg-white shadow-sm text-indigo-600" : "text-gray-500"}`}>
                  รายเดือน
                </button>
                <button onClick={() => setChartMode("quarterly")} className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${chartMode === "quarterly" ? "bg-white shadow-sm text-indigo-600" : "text-gray-500"}`}>
                  รายไตรมาส
                </button>
              </div>
            </div>
            {loading ? (
              <div className="h-64 bg-gray-100 rounded-xl animate-pulse" />
            ) : (
              <div className="flex flex-col gap-8">
                {/* Chart 1: Revenue vs Profit */}
                <div className="h-[280px] pb-4">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} margin={{ bottom: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                      <XAxis dataKey="name" tick={{ fontSize: 12, fill: "#6b7280" }} axisLine={false} tickLine={false} />
                      <YAxis tickFormatter={(v: number) => fmt(v)} tick={{ fontSize: 11, fill: "#6b7280" }} axisLine={false} tickLine={false} />
                      <Tooltip
                        content={({ active, payload, label }: any) => {
                          if (!active || !payload?.length) return null;
                          const d = payload[0]?.payload;
                          return (
                            <div className="bg-white rounded-[16px] border border-gray-100 p-4 shadow-[0_4px_20px_-4px_rgba(0,0,0,0.1)] text-sm">
                              <div className="font-semibold text-gray-900 mb-2">{label}</div>
                              <div className="text-indigo-600 font-medium">ยอดขาย: ฿{fmtDec(d?.revenue || 0)}</div>
                              <div className="text-emerald-600 font-medium">กำไร: ฿{fmtDec(d?.profit || 0)}</div>
                            </div>
                          );
                        }}
                      />
                      <Legend formatter={(value: string) => value === "revenue" ? "ยอดขาย" : "กำไร"} wrapperStyle={{ paddingTop: "10px" }} />
                      <ReferenceLine y={0} stroke="#cbd5e1" />
                      <Bar dataKey="profit" name="profit" maxBarSize={40} radius={4} fill="#10b981">
                        {chartData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.profit < 0 ? "#ef4444" : "#10b981"} />
                        ))}
                      </Bar>
                      <Bar dataKey="revenue" fill="#6366f1" radius={[4, 4, 0, 0]} name="revenue" maxBarSize={40} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                
                {/* Chart 2: Profit vs Expense */}
                <div className="h-[280px] border-t border-gray-100 pt-6 pb-4">
                  <h3 className="text-sm font-bold text-gray-800 mb-4 text-center">กำไร & รายจ่ายบริษัท</h3>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} margin={{ bottom: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                      <XAxis dataKey="name" tick={{ fontSize: 12, fill: "#6b7280" }} axisLine={false} tickLine={false} />
                      <YAxis tickFormatter={(v: number) => fmt(v)} tick={{ fontSize: 11, fill: "#6b7280" }} axisLine={false} tickLine={false} />
                      <Tooltip
                        content={({ active, payload, label }: any) => {
                          if (!active || !payload?.length) return null;
                          const d = payload[0]?.payload;
                          return (
                            <div className="bg-white rounded-[16px] border border-gray-100 p-4 shadow-[0_4px_20px_-4px_rgba(0,0,0,0.1)] text-sm">
                              <div className="font-semibold text-gray-900 mb-2">{label}</div>
                              <div className="text-emerald-600 font-medium">กำไร: ฿{fmtDec(d?.profit || 0)}</div>
                              <div className="text-rose-500 font-medium">รายจ่าย: ฿{fmtDec(d?.expense || 0)}</div>
                            </div>
                          );
                        }}
                      />
                      <Legend formatter={(value: string) => value === "expense" ? "รายจ่าย" : "กำไร"} wrapperStyle={{ paddingTop: "10px" }} />
                      <Bar dataKey="expense" fill="#f43f5e" radius={[4, 4, 0, 0]} name="expense" maxBarSize={40} />
                      <ReferenceLine y={0} stroke="#cbd5e1" />
                      <Bar dataKey="profit" name="profit" maxBarSize={40} radius={4} fill="#10b981">
                        {chartData.map((entry, index) => (
                          <Cell key={`cell-2-${index}`} fill={entry.profit < 0 ? "#ef4444" : "#10b981"} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}
          </div>

          {/* Category Pie Chart */}
          <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
            <h2 className="text-lg font-bold text-gray-800 mb-4">สัดส่วนตามหมวดหมู่</h2>
            {loading ? (
              <div className="h-64 bg-gray-100 rounded-xl animate-pulse" />
            ) : data && data.revenueByCategory.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie data={data.revenueByCategory} dataKey="revenue" nameKey="name" cx="50%" cy="50%" outerRadius={90} label={((entry: any) => `${entry.name} ${entry.percentage}%`) as any} labelLine={false} fontSize={10}>
                    {data.revenueByCategory.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={((value: number) => fmtDec(value) + " ฿") as any} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-64 flex items-center justify-center text-gray-400 text-sm">ยังไม่มีข้อมูล</div>
            )}
          </div>
        </div>

        {/* ── Top Products + Top Customers ────────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          {/* Top Products */}
          <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
            <h2 className="text-lg font-bold text-gray-800 mb-4">🏆 Top 10 สินค้าขายดี <span className="text-xs font-normal text-indigo-600 ml-2 cursor-pointer">(คลิกเพื่อดู/แก้ไข)</span></h2>
            {loading ? (
              <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex gap-3 animate-pulse">
                  <div className="h-5 w-8 bg-gray-200 rounded" />
                  <div className="h-5 flex-1 bg-gray-200 rounded" />
                  <div className="h-5 w-24 bg-gray-200 rounded" />
                </div>
              ))}</div>
            ) : data && data.topProducts.length > 0 ? (
              <div className="space-y-2">
                {data.topProducts.map((p, i) => (
                  <div key={p.id} onClick={() => handleProductClick(p)} className="flex items-center gap-3 p-2 rounded-xl hover:bg-indigo-50/50 cursor-pointer transition-colors">
                    <div className="w-7 h-7 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center text-xs font-bold shrink-0">{i + 1}</div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-gray-800 truncate">{stripHtml(p.name)}</div>
                      <div className="text-xs text-gray-400">{p.qty} เครื่อง · {p.deals} ดีล</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-sm font-semibold text-gray-800">฿{fmt(p.revenue)}</div>
                      <div className="text-xs text-gray-400">{p.percentage}%</div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center text-gray-400 py-8 text-sm">ยังไม่มีข้อมูล</div>
            )}
          </div>

          {/* Top Customers */}
          <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
            <h2 className="text-lg font-bold text-gray-800 mb-4">🏢 Top 10 ลูกค้า <span className="text-xs font-normal text-amber-600 ml-2 cursor-pointer">(คลิกเพื่อดู/แก้ไข)</span></h2>
            {loading ? (
              <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex gap-3 animate-pulse">
                  <div className="h-5 w-8 bg-gray-200 rounded" />
                  <div className="h-5 flex-1 bg-gray-200 rounded" />
                  <div className="h-5 w-24 bg-gray-200 rounded" />
                </div>
              ))}</div>
            ) : data && data.topCustomers.length > 0 ? (
              <div className="space-y-2">
                {data.topCustomers.map((c, i) => (
                  <div key={c.id} onClick={() => handleCustomerClick(c)} className="flex items-center gap-3 p-2 rounded-xl hover:bg-amber-50/50 cursor-pointer transition-colors">
                    <div className="w-7 h-7 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center text-xs font-bold shrink-0">{i + 1}</div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-gray-800 truncate">{c.name}</div>
                      <div className="text-xs text-gray-400">{c.deals} ดีล</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-sm font-semibold text-gray-800">฿{fmt(c.revenue)}</div>
                      <div className="text-xs text-gray-400">{c.percentage}%</div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center text-gray-400 py-8 text-sm">ยังไม่มีข้อมูล</div>
            )}
          </div>
        </div>

        {/* ── Salesperson Leaderboard ──────────────────────────────────────── */}
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 mb-8">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-bold text-gray-800">ผลงานทีมขาย <span className="text-xs font-normal text-indigo-600 ml-2">(คลิกแถวเพื่อดูประวัติการขาย)</span></h2>
          </div>
          {loading ? (
            <div className="space-y-4">{Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex gap-4 animate-pulse">
                <div className="h-6 w-40 bg-gray-200 rounded" />
                <div className="h-6 flex-1 bg-gray-200 rounded" />
                <div className="h-6 w-24 bg-gray-200 rounded" />
              </div>
            ))}</div>
          ) : data && data.salespersonLeaderboard.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                    <th className="pb-3 pr-4">#</th>
                    <th className="pb-3 pr-4">เซลล์</th>
                    <th className="pb-3 pr-4 text-right">ยอดขาย</th>
                    <th className="pb-3 pr-4 text-right">ดีล</th>
                    <th className="pb-3 pr-4 text-right">สัดส่วน</th>
                    <th className="pb-3 text-right">เฉลี่ย/ดีล</th>
                  </tr>
                </thead>
                <tbody>
                  {data.salespersonLeaderboard.map((s, i) => (
                    <tr key={s.id} onClick={() => handleSalespersonClick(s)} className="border-t border-gray-50 hover:bg-indigo-50/40 cursor-pointer transition-colors">
                      <td className="py-3 pr-4">
                        <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${i === 0 ? "bg-yellow-100 text-yellow-600" : i === 1 ? "bg-gray-200 text-gray-600" : i === 2 ? "bg-orange-100 text-orange-600" : "bg-gray-100 text-gray-500"}`}>{i + 1}</div>
                      </td>
                      <td className="py-3 pr-4 font-medium text-gray-800 flex items-center gap-2">
                        {s.name}
                        
                      </td>
                      <td className="py-3 pr-4 text-right font-semibold text-gray-800">฿{fmt(s.revenue)}</td>
                      <td className="py-3 pr-4 text-right text-gray-600">{s.deals}</td>
                      <td className="py-3 pr-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <div className="w-16 h-2 bg-gray-100 rounded-full overflow-hidden">
                            <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${Math.min(s.percentage, 100)}%` }} />
                          </div>
                          <span className="text-sm text-gray-600">{s.percentage}%</span>
                        </div>
                      </td>
                      <td className="py-3 text-right text-sm text-gray-500">฿{fmt(s.avgDealSize)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center text-gray-400 py-8 text-sm">ยังไม่มีข้อมูล</div>
          )}
        </div>

        {/* ── Sales Records Table ──────────────────────────────────────────── */}
        {showRecords && (
          <SalesTable
            records={salesRecords}
            recordSearch={recordSearch}
            setRecordSearch={setRecordSearch}
            recordMonth={recordMonth}
            setRecordMonth={setRecordMonth}
            recordYear={recordYear}
            setRecordYear={setRecordYear}
            onView={handleView}
            onEdit={handleEdit}
            onDelete={handleDelete}
            onHide={() => setShowRecords(false)}
          />
        )}
      </div>

      {/* ── View Sales Record Modal ─────────────────────────────────── */}
      {viewingRecord && (
        <ViewRecordModal
          record={viewingRecord}
          onClose={() => setViewingRecord(null)}
          onEdit={handleEdit}
        />
      )}

      {/* ── Add/Edit Sales Record Modal ─────────────────────────────────── */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => { setShowForm(false); setEditingId(null); }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="p-6 border-b border-gray-100 flex justify-between items-center">
              <h3 className="text-xl font-bold text-gray-800">{editingId ? "แก้ไขรายการ" : "บันทึกยอดขาย"}</h3>
              <button onClick={() => { setShowForm(false); setEditingId(null); }} className="p-2 text-gray-400 hover:text-gray-600">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="flex items-center gap-6 pb-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="saleType" value="equipment" checked={form.saleType === "equipment"} onChange={(e) => { const v = e.target.value; setForm(prev => ({ ...prev, saleType: v })); }} className="w-4 h-4 text-indigo-600 focus:ring-indigo-500" />
                  <span className="text-sm font-semibold text-gray-800">💻 ขายเครื่อง</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="saleType" value="service" checked={form.saleType === "service"} onChange={(e) => { const v = e.target.value; setForm(prev => ({ ...prev, saleType: v })); }} className="w-4 h-4 text-amber-600 focus:ring-amber-500" />
                  <span className="text-sm font-semibold text-gray-800">🔧 ขายงาน Service</span>
                </label>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">วันที่ขาย <span className="text-red-500">*</span></label>
                  <DatePicker
                      selected={form.saleDate ? new Date(form.saleDate) : null}
                      onChange={(date) => { const v = date ? toLocalDateString(date) : ""; setForm(prev => ({ ...prev, saleDate: v })); }}
                      className={`w-full px-4 py-2.5 border rounded-xl text-sm focus:outline-none focus:ring-2 transition-all ${formErrors.saleDate ? "border-red-500 bg-red-50 focus:border-red-500 focus:ring-red-200 error-border" : "bg-gray-50 border-gray-200 focus:ring-indigo-500/20 focus:border-indigo-500"}`}
                    />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">เซลล์</label>
                  <SearchableDropdown options={salespersonOptions} value={form.salespersonId} onChange={(v) => setForm(prev => ({ ...prev, salespersonId: v }))} placeholder="เลือกเซลล์..." />
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">สินค้าจากระบบ</label>
                <SearchableDropdown
                  options={productOptions}
                  value={form.productId}
                  onChange={(v) => {
                    const p = products.find((x) => x.id === v);
                    setForm(prev => ({ ...prev, productId: v, productName: p ? stripHtml(p.title_th) : prev.productName, categoryId: p?.categoryId ?? null }));
                  }}
                  placeholder="เลือกสินค้าจากแคตตาล็อก (หรือพิมพ์ชื่อด้านล่าง)..."
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">ชื่อสินค้าที่แสดง <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  required
                  value={form.productName}
                  onChange={(e) => { const v = e.target.value; setForm(prev => ({ ...prev, productName: v })); }}
                  placeholder="ชื่อเครื่อง / สินค้า / บริการ"
                  className={`w-full px-3 py-2.5 border rounded-xl text-sm focus:ring-2 outline-none ${formErrors.productName ? "border-red-500 bg-red-50 focus:border-red-500 focus:ring-red-200 error-border" : "border-gray-200 focus:ring-indigo-200 focus:border-indigo-400"}`}
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
                    className={`w-full px-3 py-2.5 border rounded-xl text-sm focus:ring-2 outline-none ${formErrors.qty ? "border-red-500 bg-red-50 focus:border-red-500 focus:ring-red-200 error-border" : "border-gray-200 focus:ring-indigo-200 focus:border-indigo-400"}`}
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">ราคาต่อหน่วย (฿) <span className="text-red-500">*</span></label>
                  <FormattedNumberInput
                    value={form.unitPrice || 0}
                    onChange={(val) => {
                      const p = val;
                      setForm(prev => ({ ...prev, unitPrice: p, totalAmount: (prev.qty || 1) * p }));
                    }}
                    placeholder="0"
                    className={`w-full px-3 py-2.5 border rounded-xl text-sm focus:ring-2 outline-none font-medium text-gray-800 ${formErrors.unitPrice ? "border-red-500 bg-red-50 focus:border-red-500 focus:ring-red-200 error-border" : "border-gray-200 focus:ring-indigo-200 focus:border-indigo-400"}`}
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">ยอดรวม (฿)</label>
                  <FormattedNumberInput
                    value={form.totalAmount || 0}
                    onChange={(val) => {
                      setForm(prev => ({ ...prev, totalAmount: val }));
                    }}
                    placeholder="0"
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 outline-none bg-gray-50 font-semibold text-gray-800"
                  />
                </div>
              </div>

              {/* ── Cost Calculator ──────────────────────────────────── */}
              <div className="border border-dashed border-emerald-300 rounded-xl bg-emerald-50/50 p-4">
                <div className="flex justify-between items-center mb-3">
                  <button
                    type="button"
                    onClick={() => { setShowCostCalc(!showCostCalc); if (!showCostCalc && costItems.length === 0) addLocalCostItem(); }}
                    className="text-sm font-semibold text-emerald-700 hover:text-emerald-800 flex items-center gap-1.5"
                  >
                    💰 {showCostCalc ? "ซ่อน" : "เปิด"} ตัวช่วยคำนวณต้นทุน
                  </button>
                  {(form.totalAmount > 0 || costTotal > 0) && (
                    <div className="flex items-center gap-3 text-sm">
                      <span className="text-gray-500">กำไร: <span className={`font-bold ${formProfit >= 0 ? "text-emerald-700" : "text-red-600"}`}>฿{fmtDec(formProfit)}</span></span>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${formMargin >= 20 ? "bg-emerald-100 text-emerald-700" : formMargin >= 10 ? "bg-amber-100 text-amber-700" : formMargin >= 0 ? "bg-red-100 text-red-700" : "bg-red-200 text-red-800"}`}>
                        Margin {formMargin}%
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
                          placeholder="เลือกประเภท..."
                          className="w-44 shrink-0"
                          buttonClassName="h-[38px] border-gray-200"
                        />
                        <input
                          type="text"
                          value={ci.label}
                          onChange={(e) => updateLocalCostItem(idx, "label", e.target.value)}
                          placeholder="รายละเอียด (เช่น ค่ารถไปส่ง)"
                          className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-emerald-200 outline-none"
                        />
                        <FormattedNumberInput
                          value={ci.amount || 0}
                          onChange={(val) => updateLocalCostItem(idx, "amount", val)}
                          placeholder="0"
                          className={`w-28 px-3 py-2 border rounded-lg text-sm text-right font-medium outline-none ${costSubmitError && (!ci.amount || ci.amount <= 0) ? "border-red-400 bg-red-50 focus:ring-2 focus:ring-red-200 error-border" : "border-gray-200 focus:ring-2 focus:ring-emerald-200"}`}
                        />
                        <button
                          type="button"
                          onClick={() => removeLocalCostItem(idx)}
                          className="p-2 text-gray-400 hover:text-red-500 transition-colors shrink-0"
                          title="ลบรายการ"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                    <div className="flex justify-between items-center pt-2">
                      <button
                        type="button"
                        onClick={addLocalCostItem}
                        className="text-sm text-emerald-600 hover:text-emerald-700 font-medium"
                      >
                        + เพิ่มรายการต้นทุน
                      </button>
                      <div className="text-sm font-semibold text-gray-700">
                        รวมต้นทุน: <span className="text-amber-700">฿{fmtDec(costTotal)}</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">อ้างอิงใบเสนอราคา</label>
                  <input type="text" value={form.quotationRef} onChange={(e) => { const v = e.target.value; setForm(prev => ({ ...prev, quotationRef: v })); }} placeholder="เลขที่ใบเสนอราคา"
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">อ้างอิงใบ PO <span className="text-red-500">*</span></label>
                  <input type="text" value={form.poRef} onChange={(e) => { const v = e.target.value; setForm(prev => ({ ...prev, poRef: v })); }} placeholder="เลขที่ใบ PO"
                    className={`w-full px-3 py-2.5 border rounded-xl text-sm focus:ring-2 outline-none ${formErrors.poRef ? "border-red-500 bg-red-50 focus:border-red-500 focus:ring-red-200 error-border" : "border-gray-200 focus:ring-indigo-200 focus:border-indigo-400"}`} />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">อ้างอิงใบส่งสินค้า</label>
                  <input type="text" value={form.deliveryRef} onChange={(e) => { const v = e.target.value; setForm(prev => ({ ...prev, deliveryRef: v })); }} placeholder="เลขที่ใบส่งสินค้า"
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">อ้างอิงใบ Invoice</label>
                  <input type="text" value={form.invoiceRef} onChange={(e) => { const v = e.target.value; setForm(prev => ({ ...prev, invoiceRef: v })); }} placeholder="เลขที่ใบ Invoice"
                    className={`w-full px-3 py-2.5 border rounded-xl text-sm focus:ring-2 outline-none ${formErrors.invoiceRef ? "border-red-500 bg-red-50 focus:border-red-500 focus:ring-red-200 error-border" : "border-gray-200 focus:ring-indigo-200 focus:border-indigo-400"}`} />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">อ้างอิงใบเสร็จ</label>
                  <input type="text" value={form.receiptRef} onChange={(e) => { const v = e.target.value; setForm(prev => ({ ...prev, receiptRef: v })); }} placeholder="เลขที่ใบเสร็จ"
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 outline-none" />
                </div>
              </div>

              {form.saleType === "equipment" && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1.5">วันเริ่มรับประกัน <span className="text-red-500">*</span></label>
                    <DatePicker
                      selected={form.warrantyStartDate ? new Date(form.warrantyStartDate) : null}
                      onChange={(date) => { const v = date ? toLocalDateString(date) : ""; setForm(prev => ({ ...prev, warrantyStartDate: v })); }}
                      placeholderText="ไม่ระบุ"
                      isClearable
                      className={`w-full px-4 py-2.5 border rounded-xl text-sm focus:outline-none focus:ring-2 transition-all ${formErrors.warrantyStartDate ? "border-red-500 bg-red-50 focus:border-red-500 focus:ring-red-200 error-border" : "bg-gray-50 border-gray-200 focus:ring-indigo-500/20 focus:border-indigo-500"}`}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1.5">วันหมดรับประกัน <span className="text-red-500">*</span></label>
                    <DatePicker
                      selected={form.warrantyEndDate ? new Date(form.warrantyEndDate) : null}
                      onChange={(date) => { const v = date ? toLocalDateString(date) : ""; setForm(prev => ({ ...prev, warrantyEndDate: v })); }}
                      placeholderText="ไม่ระบุ"
                      isClearable
                      className={`w-full px-4 py-2.5 border rounded-xl text-sm focus:outline-none focus:ring-2 transition-all ${formErrors.warrantyEndDate ? "border-red-500 bg-red-50 focus:border-red-500 focus:ring-red-200 error-border" : "bg-gray-50 border-gray-200 focus:ring-indigo-500/20 focus:border-indigo-500"}`}
                    />
                  </div>
                </div>
              )}

              {form.saleType === "equipment" && form.qty > 0 && (
                <div className="p-5 bg-gray-50 border border-gray-100 rounded-2xl">
                  <label className="block text-sm font-semibold text-gray-700 mb-3">
                    หมายเลขซีเรียล  <span className="text-red-500">*</span>
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {Array.from({ length: Math.min(form.qty, 50) }).map((_, i) => (
                      <div key={i} className="flex items-center gap-3 bg-white p-2 rounded-xl border border-gray-200">
                        <span className="text-xs text-gray-500 font-bold bg-gray-100 px-2 py-1 rounded-md shrink-0">#{i + 1}</span>
                        <input
                          type="text"
                          value={(form.serialNumbers && form.serialNumbers[i]) || ""}
                          onChange={(e) => {
                            const val = e.target.value;
                            setForm(prev => {
                              const newSn = [...(prev.serialNumbers || [])];
                              newSn[i] = val;
                              return { ...prev, serialNumbers: newSn };
                            });
                          }}
                          placeholder="Serial Number..."
                          className="w-full px-2 py-1 text-sm focus:outline-none bg-transparent"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}



              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">หมายเหตุ</label>
                <textarea value={form.note} onChange={(e) => { const v = e.target.value; setForm(prev => ({ ...prev, note: v })); }} rows={2} placeholder="หมายเหตุ (ถ้ามี)"
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 outline-none resize-none" />
              </div>
            </div>

            <div className="p-6 border-t border-gray-100 flex justify-end gap-3">
              <button onClick={() => { setShowForm(false); setEditingId(null); }} className="px-5 py-2.5 bg-gray-100 text-gray-700 rounded-xl font-semibold hover:bg-gray-200 transition-all text-sm">
                ยกเลิก
              </button>
              <button onClick={handleSave} disabled={isSaving} className="px-5 py-2.5 bg-indigo-600 text-white rounded-xl font-semibold hover:bg-indigo-700 transition-all text-sm disabled:opacity-50">
                {isSaving ? "กำลังบันทึก..." : editingId ? "บันทึกการแก้ไข" : "บันทึกยอดขาย"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── AutoEditHandler ──────────────────────────────────────────────────────────

function AutoEditHandler({
  salesRecords,
  onEdit,
}: {
  salesRecords: SalesRecord[];
  onEdit: (r: SalesRecord) => void;
}) {
  const searchParams = useSearchParams();
  const editIdFromUrl = searchParams.get("edit");
  const editHandledRef = useRef(false);

  useEffect(() => {
    if (editIdFromUrl && salesRecords.length > 0 && !editHandledRef.current) {
      editHandledRef.current = true;
      const rec = salesRecords.find((r) => r.id === editIdFromUrl);
      if (rec) {
        onEdit(rec);
      }
    }
  }, [editIdFromUrl, salesRecords, onEdit]);

  return null;
}

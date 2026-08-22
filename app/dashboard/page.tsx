"use client";
import React, { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import DatePicker from "../components/DatePicker";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  PieChart, Pie, Cell, Legend,
  LineChart, Line,
} from "recharts";
import SearchableDropdown from "../components/SearchableDropdown";
import type { SearchableDropdownOption } from "../components/SearchableDropdown";
import FormattedNumberInput from "../components/FormattedNumberInput";
import ConfirmDialog from "../components/ConfirmDialog";
import type { SalesRecord, CustomerEquipment } from "../lib/types";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Only allow Cloudinary image URLs to prevent XSS/SSRF via img src */
function safeImageUrl(url: string | undefined | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.hostname === "res.cloudinary.com" && parsed.protocol === "https:") return url;
  } catch { /* invalid URL */ }
  return null;
}

// ── Types ────────────────────────────────────────────────────────────────────

interface OverviewData {
  revenue: number; deals: number; newCustomers: number; quotations: number;
  cost: number; profit: number;
}
interface DashboardData {
  overview: { currentMonth: OverviewData; previousMonth: OverviewData; expiringWarranties: number };
  revenueMonthly: { period: string; revenue: number; deals: number; cost: number; profit: number; margin: number }[];
  revenueQuarterly: { period: string; revenue: number; deals: number; cost: number; profit: number; margin: number }[];
  revenueByCategory: TopItem[];
  topProducts: TopItem[];
  topCustomers: TopItem[];
  salespersonLeaderboard: SalespersonStat[];
  insights: Insight[];
}
interface TopItem { id: string; name: string; revenue: number; qty: number; deals: number; percentage: number }
interface SalespersonStat { id: string; name: string; revenue: number; deals: number; percentage: number; avgDealSize: number }
interface Insight { type: "positive" | "warning" | "opportunity" | "info"; icon: string; title: string; description: string }
interface CostItemLocal {
  id?: string;
  costType: string;
  label: string;
  amount: number;
  note: string;
}
const COST_TYPE_LABELS: Record<string, string> = {
  product_cost: "ต้นทุนสินค้า",
  transport: "ค่ารถ / ค่าเดินทาง",
  shipping: "ค่าขนส่ง",
  service_visit: "ค่าเซอร์วิส / ค่าติดตั้ง",
  repair: "ค่าซ่อม",
  commission: "ค่าคอมมิชชั่น",
  other: "อื่นๆ",
};
const COST_TYPE_OPTIONS = Object.entries(COST_TYPE_LABELS).map(([value, label]) => ({ value, label }));
interface Product { id: string; title_th: string; title_en: string; categoryId: number }
interface Customer { id: string; name: string; companyId: string; companyName?: string }
interface Company { id: string; name: string }
interface Salesperson { id: string; name: string }

// ── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (n: number) => n.toLocaleString("th-TH", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const fmtDec = (n: number) => n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const MONTHS_TH = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const PIE_COLORS = ["#6366f1", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316", "#06b6d4", "#84cc16"];

function pctChange(cur: number, prev: number): { value: number; label: string; color: string } {
  if (prev === 0) return { value: 0, label: "—", color: "text-gray-400" };
  const pct = Math.round(((cur - prev) / prev) * 100);
  if (pct > 0) return { value: pct, label: `↑${pct}%`, color: "text-emerald-600" };
  if (pct < 0) return { value: pct, label: `↓${Math.abs(pct)}%`, color: "text-red-500" };
  return { value: 0, label: "→0%", color: "text-gray-400" };
}

function stripHtml(html: string | null | undefined): string {
  if (!html) return "";
  if (typeof DOMParser !== "undefined") {
    const doc = new DOMParser().parseFromString(html, "text/html");
    return doc.body.textContent?.trim() || "";
  }
  return html.replace(/<[^>]*>/g, "").trim();
}

function getTodayString(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const emptyForm = () => ({
  saleType: "equipment",
  salespersonId: "",
  customerId: "",
  companyId: "",
  productId: "",
  productName: "",
  categoryId: null as number | null,
  qty: 1,
  unitPrice: 0,
  totalAmount: 0,
  saleDate: getTodayString(),
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

// ── Main Component ───────────────────────────────────────────────────────────

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [year, setYear] = useState(new Date().getFullYear());
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
      const res = await fetch(`/api/admin/dashboard?year=${year}`);
      if (res.ok) setData(await res.json());
    } catch { /* ignore */ }
    setLoading(false);
  }, [year]);

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
      const res = await fetch("/api/admin/sales");
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
      return data.revenueMonthly.map((r, i) => ({ ...r, name: MONTHS_TH[i] }));
    }
    return data.revenueQuarterly.map((r) => ({ ...r, name: r.period.split("-")[1] }));
  }, [data, chartMode]);

  // Filtered sales records for table search
  const filteredSalesRecords = useMemo(() => {
    let result = salesRecords;
    if (recordSearch.trim()) {
      const q = recordSearch.toLowerCase();
      result = result.filter(
        (r) =>
          r.productName?.toLowerCase().includes(q) ||
          r.customerName?.toLowerCase().includes(q) ||
          r.companyName?.toLowerCase().includes(q) ||
          r.salespersonName?.toLowerCase().includes(q) ||
          r.quotationRef?.toLowerCase().includes(q) ||
          r.saleDate?.includes(q)
      );
    }
    if (recordMonth) {
      result = result.filter((r) => r.saleDate && r.saleDate.substring(5, 7) === recordMonth);
    }
    return result;
  }, [salesRecords, recordSearch, recordMonth]);

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

    if (showCostCalc && costItems.length > 0) {
      const hasEmptyCost = costItems.some(ci => !ci.amount || ci.amount <= 0);
      if (hasEmptyCost) {
        setCostSubmitError(true);
        errors.costItems = true;
      }
    }

    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      showToast("กรุณากรอกข้อมูลที่จำเป็นให้ครบถ้วน", "error");
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
          showToast(editingId ? "แก้ไขสำเร็จ" : "บันทึกยอดขายสำเร็จ", "success");
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

  // Edit
  const handleEdit = async (rec: SalesRecord) => {
    try {
      const res = await fetch(`/api/admin/sales/${rec.id}/costs`);
      if (!res.ok) throw new Error("โหลดต้นทุนไม่สำเร็จ");
      const data = await res.json();

      setEditingId(rec.id);
      setForm({
        saleType: rec.saleType || "equipment",
        salespersonId: rec.salespersonId || "",
        customerId: rec.customerId || "",
        companyId: rec.companyId || "",
        productId: rec.productId || "",
        productName: rec.productName || "",
        categoryId: rec.categoryId,
        qty: rec.qty || 1,
        unitPrice: rec.unitPrice || 0,
        totalAmount: rec.totalAmount || 0,
        saleDate: rec.saleDate ? rec.saleDate.substring(0, 10) : "",
        quotationRef: rec.quotationRef || "",
        poRef: rec.poRef || "",
        deliveryRef: rec.deliveryRef || "",
        invoiceRef: rec.invoiceRef || "",
        receiptRef: rec.receiptRef || "",
        warrantyStartDate: rec.warrantyStartDate ? String(rec.warrantyStartDate).substring(0, 10) : "",
        warrantyEndDate: rec.warrantyEndDate ? String(rec.warrantyEndDate).substring(0, 10) : "",
        serialNumbers: Array.isArray(rec.serialNumbers) ? [...rec.serialNumbers] : [],
        note: rec.note || "",
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
    const matching = salesRecords.filter((r) =>
      s.name === "ไม่ระบุเซลล์"
        ? !r.salespersonId || !r.salespersonName
        : r.salespersonId === s.id || r.salespersonName === s.name
    );
    if (matching.length === 1) {
      setViewingRecord(matching[0]);
    } else {
      setRecordSearch(s.name === "ไม่ระบุเซลล์" ? "" : s.name);
      setTimeout(() => {
        document.getElementById("sales-records-section")?.scrollIntoView({ behavior: "smooth" });
      }, 50);
    }
  };

  const handleProductClick = (p: TopItem) => {
    setShowRecords(true);
    const cleanName = stripHtml(p.name);
    const matching = salesRecords.filter(
      (r) => r.productId === p.id || stripHtml(r.productName) === cleanName
    );
    if (matching.length === 1) {
      setViewingRecord(matching[0]);
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
      setViewingRecord(matching[0]);
    } else {
      setRecordSearch(c.name === "ไม่ระบุ" ? "" : c.name);
      setTimeout(() => {
        document.getElementById("sales-records-section")?.scrollIntoView({ behavior: "smooth" });
      }, 50);
    }
  };

  // Export Excel
  const handleExport = async () => {
    const yearRecords = salesRecords.filter(
      (r) => r.saleDate && r.saleDate.startsWith(String(year))
    );
    const targetRecords = yearRecords.length > 0 ? yearRecords : salesRecords;
    if (targetRecords.length === 0) {
      showToast("ไม่มีข้อมูลยอดขายสำหรับส่งออก", "error");
      return;
    }
    try {
      const XLSX = await import("xlsx");
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
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, `Sales ${year}`);
      const filename = yearRecords.length > 0
        ? `sales-report-${year}.xlsx`
        : `sales-report-all.xlsx`;
      XLSX.writeFile(wb, filename);
      showToast(`ส่งออกไฟล์ ${filename} เรียบร้อยแล้ว`, "success");
    } catch {
      showToast("ไม่สามารถส่งออกไฟล์ Excel ได้", "error");
    }
  };

  // Overview
  const ov = data?.overview;
  const curM = ov?.currentMonth;
  const prevM = ov?.previousMonth;

  const conversionRate = curM && curM.quotations > 0
    ? Math.round((curM.deals / curM.quotations) * 100)
    : 0;
  const prevConversionRate = prevM && prevM.quotations > 0
    ? Math.round((prevM.deals / prevM.quotations) * 100)
    : 0;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
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
          <div>
            <h1 className="text-4xl font-extrabold text-gray-900 tracking-tight mb-2">Dashboard ยอดขาย</h1>
            <div className="flex flex-wrap items-center gap-3 text-sm font-medium">
              <Link href="/showcase" className="text-gray-500 hover:text-indigo-600 transition-colors flex items-center gap-1">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"/></svg>
                กลับไประบบจัดการ
              </Link>
              <span className="text-gray-300">|</span>
              <span className="text-gray-500">ภาพรวมธุรกิจประจำปี</span>
            </div>
          </div>
          
          <div className="flex flex-wrap items-center gap-3 bg-white p-2 rounded-[20px] shadow-sm border border-gray-100">
            <SearchableDropdown
              options={yearOptions}
              value={String(year)}
              onChange={(v) => setYear(Number(v))}
              className="w-32 border-none bg-gray-50 hover:bg-gray-100 transition-colors rounded-xl"
            />
            <div className="h-6 w-px bg-gray-100 hidden sm:block"></div>
            
            <button
              onClick={handleScrollToRecords}
              className="px-4 py-2 text-gray-600 font-medium rounded-xl text-sm hover:bg-gray-50 transition-all flex items-center gap-2"
            >
              รายการขาย {salesRecords.length > 0 && <span className="bg-indigo-50 text-indigo-600 border border-indigo-100 text-xs px-2 py-0.5 rounded-full font-bold">{salesRecords.length}</span>}
            </button>
            <Link href="/customers?tab=equipment" className="px-4 py-2 text-gray-600 font-medium rounded-xl hover:bg-gray-50 transition-all text-sm">
              อุปกรณ์ที่ขาย
            </Link>
            <Link href="/expenses" className="px-4 py-2 text-gray-600 font-medium rounded-xl hover:bg-gray-50 transition-all text-sm">
              บันทึกรายจ่าย
            </Link>
            
            <div className="h-6 w-px bg-gray-100 hidden sm:block"></div>
            
            <button onClick={handleExport} className="p-2 text-gray-400 hover:text-gray-900 rounded-xl hover:bg-gray-50 transition-all" title="Export Excel">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
            </button>
            
            <button onClick={() => { setShowForm(true); setEditingId(null); setForm(emptyForm()); setCostItems([]); setShowCostCalc(false); }} className="px-5 py-2.5 bg-black text-white rounded-xl text-sm font-semibold hover:bg-gray-800 transition-all shadow-md ml-1">
              + บันทึกยอดขาย
            </button>
          </div>
        </div>

        {/* ── Overview Cards ──────────────────────────────────────────────── */}
        {loading ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-5 mb-10">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="bg-white rounded-2xl p-5 shadow-sm animate-pulse">
                <div className="h-4 w-20 bg-gray-200 rounded mb-3" />
                <div className="h-8 w-28 bg-gray-200 rounded mb-2" />
                <div className="h-3 w-16 bg-gray-200 rounded" />
              </div>
            ))}
          </div>
        ) : ov && curM && prevM && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-5 mb-10">
            {[
              { label: "ยอดขายเดือนนี้", value: `฿${fmt(curM.revenue)}`, change: pctChange(curM.revenue, prevM.revenue) },
              { label: "ต้นทุนและรายจ่ายรวม", value: `฿${fmt(curM.cost)}`, change: pctChange(curM.cost, prevM.cost) },
              { label: "กำไรเดือนนี้", value: `฿${fmt(curM.profit)}`, change: pctChange(curM.profit, prevM.profit) },
              { label: "Profit Margin", value: curM.revenue > 0 ? `${Math.round((curM.profit / curM.revenue) * 100)}%` : "—", change: (() => { const curMargin = curM.revenue > 0 ? Math.round((curM.profit / curM.revenue) * 100) : 0; const prevMarginVal = prevM.revenue > 0 ? Math.round((prevM.profit / prevM.revenue) * 100) : 0; return pctChange(curMargin, prevMarginVal); })() },
              { label: "จำนวนดีล", value: String(curM.deals), change: pctChange(curM.deals, prevM.deals) },
              { label: "ลูกค้าใหม่", value: String(curM.newCustomers), change: pctChange(curM.newCustomers, prevM.newCustomers) },
              { label: "Conversion Rate", value: `${conversionRate}%`, change: pctChange(conversionRate, prevConversionRate) },
              { label: "ประกันใกล้หมด", value: String(ov.expiringWarranties), change: { value: 0, label: "≤30 วัน", color: ov.expiringWarranties > 0 ? "text-amber-600" : "text-gray-400" } },
            ].map((card, i) => (
              <div key={i} className="bg-white rounded-[24px] p-6 shadow-sm border border-gray-100/50 hover:shadow-md transition-shadow">
                <div className="text-sm font-medium text-gray-500 mb-2">{card.label}</div>
                <div className={`text-2xl font-bold tracking-tight ${i === 2 ? "text-emerald-600" : i === 3 ? "text-indigo-600" : "text-gray-900"}`}>{card.value}</div>
                <div className={`text-xs font-medium mt-2 ${card.change.color}`}>{card.change.label}</div>
              </div>
            ))}
          </div>
        )}

        {/* ── Charts Row ─────────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
          {/* Revenue Bar Chart */}
          <div className="lg:col-span-2 bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-bold text-gray-800">ยอดขาย {year}</h2>
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
                <div className="h-[260px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData}>
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
                      <Bar dataKey="profit" fill="#10b981" radius={[4, 4, 0, 0]} name="profit" maxBarSize={40} />
                      <Bar dataKey="revenue" fill="#6366f1" radius={[4, 4, 0, 0]} name="revenue" maxBarSize={40} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                
                {/* Chart 2: Profit vs Expense */}
                <div className="h-[260px] border-t border-gray-100 pt-6">
                  <h3 className="text-sm font-bold text-gray-800 mb-4 text-center">กำไร & รายจ่ายบริษัท</h3>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData}>
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
                      <Bar dataKey="profit" fill="#10b981" radius={[4, 4, 0, 0]} name="profit" maxBarSize={40} />
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

        {/* ── Smart Insights ──────────────────────────────────────────────── */}
        {data && data.insights.length > 0 && (
          <div className="mb-8">
            <h2 className="text-lg font-bold text-gray-800 mb-4">💡 วิเคราะห์อัจฉริยะ</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {data.insights.map((insight, i) => (
                <div
                  key={i}
                  className={`rounded-2xl p-5 border shadow-sm ${insight.type === "positive" ? "bg-emerald-50 border-emerald-200" :
                      insight.type === "warning" ? "bg-amber-50 border-amber-200" :
                        insight.type === "opportunity" ? "bg-blue-50 border-blue-200" :
                          "bg-gray-50 border-gray-200"
                    }`}
                >
                  <div className="text-2xl mb-2">{insight.icon}</div>
                  <div className="font-semibold text-gray-800 text-sm mb-1">{insight.title}</div>
                  <div className="text-xs text-gray-500">{insight.description}</div>
                </div>
              ))}
            </div>
          </div>
        )}

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
            <h2 className="text-lg font-bold text-gray-800">ผลงานทีมขาย <span className="text-xs font-normal text-indigo-600 ml-2">(คลิกแถวเพื่อดู/แก้ไขยอดขาย)</span></h2>
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
                        <span className="text-xs px-2 py-0.5 bg-indigo-50 text-indigo-600 rounded-full font-normal opacity-75 hover:opacity-100">แก้ไข</span>
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
          <div id="sales-records-section" className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 mb-8 scroll-mt-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-4">
              <div>
                <h2 className="text-lg font-bold text-gray-800">รายการขาย ({filteredSalesRecords.length})</h2>
                <p className="text-xs text-gray-500">คลิกที่แถวหรือกดปุ่ม "แก้ไข" เพื่อแก้ไขรายละเอียดของยอดขาย</p>
              </div>
              <div className="flex gap-2 w-full sm:w-auto items-center">
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
                  placeholder="🔍 ค้นหาสินค้า, ลูกค้า, บริษัท, เซลล์..."
                  className="px-4 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm w-full sm:w-72 focus:bg-white focus:ring-2 focus:ring-indigo-200 outline-none"
                />
                {recordSearch && (
                  <button onClick={() => setRecordSearch("")} className="px-3 py-2 text-xs bg-gray-100 text-gray-600 rounded-xl hover:bg-gray-200">
                    ล้าง
                  </button>
                )}
                <button
                  onClick={() => setShowRecords(false)}
                  className="px-3 py-2 text-xs bg-gray-100 text-gray-500 hover:text-gray-700 hover:bg-gray-200 rounded-xl transition-colors font-medium whitespace-nowrap"
                  title="ซ่อนตาราง"
                >
                  ✕ ซ่อนตาราง
                </button>
              </div>
            </div>
            {filteredSalesRecords.length > 0 ? (
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
                    {filteredSalesRecords.map((r) => (
                      <tr key={r.id} className="border-t border-gray-50 hover:bg-indigo-50/30 cursor-pointer transition-colors group" onClick={() => setViewingRecord(r)}>
                        <td className="py-3 pr-3 text-sm text-gray-600">{r.saleDate}</td>
                        <td className="py-3 pr-3 text-sm font-medium text-gray-800">
                          {r.saleType === "service" ? (
                            <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-700 mr-1.5" title="บริการ">S</span>
                          ) : (
                            <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold bg-indigo-100 text-indigo-700 mr-1.5" title="อุปกรณ์">E</span>
                          )}
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
                          {r.costAmount > 0 ? (
                            <span className="font-semibold text-emerald-700">฿{fmtDec(r.totalAmount - r.costAmount)}</span>
                          ) : (
                            <span className="text-gray-400">—</span>
                          )}
                        </td>
                        <td className="py-3 pr-3 text-right">
                          {r.costAmount > 0 ? (() => {
                            const margin = r.totalAmount > 0 ? Math.round(((r.totalAmount - r.costAmount) / r.totalAmount) * 100) : 0;
                            const color = margin >= 20 ? "bg-emerald-100 text-emerald-700" : margin >= 10 ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700";
                            return <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${color}`}>{margin}%</span>;
                          })() : (
                            <span className="text-gray-400 text-xs">—</span>
                          )}
                        </td>
                        <td className="py-3 text-right pr-2">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              onClick={(e) => { e.stopPropagation(); handleEdit(r); }}
                              className="px-2.5 py-1 text-xs font-semibold bg-indigo-50 text-indigo-600 hover:bg-indigo-100 rounded-lg transition-colors"
                              title="แก้ไขยอดขาย"
                            >
                              แก้ไข
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); handleDelete(r.id); }}
                              className="p-1.5 text-gray-400 hover:text-red-600 transition-colors rounded-lg hover:bg-red-50"
                              title="ลบรายการ"
                            >
                              🗑️
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-center text-gray-400 py-8 text-sm">ยังไม่มีรายการขาย</div>
            )}
          </div>
        )}
      </div>

      {/* ── View Sales Record Modal ─────────────────────────────────── */}
      {viewingRecord && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setViewingRecord(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="p-6 border-b border-gray-100 flex justify-between items-center">
              <h3 className="text-xl font-bold text-gray-800">รายละเอียดยอดขาย</h3>
              <button onClick={() => setViewingRecord(null)} className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="p-6 space-y-6">
              <div className="grid grid-cols-2 gap-y-4 gap-x-6 text-sm">
                <div>
                  <div className="text-gray-500 mb-1">วันที่ขาย</div>
                  <div className="font-semibold text-gray-800">{viewingRecord.saleDate}</div>
                </div>
                <div>
                  <div className="text-gray-500 mb-1">ประเภทการขาย</div>
                  <div className="font-semibold text-gray-800">{viewingRecord.saleType === "service" ? "บริการ/อะไหล่" : "สินค้า/เครื่องมือ"}</div>
                </div>
                <div>
                  <div className="text-gray-500 mb-1">ลูกค้า</div>
                  <div className="font-semibold text-gray-800">{viewingRecord.customerName || "—"}</div>
                </div>
                <div>
                  <div className="text-gray-500 mb-1">บริษัท</div>
                  <div className="font-semibold text-gray-800">{viewingRecord.companyName || "—"}</div>
                </div>
                <div className="col-span-2">
                  <div className="text-gray-500 mb-1">สินค้า</div>
                  <div className="font-semibold text-gray-800">{viewingRecord.productName || "—"}</div>
                </div>
                <div>
                  <div className="text-gray-500 mb-1">จำนวน</div>
                  <div className="font-semibold text-gray-800">{viewingRecord.qty}</div>
                </div>
                <div>
                  <div className="text-gray-500 mb-1">เซลล์</div>
                  <div className="font-semibold text-gray-800">{viewingRecord.salespersonName || "—"}</div>
                </div>
                <div>
                  <div className="text-gray-500 mb-1">ยอดขายสุทธิ</div>
                  <div className="font-bold text-indigo-600 text-lg">฿{Number(viewingRecord.totalAmount).toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
                </div>
                <div>
                  <div className="text-gray-500 mb-1">ต้นทุนรวม</div>
                  <div className="font-bold text-rose-600 text-lg">฿{Number(viewingRecord.costAmount).toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
                </div>
              </div>

              {viewingRecord.saleType === "equipment" && viewingRecord.serialNumbers && viewingRecord.serialNumbers.length > 0 && (
                <div className="pt-4 border-t border-gray-100">
                  <div className="text-gray-500 mb-2 text-sm font-semibold">Serial Numbers</div>
                  <div className="flex flex-wrap gap-2">
                    {viewingRecord.serialNumbers.map((sn, idx) => (
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
                  <div className="font-semibold text-gray-800">{viewingRecord.quotationRef || "—"}</div>
                </div>
                <div>
                  <div className="text-gray-500 mb-1">อ้างอิงใบ PO</div>
                  <div className="font-semibold text-gray-800">{viewingRecord.poRef || "—"}</div>
                </div>
                <div>
                  <div className="text-gray-500 mb-1">อ้างอิงใบส่งสินค้า</div>
                  <div className="font-semibold text-gray-800">{viewingRecord.deliveryRef || "—"}</div>
                </div>
                <div>
                  <div className="text-gray-500 mb-1">อ้างอิงใบ Invoice</div>
                  <div className="font-semibold text-gray-800">{viewingRecord.invoiceRef || "—"}</div>
                </div>
              </div>
              
              {viewingRecord.note && (
                <div className="pt-4 border-t border-gray-100">
                  <div className="text-gray-500 mb-1 text-sm font-semibold">หมายเหตุ</div>
                  <div className="text-sm text-gray-700 bg-amber-50 p-3 rounded-xl border border-amber-100 whitespace-pre-wrap">{viewingRecord.note}</div>
                </div>
              )}
            </div>

            <div className="p-6 border-t border-gray-100 flex justify-end gap-3 bg-gray-50/50">
              <button onClick={() => setViewingRecord(null)} className="px-5 py-2.5 bg-white border border-gray-200 text-gray-700 rounded-xl font-semibold hover:bg-gray-50 hover:border-gray-300 transition-all text-sm shadow-sm">
                ปิด
              </button>
              <button 
                onClick={() => {
                  const rec = viewingRecord;
                  setViewingRecord(null);
                  handleEdit(rec);
                }} 
                className="px-5 py-2.5 bg-indigo-600 text-white rounded-xl font-semibold hover:bg-indigo-700 transition-all text-sm flex items-center gap-2 shadow-sm"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                แก้ไขยอดขาย
              </button>
            </div>
          </div>
        </div>
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
                  <input type="radio" name="saleType" value="equipment" checked={form.saleType === "equipment"} onChange={(e) => setForm({ ...form, saleType: e.target.value })} className="w-4 h-4 text-indigo-600 focus:ring-indigo-500" />
                  <span className="text-sm font-semibold text-gray-800">💻 ขายเครื่อง</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="saleType" value="service" checked={form.saleType === "service"} onChange={(e) => setForm({ ...form, saleType: e.target.value })} className="w-4 h-4 text-amber-600 focus:ring-amber-500" />
                  <span className="text-sm font-semibold text-gray-800">🔧 ขายงาน Service</span>
                </label>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">วันที่ขาย <span className="text-red-500">*</span></label>
                  <DatePicker
                      selected={form.saleDate ? new Date(form.saleDate) : null}
                      onChange={(date) => setForm({ ...form, saleDate: date ? date.toISOString().split('T')[0] : "" })}
                    />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">เซลล์</label>
                  <SearchableDropdown options={salespersonOptions} value={form.salespersonId} onChange={(v) => setForm({ ...form, salespersonId: v })} placeholder="เลือกเซลล์..." />
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">สินค้าจากระบบ</label>
                <SearchableDropdown
                  options={productOptions}
                  value={form.productId}
                  onChange={(v) => {
                    const p = products.find((x) => x.id === v);
                    setForm({ ...form, productId: v, productName: p ? stripHtml(p.title_th) : form.productName, categoryId: p?.categoryId ?? null });
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
                  onChange={(e) => setForm({ ...form, productName: e.target.value })}
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
                      setForm({ ...form, customerId: v, companyId: c?.companyId || form.companyId });
                    }}
                    placeholder="เลือกลูกค้า..."
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">บริษัท</label>
                  <SearchableDropdown options={companyOptions} value={form.companyId} onChange={(v) => setForm({ ...form, companyId: v })} placeholder="เลือกบริษัท..." />
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
                      setForm({ ...form, qty: q, totalAmount: q * form.unitPrice });
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
                      setForm({ ...form, unitPrice: p, totalAmount: (form.qty || 1) * p });
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
                      setForm({ ...form, totalAmount: val });
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
                        <select
                          value={ci.costType}
                          onChange={(e) => updateLocalCostItem(idx, "costType", e.target.value)}
                          className="px-2 py-2 border border-gray-200 rounded-lg text-sm bg-white w-40 shrink-0"
                        >
                          {COST_TYPE_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                          ))}
                        </select>
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
                  <input type="text" value={form.quotationRef} onChange={(e) => setForm({ ...form, quotationRef: e.target.value })} placeholder="เลขที่ใบเสนอราคา"
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">อ้างอิงใบ PO <span className="text-red-500">*</span></label>
                  <input type="text" value={form.poRef} onChange={(e) => setForm({ ...form, poRef: e.target.value })} placeholder="เลขที่ใบ PO"
                    className={`w-full px-3 py-2.5 border rounded-xl text-sm focus:ring-2 outline-none ${formErrors.poRef ? "border-red-500 bg-red-50 focus:border-red-500 focus:ring-red-200 error-border" : "border-gray-200 focus:ring-indigo-200 focus:border-indigo-400"}`} />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">อ้างอิงใบส่งสินค้า</label>
                  <input type="text" value={form.deliveryRef} onChange={(e) => setForm({ ...form, deliveryRef: e.target.value })} placeholder="เลขที่ใบส่งสินค้า"
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">อ้างอิงใบ Invoice</label>
                  <input type="text" value={form.invoiceRef} onChange={(e) => setForm({ ...form, invoiceRef: e.target.value })} placeholder="เลขที่ใบ Invoice"
                    className={`w-full px-3 py-2.5 border rounded-xl text-sm focus:ring-2 outline-none ${formErrors.invoiceRef ? "border-red-500 bg-red-50 focus:border-red-500 focus:ring-red-200 error-border" : "border-gray-200 focus:ring-indigo-200 focus:border-indigo-400"}`} />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">อ้างอิงใบเสร็จ</label>
                  <input type="text" value={form.receiptRef} onChange={(e) => setForm({ ...form, receiptRef: e.target.value })} placeholder="เลขที่ใบเสร็จ"
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 outline-none" />
                </div>
              </div>

              {form.saleType === "equipment" && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1.5">วันเริ่มรับประกัน <span className="text-red-500">*</span></label>
                    <DatePicker
                      selected={form.warrantyStartDate ? new Date(form.warrantyStartDate) : null}
                      onChange={(date) => setForm({ ...form, warrantyStartDate: date ? date.toISOString().split('T')[0] : "" })}
                      placeholderText="ไม่ระบุ"
                      isClearable
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1.5">วันหมดรับประกัน <span className="text-red-500">*</span></label>
                    <DatePicker
                      selected={form.warrantyEndDate ? new Date(form.warrantyEndDate) : null}
                      onChange={(date) => setForm({ ...form, warrantyEndDate: date ? date.toISOString().split('T')[0] : "" })}
                      placeholderText="ไม่ระบุ"
                      isClearable
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
                          value={form.serialNumbers[i] || ""}
                          onChange={(e) => {
                            const newSn = [...form.serialNumbers];
                            newSn[i] = e.target.value;
                            setForm({ ...form, serialNumbers: newSn });
                          }}
                          placeholder="Serial Number..."
                          className="w-full px-2 py-1 text-sm focus:outline-none bg-transparent"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {editingId && form.saleType === "equipment" && (
                <div className="p-4 bg-amber-50 rounded-xl border border-amber-200 text-amber-800 text-sm font-medium flex gap-3 items-start">
                  <svg className="w-5 h-5 shrink-0 mt-0.5 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                  <div>
                    หมายเหตุ: การแก้ไขวันรับประกันในหน้านี้ จะไม่ไปอัปเดตประวัติอุปกรณ์ที่เคยสร้างไว้ในระบบ CRM (หากต้องการแก้ไขข้อมูลอุปกรณ์ กรุณาไปแก้ไขแยกต่างหากในหน้าลูกค้า)
                  </div>
                </div>
              )}

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">หมายเหตุ</label>
                <textarea value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} rows={2} placeholder="หมายเหตุ (ถ้ามี)"
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

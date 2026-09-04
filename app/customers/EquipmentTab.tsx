"use client";
import DatePicker from "../components/DatePicker";
import { toLocalDateString } from "../lib/dateFormat";
import { downloadExcel } from "../lib/xlsxExport";
import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import Link from "next/link";
import SearchableDropdown from "../components/SearchableDropdown";
import EquipmentEditModal from "../components/modals/EquipmentEditModal";
import EquipmentDetailsModal from "../components/modals/EquipmentDetailsModal";
import type { SearchableDropdownOption } from "../components/SearchableDropdown";
import type {
  CustomerEquipment,
  ServiceSchedule,
} from "../lib/types";

/** Strip HTML tags from rich-text product titles for plain-text display. */
/** Only allow Cloudinary image URLs to prevent XSS/SSRF via img src */
function safeImageUrl(url: string | undefined | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.hostname === "res.cloudinary.com" && parsed.protocol === "https:") return url;
  } catch { /* invalid URL */ }
  return null;
}

function stripHtml(html: string | null | undefined): string {
  if (!html) return "";
  // Use the browser's DOMParser to safely extract text content.
  // This avoids regex pitfalls and handles nested tags / entities correctly.
  if (typeof DOMParser !== "undefined") {
    const doc = new DOMParser().parseFromString(html, "text/html");
    return doc.body.textContent?.trim() || "";
  }
  // Fallback: simple regex strip for SSR (shouldn't happen — component is "use client").
  return html.replace(/<[^>]*>/g, "").trim();
}

// ── Interfaces for lookups ───────────────────────────────────────────────────

interface Company {
  id: string;
  name: string;
}

interface Customer {
  id: string;
  companyId: string;
  companyName?: string;
  name: string;
}

interface Product {
  id: string;
  title_th: string;
  title_en: string;
}

interface EquipmentTabProps {
  showToast: (message: string, type: "success" | "error") => void;
}

// ── Component ────────────────────────────────────────────────────────────────

export default function EquipmentTab({ showToast }: EquipmentTabProps) {
  // Data
  const [equipments, setEquipments] = useState<CustomerEquipment[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Equipment Modal
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editing, setEditing] = useState<Partial<CustomerEquipment> | null>(null);
  const [submitAttempted, setSubmitAttempted] = useState(false);

  // Detail view — EquipmentDetailsModal owns all schedule/log state and
  // fetching itself; this tab only tracks WHICH equipment is being viewed.
  const [viewingEquipment, setViewingEquipment] = useState<CustomerEquipment | null>(null);

  // Delete confirm (equipment row delete — see the confirm dialog in the render
  // section below). Deleting equipment with a completed schedule attached
  // requires an emailed OTP (same control as deleting a completed schedule
  // directly) — deleteNeedsOtp switches the same dialog into OTP-entry mode.
  const [deleteConfirm, setDeleteConfirm] = useState<CustomerEquipment | null>(null);
  const [deleteNeedsOtp, setDeleteNeedsOtp] = useState(false);
  const [deleteOtpCode, setDeleteOtpCode] = useState("");
  const [deleteOtpEmail, setDeleteOtpEmail] = useState<string | null>(null);
  const [isSendingDeleteOtp, setIsSendingDeleteOtp] = useState(false);
  const [deleteOtpCountdown, setDeleteOtpCountdown] = useState(0);

  useEffect(() => {
    if (deleteOtpCountdown <= 0) return;
    const timer = setTimeout(() => setDeleteOtpCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [deleteOtpCountdown]);

  // Search and Filter
  const [searchText, setSearchText] = useState("");
  const [filterType, setFilterType] = useState("all");

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  useEffect(() => {
    setCurrentPage(1);
  }, [searchText, filterType, equipments]);

  // Double-submit guard
  const [isSaving, setIsSaving] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  // ── Excel Export ───────────────────────────────────────────────────────────

  const exportToExcel = async () => {
    if (isExporting) return;
    setIsExporting(true);
    try {
      // Fetch all schedules for a complete backup
      const schedRes = await fetch("/api/admin/schedules");
      const allSchedules: ServiceSchedule[] = schedRes.ok ? await schedRes.json() : [];

      // Group schedules by equipmentId
      const schedulesByEq = new Map<string, ServiceSchedule[]>();
      allSchedules.forEach((s) => {
        const arr = schedulesByEq.get(s.equipmentId) || [];
        arr.push(s);
        schedulesByEq.set(s.equipmentId, arr);
      });

      // Sheet 1: Equipment
      const eqData = equipments.map((eq) => {
        const eqSchedules = schedulesByEq.get(eq.id) || [];
        // Sort schedules by date descending (newest first)
        eqSchedules.sort((a, b) => new Date(b.scheduledDate).getTime() - new Date(a.scheduledDate).getTime());
        
        const scheduleText = eqSchedules.map(s => {
          const type = s.scheduleType === "service" ? "Service" : "โทรติดตาม";
          const status = s.status === "pending" ? "รอดำเนินการ" : s.status === "completed" ? "เสร็จแล้ว" : "ยกเลิก";
          return `${s.scheduledDate}: ${type} (${status})`;
        }).join(", ");

        return {
          "ลูกค้า": eq.customerName || "",
          "บริษัท": eq.companyName || "",
          "สินค้า": stripHtml(eq.productName) || eq.productId,
          "Serial Number": eq.serialNumber,
          "เลขที่ใบเสนอราคา": eq.quotationNumber,
          "เลขที่ใบรับประกัน": eq.warrantyCertNumber,
          "ประเภทประกัน": eq.warrantyType,
          "เริ่มประกัน": eq.warrantyStartDate || "",
          "หมดประกัน": eq.warrantyEndDate || "",
          "วันที่สอบเทียบล่าสุด": eq.calibrationDate || "",
          "สถานะ": eq.status,
          "หมายเหตุ": eq.note || "",
          "ประวัตินัดหมาย/ติดตาม": scheduleText || "-",
          "วันที่บันทึก": eq.createdAt,
        };
      });

      // Sheet 2: Schedules (with equipment serial for reference)
      const eqMap = new Map(equipments.map((eq) => [eq.id, eq]));
      const schedData = allSchedules.map((s) => {
        const eq = eqMap.get(s.equipmentId);
        return {
          "Serial Number อุปกรณ์": eq?.serialNumber || s.equipmentId,
          "ลูกค้า": eq?.customerName || "",
          "ประเภท": s.scheduleType === "service" ? "Service" : "โทรติดตาม",
          "วันนัดหมาย": s.scheduledDate,
          "สถานะ": s.status === "pending" ? "รอดำเนินการ" : s.status === "completed" ? "เสร็จแล้ว" : "ยกเลิก",
          "หมายเหตุ": s.notes || "",
          "วันที่สร้าง": s.createdAt,
        };
      });

      const dateStr = toLocalDateString(new Date());
      await downloadExcel(`CRM_Equipment_Backup_${dateStr}.xlsx`, [
        { name: "อุปกรณ์", rows: eqData, autoSizeColumns: true },
        { name: "นัดหมาย", rows: schedData, autoSizeColumns: true },
      ]);
      showToast("Export สำเร็จ", "success");
    } catch (err) {
      console.error(err);
      showToast("Export ไม่สำเร็จ", "error");
    } finally {
      setIsExporting(false);
    }
  };

  // ── Data fetching ──────────────────────────────────────────────────────────

  // Stable ref so fetchEquipments doesn't re-create on every parent render.
  const showToastRef = useRef(showToast);
  showToastRef.current = showToast;

  const fetchEquipments = useCallback(async () => {
    setIsLoading(true);
    try {
      const [eqRes, custRes, compRes, prodRes] = await Promise.all([
        fetch("/api/admin/equipments"),
        fetch("/api/customers"),
        fetch("/api/companies"),
        fetch("/api/products"),
      ]);
      if (eqRes.ok) setEquipments(await eqRes.json());
      if (custRes.ok) setCustomers(await custRes.json());
      if (compRes.ok) setCompanies(await compRes.json());
      if (prodRes.ok) {
        const data = await prodRes.json();
        setProducts(Array.isArray(data) ? data : data.products || []);
      }
      if (!eqRes.ok || !custRes.ok || !compRes.ok || !prodRes.ok) {
        showToastRef.current("โหลดข้อมูลบางส่วนไม่สำเร็จ กรุณาลองใหม่", "error");
      }
    } catch (err) {
      console.error(err);
      showToastRef.current("โหลดข้อมูลอุปกรณ์ไม่สำเร็จ", "error");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchEquipments();
  }, [fetchEquipments]);

  useEffect(() => {
    if (typeof window !== "undefined" && equipments.length > 0 && !isModalOpen && !viewingEquipment) {
      const params = new URLSearchParams(window.location.search);
      const editEqId = params.get("edit_eq");
      const action = params.get("action");
      if (editEqId) {
        const eq = equipments.find((e) => e.id === editEqId);
        if (eq) {
          if (action === "view") {
            setViewingEquipment(eq);
          } else {
            setEditing({ ...eq, productId: eq.productId || "_custom" });
            setSubmitAttempted(false);
            setIsModalOpen(true);
          }
          
          // Remove param from URL
          const newUrl = window.location.pathname + "?tab=equipment";
          window.history.replaceState({}, "", newUrl);
        }
      }
    }
  }, [equipments, isModalOpen, viewingEquipment]);


  // ── Dropdown options ───────────────────────────────────────────────────────

  // O(1) lookup instead of O(n) .find() per customer on every render.
  const companyMap = useMemo(
    () => new Map(companies.map((co) => [co.id, co.name])),
    [companies]
  );

  const customerOptions: SearchableDropdownOption[] = customers.map((c) => ({
    value: c.id,
    label: c.name,
    subLabel: c.companyName || companyMap.get(c.companyId),
  }));

  const productOptions: SearchableDropdownOption[] = products.map((p) => ({
    value: p.id,
    label: stripHtml(p.title_th),
    subLabel: stripHtml(p.title_en),
  }));

  if (editing && editing.id && !productOptions.some(o => o.value === editing.productId)) {
    productOptions.unshift({
      value: editing.productId || "_custom",
      label: stripHtml(editing.productName) || "(สินค้าที่ระบุเอง)",
      subLabel: "กำหนดชื่อเอง",
    });
  }

  // ── Filtered list ──────────────────────────────────────────────────────────

  const filtered = equipments.filter((eq) => {
    if (searchText) {
      const q = searchText.toLowerCase();
      const match = (
        (eq.customerName || "").toLowerCase().includes(q) ||
        (eq.companyName || "").toLowerCase().includes(q) ||
        (eq.productName || "").replace(/<[^>]*>/g, "").toLowerCase().includes(q) ||
        (eq.serialNumber || "").toLowerCase().includes(q) ||
        (eq.quotationNumber || "").toLowerCase().includes(q)
      );
      if (!match) return false;
    }

    if (filterType !== "all") {
      const daysLeft = warrantyDaysLeft(eq.warrantyEndDate);
      const isExpired = eq.status === "Expired" || (daysLeft !== null && daysLeft < 0);
      
      if (filterType === "expired") {
        if (!isExpired) return false;
      } else if (filterType === "expiring_30") {
        if (isExpired || daysLeft === null || daysLeft > 30) return false;
      } else if (filterType === "expiring_60") {
        if (isExpired || daysLeft === null || daysLeft <= 30 || daysLeft > 60) return false;
      }
    }
    
    return true;
  });

  const paginatedEquipments = filtered.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );
  const totalPages = Math.max(1, Math.ceil(filtered.length / itemsPerPage));

  // ── Equipment CRUD handlers ────────────────────────────────────────────────

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving) return;
    setSubmitAttempted(true);
    if (!editing?.customerId || !editing?.productId) {
      showToast("กรุณาเลือกลูกค้าและสินค้า", "error");
      return;
    }
    setIsSaving(true);
    try {
      const method = editing.id ? "PUT" : "POST";
      const url = editing.id
        ? `/api/admin/equipments/${editing.id}`
        : "/api/admin/equipments";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editing),
      });
      if (!res.ok) throw new Error("Failed to save");
      showToast(editing.id ? "อัปเดตอุปกรณ์สำเร็จ" : "เพิ่มอุปกรณ์สำเร็จ", "success");
      setIsModalOpen(false);
      setEditing(null);
      setSubmitAttempted(false);
      fetchEquipments();
    } catch (err) {
      console.error(err);
      showToast("เกิดข้อผิดพลาดในการบันทึก", "error");
    } finally {
      setIsSaving(false);
    }
  };

  const closeDeleteDialog = () => {
    setDeleteConfirm(null);
    setDeleteNeedsOtp(false);
    setDeleteOtpCode("");
    setDeleteOtpEmail(null);
    setDeleteOtpCountdown(0);
  };

  const handleSendDeleteOtp = async () => {
    if (!deleteConfirm || isSendingDeleteOtp) return;
    setIsSendingDeleteOtp(true);
    try {
      const res = await fetch(`/api/admin/equipments/${deleteConfirm.id}/delete-otp`, { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "ไม่สามารถส่งรหัส OTP ได้");
      setDeleteOtpEmail(data.email || "อีเมลผู้ดูแลระบบ");
      setDeleteOtpCountdown(60);
      showToast(data.message || "ส่งรหัส OTP เรียบร้อยแล้ว", "success");
    } catch (err: any) {
      showToast(err.message || "ไม่สามารถส่งรหัส OTP ได้", "error");
    } finally {
      setIsSendingDeleteOtp(false);
    }
  };

  const executeDelete = async () => {
    if (!deleteConfirm || isSaving) return;
    setIsSaving(true);
    try {
      const res = await fetch(`/api/admin/equipments/${deleteConfirm.id}`, {
        method: "DELETE",
        ...(deleteNeedsOtp
          ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ otp: deleteOtpCode }) }
          : {}),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        if (data?.needOtp) {
          setDeleteNeedsOtp(true);
          if (deleteNeedsOtp) showToast(data.error || "รหัส OTP ไม่ถูกต้อง", "error");
          return;
        }
        throw new Error(data?.error || "Failed to delete");
      }
      showToast("ลบอุปกรณ์สำเร็จ", "success");
      if (viewingEquipment?.id === deleteConfirm.id) setViewingEquipment(null);
      closeDeleteDialog();
      fetchEquipments();
    } catch (err: any) {
      console.error(err);
      showToast(err.message || "ลบอุปกรณ์ไม่สำเร็จ", "error");
    } finally {
      setIsSaving(false);
    }
  };


  // ── Helpers ────────────────────────────────────────────────────────────────

  const warrantyDaysLeft = (endDate: any) => {
    if (!endDate || typeof endDate !== "string") return null;
    
    const parts = endDate.split("T")[0].split("-");
    if (parts.length < 3) return null;
    
    // Parse as local midnight to avoid timezone offsets
    const [year, month, day] = parts.map(Number);
    const end = new Date(year, month - 1, day).getTime();
    if (isNaN(end)) return null;
    
    // Get today at local midnight
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    
    const diff = Math.ceil((end - today) / 86400000);
    return isNaN(diff) ? null : diff;
  };

  const statusBadge = (eq: CustomerEquipment) => {
    const daysLeft = warrantyDaysLeft(eq.warrantyEndDate);
    const isExpired = eq.status === "Expired" || (daysLeft !== null && daysLeft < 0);

    if (isExpired)
      return <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-red-100 text-red-700">Expired</span>;
    return <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-green-100 text-green-700">Active</span>;
  };

  const scheduleTypeBadge = (type: string) => {
    if (type === "service")
      return <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-blue-100 text-blue-700">🔧 Service</span>;
    return <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-purple-100 text-purple-700">📞 โทรติดตาม</span>;
  };

  const scheduleStatusBadge = (status: string, date: string) => {
    const isOverdue = status === "pending" && date < toLocalDateString(new Date());
    if (status === "completed")
      return <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-green-100 text-green-700">✅ เสร็จแล้ว</span>;
    if (status === "cancelled")
      return <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-gray-100 text-gray-500">ยกเลิก</span>;
    if (isOverdue)
      return <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-red-100 text-red-700">⚠️ เกินกำหนด</span>;
    return <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-yellow-100 text-yellow-700">รอดำเนินการ</span>;
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <div className="flex items-center gap-3">
          <div className="bg-orange-100 text-orange-600 p-3 rounded-xl">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z"></path></svg>
          </div>
          <h2 className="text-2xl font-bold text-gray-800">อุปกรณ์ที่ขาย <span className="text-gray-400 text-lg font-normal">({filtered.length})</span></h2>
        </div>
        <div className="flex gap-3">
          <button
            onClick={exportToExcel}
            disabled={isExporting || isLoading}
            className="px-4 py-2.5 bg-emerald-50 border border-emerald-200 text-emerald-700 font-semibold rounded-xl hover:bg-emerald-100 transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            📥 {isExporting ? "กำลัง Export..." : "Export Excel"}
          </button>
          <Link
            href="/crm/alerts"
            className="px-4 py-2.5 bg-amber-50 border border-amber-200 text-amber-700 font-semibold rounded-xl hover:bg-amber-100 transition-all flex items-center gap-2"
          >
            🔔 แจ้งเตือน
          </Link>
          <button
            onClick={() => { setEditing({}); setSubmitAttempted(false); setIsModalOpen(true); }}
            className="px-5 py-2.5 bg-gradient-to-r from-orange-500 to-orange-600 text-white font-semibold rounded-xl hover:from-orange-600 hover:to-orange-700 transition-all shadow-sm hover:shadow-md flex items-center gap-2"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4"></path></svg>
            เพิ่มอุปกรณ์
          </button>
        </div>
      </div>

      {/* Search and Filters */}
      <div className="mb-6 flex flex-col sm:flex-row gap-4">
        <input
          type="text"
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          placeholder="ค้นหาลูกค้า, บริษัท, สินค้า, Serial Number..."
          className="w-full sm:w-96 px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-400 transition-all shrink-0"
        />
        <div className="w-full sm:w-72 shrink-0 relative z-[5]">
          <SearchableDropdown
            options={[
              { value: "all", label: "ทั้งหมด (All)" },
              { value: "expired", label: "อุปกรณ์ที่หมดอายุ" },
              { value: "expiring_30", label: "กำลังจะหมดอายุใน 30 วัน" },
              { value: "expiring_60", label: "กำลังจะหมดอายุใน 31-60 วัน" }
            ]}
            value={filterType}
            onChange={setFilterType}
            searchable={false}
            buttonClassName="h-full min-h-[46px] border-gray-200 bg-white"
          />
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="pb-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">ลูกค้า / บริษัท</th>
              <th className="pb-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">สินค้า</th>
              <th className="pb-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">S/N</th>
              <th className="pb-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">ประกัน</th>
              <th className="pb-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">หมดประกัน</th>
              <th className="pb-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">สถานะ</th>
              <th className="pb-3 text-xs font-semibold text-gray-400 uppercase tracking-wider"></th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="border-b border-gray-50 animate-pulse">
                  <td className="py-4 pr-4"><div className="h-4 bg-gray-200 rounded w-36"></div><div className="h-3 bg-gray-100 rounded w-24 mt-1"></div></td>
                  <td className="py-4 pr-4"><div className="h-4 bg-gray-200 rounded w-40"></div></td>
                  <td className="py-4 pr-4"><div className="h-4 bg-gray-200 rounded w-20"></div></td>
                  <td className="py-4 pr-4"><div className="h-4 bg-gray-200 rounded w-16"></div></td>
                  <td className="py-4 pr-4"><div className="h-4 bg-gray-200 rounded w-24"></div></td>
                  <td className="py-4 pr-4"><div className="h-4 bg-gray-200 rounded w-16"></div></td>
                  <td className="py-4"><div className="h-4 bg-gray-200 rounded w-8"></div></td>
                </tr>
              ))
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-16 text-center">
                  <div className="flex flex-col items-center gap-3">
                    <div className="text-6xl">📦</div>
                    <p className="text-gray-400 text-lg">ยังไม่มีอุปกรณ์ที่บันทึกไว้</p>
                    <button
                      onClick={() => { setEditing({}); setSubmitAttempted(false); setIsModalOpen(true); }}
                      className="mt-2 px-4 py-2 bg-orange-500 text-white rounded-xl hover:bg-orange-600 transition-all text-sm font-semibold"
                    >
                      + เพิ่มอุปกรณ์ตัวแรก
                    </button>
                  </div>
                </td>
              </tr>
            ) : (
              paginatedEquipments.map((eq) => {
                const daysLeft = warrantyDaysLeft(eq.warrantyEndDate);
                return (
                  <tr
                    key={eq.id}
                    className="border-b border-gray-50 cursor-pointer hover:bg-gray-50/50 transition-colors"
                    onClick={() => setViewingEquipment(eq)}
                  >
                    <td className="py-4 pr-4">
                      <div className="font-semibold text-gray-800">{eq.customerName || "—"}</div>
                      <div className="text-xs text-gray-400">{eq.companyName || ""}</div>
                    </td>
                    <td className="py-4 pr-4">
                      <div className="flex items-center gap-2">
                        {safeImageUrl(eq.productImage) && (
                          <img src={safeImageUrl(eq.productImage)!} alt="" className="w-8 h-8 rounded object-cover border border-gray-100 bg-gray-50 shrink-0" />
                        )}
                        <span className="text-sm text-gray-700">{stripHtml(eq.productName) || eq.productId}</span>
                      </div>
                    </td>
                    <td className="py-4 pr-4 text-sm text-gray-600 font-mono">{eq.serialNumber || "—"}</td>
                    <td className="py-4 pr-4 text-sm text-gray-600">{eq.warrantyType || "—"}</td>
                    <td className="py-4 pr-4">
                      {eq.warrantyEndDate ? (
                        <div>
                          <div className="text-sm text-gray-700">{eq.warrantyEndDate}</div>
                          {daysLeft !== null && (
                            <div className={`text-xs mt-0.5 ${daysLeft <= 0 ? "text-red-500 font-semibold" : daysLeft <= 30 ? "text-amber-500" : "text-gray-400"}`}>
                              {daysLeft <= 0 ? "หมดแล้ว" : `เหลือ ${daysLeft} วัน`}
                            </div>
                          )}
                        </div>
                      ) : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="py-4 pr-4">{statusBadge(eq)}</td>
                    <td className="py-4">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={(e) => { e.stopPropagation(); setEditing({ ...eq, productId: eq.productId || "_custom" }); setSubmitAttempted(false); setIsModalOpen(true); }}
                          className="p-1.5 text-gray-400 hover:text-indigo-600 transition-colors rounded-lg hover:bg-indigo-50"
                          title="แก้ไขอุปกรณ์"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path></svg>
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); setDeleteConfirm(eq); }}
                          className="p-1.5 text-gray-400 hover:text-red-500 transition-colors rounded-lg hover:bg-red-50"
                          title="ลบอุปกรณ์"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      {totalPages > 1 && (
        <div className="flex justify-between items-center mt-6">
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

      {/* ── Extracted Modals ──────────────────────────────────────────── */}
      {isModalOpen && (
        <EquipmentEditModal
          initialData={editing || {}}
          onClose={() => setIsModalOpen(false)}
          onSaveSuccess={() => {
            setIsModalOpen(false);
            fetchEquipments();
            showToast("บันทึกข้อมูลสำเร็จ", "success");
          }}
          customers={customers}
          companies={companies}
          products={products}
        />
      )}

      {viewingEquipment && (
        <EquipmentDetailsModal
          equipment={viewingEquipment}
          onClose={() => {
            setViewingEquipment(null);
            fetchEquipments();
          }}
          onEditEquipment={(eq) => {
            setViewingEquipment(null);
            setEditing(eq);
            setIsModalOpen(true);
          }}
        />
      )}

      {/* Delete Equipment Confirmation Modal — the row trash button only sets
          deleteConfirm; the actual DELETE only happens if this is confirmed
          (this dialog was lost in an earlier refactor, see
          openspec/changes/fix-crm-data-integrity). */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-gray-900/40 backdrop-blur-sm" onClick={() => { if (!isSaving && !isSendingDeleteOtp) closeDeleteDialog(); }}></div>
          <div className="relative bg-white rounded-3xl shadow-2xl max-w-sm w-full p-6 text-center transform transition-all scale-100 opacity-100">
            <div className="w-16 h-16 bg-red-100 text-red-500 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
            </div>
            <h3 className="text-xl font-bold text-gray-900 mb-2">ยืนยันการลบอุปกรณ์</h3>
            <p className="text-gray-500 mb-6">
              คุณแน่ใจหรือไม่ที่จะลบอุปกรณ์ <strong>{stripHtml(deleteConfirm.productName) || deleteConfirm.productId}</strong>
              {deleteConfirm.serialNumber ? <> (S/N: <strong>{deleteConfirm.serialNumber}</strong>)</> : null}?
              ประวัตินัดหมาย/บันทึกผลงานของอุปกรณ์นี้จะถูกลบไปด้วย และไม่สามารถกู้คืนได้
            </p>

            {deleteNeedsOtp && (
              <div className="mb-6 text-left">
                <p className="text-sm text-red-600 font-semibold mb-3 text-center">
                  ⚠️ อุปกรณ์นี้มีประวัตินัดหมายที่เสร็จสิ้นแล้ว การลบจึงต้องยืนยันด้วยรหัส OTP 6 หลักที่ส่งไปยังอีเมลผู้ดูแลระบบ
                </p>
                <button
                  type="button"
                  onClick={handleSendDeleteOtp}
                  disabled={isSendingDeleteOtp || deleteOtpCountdown > 0}
                  className="w-full mb-3 px-4 py-2.5 bg-orange-100 text-orange-700 font-semibold rounded-xl hover:bg-orange-200 transition disabled:opacity-50"
                >
                  {isSendingDeleteOtp
                    ? "กำลังส่งรหัส OTP..."
                    : deleteOtpCountdown > 0
                      ? `ส่งอีกครั้ง (${deleteOtpCountdown}s)`
                      : deleteOtpEmail
                        ? "📩 ส่งรหัสอีกครั้ง"
                        : "📩 ส่งรหัส OTP"}
                </button>
                {deleteOtpEmail && (
                  <p className="text-xs text-emerald-600 mb-3 text-center">✅ ส่งรหัส 6 หลักไปที่ {deleteOtpEmail} แล้ว</p>
                )}
                <input
                  type="text"
                  inputMode="numeric"
                  value={deleteOtpCode}
                  onChange={(e) => setDeleteOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="กรอกรหัส OTP 6 หลัก"
                  className="w-full px-4 py-2.5 text-center tracking-widest border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500"
                />
              </div>
            )}

            <div className="flex gap-3 justify-center">
              <button onClick={closeDeleteDialog} disabled={isSaving || isSendingDeleteOtp} className="px-5 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-800 font-semibold rounded-xl transition-colors flex-1 disabled:opacity-50">ยกเลิก</button>
              <button
                onClick={executeDelete}
                disabled={isSaving || (deleteNeedsOtp && deleteOtpCode.length !== 6)}
                className="px-5 py-2.5 bg-red-500 hover:bg-red-600 text-white font-semibold rounded-xl transition-colors shadow-sm hover:shadow-md flex-1 disabled:opacity-50"
              >
                {isSaving ? "กำลังลบ..." : deleteNeedsOtp ? "ยืนยันและลบ" : "ลบข้อมูล"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Helper component ─────────────────────────────────────────────────────────

function Info({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{label}</div>
      <div className="text-sm text-gray-800 mt-0.5">{value || "—"}</div>
    </div>
  );
}

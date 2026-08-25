"use client";
import DatePicker from "../components/DatePicker";
import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import Link from "next/link";
import SearchableDropdown from "../components/SearchableDropdown";
import EquipmentEditModal from "../components/modals/EquipmentEditModal";
import EquipmentDetailsModal from "../components/modals/EquipmentDetailsModal";
import type { SearchableDropdownOption } from "../components/SearchableDropdown";
import type {
  CustomerEquipment,
  ServiceSchedule,
  ServiceLog,
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

  // Detail view (schedules + logs)
  const [viewingEquipment, setViewingEquipment] = useState<CustomerEquipment | null>(null);
  const [schedules, setSchedules] = useState<ServiceSchedule[]>([]);
  const [isScheduleModalOpen, setIsScheduleModalOpen] = useState(false);
  const [viewingSchedule, setViewingSchedule] = useState<Partial<ServiceSchedule> | null>(null);
  const [editingSchedule, setEditingSchedule] = useState<Partial<ServiceSchedule> | null>(null);
  const [scheduleFormError, setScheduleFormError] = useState(false);
  const [logs, setLogs] = useState<Record<string, ServiceLog[]>>({});

  // Complete action modal
  const [completingScheduleId, setCompletingScheduleId] = useState<string | null>(null);
  const [completeForm, setCompleteForm] = useState({
    serviceReportNumber: "",
    actionDate: new Date().toISOString().slice(0, 10),
    resultDetails: "",
    customerFeedback: "",
  });

  // Delete confirm
  const [deleteConfirm, setDeleteConfirm] = useState<CustomerEquipment | null>(null);
  const [deleteScheduleConfirm, setDeleteScheduleConfirm] = useState<ServiceSchedule | null>(null);
  const [deleteCompletedSchedule, setDeleteCompletedSchedule] = useState<ServiceSchedule | null>(null);
  const [deleteOtpCode, setDeleteOtpCode] = useState("");
  const [deleteOtpEmail, setDeleteOtpEmail] = useState<string | null>(null);
  const [isSendingOtp, setIsSendingOtp] = useState(false);
  const [otpCountdown, setOtpCountdown] = useState(0);

  useEffect(() => {
    if (otpCountdown > 0) {
      const timer = setTimeout(() => setOtpCountdown(otpCountdown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [otpCountdown]);

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
      // Dynamic import — only load xlsx (7.2MB) when user actually exports
      const XLSX = await import("xlsx");

      // Fetch all schedules for a complete backup
      const schedRes = await fetch("/api/admin/schedules");
      const allSchedules: ServiceSchedule[] = schedRes.ok ? await schedRes.json() : [];

      // Sheet 1: Equipment
      const eqData = equipments.map((eq) => ({
        "ลูกค้า": eq.customerName || "",
        "บริษัท": eq.companyName || "",
        "สินค้า": stripHtml(eq.productName) || eq.productId,
        "Serial Number": eq.serialNumber,
        "เลขที่ใบเสนอราคา": eq.quotationNumber,
        "เลขที่ใบรับประกัน": eq.warrantyCertNumber,
        "ประเภทประกัน": eq.warrantyType,
        "เริ่มประกัน": eq.warrantyStartDate || "",
        "หมดประกัน": eq.warrantyEndDate || "",
        "สถานะ": eq.status,
        "วันที่บันทึก": eq.createdAt,
      }));

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

      const wb = XLSX.utils.book_new();
      const ws1 = XLSX.utils.json_to_sheet(eqData.length > 0 ? eqData : [{ "ไม่มีข้อมูล": "" }]);
      const ws2 = XLSX.utils.json_to_sheet(schedData.length > 0 ? schedData : [{ "ไม่มีข้อมูล": "" }]);

      // Auto-size columns
      const autoSize = (ws: ReturnType<typeof XLSX.utils.json_to_sheet>, data: Record<string, unknown>[]) => {
        if (data.length === 0) return;
        const keys = Object.keys(data[0]);
        ws["!cols"] = keys.map((k) => {
          let maxLen = k.length;
          for (const r of data) {
            const len = String(r[k] || "").length;
            if (len > maxLen) maxLen = len;
          }
          return { wch: maxLen + 2 };
        });
      };
      autoSize(ws1, eqData);
      autoSize(ws2, schedData);

      XLSX.utils.book_append_sheet(wb, ws1, "อุปกรณ์");
      XLSX.utils.book_append_sheet(wb, ws2, "นัดหมาย");

      const dateStr = new Date().toISOString().slice(0, 10);
      XLSX.writeFile(wb, `CRM_Equipment_Backup_${dateStr}.xlsx`);
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
            fetchSchedules(eq.id);
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

  const fetchSchedules = useCallback(async (equipmentId: string) => {
    setSchedules([]); // Clear immediately so stale data doesn't flash
    try {
      const res = await fetch(`/api/admin/schedules?equipmentId=${equipmentId}`);
      if (res.ok) {
        const data = await res.json();
        // Only apply if we're still viewing this equipment (prevents stale race).
        setViewingEquipment((current) => {
          if (current?.id === equipmentId) setSchedules(data);
          return current;
        });
      }
    } catch (err) {
      console.error(err);
    }
  }, []);

  const fetchLogs = useCallback(async (scheduleId: string) => {
    try {
      const res = await fetch(`/api/admin/schedules/${scheduleId}/logs`);
      if (res.ok) {
        const data = await res.json();
        setLogs((prev) => ({ ...prev, [scheduleId]: data }));
      }
    } catch (err) {
      console.error(err);
    }
  }, []);

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

  const executeDelete = async () => {
    if (!deleteConfirm || isSaving) return;
    setIsSaving(true);
    try {
      const res = await fetch(`/api/admin/equipments/${deleteConfirm.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete");
      showToast("ลบอุปกรณ์สำเร็จ", "success");
      setDeleteConfirm(null);
      if (viewingEquipment?.id === deleteConfirm.id) setViewingEquipment(null);
      fetchEquipments();
    } catch (err) {
      console.error(err);
      showToast("ลบอุปกรณ์ไม่สำเร็จ", "error");
    } finally {
      setIsSaving(false);
    }
  };

  // ── Schedule handlers ──────────────────────────────────────────────────────

  const handleSaveSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving) return;
    if (!editingSchedule?.scheduledDate) {
      setScheduleFormError(true);
      showToast("กรุณาระบุวันที่นัดหมาย", "error");
      return;
    }
    setScheduleFormError(false);
    setIsSaving(true);
    try {
      const method = editingSchedule.id ? "PUT" : "POST";
      const url = editingSchedule.id
        ? `/api/admin/schedules/${editingSchedule.id}`
        : "/api/admin/schedules";
      const body = {
        ...editingSchedule,
        equipmentId: editingSchedule.equipmentId || viewingEquipment?.id,
      };
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Failed to save schedule");
      showToast(editingSchedule.id ? "อัปเดตนัดหมายสำเร็จ" : "สร้างนัดหมายสำเร็จ", "success");
      setIsScheduleModalOpen(false);
      setEditingSchedule(null);
      if (viewingEquipment) fetchSchedules(viewingEquipment.id);
    } catch (err) {
      console.error(err);
      showToast("บันทึกนัดหมายไม่สำเร็จ", "error");
    } finally {
      setIsSaving(false);
    }
  };

  const executeDeleteSchedule = async () => {
    if (!deleteScheduleConfirm || isSaving) return;
    setIsSaving(true);
    try {
      const res = await fetch(`/api/admin/schedules/${deleteScheduleConfirm.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete");
      showToast("ลบนัดหมายสำเร็จ", "success");
      setDeleteScheduleConfirm(null);
      if (viewingEquipment) fetchSchedules(viewingEquipment.id);
    } catch (err) {
      console.error(err);
      showToast("ลบนัดหมายไม่สำเร็จ", "error");
    } finally {
      setIsSaving(false);
    }
  };

  const handleSendDeleteOtp = async () => {
    if (!deleteCompletedSchedule || isSendingOtp) return;
    setIsSendingOtp(true);
    try {
      const res = await fetch(`/api/admin/schedules/${deleteCompletedSchedule.id}/delete-otp`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to send OTP");
      }
      setDeleteOtpEmail(data.email || "อีเมลผู้ดูแลระบบ");
      setOtpCountdown(60);
      showToast(data.message || "ส่งรหัส OTP เรียบร้อยแล้ว", "success");
    } catch (err: any) {
      console.error(err);
      showToast(err.message || "ไม่สามารถส่งรหัส OTP ได้", "error");
    } finally {
      setIsSendingOtp(false);
    }
  };

  const executeDeleteCompletedSchedule = async () => {
    if (!deleteCompletedSchedule || isSaving) return;
    if (!deleteOtpCode || deleteOtpCode.length !== 6) {
      showToast("กรุณากรอกรหัส OTP 6 หลัก", "error");
      return;
    }
    setIsSaving(true);
    try {
      const res = await fetch(`/api/admin/schedules/${deleteCompletedSchedule.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ otp: deleteOtpCode }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to delete schedule");
      }
      showToast("ลบนัดหมายสำเร็จ", "success");
      setDeleteCompletedSchedule(null);
      setDeleteOtpCode("");
      setDeleteOtpEmail(null);
      if (viewingEquipment) fetchSchedules(viewingEquipment.id);
    } catch (err: any) {
      console.error(err);
      showToast(err.message || "ลบนัดหมายไม่สำเร็จ", "error");
    } finally {
      setIsSaving(false);
    }
  };

  const handleComplete = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!completingScheduleId || isSaving) return;
    setIsSaving(true);
    try {
      const res = await fetch(`/api/admin/schedules/${completingScheduleId}/logs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(completeForm),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed");
      }
      showToast("บันทึกผลงานสำเร็จ", "success");
      setCompletingScheduleId(null);
      setCompleteForm({
        serviceReportNumber: "",
        actionDate: new Date().toISOString().slice(0, 10),
        resultDetails: "",
        customerFeedback: "",
      });
      if (viewingEquipment) fetchSchedules(viewingEquipment.id);
    } catch (err) {
      console.error(err);
      showToast(err instanceof Error ? err.message : "บันทึกผลงานไม่สำเร็จ", "error");
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
    const isOverdue = status === "pending" && date < new Date().toISOString().slice(0, 10);
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
                    onClick={() => { setViewingEquipment(eq); setLogs({}); fetchSchedules(eq.id); }}
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

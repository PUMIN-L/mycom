"use client";
import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import Link from "next/link";
import SearchableDropdown from "../components/SearchableDropdown";
import type { SearchableDropdownOption } from "../components/SearchableDropdown";
import type {
  CustomerEquipment,
  ServiceSchedule,
  ServiceLog,
} from "../lib/types";

/** Strip HTML tags from rich-text product titles for plain-text display. */
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
  const [editingSchedule, setEditingSchedule] = useState<Partial<ServiceSchedule> | null>(null);
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

  // Search
  const [searchText, setSearchText] = useState("");

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

  // ── Filtered list ──────────────────────────────────────────────────────────

  const filtered = equipments.filter((eq) => {
    if (!searchText) return true;
    const q = searchText.toLowerCase();
    return (
      (eq.customerName || "").toLowerCase().includes(q) ||
      (eq.companyName || "").toLowerCase().includes(q) ||
      stripHtml(eq.productName).toLowerCase().includes(q) ||
      eq.serialNumber.toLowerCase().includes(q) ||
      eq.quotationNumber.toLowerCase().includes(q)
    );
  });

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
      showToast("กรุณาระบุวันที่นัดหมาย", "error");
      return;
    }
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

  const warrantyDaysLeft = (endDate: string | null) => {
    if (!endDate) return null;
    const diff = Math.ceil((new Date(endDate).getTime() - Date.now()) / 86400000);
    return diff;
  };

  const statusBadge = (status: string) => {
    if (status === "Active")
      return <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-green-100 text-green-700">Active</span>;
    return <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-red-100 text-red-700">Expired</span>;
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

      {/* Search */}
      <div className="mb-6">
        <input
          type="text"
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          placeholder="ค้นหาลูกค้า, บริษัท, สินค้า, Serial Number..."
          className="w-full sm:w-96 px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-400 transition-all"
        />
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
              filtered.map((eq) => {
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
                    <td className="py-4 pr-4 text-sm text-gray-700">{stripHtml(eq.productName) || eq.productId}</td>
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
                    <td className="py-4 pr-4">{statusBadge(eq.status)}</td>
                    <td className="py-4">
                      <button
                        onClick={(e) => { e.stopPropagation(); setDeleteConfirm(eq); }}
                        className="p-1.5 text-gray-400 hover:text-red-500 transition-colors rounded-lg hover:bg-red-50"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* ── Equipment CRUD Modal ──────────────────────────────────────────── */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setIsModalOpen(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="p-6 border-b border-gray-100">
              <h3 className="text-xl font-bold text-gray-800">{editing?.id ? "แก้ไขอุปกรณ์" : "เพิ่มอุปกรณ์ใหม่"}</h3>
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
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-400"
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
                    className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-400"
                    placeholder="QT-XXXXX"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">เลขที่ใบรับประกัน</label>
                  <input
                    type="text"
                    value={editing?.warrantyCertNumber || ""}
                    onChange={(e) => setEditing((prev) => ({ ...prev, warrantyCertNumber: e.target.value }))}
                    className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-400"
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
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-400"
                  placeholder="เช่น 1 Year, On-site"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">วันเริ่มประกัน</label>
                  <input
                    type="date"
                    value={editing?.warrantyStartDate || ""}
                    onChange={(e) => setEditing((prev) => ({ ...prev, warrantyStartDate: e.target.value }))}
                    className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-400"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">วันหมดประกัน</label>
                  <input
                    type="date"
                    value={editing?.warrantyEndDate || ""}
                    onChange={(e) => setEditing((prev) => ({ ...prev, warrantyEndDate: e.target.value }))}
                    className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-400"
                  />
                </div>
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
                        className="accent-orange-500"
                      />
                      <span className="text-sm text-gray-700">{s === "Active" ? "ใช้งานอยู่ (Active)" : "หมดอายุ (Expired)"}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Actions */}
              <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
                <button type="button" onClick={() => setIsModalOpen(false)} className="px-5 py-2.5 border border-gray-200 text-gray-600 font-semibold rounded-xl hover:bg-gray-50 transition-all">ยกเลิก</button>
                <button type="submit" disabled={isSaving} className="px-5 py-2.5 bg-gradient-to-r from-orange-500 to-orange-600 text-white font-semibold rounded-xl hover:from-orange-600 hover:to-orange-700 transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed">{isSaving ? "กำลังบันทึก..." : "บันทึก"}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Equipment Detail / Schedules Modal ────────────────────────────── */}
      {viewingEquipment && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setViewingEquipment(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="p-6 border-b border-gray-100 flex justify-between items-start">
              <div>
                <h3 className="text-xl font-bold text-gray-800">รายละเอียดอุปกรณ์</h3>
                <p className="text-sm text-gray-400 mt-1">{stripHtml(viewingEquipment.productName)} — S/N: {viewingEquipment.serialNumber || "—"}</p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => { setEditing(viewingEquipment); setSubmitAttempted(false); setIsModalOpen(true); setViewingEquipment(null); }}
                  className="px-4 py-2 bg-gray-100 text-gray-700 font-semibold rounded-xl hover:bg-gray-200 transition-all text-sm"
                >
                  ✏️ แก้ไข
                </button>
                <button
                  onClick={() => setViewingEquipment(null)}
                  className="p-2 text-gray-400 hover:text-gray-600 transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                </button>
              </div>
            </div>

            {/* Equipment info grid */}
            <div className="p-6 grid grid-cols-2 gap-4">
              <Info label="ลูกค้า" value={viewingEquipment.customerName} />
              <Info label="บริษัท" value={viewingEquipment.companyName} />
              <Info label="สินค้า" value={stripHtml(viewingEquipment.productName)} />
              <Info label="Serial Number" value={viewingEquipment.serialNumber} />
              <Info label="ใบเสนอราคา" value={viewingEquipment.quotationNumber} />
              <Info label="ใบรับประกัน" value={viewingEquipment.warrantyCertNumber} />
              <Info label="ประเภทประกัน" value={viewingEquipment.warrantyType} />
              <Info label="สถานะ" value={viewingEquipment.status} />
              <Info label="เริ่มประกัน" value={viewingEquipment.warrantyStartDate} />
              <Info label="หมดประกัน" value={viewingEquipment.warrantyEndDate} />
            </div>

            {/* Schedules */}
            <div className="p-6 border-t border-gray-100">
              <div className="flex justify-between items-center mb-4">
                <h4 className="text-lg font-bold text-gray-800">📅 นัดหมาย Service / โทรติดตาม</h4>
                <button
                  onClick={() => { setEditingSchedule({ scheduleType: "service", scheduledDate: "", notes: "" }); setIsScheduleModalOpen(true); }}
                  className="px-4 py-2 bg-blue-500 text-white font-semibold rounded-xl hover:bg-blue-600 transition-all text-sm flex items-center gap-1.5"
                >
                  + เพิ่มนัดหมาย
                </button>
              </div>

              {schedules.length === 0 ? (
                <p className="text-gray-400 text-center py-8">ยังไม่มีนัดหมาย</p>
              ) : (
                <div className="space-y-3">
                  {schedules.map((s) => (
                    <div key={s.id} className="border border-gray-100 rounded-xl p-4 hover:bg-gray-50/50 transition-colors">
                      <div className="flex justify-between items-start">
                        <div className="flex items-center gap-3">
                          {scheduleTypeBadge(s.scheduleType)}
                          <div>
                            <div className="font-semibold text-gray-800 text-sm">{s.scheduledDate}</div>
                            {s.notes && <div className="text-xs text-gray-400 mt-0.5">{s.notes}</div>}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {scheduleStatusBadge(s.status, s.scheduledDate)}
                          {s.status === "pending" && (
                            <button
                              onClick={() => { setCompletingScheduleId(s.id); setCompleteForm({ serviceReportNumber: "", actionDate: new Date().toISOString().slice(0, 10), resultDetails: "", customerFeedback: "" }); }}
                              className="px-3 py-1.5 bg-green-500 text-white text-xs font-semibold rounded-lg hover:bg-green-600 transition-all"
                            >
                              ✅ จบงาน
                            </button>
                          )}
                          {s.status === "completed" && !logs[s.id] && (
                            <button
                              onClick={() => fetchLogs(s.id)}
                              className="px-3 py-1.5 bg-gray-100 text-gray-600 text-xs font-semibold rounded-lg hover:bg-gray-200 transition-all"
                            >
                              📋 ดูประวัติ
                            </button>
                          )}
                          <button
                            onClick={(e) => { e.stopPropagation(); setDeleteScheduleConfirm(s); }}
                            className="p-1 text-gray-400 hover:text-red-500 transition-colors"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                          </button>
                        </div>
                      </div>
                      {/* Show logs inline */}
                      {logs[s.id] && logs[s.id].length > 0 && (
                        <div className="mt-3 pt-3 border-t border-gray-100 space-y-2">
                          {logs[s.id].map((log) => (
                            <div key={log.id} className="bg-gray-50 rounded-lg p-3 text-sm">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="font-semibold text-gray-700">เลขที่รายงาน:</span>
                                <span className="text-gray-600">{log.serviceReportNumber || "—"}</span>
                                <span className="text-gray-300">|</span>
                                <span className="text-gray-500">{log.actionDate}</span>
                              </div>
                              {log.resultDetails && <p className="text-gray-600">{log.resultDetails}</p>}
                              {log.customerFeedback && (
                                <p className="text-blue-600 mt-1">💡 Feedback: {log.customerFeedback}</p>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Schedule CRUD Modal ───────────────────────────────────────────── */}
      {isScheduleModalOpen && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[60] flex items-center justify-center p-4" onClick={() => setIsScheduleModalOpen(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
            <div className="p-6 border-b border-gray-100">
              <h3 className="text-xl font-bold text-gray-800">{editingSchedule?.id ? "แก้ไขนัดหมาย" : "เพิ่มนัดหมายใหม่"}</h3>
            </div>
            <form onSubmit={handleSaveSchedule} className="p-6 space-y-5">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">ประเภท</label>
                <div className="flex gap-4">
                  {[
                    { value: "service", label: "🔧 Service" },
                    { value: "phone_call", label: "📞 โทรติดตาม" },
                  ].map((opt) => (
                    <label key={opt.value} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="scheduleType"
                        checked={(editingSchedule?.scheduleType || "service") === opt.value}
                        onChange={() => setEditingSchedule((prev) => ({ ...prev, scheduleType: opt.value as "service" | "phone_call" }))}
                        className="accent-orange-500"
                      />
                      <span className="text-sm text-gray-700">{opt.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">วันที่นัดหมาย <span className="text-red-500">*</span></label>
                <input
                  type="date"
                  value={editingSchedule?.scheduledDate || ""}
                  onChange={(e) => setEditingSchedule((prev) => ({ ...prev, scheduledDate: e.target.value }))}
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-400"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">หมายเหตุ</label>
                <textarea
                  value={editingSchedule?.notes || ""}
                  onChange={(e) => setEditingSchedule((prev) => ({ ...prev, notes: e.target.value }))}
                  rows={3}
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-400 resize-none"
                  placeholder="สิ่งที่ต้องทำ / หมายเหตุ"
                />
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
                <button type="button" onClick={() => setIsScheduleModalOpen(false)} className="px-5 py-2.5 border border-gray-200 text-gray-600 font-semibold rounded-xl hover:bg-gray-50 transition-all">ยกเลิก</button>
                <button type="submit" disabled={isSaving} className="px-5 py-2.5 bg-gradient-to-r from-blue-500 to-blue-600 text-white font-semibold rounded-xl hover:from-blue-600 hover:to-blue-700 transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed">{isSaving ? "กำลังบันทึก..." : "บันทึก"}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Complete Action Modal ─────────────────────────────────────────── */}
      {completingScheduleId && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[60] flex items-center justify-center p-4" onClick={() => setCompletingScheduleId(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
            <div className="p-6 border-b border-gray-100">
              <h3 className="text-xl font-bold text-gray-800">✅ บันทึกผลการดำเนินงาน</h3>
            </div>
            <form onSubmit={handleComplete} className="p-6 space-y-5">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">เลขที่ใบรายงานการซ่อม</label>
                <input
                  type="text"
                  value={completeForm.serviceReportNumber}
                  onChange={(e) => setCompleteForm((prev) => ({ ...prev, serviceReportNumber: e.target.value }))}
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-green-500/20 focus:border-green-400"
                  placeholder="SR-XXXXX"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">วันที่ดำเนินการ</label>
                <input
                  type="date"
                  value={completeForm.actionDate}
                  onChange={(e) => setCompleteForm((prev) => ({ ...prev, actionDate: e.target.value }))}
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-green-500/20 focus:border-green-400"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">รายละเอียดสิ่งที่ทำ</label>
                <textarea
                  value={completeForm.resultDetails}
                  onChange={(e) => setCompleteForm((prev) => ({ ...prev, resultDetails: e.target.value }))}
                  rows={3}
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-green-500/20 focus:border-green-400 resize-none"
                  placeholder="อธิบายสิ่งที่ดำเนินการ..."
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Feedback ลูกค้า / โอกาสขายเพิ่ม</label>
                <textarea
                  value={completeForm.customerFeedback}
                  onChange={(e) => setCompleteForm((prev) => ({ ...prev, customerFeedback: e.target.value }))}
                  rows={3}
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-green-500/20 focus:border-green-400 resize-none"
                  placeholder="ลูกค้าสนใจสินค้าอะไรเพิ่มเติม / ความต้องการในอนาคต..."
                />
              </div>
              <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
                <button type="button" onClick={() => setCompletingScheduleId(null)} className="px-5 py-2.5 border border-gray-200 text-gray-600 font-semibold rounded-xl hover:bg-gray-50 transition-all">ยกเลิก</button>
                <button type="submit" disabled={isSaving} className="px-5 py-2.5 bg-gradient-to-r from-green-500 to-green-600 text-white font-semibold rounded-xl hover:from-green-600 hover:to-green-700 transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed">{isSaving ? "กำลังบันทึก..." : "บันทึกผลงาน"}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Delete Confirm Dialogs ────────────────────────────────────────── */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[60] flex items-center justify-center p-4" onClick={() => setDeleteConfirm(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 text-center" onClick={(e) => e.stopPropagation()}>
            <div className="text-5xl mb-4">🗑️</div>
            <h3 className="text-lg font-bold text-gray-800 mb-2">ลบอุปกรณ์นี้?</h3>
            <p className="text-gray-500 text-sm mb-6">S/N: {deleteConfirm.serialNumber || "—"}<br />การลบจะรวมถึงนัดหมายและประวัติทั้งหมด</p>
            <div className="flex gap-3 justify-center">
              <button onClick={() => setDeleteConfirm(null)} className="px-5 py-2.5 border border-gray-200 text-gray-600 font-semibold rounded-xl hover:bg-gray-50 transition-all">ยกเลิก</button>
              <button onClick={executeDelete} className="px-5 py-2.5 bg-red-500 text-white font-semibold rounded-xl hover:bg-red-600 transition-all">ลบ</button>
            </div>
          </div>
        </div>
      )}

      {deleteScheduleConfirm && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[60] flex items-center justify-center p-4" onClick={() => setDeleteScheduleConfirm(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 text-center" onClick={(e) => e.stopPropagation()}>
            <div className="text-5xl mb-4">🗑️</div>
            <h3 className="text-lg font-bold text-gray-800 mb-2">ลบนัดหมายนี้?</h3>
            <p className="text-gray-500 text-sm mb-6">{deleteScheduleConfirm.scheduledDate}</p>
            <div className="flex gap-3 justify-center">
              <button onClick={() => setDeleteScheduleConfirm(null)} className="px-5 py-2.5 border border-gray-200 text-gray-600 font-semibold rounded-xl hover:bg-gray-50 transition-all">ยกเลิก</button>
              <button onClick={executeDeleteSchedule} className="px-5 py-2.5 bg-red-500 text-white font-semibold rounded-xl hover:bg-red-600 transition-all">ลบ</button>
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

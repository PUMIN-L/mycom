"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../context/AuthContext";
import Toast from "../../components/Toast";
import type { CrmAlerts, CustomerEquipment } from "../../lib/types";

// Import Modals
import EquipmentEditModal from "../../components/modals/EquipmentEditModal";
import EquipmentDetailsModal from "../../components/modals/EquipmentDetailsModal";
import SalesRecordEditModal from "../../components/modals/SalesRecordEditModal";

export default function AlertsPage() {
  const router = useRouter();
  const { isLoggedIn, isLoading: authLoading } = useAuth();
  const [alerts, setAlerts] = useState<CrmAlerts | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [activeTab, setActiveTab] = useState("all");

  // Modals state
  const [editingEquipment, setEditingEquipment] = useState<CustomerEquipment | null>(null);
  const [viewingEquipmentDetails, setViewingEquipmentDetails] = useState<CustomerEquipment | null>(null);
  const [editingSalesRecordId, setEditingSalesRecordId] = useState<string | null>(null);
  
  // Complete modal
  const [completingId, setCompletingId] = useState<string | null>(null);
  const [completeForm, setCompleteForm] = useState({
    serviceReportNumber: "",
    actionDate: new Date().toISOString().slice(0, 10),
    resultDetails: "",
    customerFeedback: "",
  });

  // View Details Modal
  const [selectedAlert, setSelectedAlert] = useState<{
    type: "schedule" | "warranty" | "incomplete" | "missing_doc";
    data: any;
  } | null>(null);

  useEffect(() => {
    if (!authLoading && !isLoggedIn) router.replace("/login");
  }, [isLoggedIn, authLoading, router]);

  const showToast = (message: string, type: "success" | "error") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const fetchAlerts = async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/admin/alerts");
      if (res.ok) setAlerts(await res.json());
    } catch (err) {
      console.error(err);
      showToast("โหลดข้อมูลแจ้งเตือนไม่สำเร็จ", "error");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isLoggedIn) fetchAlerts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoggedIn]);

  const handleComplete = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!completingId || isSaving) return;
    setIsSaving(true);
    try {
      const res = await fetch(`/api/admin/schedules/${completingId}/logs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(completeForm),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed");
      }
      showToast("บันทึกผลงานสำเร็จ", "success");
      setCompletingId(null);
      setCompleteForm({
        serviceReportNumber: "",
        actionDate: new Date().toISOString().slice(0, 10),
        resultDetails: "",
        customerFeedback: "",
      });
      fetchAlerts();
    } catch (err) {
      console.error(err);
      showToast(err instanceof Error ? err.message : "บันทึกผลงานไม่สำเร็จ", "error");
    } finally {
      setIsSaving(false);
    }
  };

  const handleEditClick = async (alertTarget?: any) => {
    const target = alertTarget || selectedAlert;
    if (!target) return;
    
    if (target.type === "missing_doc") {
      setEditingSalesRecordId(target.data.id);
      setSelectedAlert(null);
    } else if (target.type === "schedule") {
      try {
        const eqId = target.data.equipmentId;
        const res = await fetch(`/api/admin/equipments/${eqId}`);
        if (res.ok) {
          const eq = await res.json();
          setViewingEquipmentDetails(eq);
          setSelectedAlert(null);
        } else {
          showToast("โหลดข้อมูลอุปกรณ์ไม่สำเร็จ", "error");
        }
      } catch {
        showToast("โหลดข้อมูลอุปกรณ์ไม่สำเร็จ", "error");
      }
    } else {
      // warranty or incomplete -> target.data IS the equipment
      setEditingEquipment(target.data);
      setSelectedAlert(null);
    }
  };

  const warrantyDaysLeft = (endDate: string | null) => {
    if (!endDate) return null;
    return Math.ceil((new Date(endDate).getTime() - Date.now()) / 86400000);
  };

  if (authLoading || !isLoggedIn) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-orange-500 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  const allAlerts = alerts
    ? [
        ...(alerts.expiringWarranties || []).map((data) => ({ type: "warranty" as const, data })),
        ...(alerts.incompleteEquipments || []).map((data) => ({ type: "incomplete" as const, data })),
        ...(alerts.upcomingSchedules || []).map((data) => ({ type: "schedule" as const, data })),
        ...(alerts.missingDocuments || []).map((data) => ({ type: "missing_doc" as const, data })),
      ]
    : [];

  const filteredAlerts = allAlerts.filter((a) => (activeTab === "all" ? true : a.type === activeTab));
  
  // Custom sort to put overdue/urgent items first
  filteredAlerts.sort((a, b) => {
    // 1. Overdue schedules first
    const aIsOverdue = a.type === "schedule" && a.data.overdue;
    const bIsOverdue = b.type === "schedule" && b.data.overdue;
    if (aIsOverdue && !bIsOverdue) return -1;
    if (!aIsOverdue && bIsOverdue) return 1;

    // 2. Missing docs next (these are already overdue per the SQL logic)
    if (a.type === "missing_doc" && b.type !== "missing_doc") return -1;
    if (a.type !== "missing_doc" && b.type === "missing_doc") return 1;

    // 3. Expired warranties next
    const aIsExp = a.type === "warranty" && warrantyDaysLeft(a.data.warrantyEndDate) !== null && warrantyDaysLeft(a.data.warrantyEndDate)! <= 0;
    const bIsExp = b.type === "warranty" && warrantyDaysLeft(b.data.warrantyEndDate) !== null && warrantyDaysLeft(b.data.warrantyEndDate)! <= 0;
    if (aIsExp && !bIsExp) return -1;
    if (!aIsExp && bIsExp) return 1;

    return 0;
  });

  const tabOptions = [
    { id: "all", label: "ทั้งหมด", count: allAlerts.length, color: "bg-gray-100 text-gray-700" },
    { id: "schedule", label: "กำหนดการ", count: alerts?.upcomingSchedules?.length || 0, color: "bg-blue-50 text-blue-700 border-blue-200" },
    { id: "warranty", label: "ประกันใกล้หมด", count: alerts?.expiringWarranties?.length || 0, color: "bg-orange-50 text-orange-700 border-orange-200" },
    { id: "incomplete", label: "ข้อมูลไม่ครบ", count: alerts?.incompleteEquipments?.length || 0, color: "bg-rose-50 text-rose-700 border-rose-200" },
    { id: "missing_doc", label: "เอกสารค้าง", count: alerts?.missingDocuments?.length || 0, color: "bg-red-50 text-red-700 border-red-200" },
  ];

  return (
    <div className="min-h-screen bg-gray-50/50">
      {/* Toast */}
      {toast && (
        <div className="fixed top-6 right-6 z-[100] animate-in slide-in-from-top-4 fade-in">
          <Toast message={toast.message} type={toast.type} />
        </div>
      )}

      {/* Header */}
      <div className="bg-white border-b border-gray-100 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div>
              <div className="flex items-center gap-3 mb-1">
                <div className="w-10 h-10 bg-rose-100 text-rose-600 rounded-xl flex items-center justify-center text-xl shadow-sm">
                  🔔
                </div>
                <h1 className="text-2xl font-bold text-gray-900 tracking-tight">ศูนย์แจ้งเตือน CRM</h1>
              </div>
              <p className="text-sm text-gray-500 font-medium ml-13">รวมรายการที่ต้องติดตามและอัปเดต</p>
            </div>
            <button
              onClick={fetchAlerts}
              className="px-4 py-2 bg-white border border-gray-200 text-gray-700 font-semibold rounded-xl hover:bg-gray-50 hover:border-gray-300 transition-all text-sm shadow-sm flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
              รีเฟรช
            </button>
          </div>

          {/* Tabs */}
          <div className="flex gap-2 mt-8 overflow-x-auto pb-2 no-scrollbar">
            {tabOptions.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold whitespace-nowrap transition-all duration-200 border ${
                  activeTab === tab.id
                    ? "bg-gray-900 text-white border-gray-900 shadow-md"
                    : `bg-white border-gray-200 text-gray-600 hover:bg-gray-50 hover:border-gray-300`
                }`}
              >
                {tab.label}
                <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                  activeTab === tab.id ? "bg-white/20 text-white" : tab.color
                }`}>
                  {tab.count}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-20 text-gray-400">
             <div className="w-10 h-10 border-4 border-gray-200 border-t-gray-500 rounded-full animate-spin mb-4"></div>
             <p className="font-medium">กำลังโหลดข้อมูล...</p>
          </div>
        ) : filteredAlerts.length === 0 ? (
          <div className="bg-white rounded-3xl border border-gray-100 p-16 text-center shadow-sm">
            <div className="text-6xl mb-4 opacity-50">🎉</div>
            <h3 className="text-xl font-bold text-gray-800 mb-2">ไม่มีแจ้งเตือน</h3>
            <p className="text-gray-500">ทุกอย่างอัปเดตเรียบร้อยแล้วในหมวดหมู่นี้</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {filteredAlerts.map((alert, idx) => {
              if (alert.type === "schedule") {
                const isOverdue = alert.data.overdue;
                return (
                  <div key={idx} onClick={() => setSelectedAlert(alert)} className="bg-white rounded-2xl p-5 border border-gray-100 hover:border-blue-200 hover:shadow-lg transition-all cursor-pointer group relative overflow-hidden flex flex-col">
                    <div className="absolute top-0 left-0 w-1 h-full bg-blue-500"></div>
                    <div className="flex justify-between items-start mb-4">
                      <div className={`px-2.5 py-1 rounded-md text-xs font-bold flex items-center gap-1.5 ${isOverdue ? "bg-red-50 text-red-700" : "bg-blue-50 text-blue-700"}`}>
                        {alert.data.scheduleType === "service" ? "🔧 Service" : "📞 โทรติดตาม"}
                      </div>
                      <span className={`text-xs font-bold ${isOverdue ? "text-red-600 bg-red-50 px-2 py-0.5 rounded-full" : "text-gray-500"}`}>
                        {alert.data.scheduledDate} {isOverdue && "(เลยกำหนด)"}
                      </span>
                    </div>
                    
                    <h4 className="font-bold text-gray-900 mb-1 line-clamp-1">{alert.data.customerName || "ลูกค้าทั่วไป"}</h4>
                    <p className="text-sm text-gray-500 mb-4 line-clamp-1" dangerouslySetInnerHTML={{ __html: alert.data.productName || "ไม่ระบุสินค้า" }} />
                    
                    <div className="mt-auto pt-4 flex gap-2 w-full">
                      <button 
                        onClick={(e) => { e.stopPropagation(); handleEditClick(alert); }}
                        className="flex-1 px-3 py-2 bg-gray-50 text-gray-700 text-sm font-semibold rounded-xl hover:bg-gray-100 transition-colors flex items-center justify-center gap-1.5"
                      >
                         <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                         แก้ไข
                      </button>
                      <button 
                        onClick={(e) => { e.stopPropagation(); setCompletingId(alert.data.id); }}
                        className="flex-1 px-3 py-2 bg-emerald-50 text-emerald-700 text-sm font-semibold rounded-xl hover:bg-emerald-100 transition-colors flex items-center justify-center gap-1.5"
                      >
                         <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" /></svg>
                         เสร็จแล้ว
                      </button>
                    </div>
                  </div>
                );
              }

              if (alert.type === "warranty") {
                const daysLeft = warrantyDaysLeft(alert.data.warrantyEndDate);
                const isExp = daysLeft !== null && daysLeft <= 0;
                return (
                  <div key={idx} onClick={() => setSelectedAlert(alert)} className="bg-white rounded-2xl p-5 border border-gray-100 hover:border-orange-200 hover:shadow-lg transition-all cursor-pointer group relative overflow-hidden flex flex-col">
                    <div className={`absolute top-0 left-0 w-1 h-full ${isExp ? "bg-red-500" : "bg-orange-500"}`}></div>
                    <div className="flex justify-between items-start mb-4">
                      <div className={`px-2.5 py-1 rounded-md text-xs font-bold ${isExp ? "bg-red-50 text-red-700" : "bg-orange-50 text-orange-700"}`}>
                        🛡️ {isExp ? "หมดประกันแล้ว" : "ประกันใกล้หมด"}
                      </div>
                      <span className={`text-xs font-bold ${isExp ? "text-red-600 bg-red-50 px-2 py-0.5 rounded-full" : "text-orange-600 bg-orange-50 px-2 py-0.5 rounded-full"}`}>
                        เหลือ {daysLeft} วัน
                      </span>
                    </div>
                    
                    <h4 className="font-bold text-gray-900 mb-1 line-clamp-1">{alert.data.customerName || "ลูกค้าทั่วไป"}</h4>
                    <p className="text-sm text-gray-500 mb-1 line-clamp-1" dangerouslySetInnerHTML={{ __html: alert.data.productName || "ไม่ระบุสินค้า" }} />
                    <p className="text-xs text-gray-400 font-mono mb-4">S/N: {alert.data.serialNumber || "—"}</p>
                    
                    <button className="mt-auto w-full px-3 py-2 bg-gray-50 text-gray-700 text-sm font-semibold rounded-xl hover:bg-gray-100 transition-colors flex items-center justify-center gap-1.5 opacity-0 group-hover:opacity-100">
                      ดูรายละเอียด →
                    </button>
                  </div>
                );
              }

              if (alert.type === "incomplete") {
                return (
                  <div key={idx} onClick={() => setSelectedAlert(alert)} className="bg-white rounded-2xl p-5 border border-gray-100 hover:border-rose-200 hover:shadow-lg transition-all cursor-pointer group relative overflow-hidden flex flex-col">
                    <div className="absolute top-0 left-0 w-1 h-full bg-rose-500"></div>
                    <div className="flex justify-between items-start mb-4">
                      <div className="px-2.5 py-1 rounded-md text-xs font-bold bg-rose-50 text-rose-700">
                        ⚠️ ข้อมูลไม่ครบ
                      </div>
                    </div>
                    
                    <h4 className="font-bold text-gray-900 mb-1 line-clamp-1">{alert.data.customerName || "ลูกค้าทั่วไป"}</h4>
                    <p className="text-sm text-gray-500 mb-3 line-clamp-1" dangerouslySetInnerHTML={{ __html: alert.data.productName || "ไม่ระบุสินค้า" }} />
                    
                    <div className="flex flex-wrap gap-1 mb-4">
                      {!alert.data.serialNumber && <span className="text-[10px] font-bold bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded uppercase">No S/N</span>}
                      {!alert.data.warrantyStartDate && <span className="text-[10px] font-bold bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded uppercase">No Warranty Start</span>}
                    </div>
                    
                    <button className="mt-auto w-full px-3 py-2 bg-rose-50 text-rose-700 text-sm font-semibold rounded-xl hover:bg-rose-100 transition-colors flex items-center justify-center gap-1.5">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                      เพิ่มข้อมูล
                    </button>
                  </div>
                );
              }

              if (alert.type === "missing_doc") {
                return (
                  <div key={idx} onClick={() => setSelectedAlert(alert)} className="bg-white rounded-2xl p-5 border border-gray-100 hover:border-red-200 hover:shadow-lg transition-all cursor-pointer group relative overflow-hidden flex flex-col">
                    <div className="absolute top-0 left-0 w-1 h-full bg-red-500"></div>
                    <div className="flex justify-between items-start mb-4">
                      <div className="px-2.5 py-1 rounded-md text-xs font-bold bg-red-50 text-red-700 flex items-center gap-1.5">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                        เอกสารค้าง
                      </div>
                      <span className="text-xs font-bold text-gray-400">{alert.data.saleDate}</span>
                    </div>
                    
                    <h4 className="font-bold text-gray-900 mb-1 line-clamp-1">{alert.data.customerName || "ลูกค้าทั่วไป"}</h4>
                    <p className="text-sm text-gray-500 mb-3 line-clamp-1" dangerouslySetInnerHTML={{ __html: alert.data.productName || "ไม่ระบุสินค้า" }} />
                    
                    <div className="flex flex-col gap-1 mb-4 text-xs font-medium text-gray-500">
                       {!alert.data.deliveryRef && <div className="flex items-center gap-1.5"><span className="text-red-500">❌</span> ขาดใบส่งสินค้า (เกิน 20 วัน)</div>}
                       {alert.data.invoiceRef && !alert.data.receiptRef && <div className="flex items-center gap-1.5"><span className="text-orange-500">⚠️</span> ขาดใบเสร็จ (เกิน 30 วัน)</div>}
                    </div>
                    
                    <button className="mt-auto w-full px-3 py-2 bg-gray-900 text-white text-sm font-semibold rounded-xl hover:bg-gray-800 transition-colors flex items-center justify-center gap-1.5">
                      ตามเอกสาร →
                    </button>
                  </div>
                );
              }
            })}
          </div>
        )}
      </div>

      {/* ── Complete Schedule Modal ─────────────────────────────────────── */}
      {completingId && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in fade-in" onClick={() => setCompletingId(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden animate-in zoom-in-95" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
              <h2 className="text-lg font-bold text-gray-800">✅ บันทึกผลการดำเนินงาน</h2>
              <button
                onClick={() => setCompletingId(null)}
                className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <form onSubmit={handleComplete} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">เลขที่ใบแจ้งซ่อม / Service Report</label>
                <input
                  type="text"
                  value={completeForm.serviceReportNumber}
                  onChange={(e) => setCompleteForm((prev) => ({ ...prev, serviceReportNumber: e.target.value }))}
                  className="w-full px-4 py-2 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 font-mono"
                  placeholder="เช่น SR-12345"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">วันที่ดำเนินการ <span className="text-red-500">*</span></label>
                <input
                  type="date"
                  required
                  value={completeForm.actionDate}
                  onChange={(e) => setCompleteForm((prev) => ({ ...prev, actionDate: e.target.value }))}
                  className="w-full px-4 py-2 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">รายละเอียดสิ่งที่ทำ</label>
                <textarea
                  value={completeForm.resultDetails}
                  onChange={(e) => setCompleteForm((prev) => ({ ...prev, resultDetails: e.target.value }))}
                  rows={3}
                  className="w-full px-4 py-2 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 resize-y"
                  placeholder="อธิบายสิ่งที่ดำเนินการ..."
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Feedback ลูกค้า / โอกาสขายเพิ่ม</label>
                <textarea
                  value={completeForm.customerFeedback}
                  onChange={(e) => setCompleteForm((prev) => ({ ...prev, customerFeedback: e.target.value }))}
                  rows={3}
                  className="w-full px-4 py-2 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 resize-y"
                  placeholder="ลูกค้าสนใจสินค้าอะไรเพิ่มเติม / ความต้องการในอนาคต..."
                />
              </div>
              <div className="pt-4 flex justify-end gap-3">
                <button 
                  type="button" 
                  onClick={() => setCompletingId(null)} 
                  className="px-5 py-2.5 text-gray-600 font-medium hover:bg-gray-100 rounded-xl transition-colors"
                >
                  ยกเลิก
                </button>
                <button 
                  type="submit" 
                  disabled={isSaving} 
                  className="px-6 py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white font-semibold rounded-xl shadow-sm disabled:opacity-50 transition-colors"
                >
                  {isSaving ? "กำลังบันทึก..." : "บันทึกข้อมูล"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Alert Details Modal ─────────────────────────────────────────── */}
      {selectedAlert && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in fade-in" onClick={() => setSelectedAlert(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl overflow-hidden animate-in zoom-in-95" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
              <h2 className="text-lg font-bold text-gray-800">รายละเอียดแจ้งเตือน</h2>
              <button
                onClick={() => setSelectedAlert(null)}
                className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            
            <div className="p-6 space-y-6">
              <div className="grid grid-cols-2 gap-y-4 gap-x-6 text-sm">
                <div>
                  <div className="text-gray-500 mb-1">ลูกค้า</div>
                  <div className="font-semibold text-gray-800">{selectedAlert.data.customerName || "—"}</div>
                </div>
                <div>
                  <div className="text-gray-500 mb-1">บริษัท</div>
                  <div className="font-semibold text-gray-800">{selectedAlert.data.companyName || "—"}</div>
                </div>
                <div className="col-span-2">
                  <div className="text-gray-500 mb-1">สินค้า</div>
                  <div className="font-semibold text-gray-800" dangerouslySetInnerHTML={{ __html: selectedAlert.data.productName || "—" }} />
                </div>
                
                {selectedAlert.type === "schedule" && (
                  <>
                    <div>
                      <div className="text-gray-500 mb-1">ประเภท</div>
                      <div className="font-semibold text-gray-800">
                        {selectedAlert.data.scheduleType === "service" ? "Service" : "โทรติดตาม"}
                      </div>
                    </div>
                    <div>
                      <div className="text-gray-500 mb-1">กำหนดการ</div>
                      <div className="font-semibold text-gray-800">{selectedAlert.data.scheduledDate}</div>
                    </div>
                    <div>
                      <div className="text-gray-500 mb-1">สถานะ</div>
                      <div className="font-semibold text-gray-800">
                        {selectedAlert.data.overdue ? (
                           <span className="text-red-600">⚠️ เกินกำหนด</span>
                        ) : (
                           <span className="text-amber-600">รอดำเนินการ</span>
                        )}
                      </div>
                    </div>
                    {selectedAlert.data.notes && (
                      <div className="col-span-2">
                        <div className="text-gray-500 mb-1">หมายเหตุ</div>
                        <div className="text-gray-800 bg-gray-50 p-3 rounded-xl whitespace-pre-wrap">{selectedAlert.data.notes}</div>
                      </div>
                    )}
                  </>
                )}

                {selectedAlert.type === "warranty" && (
                  <>
                    <div>
                      <div className="text-gray-500 mb-1">Serial Number</div>
                      <div className="font-mono text-gray-800">{selectedAlert.data.serialNumber || "—"}</div>
                    </div>
                    <div>
                      <div className="text-gray-500 mb-1">หมดประกัน</div>
                      <div className="font-semibold text-gray-800">{selectedAlert.data.warrantyEndDate}</div>
                    </div>
                  </>
                )}

                {selectedAlert.type === "incomplete" && (
                  <>
                    <div className="col-span-2">
                      <div className="text-gray-500 mb-1">สิ่งที่ขาด</div>
                      <div className="flex flex-col gap-1.5 mt-1">
                        {!selectedAlert.data.serialNumber && <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-white border border-rose-100 text-rose-700 w-fit">❌ ขาด Serial Number</span>}
                        {!selectedAlert.data.warrantyStartDate && <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-white border border-rose-100 text-rose-700 w-fit">❌ ขาดวันเริ่มประกัน</span>}
                      </div>
                    </div>
                  </>
                )}

                {selectedAlert.type === "missing_doc" && (
                  <>
                    <div>
                      <div className="text-gray-500 mb-1">วันที่ขาย</div>
                      <div className="font-semibold text-gray-800">{selectedAlert.data.saleDate}</div>
                    </div>
                    <div>
                      <div className="text-gray-500 mb-1">พนักงานขาย</div>
                      <div className="font-semibold text-gray-800">{selectedAlert.data.salespersonName || "—"}</div>
                    </div>
                    <div className="col-span-2">
                      <div className="text-gray-500 mb-1">สถานะเอกสาร</div>
                      <div className="flex flex-col gap-1.5 mt-1">
                        {!selectedAlert.data.deliveryRef && (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-red-50 text-red-700 w-fit">ขาดใบส่งสินค้า</span>
                        )}
                        {selectedAlert.data.invoiceRef && !selectedAlert.data.receiptRef && (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-orange-50 text-orange-700 w-fit">ขาดใบเสร็จ</span>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>

            <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3 bg-gray-50/50">
              <button 
                onClick={() => setSelectedAlert(null)} 
                className="px-5 py-2.5 bg-white border border-gray-200 text-gray-700 font-semibold rounded-xl hover:bg-gray-50 transition-all text-sm shadow-sm"
              >
                ปิด
              </button>
              <button
                onClick={() => handleEditClick()}
                className="px-5 py-2.5 bg-indigo-600 text-white font-semibold rounded-xl hover:bg-indigo-700 transition-all text-sm shadow-sm flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                ไปแก้ไขข้อมูล
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* ── Extracted Modals ────────────────────────────────────────────── */}
      {editingEquipment && (
        <EquipmentEditModal
          initialData={editingEquipment}
          onClose={() => setEditingEquipment(null)}
          onSaveSuccess={() => {
            setEditingEquipment(null);
            fetchAlerts();
            showToast("บันทึกข้อมูลสำเร็จ", "success");
          }}
        />
      )}
      
      {viewingEquipmentDetails && (
        <EquipmentDetailsModal
          equipment={viewingEquipmentDetails}
          onClose={() => {
            setViewingEquipmentDetails(null);
            fetchAlerts(); // Fetch alerts in case a schedule was added/deleted
          }}
          onEditEquipment={(eq) => {
            setViewingEquipmentDetails(null);
            setEditingEquipment(eq);
          }}
        />
      )}
      
      {editingSalesRecordId && (
        <SalesRecordEditModal
          editingId={editingSalesRecordId}
          onClose={() => setEditingSalesRecordId(null)}
          onSaveSuccess={() => {
            setEditingSalesRecordId(null);
            fetchAlerts();
            showToast("บันทึกข้อมูลสำเร็จ", "success");
          }}
        />
      )}
      
    </div>
  );
}

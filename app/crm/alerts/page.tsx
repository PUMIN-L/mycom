"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../context/AuthContext";
import Toast from "../../components/Toast";
import Link from "next/link";
import type { CrmAlerts } from "../../lib/types";

export default function AlertsPage() {
  const router = useRouter();
  const { isLoggedIn, isLoading: authLoading } = useAuth();
  const [alerts, setAlerts] = useState<CrmAlerts | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [activeTab, setActiveTab] = useState("all");

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

  const tabs = [
    { 
      id: "all", 
      label: "รวมทั้งหมด", 
      count: (alerts?.upcomingSchedules.length ?? 0) + (alerts?.expiringWarranties.length ?? 0) + (alerts?.incompleteEquipments.length ?? 0) + (alerts?.missingDocuments?.length ?? 0),
      activeBg: "bg-indigo-600 text-white shadow-md border-indigo-600",
      inactiveBg: "bg-white text-gray-600 hover:bg-indigo-50 hover:text-indigo-700 border-gray-200 hover:border-indigo-200",
      activeBadge: "bg-white/20 text-white font-bold",
      inactiveBadge: "bg-gray-100 text-gray-600 font-medium group-hover:bg-indigo-100 group-hover:text-indigo-700"
    },
    { 
      id: "schedules", 
      label: "กำหนดการ Service", 
      count: alerts?.upcomingSchedules.length ?? 0,
      activeBg: "bg-blue-600 text-white shadow-md border-blue-600",
      inactiveBg: "bg-white text-gray-600 hover:bg-blue-50 hover:text-blue-700 border-gray-200 hover:border-blue-200",
      activeBadge: "bg-white/20 text-white font-bold",
      inactiveBadge: "bg-gray-100 text-gray-600 font-medium group-hover:bg-blue-100 group-hover:text-blue-700"
    },
    { 
      id: "warranties", 
      label: "ประกันใกล้หมดอายุ", 
      count: alerts?.expiringWarranties.length ?? 0,
      activeBg: "bg-amber-500 text-white shadow-md border-amber-500",
      inactiveBg: "bg-white text-gray-600 hover:bg-amber-50 hover:text-amber-700 border-gray-200 hover:border-amber-200",
      activeBadge: "bg-white/20 text-white font-bold",
      inactiveBadge: "bg-gray-100 text-gray-600 font-medium group-hover:bg-amber-100 group-hover:text-amber-700"
    },
    { 
      id: "incomplete", 
      label: "อุปกรณ์ขาดข้อมูล", 
      count: alerts?.incompleteEquipments.length ?? 0,
      activeBg: "bg-rose-500 text-white shadow-md border-rose-500",
      inactiveBg: "bg-white text-gray-600 hover:bg-rose-50 hover:text-rose-700 border-gray-200 hover:border-rose-200",
      activeBadge: "bg-white/20 text-white font-bold",
      inactiveBadge: "bg-gray-100 text-gray-600 font-medium group-hover:bg-rose-100 group-hover:text-rose-700"
    },
    { 
      id: "missing_docs", 
      label: "เอกสารอ้างอิงสูญหาย", 
      count: alerts?.missingDocuments?.length ?? 0,
      activeBg: "bg-red-500 text-white shadow-md border-red-500",
      inactiveBg: "bg-white text-gray-600 hover:bg-red-50 hover:text-red-700 border-gray-200 hover:border-red-200",
      activeBadge: "bg-white/20 text-white font-bold",
      inactiveBadge: "bg-gray-100 text-gray-600 font-medium group-hover:bg-red-100 group-hover:text-red-700"
    },
  ];

  return (
    <div className="min-h-screen bg-gray-50/50 p-6 md:p-8 pt-32">
      {toast && <Toast message={toast.message} type={toast.type} />}

      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-800">🔔 แจ้งเตือน CRM</h1>
            <p className="text-gray-500 mt-1">จัดการกำหนดการ, ประกันใกล้หมดอายุ และเอกสาร</p>
          </div>
          <Link
            href="/customers"
            className="px-4 py-2.5 bg-white border border-gray-200 text-gray-700 font-semibold rounded-xl hover:bg-gray-50 transition-all text-sm flex items-center gap-2 shadow-sm"
          >
            <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"></path></svg>
            กลับไปหน้าลูกค้า
          </Link>
        </div>

        {/* Tabs */}
        <div className="flex overflow-x-auto hide-scrollbar gap-2 mb-8 pb-2">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`group px-5 py-2.5 rounded-xl font-semibold text-sm transition-all whitespace-nowrap flex items-center gap-2 border ${
                activeTab === tab.id ? tab.activeBg : tab.inactiveBg
              }`}
            >
              {tab.label}
              <span className={`px-2 py-0.5 rounded-full text-xs transition-colors ${
                activeTab === tab.id ? tab.activeBadge : tab.inactiveBadge
              }`}>
                {tab.count}
              </span>
            </button>
          ))}
        </div>

        {/* ── Section 2: Upcoming / Overdue Schedules ─────────────────────── */}
        {(activeTab === "all" || activeTab === "schedules") && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden mb-8">
            <div className="p-6 md:px-8 border-b border-gray-50">
              <div className="flex items-center gap-3">
                <div className="bg-blue-50 text-blue-600 p-2.5 rounded-xl">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
                </div>
                <h2 className="text-xl font-bold text-gray-800">
                  กำหนดการ Service / โทรติดตาม
                  <span className="text-gray-400 text-base font-normal ml-2">
                    ({alerts?.upcomingSchedules.length ?? 0} รายการ)
                  </span>
                </h2>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-gray-50/80 border-b border-gray-100 text-gray-600 text-sm">
                    <th className="p-4 font-semibold w-24">ประเภท</th>
                    <th className="p-4 font-semibold">ลูกค้า / บริษัท</th>
                    <th className="p-4 font-semibold w-48">สินค้า</th>
                    <th className="p-4 font-semibold w-32">กำหนด</th>
                    <th className="p-4 font-semibold w-32">สถานะ</th>
                    <th className="p-4 font-semibold text-center w-28">จัดการ</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    Array.from({ length: 3 }).map((_, i) => (
                      <tr key={i} className="border-b border-gray-50">
                        <td className="p-4"><div className="h-5 bg-gray-200 rounded w-16 animate-pulse"></div></td>
                        <td className="p-4"><div className="h-5 bg-gray-200 rounded w-36 animate-pulse"></div></td>
                        <td className="p-4"><div className="h-5 bg-gray-200 rounded w-32 animate-pulse"></div></td>
                        <td className="p-4"><div className="h-5 bg-gray-200 rounded w-24 animate-pulse"></div></td>
                        <td className="p-4"><div className="h-5 bg-gray-200 rounded w-20 animate-pulse"></div></td>
                        <td className="p-4"><div className="h-5 bg-gray-200 rounded w-16 mx-auto animate-pulse"></div></td>
                      </tr>
                    ))
                  ) : !alerts?.upcomingSchedules.length ? (
                    <tr>
                      <td colSpan={6} className="p-12 text-center text-gray-400">
                        ไม่มีกำหนดการที่ใกล้ถึง
                      </td>
                    </tr>
                  ) : (
                    alerts.upcomingSchedules.map((s) => (
                      <tr 
                        key={s.id} 
                        onClick={() => setSelectedAlert({ type: "schedule", data: s })}
                        className={`border-b border-gray-50 transition-colors cursor-pointer ${s.overdue ? "bg-red-50/30 hover:bg-red-50/50" : "hover:bg-gray-50/50"}`}
                      >
                        <td className="p-4">
                          {s.scheduleType === "service" ? (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full bg-blue-50 text-blue-700 border border-blue-100 whitespace-nowrap">
                              <span>🔧</span> Service
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full bg-purple-50 text-purple-700 border border-purple-100 whitespace-nowrap">
                              <span>📞</span> โทรติดตาม
                            </span>
                          )}
                        </td>
                        <td className="p-4">
                          <div className="font-medium text-gray-800">{s.customerName || "—"}</div>
                          <div className="text-xs text-gray-500 mt-0.5">{s.companyName}</div>
                        </td>
                        <td className="p-4 text-sm text-gray-700">
                          {s.productName ? <div dangerouslySetInnerHTML={{ __html: s.productName }} /> : "—"}
                        </td>
                        <td className="p-4 text-sm text-gray-600">{s.scheduledDate}</td>
                        <td className="p-4">
                          {s.overdue ? (
                            <span className="px-2.5 py-1 text-xs font-bold rounded-full bg-red-100 text-red-700">⚠️ เกินกำหนด</span>
                          ) : (
                            <span className="px-2.5 py-1 text-xs font-medium rounded-full bg-amber-100 text-amber-700">รอดำเนินการ</span>
                          )}
                        </td>
                        <td className="p-4 text-center">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setCompletingId(s.id);
                              setCompleteForm({
                                serviceReportNumber: "",
                                actionDate: new Date().toISOString().slice(0, 10),
                                resultDetails: "",
                                customerFeedback: "",
                              });
                            }}
                            className="px-3 py-1.5 bg-emerald-50 text-emerald-600 border border-emerald-200 text-xs font-semibold rounded-lg hover:bg-emerald-100 transition-colors"
                          >
                            ✅ จบงาน
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── Section 1: Expiring Warranties ──────────────────────────────── */}
        {(activeTab === "all" || activeTab === "warranties") && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden mb-8">
            <div className="p-6 md:px-8 border-b border-gray-50">
              <div className="flex items-center gap-3">
                <div className="bg-amber-50 text-amber-600 p-2.5 rounded-xl">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
                </div>
                <h2 className="text-xl font-bold text-gray-800">
                  ประกันใกล้หมดอายุ
                  <span className="text-gray-400 text-base font-normal ml-2">
                    (ภายใน 30 วัน — {alerts?.expiringWarranties.length ?? 0} รายการ)
                  </span>
                </h2>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-gray-50/80 border-b border-gray-100 text-gray-600 text-sm">
                    <th className="p-4 font-semibold">ลูกค้า / บริษัท</th>
                    <th className="p-4 font-semibold w-48">สินค้า</th>
                    <th className="p-4 font-semibold w-40">S/N</th>
                    <th className="p-4 font-semibold w-32">หมดประกัน</th>
                    <th className="p-4 font-semibold w-28">เหลือ</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    Array.from({ length: 3 }).map((_, i) => (
                      <tr key={i} className="border-b border-gray-50">
                        <td className="p-4"><div className="h-5 bg-gray-200 rounded w-36 animate-pulse"></div></td>
                        <td className="p-4"><div className="h-5 bg-gray-200 rounded w-40 animate-pulse"></div></td>
                        <td className="p-4"><div className="h-5 bg-gray-200 rounded w-20 animate-pulse"></div></td>
                        <td className="p-4"><div className="h-5 bg-gray-200 rounded w-24 animate-pulse"></div></td>
                        <td className="p-4"><div className="h-5 bg-gray-200 rounded w-16 animate-pulse"></div></td>
                      </tr>
                    ))
                  ) : !alerts?.expiringWarranties.length ? (
                    <tr>
                      <td colSpan={5} className="p-12 text-center text-gray-400">
                        ไม่มีอุปกรณ์ที่ประกันใกล้หมดอายุ
                      </td>
                    </tr>
                  ) : (
                    alerts.expiringWarranties.map((eq) => {
                      const days = warrantyDaysLeft(eq.warrantyEndDate);
                      const isUrgent = days !== null && days <= 7;
                      return (
                        <tr 
                          key={eq.id} 
                          onClick={() => setSelectedAlert({ type: "warranty", data: eq })}
                          className={`border-b border-gray-50 transition-colors cursor-pointer ${isUrgent ? "bg-red-50/30 hover:bg-red-50/50" : "hover:bg-gray-50/50"}`}
                        >
                          <td className="p-4">
                            <div className="font-medium text-gray-800">{eq.customerName || "—"}</div>
                            <div className="text-xs text-gray-500 mt-0.5">{eq.companyName}</div>
                          </td>
                          <td className="p-4 text-sm text-gray-700">
                            {eq.productName ? <div dangerouslySetInnerHTML={{ __html: eq.productName }} /> : "—"}
                          </td>
                          <td className="p-4 text-sm text-gray-600 font-mono">{eq.serialNumber || "—"}</td>
                          <td className="p-4 text-sm text-gray-600">{eq.warrantyEndDate}</td>
                          <td className="p-4">
                            <span className={`px-2.5 py-1 text-xs font-bold rounded-full ${isUrgent ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}>
                              {days !== null ? `${days} วัน` : "—"}
                            </span>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── Section 1.5: Incomplete Equipments ────────────────────────────── */}
        {(activeTab === "all" || activeTab === "incomplete") && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden mb-8">
            <div className="p-6 md:px-8 border-b border-gray-50">
              <div className="flex items-center gap-3">
                <div className="bg-rose-50 text-rose-600 p-2.5 rounded-xl">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
                </div>
                <h2 className="text-xl font-bold text-gray-800">
                  อุปกรณ์ขาดข้อมูลสำคัญ
                  <span className="text-gray-400 text-base font-normal ml-2">
                    (ยังไม่ระบุ S/N หรือประกัน — {alerts?.incompleteEquipments.length ?? 0} รายการ)
                  </span>
                </h2>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-gray-50/80 border-b border-gray-100 text-gray-600 text-sm">
                    <th className="p-4 font-semibold">ลูกค้า / บริษัท</th>
                    <th className="p-4 font-semibold w-48">สินค้า</th>
                    <th className="p-4 font-semibold w-48">สิ่งที่ขาด</th>
                    <th className="p-4 font-semibold text-center w-28">จัดการ</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    Array.from({ length: 3 }).map((_, i) => (
                      <tr key={i} className="border-b border-gray-50">
                        <td className="p-4"><div className="h-5 bg-gray-200 rounded w-36 animate-pulse"></div></td>
                        <td className="p-4"><div className="h-5 bg-gray-200 rounded w-40 animate-pulse"></div></td>
                        <td className="p-4"><div className="h-5 bg-gray-200 rounded w-20 animate-pulse"></div></td>
                        <td className="p-4"><div className="h-8 bg-gray-200 rounded-xl w-24 mx-auto animate-pulse"></div></td>
                      </tr>
                    ))
                  ) : !alerts?.incompleteEquipments.length ? (
                    <tr>
                      <td colSpan={4} className="p-12 text-center text-gray-400">
                        ข้อมูลอุปกรณ์ครบถ้วนสมบูรณ์
                      </td>
                    </tr>
                  ) : (
                    alerts.incompleteEquipments.map((eq) => (
                      <tr 
                        key={eq.id} 
                        onClick={() => setSelectedAlert({ type: "incomplete", data: eq })}
                        className="border-b border-gray-50 bg-rose-50/20 hover:bg-rose-50/40 transition-colors cursor-pointer"
                      >
                        <td className="p-4">
                          <div className="font-medium text-gray-800">{eq.customerName || "—"}</div>
                          <div className="text-xs text-gray-500 mt-0.5">{eq.companyName}</div>
                        </td>
                        <td className="p-4 text-sm text-gray-700">
                          {eq.productName ? <div dangerouslySetInnerHTML={{ __html: eq.productName }} /> : "—"}
                        </td>
                        <td className="p-4 text-sm">
                          <div className="flex flex-col gap-1.5">
                            {!eq.serialNumber && <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-white border border-rose-100 text-rose-700 w-fit shadow-sm">❌ ขาด Serial Number</span>}
                            {!eq.warrantyStartDate && <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-white border border-rose-100 text-rose-700 w-fit shadow-sm">❌ ขาดวันเริ่มประกัน</span>}
                          </div>
                        </td>
                        <td className="p-4 text-center">
                          <Link
                            href={eq.salesRecordId ? `/dashboard?edit=${eq.salesRecordId}` : "/customers"}
                            onClick={(e) => e.stopPropagation()}
                            className="px-4 py-1.5 bg-white border border-gray-200 text-gray-700 rounded-lg text-xs font-semibold hover:bg-gray-50 transition-colors shadow-sm inline-block"
                          >
                            ไปใส่ข้อมูล
                          </Link>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── Section: Missing Documents ───────────────────────────────────────── */}
        {(activeTab === "all" || activeTab === "missing_docs") && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden mb-8">
            <div className="p-6 md:px-8 border-b border-gray-50">
              <div className="flex items-center gap-3">
                <div className="bg-red-50 text-red-600 p-2.5 rounded-xl">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
                </div>
                <h2 className="text-xl font-bold text-gray-800">
                  เอกสารอ้างอิงสูญหาย / เกินกำหนด
                  <span className="text-gray-400 text-base font-normal ml-2">
                    (ขาดใบส่งสินค้าหรือใบเสร็จ — {alerts?.missingDocuments?.length ?? 0} รายการ)
                  </span>
                </h2>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-gray-50/80 border-b border-gray-100 text-gray-600 text-sm">
                    <th className="p-4 font-semibold w-24">พนักงานขาย</th>
                    <th className="p-4 font-semibold">ลูกค้า / บริษัท</th>
                    <th className="p-4 font-semibold w-48">สินค้า</th>
                    <th className="p-4 font-semibold w-24">วันที่ขาย</th>
                    <th className="p-4 font-semibold w-48">สถานะเอกสาร</th>
                    <th className="p-4 font-semibold text-center w-28">จัดการ</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    Array.from({ length: 3 }).map((_, i) => (
                      <tr key={i} className="border-b border-gray-50">
                        <td className="p-4"><div className="h-5 bg-gray-200 rounded w-16 animate-pulse"></div></td>
                        <td className="p-4"><div className="h-5 bg-gray-200 rounded w-36 animate-pulse"></div></td>
                        <td className="p-4"><div className="h-5 bg-gray-200 rounded w-40 animate-pulse"></div></td>
                        <td className="p-4"><div className="h-5 bg-gray-200 rounded w-20 animate-pulse"></div></td>
                        <td className="p-4"><div className="h-5 bg-gray-200 rounded w-24 animate-pulse"></div></td>
                        <td className="p-4"><div className="h-8 bg-gray-200 rounded-xl w-24 mx-auto animate-pulse"></div></td>
                      </tr>
                    ))
                  ) : !alerts?.missingDocuments?.length ? (
                    <tr>
                      <td colSpan={6} className="p-12 text-center text-gray-400">
                        เอกสารอ้างอิงครบถ้วน
                      </td>
                    </tr>
                  ) : (
                    alerts.missingDocuments.map((doc) => {
                      const daysSinceSale = Math.floor((new Date().getTime() - new Date(doc.saleDate).getTime()) / (1000 * 3600 * 24));
                      const isMissingDelivery = !doc.deliveryRef && daysSinceSale >= 20;
                      const isMissingReceipt = doc.invoiceRef && !doc.receiptRef && daysSinceSale >= 30;
                      return (
                      <tr 
                        key={doc.id} 
                        onClick={() => setSelectedAlert({ type: "missing_doc", data: doc })}
                        className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors cursor-pointer"
                      >
                        <td className="p-4 text-sm font-medium text-gray-600">{doc.salespersonName || "—"}</td>
                        <td className="p-4">
                          <div className="font-medium text-gray-800">{doc.customerName || "—"}</div>
                          {doc.companyName && <div className="text-xs text-gray-500 mt-0.5">{doc.companyName}</div>}
                        </td>
                        <td className="p-4 text-sm text-gray-700">
                          {doc.productName ? <div dangerouslySetInnerHTML={{ __html: doc.productName }} /> : "—"}
                        </td>
                        <td className="p-4 text-sm text-gray-600">{doc.saleDate}</td>
                        <td className="p-4 text-sm">
                          <div className="flex flex-col gap-1.5">
                            {isMissingDelivery && (
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-red-50 text-red-700 w-fit">
                                ขาดใบส่งสินค้า (เลย {daysSinceSale - 20} วัน)
                              </span>
                            )}
                            {isMissingReceipt && (
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-orange-50 text-orange-700 w-fit">
                                ขาดใบเสร็จ (เลย {daysSinceSale - 30} วัน)
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="p-4 text-center">
                          <Link
                            href={`/dashboard?edit=${doc.id}`}
                            onClick={(e) => e.stopPropagation()}
                            className="px-4 py-1.5 bg-white border border-gray-200 text-gray-700 rounded-lg text-xs font-semibold hover:bg-gray-50 transition-colors shadow-sm inline-block"
                          >
                            ไปใส่ข้อมูล
                          </Link>
                        </td>
                      </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* ── Complete Action Modal ─────────────────────────────────────────── */}
      {completingId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in fade-in" onClick={() => setCompletingId(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg overflow-hidden animate-in zoom-in-95" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
              <h2 className="text-lg font-bold text-gray-800">✅ บันทึกผลการดำเนินงาน</h2>
              <button
                onClick={() => setCompletingId(null)}
                className="text-gray-400 hover:text-gray-600"
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleComplete} className="p-6 space-y-5">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">
                  เลขที่ใบรายงานการซ่อม <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={completeForm.serviceReportNumber}
                  onChange={(e) => setCompleteForm((prev) => ({ ...prev, serviceReportNumber: e.target.value }))}
                  className="w-full px-4 py-2 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                  placeholder="SR-XXXXX"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">
                  วันที่ดำเนินการ <span className="text-red-500">*</span>
                </label>
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
              <Link
                href={
                  selectedAlert.type === "missing_doc"
                    ? `/dashboard?edit=${selectedAlert.data.id}`
                    : `/customers?tab=equipment&edit_eq=${selectedAlert.type === "schedule" ? selectedAlert.data.equipmentId : selectedAlert.data.id}`
                }
                className="px-5 py-2.5 bg-indigo-600 text-white font-semibold rounded-xl hover:bg-indigo-700 transition-all text-sm shadow-sm flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                ไปแก้ไขข้อมูล
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

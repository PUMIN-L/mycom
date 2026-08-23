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
    { id: "all", label: "รวมทั้งหมด", count: (alerts?.upcomingSchedules.length ?? 0) + (alerts?.expiringWarranties.length ?? 0) + (alerts?.incompleteEquipments.length ?? 0) + (alerts?.missingDocuments?.length ?? 0) },
    { id: "schedules", label: "กำหนดการ Service", count: alerts?.upcomingSchedules.length ?? 0 },
    { id: "warranties", label: "ประกันใกล้หมดอายุ", count: alerts?.expiringWarranties.length ?? 0 },
    { id: "incomplete", label: "อุปกรณ์ขาดข้อมูล", count: alerts?.incompleteEquipments.length ?? 0 },
    { id: "missing_docs", label: "เอกสารอ้างอิงสูญหาย", count: alerts?.missingDocuments?.length ?? 0 },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100/50 pt-32 pb-16 px-4 md:px-16">
      {toast && <Toast message={toast.message} type={toast.type} />}

      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-4">
        <div>
          <h1 className="text-4xl font-extrabold text-gray-900 tracking-tight">🔔 แจ้งเตือน CRM</h1>
          <p className="text-gray-500 mt-2 text-lg">ประกันใกล้หมดอายุ และกำหนดการที่ใกล้ถึง</p>
        </div>
        <Link
          href="/customers"
          className="px-5 py-2.5 bg-white border border-gray-200 text-gray-700 font-semibold rounded-xl hover:bg-gray-50 hover:shadow-sm transition-all flex items-center gap-2"
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
            className={`px-5 py-2.5 rounded-xl font-semibold text-sm transition-all whitespace-nowrap flex items-center gap-2 ${
              activeTab === tab.id
                ? "bg-gray-900 text-white shadow-md"
                : "bg-white text-gray-600 hover:bg-gray-50 border border-gray-200"
            }`}
          >
            {tab.label}
            <span className={`px-2 py-0.5 rounded-full text-xs ${
              activeTab === tab.id ? "bg-white/20 text-white font-bold" : "bg-gray-100 text-gray-600 font-medium"
            }`}>
              {tab.count}
            </span>
          </button>
        ))}
      </div>

      {/* ── Section 2: Upcoming / Overdue Schedules ─────────────────────── */}
      {(activeTab === "all" || activeTab === "schedules") && (
      <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden mb-8">
        <div className="p-8">
          <div className="flex items-center gap-3 mb-6">
            <div className="bg-blue-100 text-blue-600 p-3 rounded-xl">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
            </div>
            <h2 className="text-2xl font-bold text-gray-800">
              กำหนดการ Service / โทรติดตาม
              <span className="text-gray-400 text-lg font-normal ml-2">
                ({alerts?.upcomingSchedules.length ?? 0} รายการ)
              </span>
            </h2>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="pb-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">ประเภท</th>
                  <th className="pb-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">ลูกค้า / บริษัท</th>
                  <th className="pb-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">สินค้า</th>
                  <th className="pb-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">กำหนด</th>
                  <th className="pb-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">สถานะ</th>
                  <th className="pb-3 text-xs font-semibold text-gray-400 uppercase tracking-wider"></th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  Array.from({ length: 3 }).map((_, i) => (
                    <tr key={i} className="border-b border-gray-50 animate-pulse">
                      <td className="py-4 pr-4"><div className="h-4 bg-gray-200 rounded w-20"></div></td>
                      <td className="py-4 pr-4"><div className="h-4 bg-gray-200 rounded w-36"></div></td>
                      <td className="py-4 pr-4"><div className="h-4 bg-gray-200 rounded w-32"></div></td>
                      <td className="py-4 pr-4"><div className="h-4 bg-gray-200 rounded w-24"></div></td>
                      <td className="py-4 pr-4"><div className="h-4 bg-gray-200 rounded w-20"></div></td>
                      <td className="py-4"><div className="h-4 bg-gray-200 rounded w-16"></div></td>
                    </tr>
                  ))
                ) : !alerts?.upcomingSchedules.length ? (
                  <tr>
                    <td colSpan={6} className="py-12 text-center">
                      <div className="flex flex-col items-center gap-2">
                        <div className="text-5xl">📅</div>
                        <p className="text-gray-400 text-lg">ไม่มีกำหนดการที่ใกล้ถึง</p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  alerts.upcomingSchedules.map((s) => (
                    <tr key={s.id} className={`border-b border-gray-50 ${s.overdue ? "bg-red-50/50" : ""}`}>
                      <td className="py-4 pr-4">
                        {s.scheduleType === "service" ? (
                          <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-blue-100 text-blue-700">🔧 Service</span>
                        ) : (
                          <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-purple-100 text-purple-700">📞 โทร</span>
                        )}
                      </td>
                      <td className="py-4 pr-4">
                        <div className="font-semibold text-gray-800">{s.customerName || "—"}</div>
                        <div className="text-xs text-gray-400">{s.companyName}</div>
                      </td>
                      <td className="py-4 pr-4 text-sm text-gray-700">
                        {s.productName ? <div dangerouslySetInnerHTML={{ __html: s.productName }} /> : "—"}
                      </td>
                      <td className="py-4 pr-4 text-sm text-gray-700">{s.scheduledDate}</td>
                      <td className="py-4 pr-4">
                        {s.overdue ? (
                          <span className="px-2.5 py-1 text-xs font-bold rounded-full bg-red-100 text-red-700">⚠️ เกินกำหนด</span>
                        ) : (
                          <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-yellow-100 text-yellow-700">รอดำเนินการ</span>
                        )}
                      </td>
                      <td className="py-4">
                        <button
                          onClick={() => {
                            setCompletingId(s.id);
                            setCompleteForm({
                              serviceReportNumber: "",
                              actionDate: new Date().toISOString().slice(0, 10),
                              resultDetails: "",
                              customerFeedback: "",
                            });
                          }}
                          className="px-3 py-1.5 bg-green-500 text-white text-xs font-semibold rounded-lg hover:bg-green-600 transition-all"
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
      </div>
      )}

      {/* ── Section 1: Expiring Warranties ──────────────────────────────── */}
      {(activeTab === "all" || activeTab === "warranties") && (
      <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden mb-8">
        <div className="p-8">
          <div className="flex items-center gap-3 mb-6">
            <div className="bg-amber-100 text-amber-600 p-3 rounded-xl">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
            </div>
            <h2 className="text-2xl font-bold text-gray-800">
              ประกันใกล้หมดอายุ
              <span className="text-gray-400 text-lg font-normal ml-2">
                (ภายใน 30 วัน — {alerts?.expiringWarranties.length ?? 0} รายการ)
              </span>
            </h2>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="pb-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">ลูกค้า / บริษัท</th>
                  <th className="pb-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">สินค้า</th>
                  <th className="pb-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">S/N</th>
                  <th className="pb-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">หมดประกัน</th>
                  <th className="pb-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">เหลือ</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  Array.from({ length: 3 }).map((_, i) => (
                    <tr key={i} className="border-b border-gray-50 animate-pulse">
                      <td className="py-4 pr-4"><div className="h-4 bg-gray-200 rounded w-36"></div></td>
                      <td className="py-4 pr-4"><div className="h-4 bg-gray-200 rounded w-40"></div></td>
                      <td className="py-4 pr-4"><div className="h-4 bg-gray-200 rounded w-20"></div></td>
                      <td className="py-4 pr-4"><div className="h-4 bg-gray-200 rounded w-24"></div></td>
                      <td className="py-4"><div className="h-4 bg-gray-200 rounded w-16"></div></td>
                    </tr>
                  ))
                ) : !alerts?.expiringWarranties.length ? (
                  <tr>
                    <td colSpan={5} className="py-12 text-center">
                      <div className="flex flex-col items-center gap-2">
                        <div className="text-5xl">✅</div>
                        <p className="text-gray-400 text-lg">ไม่มีอุปกรณ์ที่ประกันใกล้หมดอายุ</p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  alerts.expiringWarranties.map((eq) => {
                    const days = warrantyDaysLeft(eq.warrantyEndDate);
                    const isUrgent = days !== null && days <= 7;
                    return (
                      <tr key={eq.id} className={`border-b border-gray-50 ${isUrgent ? "bg-red-50/50" : ""}`}>
                        <td className="py-4 pr-4">
                          <div className="font-semibold text-gray-800">{eq.customerName || "—"}</div>
                          <div className="text-xs text-gray-400">{eq.companyName}</div>
                        </td>
                        <td className="py-4 pr-4 text-sm text-gray-700">
                          {eq.productName ? <div dangerouslySetInnerHTML={{ __html: eq.productName }} /> : "—"}
                        </td>
                        <td className="py-4 pr-4 text-sm text-gray-600 font-mono">{eq.serialNumber || "—"}</td>
                        <td className="py-4 pr-4 text-sm text-gray-700">{eq.warrantyEndDate}</td>
                        <td className="py-4">
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
      </div>
      )}

      {/* ── Section 1.5: Incomplete Equipments ────────────────────────────── */}
      {(activeTab === "all" || activeTab === "incomplete") && (
      <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden mb-8">
        <div className="p-8">
          <div className="flex items-center gap-3 mb-6">
            <div className="bg-red-100 text-red-600 p-3 rounded-xl">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
            </div>
            <h2 className="text-2xl font-bold text-gray-800">
              อุปกรณ์ขาดข้อมูลสำคัญ
              <span className="text-gray-400 text-lg font-normal ml-2">
                (ยังไม่ระบุ S/N หรือประกัน — {alerts?.incompleteEquipments.length ?? 0} รายการ)
              </span>
            </h2>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="pb-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">ลูกค้า / บริษัท</th>
                  <th className="pb-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">สินค้า</th>
                  <th className="pb-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">สิ่งที่ขาด</th>
                  <th className="pb-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">จัดการ</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  Array.from({ length: 3 }).map((_, i) => (
                    <tr key={i} className="border-b border-gray-50 animate-pulse">
                      <td className="py-4 pr-4"><div className="h-4 bg-gray-200 rounded w-36"></div></td>
                      <td className="py-4 pr-4"><div className="h-4 bg-gray-200 rounded w-40"></div></td>
                      <td className="py-4 pr-4"><div className="h-4 bg-gray-200 rounded w-20"></div></td>
                      <td className="py-4"><div className="h-8 bg-gray-200 rounded-xl w-24"></div></td>
                    </tr>
                  ))
                ) : !alerts?.incompleteEquipments.length ? (
                  <tr>
                    <td colSpan={4} className="py-12 text-center">
                      <div className="flex flex-col items-center gap-2">
                        <div className="text-5xl">🎉</div>
                        <p className="text-gray-400 text-lg">ข้อมูลอุปกรณ์ครบถ้วนสมบูรณ์</p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  alerts.incompleteEquipments.map((eq) => (
                    <tr key={eq.id} className="border-b border-gray-50 bg-red-50/20">
                      <td className="py-4 pr-4">
                        <div className="font-semibold text-gray-800">{eq.customerName || "—"}</div>
                        <div className="text-xs text-gray-400">{eq.companyName}</div>
                      </td>
                      <td className="py-4 pr-4 text-sm text-gray-700">
                        {eq.productName ? <div dangerouslySetInnerHTML={{ __html: eq.productName }} /> : "—"}
                      </td>
                      <td className="py-4 pr-4 text-sm">
                        <div className="flex flex-col gap-1">
                          {!eq.serialNumber && <span className="text-red-600 font-medium">❌ ขาด Serial Number</span>}
                          {!eq.warrantyStartDate && <span className="text-red-600 font-medium">❌ ขาดวันเริ่มประกัน</span>}
                        </div>
                      </td>
                      <td className="py-4">
                        <Link
                          href={eq.salesRecordId ? `/dashboard?edit=${eq.salesRecordId}` : "/customers"}
                          className="px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-xl text-xs font-semibold hover:bg-gray-50 transition-colors shadow-sm inline-block"
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
      </div>
      )}

      {/* ── Section: Missing Documents ───────────────────────────────────────── */}
      {(activeTab === "all" || activeTab === "missing_docs") && (
      <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden mb-8">
        <div className="p-8">
          <div className="flex items-center gap-3 mb-6">
            <div className="bg-red-100 text-red-600 p-3 rounded-xl">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
            </div>
            <h2 className="text-2xl font-bold text-gray-800">
              เอกสารอ้างอิงสูญหาย / เกินกำหนด
              <span className="text-gray-400 text-lg font-normal ml-2">
                (ขาดใบส่งสินค้าหรือใบเสร็จ — {alerts?.missingDocuments?.length ?? 0} รายการ)
              </span>
            </h2>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="pb-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">พนักงานขาย</th>
                  <th className="pb-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">ลูกค้า / บริษัท</th>
                  <th className="pb-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">สินค้า</th>
                  <th className="pb-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">วันที่ขาย</th>
                  <th className="pb-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">สถานะเอกสาร</th>
                  <th className="pb-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">จัดการ</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  Array.from({ length: 3 }).map((_, i) => (
                    <tr key={i} className="border-b border-gray-50 animate-pulse">
                      <td className="py-4 pr-4"><div className="h-4 bg-gray-200 rounded w-24"></div></td>
                      <td className="py-4 pr-4"><div className="h-4 bg-gray-200 rounded w-36"></div></td>
                      <td className="py-4 pr-4"><div className="h-4 bg-gray-200 rounded w-40"></div></td>
                      <td className="py-4 pr-4"><div className="h-4 bg-gray-200 rounded w-24"></div></td>
                      <td className="py-4 pr-4"><div className="h-4 bg-gray-200 rounded w-20"></div></td>
                      <td className="py-4"><div className="h-4 bg-gray-200 rounded w-16"></div></td>
                    </tr>
                  ))
                ) : !alerts?.missingDocuments?.length ? (
                  <tr>
                    <td colSpan={6} className="py-12 text-center">
                      <div className="flex flex-col items-center gap-2">
                        <div className="text-5xl">✅</div>
                        <p className="text-gray-400 text-lg">เอกสารอ้างอิงครบถ้วน</p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  alerts.missingDocuments.map((doc) => {
                    const daysSinceSale = Math.floor((new Date().getTime() - new Date(doc.saleDate).getTime()) / (1000 * 3600 * 24));
                    const isMissingDelivery = !doc.deliveryRef && daysSinceSale >= 20;
                    const isMissingReceipt = doc.invoiceRef && !doc.receiptRef && daysSinceSale >= 30;
                    return (
                    <tr key={doc.id} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                      <td className="py-4 pr-4 text-sm font-medium text-gray-900">{doc.salespersonName || "—"}</td>
                      <td className="py-4 pr-4">
                        <div className="text-sm font-medium text-gray-900">{doc.customerName || "—"}</div>
                        {doc.companyName && <div className="text-xs text-gray-500 mt-0.5">{doc.companyName}</div>}
                      </td>
                      <td className="py-4 pr-4 text-sm text-gray-700">
                        {doc.productName ? <div dangerouslySetInnerHTML={{ __html: doc.productName }} /> : "—"}
                      </td>
                      <td className="py-4 pr-4 text-sm text-gray-700">{doc.saleDate}</td>
                      <td className="py-4 pr-4 text-sm">
                        <div className="flex flex-col gap-1">
                          {isMissingDelivery && (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-red-50 text-red-700 ring-1 ring-inset ring-red-600/20">
                              ขาดใบส่งสินค้า (เลยกำหนด {daysSinceSale - 20} วัน)
                            </span>
                          )}
                          {isMissingReceipt && (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-orange-50 text-orange-700 ring-1 ring-inset ring-orange-600/20">
                              ขาดใบเสร็จ (เลยกำหนด {daysSinceSale - 30} วัน)
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-4">
                        <Link
                          href={`/dashboard?edit=${doc.id}`}
                          className="px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-xl text-xs font-semibold hover:bg-gray-50 transition-colors shadow-sm inline-block"
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
      </div>
      )}

      {/* ── Complete Action Modal ─────────────────────────────────────────── */}
      {completingId && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setCompletingId(null)}>
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
                <button type="button" onClick={() => setCompletingId(null)} className="px-5 py-2.5 border border-gray-200 text-gray-600 font-semibold rounded-xl hover:bg-gray-50 transition-all">ยกเลิก</button>
                <button type="submit" disabled={isSaving} className="px-5 py-2.5 bg-gradient-to-r from-green-500 to-green-600 text-white font-semibold rounded-xl hover:from-green-600 hover:to-green-700 transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed">{isSaving ? "กำลังบันทึก..." : "บันทึกผลงาน"}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

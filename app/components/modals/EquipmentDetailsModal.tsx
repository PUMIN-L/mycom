"use client";
import React, { useState, useEffect } from "react";
import DatePicker from "../DatePicker";
import type { CustomerEquipment, ServiceSchedule } from "../../lib/types";
import { toLocalDateString, formatDisplayDate } from "../../lib/dateFormat";

// Note: Local stripHtml function
function stripHtml(html?: string): string {
  if (!html) return "";
  return html.replace(/<[^>]*>/g, "");
}

interface EquipmentDetailsModalProps {
  equipment: CustomerEquipment;
  onClose: () => void;
  onEditEquipment: (equipment: CustomerEquipment) => void;
}

export default function EquipmentDetailsModal({
  equipment,
  onClose,
  onEditEquipment,
}: EquipmentDetailsModalProps) {
  // State for schedules
  const [schedules, setSchedules] = useState<ServiceSchedule[]>([]);
  const [isScheduleModalOpen, setIsScheduleModalOpen] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<Partial<ServiceSchedule> | null>(null);
  
  // State for completing schedules
  const [completingScheduleId, setCompletingScheduleId] = useState<string | null>(null);
  const [completeForm, setCompleteForm] = useState({
    serviceReportNumber: "",
    actionDate: toLocalDateString(new Date()),
    resultDetails: "",
    customerFeedback: "",
  });
  
  // State for viewing schedules
  const [viewingSchedule, setViewingSchedule] = useState<ServiceSchedule | null>(null);
  const [logs, setLogs] = useState<{ [scheduleId: string]: any[] }>({});
  
  // State for deleting schedules
  const [deleteScheduleConfirm, setDeleteScheduleConfirm] = useState<ServiceSchedule | null>(null);
  const [deleteCompletedSchedule, setDeleteCompletedSchedule] = useState<ServiceSchedule | null>(null);
  const [deleteOtpCode, setDeleteOtpCode] = useState("");
  const [deleteOtpEmail, setDeleteOtpEmail] = useState<string | null>(null);
  const [isSendingOtp, setIsSendingOtp] = useState(false);
  const [otpCountdown, setOtpCountdown] = useState(0);

  const [isSaving, setIsSaving] = useState(false);
  const [scheduleFormError, setScheduleFormError] = useState(false);

  useEffect(() => {
    fetchSchedules(equipment.id);
  }, [equipment.id]);

  useEffect(() => {
    if (otpCountdown > 0) {
      const timer = setTimeout(() => setOtpCountdown(otpCountdown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [otpCountdown]);

  const fetchSchedules = async (eqId: string) => {
    try {
      const res = await fetch(`/api/admin/schedules?equipmentId=${eqId}`);
      if (res.ok) {
        const data = await res.json();
        setSchedules(Array.isArray(data) ? data : (data.schedules || []));
      }
    } catch (err) {
      console.error("Failed to fetch schedules", err);
    }
  };

  const fetchLogs = async (scheduleId: string) => {
    try {
      const res = await fetch(`/api/admin/schedules/${scheduleId}/logs`);
      if (res.ok) {
        const data = await res.json();
        setLogs((prev) => ({ ...prev, [scheduleId]: Array.isArray(data) ? data : (data.logs || []) }));
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleSaveSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving) return;
    if (!editingSchedule?.scheduledDate) {
      setScheduleFormError(true);
      alert("กรุณาระบุวันที่นัดหมาย");
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
        equipmentId: editingSchedule.equipmentId || equipment.id,
      };
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Failed to save schedule");
      setIsScheduleModalOpen(false);
      setEditingSchedule(null);
      fetchSchedules(equipment.id);
    } catch (err) {
      console.error(err);
      alert("บันทึกนัดหมายไม่สำเร็จ");
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
      setDeleteScheduleConfirm(null);
      fetchSchedules(equipment.id);
    } catch (err) {
      console.error(err);
      alert("ลบนัดหมายไม่สำเร็จ");
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
      setCompletingScheduleId(null);
      setCompleteForm({
        serviceReportNumber: "",
        actionDate: toLocalDateString(new Date()),
        resultDetails: "",
        customerFeedback: "",
      });
      fetchSchedules(equipment.id);
    } catch (err) {
      console.error(err);
      alert(err instanceof Error ? err.message : "บันทึกผลงานไม่สำเร็จ");
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
      if (!res.ok) throw new Error(data.error || "Failed to send OTP");
      setDeleteOtpEmail(data.email || "อีเมลผู้ดูแลระบบ");
      setOtpCountdown(60);
      alert(data.message || "ส่งรหัส OTP เรียบร้อยแล้ว");
    } catch (err: any) {
      console.error(err);
      alert(err.message || "ไม่สามารถส่งรหัส OTP ได้");
    } finally {
      setIsSendingOtp(false);
    }
  };

  const executeDeleteCompletedSchedule = async () => {
    if (!deleteCompletedSchedule || isSaving) return;
    if (!deleteOtpCode || deleteOtpCode.length !== 6) {
      alert("กรุณากรอกรหัส OTP 6 หลัก");
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
      if (!res.ok) throw new Error(data.error || "Failed to delete schedule");
      setDeleteCompletedSchedule(null);
      setDeleteOtpCode("");
      setDeleteOtpEmail(null);
      fetchSchedules(equipment.id);
    } catch (err: any) {
      console.error(err);
      alert(err.message || "ลบนัดหมายไม่สำเร็จ");
    } finally {
      setIsSaving(false);
    }
  };

  // ── Helpers ────────────────────────────────────────────────────────────────

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

  return (
    <>
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[150] flex items-center justify-center p-4 animate-fade-in" onClick={onClose}>
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
          {/* Header */}
          <div className="p-6 border-b border-gray-100 flex justify-between items-start sticky top-0 bg-white z-10">
            <div>
              <h3 className="text-xl font-bold text-gray-800">รายละเอียดอุปกรณ์</h3>
              <p className="text-sm text-gray-400 mt-1">{stripHtml(equipment.productName)} — S/N: {equipment.serialNumber || "—"}</p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => onEditEquipment(equipment)}
                className="px-4 py-2 bg-gray-100 text-gray-700 font-semibold rounded-xl hover:bg-gray-200 transition-all text-sm"
              >
                ✏️ แก้ไข
              </button>
              <button
                onClick={onClose}
                className="p-2 text-gray-400 hover:text-gray-600 transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
              </button>
            </div>
          </div>

          {/* Equipment info grid */}
          <div className="p-6 grid grid-cols-2 gap-4">
            <Info label="ลูกค้า" value={equipment.customerName} />
            <Info label="บริษัท" value={equipment.companyName} />
            <Info label="สินค้า" value={stripHtml(equipment.productName)} />
            <Info label="Serial Number" value={equipment.serialNumber} />
            <Info label="ใบเสนอราคา" value={equipment.quotationNumber} />
            <Info label="ใบรับประกัน" value={equipment.warrantyCertNumber} />
            <Info label="ประเภทประกัน" value={equipment.warrantyType} />
            <Info label="สถานะ" value={equipment.status} />
            <Info label="เริ่มประกัน" value={equipment.warrantyStartDate} />
            <Info label="หมดประกัน" value={equipment.warrantyEndDate} />
            <Info label="วันที่สอบเทียบล่าสุด" value={equipment.calibrationDate} />
          </div>

          {equipment.note && (
            <div className="px-6 pb-6">
              <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">หมายเหตุ</div>
              <div className="text-sm text-gray-700 whitespace-pre-wrap bg-gray-50 border border-gray-100 rounded-xl p-3">
                {equipment.note}
              </div>
            </div>
          )}

          {/* Schedules */}
          <div className="p-6 border-t border-gray-100">
            <div className="flex justify-between items-center mb-4">
              <h4 className="text-lg font-bold text-gray-800">📅 นัดหมาย Service / โทรติดตาม</h4>
              <button
                onClick={() => { setEditingSchedule({ scheduleType: "service", scheduledDate: "", notes: "" }); setIsScheduleModalOpen(true); }}
                className="px-4 py-2 bg-indigo-500 text-white font-semibold rounded-xl hover:bg-indigo-600 transition-all text-sm flex items-center gap-1.5"
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
                          <div className="font-semibold text-gray-800 text-sm">{formatDisplayDate(s.scheduledDate)}</div>
                          {s.notes && <div className="text-xs text-gray-400 mt-0.5 line-clamp-1">{s.notes}</div>}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {scheduleStatusBadge(s.status, s.scheduledDate)}
                        {s.status === "pending" && (
                          <>
                            <button
                              onClick={(e) => { e.stopPropagation(); setEditingSchedule(s); setIsScheduleModalOpen(true); }}
                              className="px-2.5 py-1.5 bg-blue-50 text-blue-600 hover:bg-blue-100 text-xs font-semibold rounded-lg transition-all flex items-center gap-1"
                              title="แก้ไขนัดหมาย"
                            >
                              ✏️ แก้ไข
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); setCompletingScheduleId(s.id); setCompleteForm({ serviceReportNumber: "", actionDate: toLocalDateString(new Date()), resultDetails: "", customerFeedback: "" }); }}
                              className="px-3 py-1.5 bg-green-500 text-white text-xs font-semibold rounded-lg hover:bg-green-600 transition-all"
                            >
                              ✅ จบงาน
                            </button>
                          </>
                        )}
                        {s.status === "completed" && !logs[s.id] && (
                          <button
                            onClick={(e) => { e.stopPropagation(); fetchLogs(s.id); }}
                            className="px-3 py-1.5 bg-gray-100 text-gray-600 text-xs font-semibold rounded-lg hover:bg-gray-200 transition-all"
                          >
                            📋 ดูประวัติ
                          </button>
                        )}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (s.status === "completed") {
                              setDeleteCompletedSchedule(s);
                              setDeleteOtpCode("");
                              setDeleteOtpEmail(null);
                            } else {
                              setDeleteScheduleConfirm(s);
                            }
                          }}
                          className="p-1.5 text-gray-400 hover:text-red-500 transition-colors rounded-lg hover:bg-red-50"
                          title="ลบนัดหมาย"
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

      {/* ── Schedule CRUD Modal ───────────────────────────────────────────── */}
      {isScheduleModalOpen && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[160] flex items-center justify-center p-4" onClick={() => { setIsScheduleModalOpen(false); setScheduleFormError(false); }}>
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
                        className="accent-indigo-500"
                      />
                      <span className="text-sm text-gray-700">{opt.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">วันที่นัดหมาย <span className="text-red-500">*</span></label>
                <DatePicker
                  selected={editingSchedule?.scheduledDate ? new Date(editingSchedule.scheduledDate) : null}
                  onChange={(date) => {
                    setScheduleFormError(false);
                    setEditingSchedule((prev) => ({ ...prev, scheduledDate: date ? toLocalDateString(date) : "" }));
                  }}
                  className={scheduleFormError && !editingSchedule?.scheduledDate ? "!border-red-500 !bg-red-50 !ring-red-200" : ""}
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">หมายเหตุ</label>
                <textarea
                  value={editingSchedule?.notes || ""}
                  onChange={(e) => setEditingSchedule((prev) => ({ ...prev, notes: e.target.value }))}
                  className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400"
                  rows={3}
                  placeholder="รายละเอียดนัดหมาย"
                />
              </div>

              {/* Status — "completed" is NOT an option here on purpose: a job can
                  only become completed together with its result log, via the
                  separate "จบงาน" flow (handleComplete below), which calls
                  completeScheduleWithLog in one transaction. The API also
                  rejects status:"completed" from this generic edit endpoint. */}
              {editingSchedule?.id && (
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">สถานะ</label>
                  <div className="flex gap-4">
                    {["pending", "cancelled"].map((s) => (
                      <label key={s} className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          name="status"
                          checked={(editingSchedule?.status || "pending") === s}
                          onChange={() => setEditingSchedule((prev) => ({ ...prev, status: s as any }))}
                          className="accent-indigo-500"
                        />
                        <span className="text-sm text-gray-700">
                          {s === "pending" ? "รอดำเนินการ" : "ยกเลิก"}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
                <button type="button" onClick={() => { setIsScheduleModalOpen(false); setScheduleFormError(false); }} className="px-5 py-2.5 text-sm font-semibold text-gray-700 bg-white border border-gray-300 rounded-xl hover:bg-gray-50 transition-all">ยกเลิก</button>
                <button type="submit" disabled={isSaving} className="px-5 py-2.5 bg-indigo-600 text-white font-semibold rounded-xl hover:bg-indigo-700 transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed text-sm">
                  {isSaving ? "กำลังบันทึก..." : "บันทึกข้อมูล"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Complete Schedule Modal ───────────────────────────────────────── */}
      {completingScheduleId && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[160] flex items-center justify-center p-4 animate-fade-in" onClick={() => setCompletingScheduleId(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
            <div className="p-6 border-b border-gray-100">
              <h3 className="text-xl font-bold text-gray-800">✅ บันทึกผลการดำเนินงาน</h3>
            </div>
            <form onSubmit={handleComplete} className="p-6 space-y-5">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">วันที่ดำเนินการ <span className="text-red-500">*</span></label>
                <input
                  type="date"
                  required
                  value={completeForm.actionDate}
                  onChange={(e) => setCompleteForm((prev) => ({ ...prev, actionDate: e.target.value }))}
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-green-500/20 focus:border-green-400"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">เลขที่ใบแจ้งซ่อม / Service Report</label>
                <input
                  type="text"
                  value={completeForm.serviceReportNumber}
                  onChange={(e) => setCompleteForm((prev) => ({ ...prev, serviceReportNumber: e.target.value }))}
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-green-500/20 focus:border-green-400 font-mono"
                  placeholder="เช่น SR-12345"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">รายละเอียดผลการดำเนินงาน</label>
                <textarea
                  value={completeForm.resultDetails}
                  onChange={(e) => setCompleteForm((prev) => ({ ...prev, resultDetails: e.target.value }))}
                  className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-green-500/20 focus:border-green-400"
                  rows={3}
                  placeholder="บันทึกสิ่งที่ทำ..."
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Feedback จากลูกค้า</label>
                <textarea
                  value={completeForm.customerFeedback}
                  onChange={(e) => setCompleteForm((prev) => ({ ...prev, customerFeedback: e.target.value }))}
                  className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 bg-blue-50/30"
                  rows={2}
                  placeholder="ความเห็นลูกค้า (ถ้ามี)"
                />
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
                <button type="button" onClick={() => setCompletingScheduleId(null)} className="px-5 py-2.5 text-sm font-semibold text-gray-700 bg-white border border-gray-300 rounded-xl hover:bg-gray-50 transition-all">ยกเลิก</button>
                <button type="submit" disabled={isSaving} className="px-5 py-2.5 bg-green-600 text-white font-semibold rounded-xl hover:bg-green-700 transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed text-sm">
                  {isSaving ? "กำลังบันทึก..." : "บันทึกผลงาน"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Delete Confirm Dialogs ────────────────────────────────────────── */}
      {deleteScheduleConfirm && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[160] flex items-center justify-center p-4" onClick={() => setDeleteScheduleConfirm(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 text-center" onClick={(e) => e.stopPropagation()}>
            <div className="text-5xl mb-4">🗑️</div>
            <h3 className="text-lg font-bold text-gray-800 mb-2">ลบนัดหมายนี้?</h3>
            <p className="text-gray-500 text-sm mb-6">{formatDisplayDate(deleteScheduleConfirm.scheduledDate)}</p>
            <div className="flex gap-3 justify-center">
              <button onClick={() => setDeleteScheduleConfirm(null)} className="px-5 py-2.5 border border-gray-200 text-gray-600 font-semibold rounded-xl hover:bg-gray-50 transition-all">ยกเลิก</button>
              <button onClick={executeDeleteSchedule} className="px-5 py-2.5 bg-red-600 text-white font-semibold rounded-xl hover:bg-red-700 transition-all">ลบ</button>
            </div>
          </div>
        </div>
      )}
      
      {/* ── View Schedule Detail Modal ────────────────────────────────────── */}
      {viewingSchedule && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[170] flex items-center justify-center p-4" onClick={() => setViewingSchedule(null)}>
          <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center p-6 border-b border-gray-100">
              <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                {viewingSchedule.scheduleType === "service" ? "🔧 Service" : "📞 โทร"}
              </h2>
              <button onClick={() => setViewingSchedule(null)} className="text-gray-400 hover:text-gray-600 transition-colors">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="p-6 space-y-5">
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">วันที่นัดหมาย</label>
                <div className="text-gray-900 font-medium">{formatDisplayDate(viewingSchedule.scheduledDate)}</div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">สถานะ</label>
                <div>{scheduleStatusBadge(viewingSchedule.status || "pending", viewingSchedule.scheduledDate || "")}</div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">รายละเอียด / หมายเหตุ</label>
                <div className="text-gray-700 whitespace-pre-wrap">{viewingSchedule.notes || "-"}</div>
              </div>
            </div>
            <div className="p-6 border-t border-gray-100 flex justify-end">
              <button
                type="button"
                onClick={() => setViewingSchedule(null)}
                className="px-5 py-2.5 bg-gray-100 text-gray-700 font-semibold rounded-xl hover:bg-gray-200 transition-all"
              >
                ปิด
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete Completed Schedule with OTP Modal ────────────────────── */}
      {deleteCompletedSchedule && (
        <div
          className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[170] flex items-center justify-center p-4 animate-fadeIn"
          onClick={() => {
            if (!isSaving && !isSendingOtp) {
              setDeleteCompletedSchedule(null);
              setDeleteOtpCode("");
              setDeleteOtpEmail(null);
            }
          }}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 text-center"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-14 h-14 bg-red-100 text-red-600 rounded-full flex items-center justify-center text-2xl mx-auto mb-4">
              🔒
            </div>
            <h3 className="text-xl font-bold text-gray-900 mb-2">ยืนยันการลบนัดหมายที่เสร็จแล้ว</h3>
            <p className="text-gray-600 text-sm mb-4">
              นัดหมายวันที่ <span className="font-semibold text-gray-800">{formatDisplayDate(deleteCompletedSchedule.scheduledDate)}</span> ({deleteCompletedSchedule.scheduleType === "service" ? "Service" : "โทรติดตาม"}) ดำเนินการเสร็จแล้ว
              <br />
              <span className="text-red-600 text-xs font-medium mt-1 block">
                ⚠️ การลบจำเป็นต้องยืนยันรหัส OTP 6 หลักที่ส่งไปยังอีเมลผู้ดูแลระบบ
              </span>
            </p>

            {/* OTP Section */}
            <div className="bg-gray-50 rounded-xl p-4 mb-5 text-left border border-gray-100 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-gray-700">รหัสยืนยันจากอีเมล</span>
                <button
                  type="button"
                  onClick={handleSendDeleteOtp}
                  disabled={isSendingOtp || otpCountdown > 0}
                  className="text-xs font-bold text-blue-600 hover:text-blue-700 disabled:opacity-50 transition"
                >
                  {isSendingOtp
                    ? "กำลังส่งรหัส..."
                    : otpCountdown > 0
                    ? `ส่งอีกครั้ง (${otpCountdown}s)`
                    : deleteOtpEmail
                    ? "🔄 ส่งรหัสใหม่"
                    : "📩 ส่งรหัส OTP"}
                </button>
              </div>

              {deleteOtpEmail && (
                <p className="text-xs text-green-600 font-medium">
                  ✅ ส่งรหัส 6 หลักไปที่ {deleteOtpEmail} แล้ว
                </p>
              )}

              <input
                type="text"
                maxLength={6}
                value={deleteOtpCode}
                onChange={(e) => setDeleteOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="กรอกรหัส 6 หลัก เช่น 123456"
                className="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-center text-xl font-mono tracking-widest font-bold focus:ring-2 focus:ring-red-500/20 focus:border-red-500 outline-none"
              />
            </div>

            <div className="flex gap-3 justify-center">
              <button
                type="button"
                onClick={() => {
                  setDeleteCompletedSchedule(null);
                  setDeleteOtpCode("");
                  setDeleteOtpEmail(null);
                }}
                className="px-5 py-2.5 border border-gray-200 text-gray-600 font-semibold rounded-xl hover:bg-gray-50 transition-all text-sm flex-1"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={executeDeleteCompletedSchedule}
                disabled={isSaving || deleteOtpCode.length !== 6}
                className="px-5 py-2.5 bg-red-600 text-white font-semibold rounded-xl hover:bg-red-700 transition-all text-sm flex-1 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSaving ? "กำลังลบ..." : "🗑️ ยืนยันลบ"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
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

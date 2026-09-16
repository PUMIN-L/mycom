"use client";
import React, { useState, useEffect } from "react";
import Link from "next/link";
import DatePicker from "../DatePicker";
import type {
  CustomerEquipment,
  ServiceSchedule,
  ServiceJobSummary,
  TaskTopic,
  CrmTask,
} from "../../lib/types";
import { toLocalDateString, formatDisplayDate } from "../../lib/dateFormat";
// "สร้างสิ่งที่ต้องทำ" linked to this equipment — spec:
// add-equipment-quick-task-button. Mirrors the same button on the Viewing
// Customer modal (add-customer-quick-task-button): reuses TaskFormModal and
// the client-safe label builder rather than inventing either a second time,
// and shares its topic cache with that button through useTaskTopics.ts.
import TaskFormModal, { type TaskLinkPayload } from "../TaskFormModal";
import { buildTaskLinkLabel } from "../TaskLinkChips";
import { ensureTaskTopicsLoaded } from "../useTaskTopics";
import TaskCreatedNotice from "./TaskCreatedNotice";

// Note: Local stripHtml function
function stripHtml(html?: string): string {
  if (!html) return "";
  return html.replace(/<[^>]*>/g, "");
}

interface EquipmentDetailsModalProps {
  equipment: CustomerEquipment;
  onClose: () => void;
  onEditEquipment: (equipment: CustomerEquipment) => void;
  // Fired after the quick-create "สร้างสิ่งที่ต้องทำ" button saves a task —
  // lets a host page with its own task board (e.g. /crm/alerts) reveal the
  // new task there instead of requiring a manual refresh. Hosts with no task
  // board of their own (EquipmentTab) simply omit it.
  onTaskCreated?: (task: CrmTask) => void;
}

export default function EquipmentDetailsModal({
  equipment,
  onClose,
  onEditEquipment,
  onTaskCreated,
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

  const [isSaving, setIsSaving] = useState(false);
  const [scheduleFormError, setScheduleFormError] = useState(false);

  // ── ใบ Job ที่เครื่องนี้เคยอยู่ (v38) ───────────────────────────────────────
  // The paper trail of this one physical unit: every job sheet it has ever been
  // listed on, newest first. Includes sheets that are still `issued` — those are
  // printed, NOT proof anybody went yet — which is exactly why every row shows
  // its status beside the number instead of reading as "times we visited".
  const [jobs, setJobs] = useState<ServiceJobSummary[]>([]);
  const [jobsLoading, setJobsLoading] = useState(true);

  // "สร้างสิ่งที่ต้องทำ" — see the button in the header. `taskTopics === null`
  // means "not resolved on THIS modal instance yet"; the actual fetch (if any)
  // is owned by the module-level cache in `useTaskTopics.ts`, shared with the
  // customer-page button, so a load done from either one covers both.
  const [taskTopics, setTaskTopics] = useState<TaskTopic[] | null>(null);
  const [isLoadingTaskTopics, setIsLoadingTaskTopics] = useState(false);
  const [showTaskForm, setShowTaskForm] = useState(false);
  const [taskCreatedMessage, setTaskCreatedMessage] = useState<string | null>(null);

  useEffect(() => {
    fetchSchedules(equipment.id);
  }, [equipment.id]);

  useEffect(() => {
    let cancelled = false;
    setJobsLoading(true);
    fetch(`/api/service-jobs?equipmentId=${encodeURIComponent(equipment.id)}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((list) => {
        if (!cancelled) setJobs(Array.isArray(list) ? list : []);
      })
      .catch(() => {
        if (!cancelled) setJobs([]);
      })
      .finally(() => {
        if (!cancelled) setJobsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [equipment.id]);

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

  /**
   * "สร้างสิ่งที่ต้องทำ" — the topic list is required before `TaskFormModal`
   * can open (a task with no active topic is refused with a 400 by `POST
   * /api/admin/tasks`), so it must be in hand first; there is no honest
   * "open now, fail later" path. The topic-load/no-topics FAILURE paths still
   * report with `alert()`, matching every other failure this modal already
   * reports that way (schedule save/delete, OTP) — only the task-created
   * SUCCESS message gets the nicer `TaskCreatedNotice` dialog (shared with
   * `CustomerDetailsModal`), since a plain `alert()` there is what the user
   * flagged as ugly.
   */
  const handleOpenTaskForm = async () => {
    if (isLoadingTaskTopics) return;
    let topics = taskTopics;
    if (topics === null) {
      setIsLoadingTaskTopics(true);
      const loaded = await ensureTaskTopicsLoaded();
      setIsLoadingTaskTopics(false);
      if (loaded === null) {
        alert("โหลดหัวข้องานไม่สำเร็จ กรุณาลองใหม่");
        return;
      }
      topics = loaded;
      setTaskTopics(topics);
    }
    if (topics.length === 0) {
      alert("ยังไม่มีหัวข้องาน กรุณาไปสร้างหัวข้อที่หน้ากระดานงานก่อน");
      return;
    }
    setShowTaskForm(true);
  };

  /** The equipment link `TaskFormModal` opens pre-seeded with — computed with
   *  the SAME function the form's own link picker uses (`TaskLinkChips.tsx`),
   *  so the chip reads identically whichever way it was added. */
  const taskFormInitialLinks = (): TaskLinkPayload[] => [
    {
      targetType: "equipment",
      targetId: equipment.id,
      label: buildTaskLinkLabel("equipment", {
        productName: equipment.productName,
        serialNumber: equipment.serialNumber,
      }),
    },
  ];

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

  const executeDeleteCompletedSchedule = async () => {
    if (!deleteCompletedSchedule || isSaving) return;
    setIsSaving(true);
    try {
      const res = await fetch(`/api/admin/schedules/${deleteCompletedSchedule.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete schedule");
      setDeleteCompletedSchedule(null);
      fetchSchedules(equipment.id);
    } catch (err) {
      console.error(err);
      alert("ลบนัดหมายไม่สำเร็จ");
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

  /** `issued` is NOT "we went" — it is "the paper is printed". Kept visually
   * distinct from ปิดงานแล้ว so a row can never be misread as a visit that has
   * already happened. */
  const jobStatusBadge = (status: ServiceJobSummary["status"]) => {
    if (status === "completed")
      return <span className="shrink-0 px-2.5 py-1 text-xs font-semibold rounded-full bg-green-100 text-green-700">✅ ปิดงานแล้ว</span>;
    if (status === "cancelled")
      return <span className="shrink-0 px-2.5 py-1 text-xs font-semibold rounded-full bg-gray-100 text-gray-500">ยกเลิก</span>;
    return <span className="shrink-0 px-2.5 py-1 text-xs font-semibold rounded-full bg-amber-100 text-amber-700">📄 ออกใบแล้ว (ยังไม่ปิดงาน)</span>;
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
        <div
          className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header — a flex sibling ABOVE the scrollable body, not
              `position: sticky` inside one shared scroll box: Chromium has a
              real bug where a sticky child can escape its ancestor's
              `border-radius` clip once that ancestor actually scrolls, which
              squared off these top corners once there was enough content
              (job history + schedules) to need scrolling. Splitting header/
              body into their own flex boxes with `overflow-hidden` on this
              outer one keeps the rounding correct regardless of scroll
              state (same fix as CustomerDetailsModal). */}
          <div className="p-6 border-b border-gray-100 flex justify-between items-start shrink-0">
            <div>
              <h3 className="text-xl font-bold text-gray-800">รายละเอียดอุปกรณ์</h3>
              <p className="text-sm text-gray-400 mt-1">{stripHtml(equipment.productName)} — S/N: {equipment.serialNumber || "—"}</p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleOpenTaskForm}
                disabled={isLoadingTaskTopics}
                className="px-4 py-2 bg-orange-50 text-orange-700 font-semibold rounded-xl hover:bg-orange-100 transition-all text-sm disabled:opacity-50"
              >
                {isLoadingTaskTopics ? "กำลังโหลด..." : "📝 สร้างสิ่งที่ต้องทำ"}
              </button>
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

          {/* Scrollable body — everything below the header. */}
          <div className="overflow-y-auto min-h-0">
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

          {/* ── ใบ Job — the service history of THIS machine ─────────────────
              "เพิ่มในประวัติเครื่องที่เคยขายว่าเคยเข้าไป service มีใบ job เลขที่
              อะไร" — the number is the point: it is what the office quotes to
              find the signed paper in the folder. A row is only evidence that
              the visit HAPPENED once its status says ปิดงานแล้ว. */}
          <div className="p-6 border-t border-gray-100">
            <div className="flex justify-between items-center mb-4">
              <h4 className="text-lg font-bold text-gray-800">🔧 ใบ Job ที่เครื่องนี้เคยอยู่</h4>
              <Link
                href={`/service-job?equipmentId=${encodeURIComponent(equipment.id)}`}
                className="px-4 py-2 bg-orange-500 text-white font-semibold rounded-xl hover:bg-orange-600 transition-all text-sm"
              >
                + ออกใบ Job
              </Link>
            </div>

            {jobsLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 2 }).map((_, i) => (
                  <div key={i} className="h-14 bg-gray-100 rounded-xl animate-pulse" />
                ))}
              </div>
            ) : jobs.length === 0 ? (
              <p className="text-gray-400 text-center py-8">ยังไม่เคยออกใบ Job ให้เครื่องนี้</p>
            ) : (
              <div className="space-y-2">
                {jobs.map((job) => (
                  <Link
                    key={job.id}
                    href={`/service-job?id=${encodeURIComponent(job.id)}`}
                    className="flex justify-between items-center gap-3 border border-gray-100 rounded-xl p-4 hover:bg-gray-50/50 transition-colors"
                  >
                    <div className="min-w-0">
                      <div className="font-mono font-bold text-gray-800 text-sm">
                        {job.jobNo || "—"}
                      </div>
                      <div className="text-xs text-gray-400 mt-0.5">
                        {formatDisplayDate(job.jobDate) || "—"}
                        {job.technicianName ? ` · ช่าง ${job.technicianName}` : ""}
                        {job.equipmentCount > 1 ? ` · ${job.equipmentCount} เครื่องในใบเดียว` : ""}
                      </div>
                    </div>
                    {jobStatusBadge(job.status)}
                  </Link>
                ))}
              </div>
            )}
          </div>

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
                            {/* The appointment → the paper the technician
                                carries to it. The sheet keeps `scheduleId`, so
                                pressing ปิดงาน on the sheet later closes THIS
                                appointment too — and because that link is a
                                plain id with no FK, deleting the appointment
                                afterwards leaves the sheet intact. */}
                            <Link
                              href={`/service-job?scheduleId=${encodeURIComponent(s.id)}`}
                              onClick={(e) => e.stopPropagation()}
                              className="px-2.5 py-1.5 bg-orange-50 text-orange-600 hover:bg-orange-100 text-xs font-semibold rounded-lg transition-all"
                              title="ออกใบ Job จากนัดหมายนี้"
                            >
                              🔧 ออกใบ Job
                            </Link>
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

      {/* ── Delete Completed Schedule Confirm ───────────────────────────── */}
      {deleteCompletedSchedule && (
        <div
          className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[170] flex items-center justify-center p-4 animate-fadeIn"
          onClick={() => {
            if (!isSaving) setDeleteCompletedSchedule(null);
          }}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 text-center"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-5xl mb-4">🗑️</div>
            <h3 className="text-lg font-bold text-gray-800 mb-2">ลบนัดหมายที่เสร็จแล้วนี้?</h3>
            <p className="text-gray-500 text-sm mb-6">
              {formatDisplayDate(deleteCompletedSchedule.scheduledDate)} ({deleteCompletedSchedule.scheduleType === "service" ? "Service" : "โทรติดตาม"}) ดำเนินการเสร็จแล้ว
            </p>
            <div className="flex gap-3 justify-center">
              <button
                type="button"
                onClick={() => setDeleteCompletedSchedule(null)}
                className="px-5 py-2.5 border border-gray-200 text-gray-600 font-semibold rounded-xl hover:bg-gray-50 transition-all"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={executeDeleteCompletedSchedule}
                disabled={isSaving}
                className="px-5 py-2.5 bg-red-600 text-white font-semibold rounded-xl hover:bg-red-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSaving ? "กำลังลบ..." : "ลบ"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* "สร้างสิ่งที่ต้องทำ" ผูกกับเครื่องนี้ — a sibling modal (own backdrop,
          z-200 > this modal's z-[150]) rather than nested inside the markup
          above, so closing this one leaves the equipment details modal
          exactly as it was. `taskTopics` is asserted non-null by
          `handleOpenTaskForm` before this ever opens. */}
      {showTaskForm && taskTopics && (
        <TaskFormModal
          topics={taskTopics}
          initialLinks={taskFormInitialLinks()}
          onClose={() => setShowTaskForm(false)}
          onSaved={(task) => {
            setShowTaskForm(false);
            setTaskCreatedMessage("ผูกกับเครื่องนี้แล้ว");
            onTaskCreated?.(task);
          }}
        />
      )}

      {taskCreatedMessage && (
        <TaskCreatedNotice
          message={taskCreatedMessage}
          onClose={() => setTaskCreatedMessage(null)}
        />
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

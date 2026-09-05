"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "../../context/AuthContext";
import Toast from "../../components/Toast";
import ConfirmDialog from "../../components/ConfirmDialog";
import DatePicker from "../../components/DatePicker";
import SearchableDropdown from "../../components/SearchableDropdown";
import type { SearchableDropdownOption } from "../../components/SearchableDropdown";
import {
  CALIBRATION_VALIDITY_MONTHS,
  type CrmAlerts,
  type CrmTask,
  type CustomerEquipment,
  type TaskTopic,
} from "../../lib/types";
import {
  toLocalDateString,
  bangkokDateString,
  bangkokDateAtHour,
  bangkokDateAtHourFromNow,
  addMonthsToDateString,
  formatDisplayDate,
} from "../../lib/dateFormat";
import { dueMarkerOf } from "../../lib/taskBoard";
import { resolveAlertEditRoute } from "../../lib/alertEditRoute";

// Import Modals
import EquipmentEditModal from "../../components/modals/EquipmentEditModal";
import EquipmentDetailsModal from "../../components/modals/EquipmentDetailsModal";
import SalesRecordEditModal from "../../components/modals/SalesRecordEditModal";

// The manual task board ("post-it notes the owner wrote for himself"). It is
// NOT an alert: it lives in its own block below the alert grid, never in the
// tab strip, and its cards never carry a snooze button.
import TaskBoardSection from "../../components/TaskBoardSection";
import TaskBoardJumpButton from "../../components/TaskBoardJumpButton";
import TaskFormModal from "../../components/TaskFormModal";
import TaskTopicManagerModal from "../../components/TaskTopicManagerModal";

// The in-page user guide (tasks.md 18). It is opened by a boolean below and
// nothing else — no route, no query string — so reading it never changes the
// URL nor the alert tab the admin had selected (18.13).
import AlertsGuidePanel from "../../components/AlertsGuidePanel";
import {
  ALERT_WARRANTY_DAYS,
  ALERT_SCHEDULE_DAYS,
  ALERT_LIST_DISPLAY_LIMIT,
} from "../../lib/alertThresholds";

/** The snooze durations, in the order the old <select> listed them. Module
 *  scope so the array identity never changes between renders. */
const SNOOZE_DAY_OPTIONS: SearchableDropdownOption[] = [
  { value: "1", label: "1 วัน" },
  { value: "3", label: "3 วัน" },
  { value: "7", label: "7 วัน" },
  { value: "14", label: "14 วัน" },
  { value: "30", label: "1 เดือน" },
];

/** How many rows `getAlerts()` sends for the capped categories. The overflow
 *  line under the grid quotes it, so it is not retyped in prose — and it is now
 *  the SAME constant the query and the guide panel read (tasks.md 18.14). */
const ALERT_ROW_CAP = ALERT_LIST_DISPLAY_LIMIT;

/** "YYYY-MM-DD" → a LOCAL Date. `new Date("2026-09-05")` is UTC midnight, which
 *  the picker would show as the 4th on any machine west of Greenwich. */
function parseDateValue(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? "").trim());
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

/** A customer-scoped follow-up call being edited in the small schedule form.
 *  These calls have no equipment, so there is nothing to load first — the form
 *  opens straight from the card (tasks 10.2 / 10.5). */
interface ScheduleEditState {
  id: string;
  scheduledDate: string;
  assignedToAdminId: string;
  notes: string;
  customerName: string;
}

export default function AlertsPage() {
  const router = useRouter();
  const { isLoggedIn, isLoading: authLoading } = useAuth();
  const [alerts, setAlerts] = useState<CrmAlerts | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  /** Thai, user-facing. Set when the WHOLE alerts payload failed. While it is
   *  set no tab renders a count — a 0 would read as "ไม่มีรายการ", which is a
   *  different fact from "โหลดไม่ได้" (tasks 11.16 / 11.17). */
  const [alertsError, setAlertsError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [activeTab, setActiveTab] = useState("all");
  /** The in-page guide. Deliberately plain local state and nothing else: it
   *  never touches the router or `activeTab`, so opening and closing it leaves
   *  the URL at /crm/alerts and the selected tab exactly where it was (18.13). */
  const [isGuideOpen, setIsGuideOpen] = useState(false);

  // Snooze state
  const [snoozeAlertTarget, setSnoozeAlertTarget] = useState<{ type: string; id: string } | null>(null);
  const [snoozeMode, setSnoozeMode] = useState<"days" | "date">("days");
  const [snoozeDays, setSnoozeDays] = useState<number>(3);
  const [snoozeDate, setSnoozeDate] = useState<string>("");
  const [isSnoozing, setIsSnoozing] = useState(false);

  // Modals state
  const [editingEquipment, setEditingEquipment] = useState<CustomerEquipment | null>(null);
  const [viewingEquipmentDetails, setViewingEquipmentDetails] = useState<CustomerEquipment | null>(null);
  const [editingSalesRecordId, setEditingSalesRecordId] = useState<string | null>(null);
  
  // Complete modal
  const [completingId, setCompletingId] = useState<string | null>(null);
  const [completeForm, setCompleteForm] = useState({
    serviceReportNumber: "",
    actionDate: toLocalDateString(new Date()),
    resultDetails: "",
    customerFeedback: "",
  });

  // View Details Modal
  const [selectedAlert, setSelectedAlert] = useState<{
    type: "schedule" | "customer_call" | "warranty" | "calibration" | "incomplete" | "missing_doc";
    data: any;
  } | null>(null);

  // Edit form for a customer-scoped follow-up call (no equipment involved).
  const [editingSchedule, setEditingSchedule] = useState<ScheduleEditState | null>(null);
  const [isSavingSchedule, setIsSavingSchedule] = useState(false);

  // ── Task board (its own block, its own data, its own failures) ─────────────
  // The topic list is owned HERE so the topic-manager modal can hand back a
  // fresh, reordered set without the board refetching (TaskTopicManagerModal
  // props). The board gets every topic, hidden ones included; the create/edit
  // form only gets the active ones.
  const [topics, setTopics] = useState<TaskTopic[]>([]);
  const [topicsLoading, setTopicsLoading] = useState(true);
  const [topicsError, setTopicsError] = useState<string | null>(null);
  const [boardRefreshKey, setBoardRefreshKey] = useState(0);
  const [taskModal, setTaskModal] = useState<{ task: CrmTask | null } | null>(null);
  const [revealTask, setRevealTask] = useState<CrmTask | null>(null);
  const [showTopicManager, setShowTopicManager] = useState(false);
  /** The board's wrapper. The floating jump button both scrolls to it and
   *  watches it with an IntersectionObserver, so it can hide itself once the
   *  board is actually on screen. */
  const taskBoardRef = useRef<HTMLDivElement>(null);

  // "ลูกค้าไม่ต่อประกัน" confirmation
  const [declineRenewalTarget, setDeclineRenewalTarget] = useState<CustomerEquipment | null>(null);
  const [isDecliningRenewal, setIsDecliningRenewal] = useState(false);

  useEffect(() => {
    if (!authLoading && !isLoggedIn) router.replace("/login");
  }, [isLoggedIn, authLoading, router]);

  // Stable identity: TaskBoardSection lists its callbacks in an effect's
  // dependency array, so a fresh arrow on every render would restart its fetch
  // in a loop.
  const showToast = useCallback((message: string, type: "success" | "error") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  const handleUnauthorized = useCallback(() => {
    router.replace("/login");
  }, [router]);

  const fetchAlerts = async () => {
    setIsLoading(true);
    try {
      // The windows are sent explicitly, from the same constants the guide
      // panel renders, so "the guide quotes what this load actually asked for"
      // stays true even if the route's defaults ever drift (tasks.md 18.14).
      const res = await fetch(
        `/api/admin/alerts?warrantyDays=${ALERT_WARRANTY_DAYS}&scheduleDays=${ALERT_SCHEDULE_DAYS}`
      );
      if (res.ok) {
        setAlerts(await res.json());
        setAlertsError(null);
      } else if (res.status === 401) {
        router.replace("/login");
      } else {
        // Keep whatever was already on screen (a refresh that fails should not
        // wipe a working page) and raise the banner. `alertsError` is what
        // suppresses the counts and the "ไม่มีแจ้งเตือน 🎉" empty state.
        setAlertsError("โหลดข้อมูลแจ้งเตือนไม่สำเร็จ");
        showToast("โหลดข้อมูลแจ้งเตือนไม่สำเร็จ", "error");
      }
    } catch (err) {
      console.error(err);
      setAlertsError("โหลดข้อมูลแจ้งเตือนไม่สำเร็จ");
      showToast("โหลดข้อมูลแจ้งเตือนไม่สำเร็จ", "error");
    } finally {
      setIsLoading(false);
    }
  };

  /** Topics for the board. Deliberately a SEPARATE request from the alerts:
   *  when this one fails the board still lists its tasks (with a retry next to
   *  the chips) and the alert feed is untouched — tasks.md 11.16. */
  const fetchTopics = useCallback(async () => {
    setTopicsLoading(true);
    try {
      const res = await fetch("/api/admin/task-topics?includeHidden=1");
      if (res.status === 401) {
        handleUnauthorized();
        setTopicsError("เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่");
        return;
      }
      if (!res.ok) throw new Error("โหลดหัวข้องานไม่สำเร็จ");
      const data = await res.json();
      setTopics(Array.isArray(data) ? (data as TaskTopic[]) : []);
      setTopicsError(null);
    } catch (err) {
      console.error(err);
      setTopicsError("โหลดหัวข้องานไม่สำเร็จ");
    } finally {
      setTopicsLoading(false);
    }
  }, [handleUnauthorized]);

  useEffect(() => {
    if (isLoggedIn) fetchAlerts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoggedIn]);

  useEffect(() => {
    if (isLoggedIn) fetchTopics();
  }, [isLoggedIn, fetchTopics]);

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
        actionDate: toLocalDateString(new Date()),
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

  const handleSnooze = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!snoozeAlertTarget || isSnoozing) return;
    setIsSnoozing(true);
    
    let snoozeUntilIso = "";
    if (snoozeMode === "days") {
      // 6:00 AM Bangkok time, `snoozeDays` days from now — NOT the admin's
      // own device timezone (see bangkokDateAtHourFromNow's doc comment).
      snoozeUntilIso = bangkokDateAtHourFromNow(snoozeDays, 6).toISOString();
    } else {
      if (!snoozeDate) {
        showToast("กรุณาระบุวันที่", "error");
        setIsSnoozing(false);
        return;
      }
      const d = bangkokDateAtHour(snoozeDate, 6);
      if (d <= new Date()) {
        showToast("กรุณาเลือกวันที่ในอนาคต", "error");
        setIsSnoozing(false);
        return;
      }
      snoozeUntilIso = d.toISOString();
    }

    try {
      const res = await fetch("/api/admin/alerts/snooze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          alertType: snoozeAlertTarget.type,
          referenceId: snoozeAlertTarget.id,
          snoozeUntil: snoozeUntilIso
        }),
      });
      if (!res.ok) throw new Error("Failed to snooze");
      showToast("เลื่อนการแจ้งเตือนสำเร็จ", "success");
      setSnoozeAlertTarget(null);
      fetchAlerts();
    } catch (err) {
      showToast("ไม่สามารถเลื่อนการแจ้งเตือนได้", "error");
    } finally {
      setIsSnoozing(false);
    }
  };

  const handleDeclineRenewal = async () => {
    if (!declineRenewalTarget || isDecliningRenewal) return;
    setIsDecliningRenewal(true);
    try {
      const res = await fetch(`/api/admin/equipments/${declineRenewalTarget.id}/decline-renewal`, {
        method: "POST",
      });
      if (!res.ok) throw new Error("Failed");
      showToast("บันทึกแล้วว่าลูกค้าไม่ต่อประกัน", "success");
      setDeclineRenewalTarget(null);
      setSelectedAlert(null);
      fetchAlerts();
    } catch {
      showToast("บันทึกไม่สำเร็จ", "error");
    } finally {
      setIsDecliningRenewal(false);
    }
  };

  /**
   * The edit button on every alert card and in the details modal.
   *
   * The decision of WHERE to go lives in `resolveAlertEditRoute` (pure, unit
   * tested — tasks 10.1-10.5 / 17.5). It exists because this used to assume
   * every schedule has an `equipmentId` and fetched
   * `/api/admin/equipments/undefined` for a customer-scoped call, which failed
   * every single time. Equipment-scoped schedules keep the exact old path,
   * failing load and all.
   */
  const handleEditClick = async (alertTarget?: any) => {
    const target = alertTarget || selectedAlert;
    const route = resolveAlertEditRoute(target);

    if (route.kind === "none") return;

    if (route.kind === "sales_record") {
      setEditingSalesRecordId(route.salesRecordId);
      setSelectedAlert(null);
      return;
    }

    if (route.kind === "schedule_form") {
      // No equipment on this schedule — open the form directly. Nothing is
      // fetched, so nothing can fail here.
      setEditingSchedule({
        id: route.scheduleId,
        scheduledDate: target.data?.scheduledDate || "",
        assignedToAdminId: target.data?.assignedToAdminId || "",
        notes: target.data?.notes || "",
        customerName: target.data?.customerName || target.data?.companyName || "ลูกค้าทั่วไป",
      });
      setSelectedAlert(null);
      return;
    }

    if (route.kind === "equipment_inline") {
      // warranty / calibration / incomplete -> target.data IS the equipment
      setEditingEquipment(target.data);
      setSelectedAlert(null);
      return;
    }

    try {
      const res = await fetch(`/api/admin/equipments/${encodeURIComponent(route.equipmentId)}`);
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
  };

  const handleSaveSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingSchedule || isSavingSchedule) return;
    if (!editingSchedule.scheduledDate) {
      showToast("กรุณาระบุวันที่นัด", "error");
      return;
    }
    setIsSavingSchedule(true);
    try {
      // Partial body on purpose: `updateSchedule` merges onto the stored row,
      // so the fields this form does not show (type, status) keep their values.
      const res = await fetch(`/api/admin/schedules/${editingSchedule.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scheduledDate: editingSchedule.scheduledDate,
          assignedToAdminId: editingSchedule.assignedToAdminId,
          notes: editingSchedule.notes,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "บันทึกนัดหมายไม่สำเร็จ");
      }
      showToast("บันทึกนัดหมายสำเร็จ", "success");
      setEditingSchedule(null);
      fetchAlerts();
    } catch (err) {
      console.error(err);
      showToast(err instanceof Error ? err.message : "บันทึกนัดหมายไม่สำเร็จ", "error");
    } finally {
      setIsSavingSchedule(false);
    }
  };

  const warrantyDaysLeft = (endDate: string | null) => {
    if (!endDate) return null;
    return Math.ceil((new Date(endDate).getTime() - Date.now()) / 86400000);
  };

  // A calibration is valid for 1 year (no separate stored due-date column —
  // see getAlerts() in crmStore.ts, which alerts starting 2 months before
  // this same anniversary).
  const calibrationDueDate = (calibrationDate: string | null | undefined) =>
    calibrationDate ? addMonthsToDateString(calibrationDate, CALIBRATION_VALIDITY_MONTHS) : null;
  const calibrationDaysLeft = (calibrationDate: string | null | undefined) => {
    const due = calibrationDueDate(calibrationDate);
    if (!due) return null;
    return Math.ceil((new Date(due).getTime() - Date.now()) / 86400000);
  };

  if (authLoading || !isLoggedIn) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-orange-500 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  // Today's Asia/Bangkok calendar day — the same day the server flagged
  // `overdue` by, so a laptop in another timezone cannot disagree with it.
  const today = bangkokDateString(new Date());

  // The follow-up-call category can be missing from an otherwise fine payload
  // (an older deploy answering, a partially written response). That is a
  // FAILURE of this one category, not "there are none": its tab shows a Thai
  // message with its own retry and NO count, while the rest of the feed and the
  // task board carry on (task 11.16).
  const callFollowUps = Array.isArray(alerts?.customerCallFollowUps)
    ? alerts!.customerCallFollowUps
    : null;
  const callFollowUpsFailed = alerts !== null && callFollowUps === null;

  const allAlerts = alerts
    ? [
        ...(alerts.expiringWarranties || []).map((data) => ({ type: "warranty" as const, data })),
        ...(alerts.nearingCalibration || []).map((data) => ({ type: "calibration" as const, data })),
        ...(alerts.incompleteEquipments || []).map((data) => ({ type: "incomplete" as const, data })),
        ...(alerts.upcomingSchedules || []).map((data) => ({ type: "schedule" as const, data })),
        ...(callFollowUps || []).map((data) => ({ type: "customer_call" as const, data })),
        ...(alerts.missingDocuments || []).map((data) => ({ type: "missing_doc" as const, data })),
      ]
    : [];

  const filteredAlerts = allAlerts.filter((a) => (activeTab === "all" ? true : a.type === activeTab));
  
  // Custom sort to put overdue/urgent items first
  filteredAlerts.sort((a, b) => {
    // 1. Overdue schedules first — follow-up calls included: an overdue call is
    //    just as late as an overdue service visit.
    const aIsOverdue = (a.type === "schedule" || a.type === "customer_call") && a.data.overdue;
    const bIsOverdue = (b.type === "schedule" || b.type === "customer_call") && b.data.overdue;
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

  const incompleteTotal = alerts?.incompleteEquipmentsTotal ?? alerts?.incompleteEquipments?.length ?? 0;
  const incompleteHiddenCount = Math.max(0, incompleteTotal - (alerts?.incompleteEquipments?.length || 0));

  /**
   * "เครื่องที่ i/n ของใบขายเดียวกัน" for every incomplete-data row that shares
   * a sales record with another one.
   *
   * Since a sale may now be saved with blank serials (report 7), one bill can
   * put SEVERAL machines in this feed at once — same customer, same product, no
   * serial on any of them. Without this the cards are literally identical and
   * the admin cannot tell which one he has already dealt with. Position in the
   * feed is the only stable handle there is: the query returns these rows
   * `ORDER BY e.createdAt DESC`, i.e. the order the machines were written, so
   * the numbering is stable across reloads as long as the sale is not re-saved.
   *
   * DISPLAY ONLY — computed from the list the API already returned; no query is
   * touched and nothing is fetched for it.
   */
  const incompleteSeq = new Map<string, { index: number; total: number }>();
  {
    const rows = alerts?.incompleteEquipments || [];
    const totals = new Map<string, number>();
    for (const row of rows) {
      const saleId = String(row?.salesRecordId || "");
      if (saleId) totals.set(saleId, (totals.get(saleId) || 0) + 1);
    }
    const seen = new Map<string, number>();
    for (const row of rows) {
      const saleId = String(row?.salesRecordId || "");
      if (!saleId) continue;
      const index = (seen.get(saleId) || 0) + 1;
      seen.set(saleId, index);
      incompleteSeq.set(String(row.id), { index, total: totals.get(saleId) || 1 });
    }
  }

  // The TRUE number of follow-up calls, not the length of the capped array —
  // exactly how `incompleteTotal` above works. `?? length` keeps the tab honest
  // if an older API build answers without the total.
  const callFollowUpsTotal = callFollowUps
    ? alerts?.customerCallFollowUpsTotal ?? callFollowUps.length
    : 0;
  const callFollowUpsHiddenCount = Math.max(0, callFollowUpsTotal - (callFollowUps?.length || 0));

  // `null` count = "we do not know", rendered as "–". A tab must never show 0
  // for a list that failed to load or has not arrived yet — 0 has to keep
  // meaning "ไม่มีรายการ" (task 11.16). A payload we DO have is still shown
  // after a failed refresh (with the banner saying it may be stale): stale is a
  // different thing from unknown.
  const countOr = (value: number) => (alerts ? value : null);

  const tabOptions: { id: string; label: string; count: number | null; color: string }[] = [
    {
      id: "all",
      label: "ทั้งหมด",
      // Built from the TRUE totals of the two capped categories, so that
      // (cards on screen) + (the "และอีก N รายการ" lines under the grid) adds
      // up to exactly this number — nothing is hidden without being counted.
      count: countOr(
        allAlerts.length
          - (alerts?.incompleteEquipments?.length || 0) + incompleteTotal
          - (callFollowUps?.length || 0) + callFollowUpsTotal
      ),
      color: "bg-gray-100 text-gray-700",
    },
    { id: "schedule", label: "กำหนดการ", count: countOr(alerts?.upcomingSchedules?.length || 0), color: "bg-blue-50 text-blue-700 border-blue-200" },
    // Its own tone, distinct from "กำหนดการ" blue: these calls are a different
    // category now, not a subset of the service schedules (task 9.1).
    { id: "customer_call", label: "นัดโทรลูกค้า", count: callFollowUpsFailed ? null : countOr(callFollowUpsTotal), color: "bg-violet-50 text-violet-700 border-violet-200" },
    { id: "warranty", label: "ประกันใกล้หมด", count: countOr(alerts?.expiringWarranties?.length || 0), color: "bg-orange-50 text-orange-700 border-orange-200" },
    { id: "calibration", label: "ใกล้ถึงกำหนดสอบเทียบ", count: countOr(alerts?.nearingCalibration?.length || 0), color: "bg-cyan-50 text-cyan-700 border-cyan-200" },
    { id: "incomplete", label: "ข้อมูลไม่ครบ", count: countOr(incompleteTotal), color: "bg-rose-50 text-rose-700 border-rose-200" },
    { id: "missing_doc", label: "เอกสารค้าง", count: countOr(alerts?.missingDocuments?.length || 0), color: "bg-red-50 text-red-700 border-red-200" },
  ];

  // ── Task board wiring ─────────────────────────────────────────────────────
  const activeTopics = topics.filter((topic) => topic.isActive !== false);

  /** The number on the floating jump button. Deliberately the count the page
   *  ALREADY has from /api/admin/alerts (`dueTaskCount` — pending tasks whose
   *  due date has arrived, the same number the global bell shows): the board
   *  owns the task list and must not be asked for it a second time just to
   *  draw a badge. `null` while the payload is loading or failed — on this
   *  page a 0 reads as "ไม่มีรายการ", which is a different fact from
   *  "โหลดไม่ได้" (same rule as the tab counts above). */
  const dueTaskCount = alertsError ? null : (alerts?.dueTaskCount ?? null);

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
              <Link href="/dashboard" className="inline-flex items-center gap-1.5 text-sm font-semibold text-gray-500 hover:text-gray-800 transition-colors mb-3">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
                กลับไป Dashboard
              </Link>
              <div className="flex items-center gap-3 mb-1">
                <div className="w-10 h-10 bg-rose-100 text-rose-600 rounded-xl flex items-center justify-center text-xl shadow-sm">
                  🔔
                </div>
                <h1 className="text-2xl font-bold text-gray-900 tracking-tight">ศูนย์แจ้งเตือน CRM</h1>
              </div>
              <p className="text-sm text-gray-500 font-medium ml-13">รวมรายการที่ต้องติดตามและอัปเดต</p>
            </div>
            {/* flex-wrap: the guide button is a third item in this row, which
                would otherwise push the header wider than a 360px phone. */}
            <div className="flex flex-wrap items-center gap-3">
              {/* ปุ่มกลับไประบบจัดการ — มุมขวาบน สไตล์เดียวกับหน้า admin อื่นๆ */}
              <Link
                href="/adminpanel"
                className="px-4 py-2 bg-white border border-gray-200 text-gray-700 font-semibold rounded-xl hover:bg-gray-50 hover:border-gray-300 transition-all text-sm shadow-sm whitespace-nowrap"
              >
                🏠 กลับไประบบจัดการ
              </Link>
              {/* คู่มือการใช้งาน — เปิดอ่านได้ตลอดโดยไม่ต้องออกจากหน้านี้ */}
              <button
                onClick={() => setIsGuideOpen(true)}
                className="px-4 py-2 bg-white border border-gray-200 text-gray-700 font-semibold rounded-xl hover:bg-gray-50 hover:border-gray-300 transition-all text-sm shadow-sm flex items-center gap-2 whitespace-nowrap"
                aria-haspopup="dialog"
                aria-expanded={isGuideOpen}
                title="อธิบายว่าแต่ละแจ้งเตือนขึ้นเพราะอะไร และทำอย่างไรถึงจะหายไป"
              >
                📖 คู่มือการใช้งาน
              </button>
              <button
                onClick={fetchAlerts}
                className="px-4 py-2 bg-white border border-gray-200 text-gray-700 font-semibold rounded-xl hover:bg-gray-50 hover:border-gray-300 transition-all text-sm shadow-sm flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                รีเฟรช
              </button>
            </div>
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
                <span
                  className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                    activeTab === tab.id ? "bg-white/20 text-white" : tab.color
                  }`}
                  title={tab.count === null ? "ยังไม่ทราบจำนวน (โหลดไม่สำเร็จ)" : undefined}
                >
                  {/* "–" not 0: a failed or unfinished load must not claim the
                      category is empty (task 11.16). */}
                  {tab.count === null ? "–" : tab.count}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        {/* Stale data is still on screen after a failed refresh — say so instead
            of pretending the numbers are current (task 11.17). */}
        {alertsError && alerts && !isLoading && (
          <div className="mb-6 flex flex-col sm:flex-row sm:items-center gap-3 bg-red-50 border border-red-200 rounded-2xl px-5 py-4">
            <div className="flex-1">
              <p className="font-bold text-red-800">⚠️ {alertsError}</p>
              <p className="text-sm text-red-700 mt-0.5">ข้อมูลที่เห็นอยู่อาจไม่ใช่ข้อมูลล่าสุด</p>
            </div>
            <button
              onClick={fetchAlerts}
              className="px-4 py-2 bg-white border border-red-200 text-red-700 font-semibold rounded-xl hover:bg-red-100 transition-all text-sm shadow-sm whitespace-nowrap self-start sm:self-auto"
            >
              🔄 รีเฟรช
            </button>
          </div>
        )}

        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-20 text-gray-400">
             <div className="w-10 h-10 border-4 border-gray-200 border-t-gray-500 rounded-full animate-spin mb-4"></div>
             <p className="font-medium">กำลังโหลดข้อมูล...</p>
          </div>
        ) : alertsError && !alerts ? (
          /* The whole payload failed and there is nothing to fall back on.
             Never the white screen, and never "ไม่มีแจ้งเตือน 🎉" — which would
             claim there is nothing to do (task 11.17). */
          <div className="bg-white rounded-3xl border border-red-100 p-16 text-center shadow-sm">
            <div className="text-6xl mb-4 opacity-60">📡</div>
            <h3 className="text-xl font-bold text-gray-800 mb-2">โหลดข้อมูลแจ้งเตือนไม่สำเร็จ</h3>
            <p className="text-gray-500 mb-6">
              ยังไม่ทราบว่ามีรายการค้างอยู่กี่รายการ กรุณาลองใหม่อีกครั้ง
            </p>
            <button
              onClick={fetchAlerts}
              className="px-6 py-2.5 bg-gray-900 text-white font-semibold rounded-xl hover:bg-gray-800 transition-all text-sm shadow-sm"
            >
              🔄 รีเฟรช
            </button>
            <p className="text-xs text-gray-400 mt-6">
              กระดานงาน “สิ่งที่ต้องทำ” ด้านล่างยังใช้งานได้ตามปกติ
            </p>
          </div>
        ) : activeTab === "customer_call" && callFollowUpsFailed ? (
          /* Only THIS category is broken — the other tabs still work. */
          <div className="bg-white rounded-3xl border border-violet-100 p-16 text-center shadow-sm">
            <div className="text-6xl mb-4 opacity-60">📞</div>
            <h3 className="text-xl font-bold text-gray-800 mb-2">โหลดรายการนัดโทรลูกค้าไม่สำเร็จ</h3>
            <p className="text-gray-500 mb-6">หมวดอื่นยังแสดงผลได้ตามปกติ</p>
            <button
              onClick={fetchAlerts}
              className="px-6 py-2.5 bg-violet-600 text-white font-semibold rounded-xl hover:bg-violet-700 transition-all text-sm shadow-sm"
            >
              🔄 ลองใหม่
            </button>
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
                        {formatDisplayDate(alert.data.scheduledDate)} {isOverdue && "(เลยกำหนด)"}
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
                      <button 
                        onClick={(e) => { e.stopPropagation(); setSnoozeAlertTarget({ type: "schedule", id: alert.data.id }); }}
                        className="px-3 py-2 bg-amber-50 text-amber-700 text-sm font-semibold rounded-xl hover:bg-amber-100 transition-colors flex items-center justify-center gap-1.5"
                        title="เลื่อนแจ้งเตือน"
                      >
                         ⏱️
                      </button>
                    </div>
                  </div>
                );
              }

              if (alert.type === "customer_call") {
                // A follow-up call is NOT tied to a machine, so this card shows
                // no product and no serial — there are none (task 9.3).
                const isOverdue = alert.data.overdue;
                // Future dates read as "อีก N วัน" in the category's own violet,
                // never the red of something already late (task 9.4).
                const marker = dueMarkerOf(alert.data.scheduledDate, today);
                return (
                  <div key={idx} onClick={() => setSelectedAlert(alert)} className="bg-white rounded-2xl p-5 border border-gray-100 hover:border-violet-200 hover:shadow-lg transition-all cursor-pointer group relative overflow-hidden flex flex-col">
                    <div className={`absolute top-0 left-0 w-1 h-full ${isOverdue ? "bg-red-500" : "bg-violet-500"}`}></div>
                    <div className="flex justify-between items-start mb-4 gap-2">
                      <div className={`px-2.5 py-1 rounded-md text-xs font-bold flex items-center gap-1.5 ${isOverdue ? "bg-red-50 text-red-700" : "bg-violet-50 text-violet-700"}`}>
                        📞 นัดโทรลูกค้า
                      </div>
                      <span className={`text-xs font-bold whitespace-nowrap ${isOverdue ? "text-red-600 bg-red-50 px-2 py-0.5 rounded-full" : "text-violet-700 bg-violet-50 px-2 py-0.5 rounded-full"}`}>
                        {isOverdue ? "เลยกำหนด" : marker.label}
                      </span>
                    </div>

                    <h4 className="font-bold text-gray-900 mb-1 line-clamp-1">{alert.data.customerName || "ลูกค้าทั่วไป"}</h4>
                    {alert.data.companyName && (
                      <p className="text-sm text-gray-500 mb-1 line-clamp-1">{alert.data.companyName}</p>
                    )}
                    <p className="text-xs font-semibold text-gray-600 mb-2">
                      วันที่นัด: {formatDisplayDate(alert.data.scheduledDate) || "—"}
                    </p>
                    <p className="text-sm text-gray-500 mb-4 line-clamp-2">
                      {alert.data.notes || "ไม่มีโน้ต"}
                    </p>

                    <div className="mt-auto pt-2 flex gap-2 w-full">
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
                      <button
                        // alertType stays "schedule" — the SAME value the split
                        // query still reads, so calls snoozed before this change
                        // are still snoozed (task 9.5).
                        onClick={(e) => { e.stopPropagation(); setSnoozeAlertTarget({ type: "schedule", id: alert.data.id }); }}
                        className="px-3 py-2 bg-amber-50 text-amber-700 text-sm font-semibold rounded-xl hover:bg-amber-100 transition-colors flex items-center justify-center gap-1.5"
                        title="เลื่อนแจ้งเตือน"
                      >
                        ⏱️
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
                    
                    <div className="mt-auto flex gap-2 w-full opacity-0 group-hover:opacity-100 transition-opacity">
                      <button className="flex-1 px-3 py-2 bg-gray-50 text-gray-700 text-sm font-semibold rounded-xl hover:bg-gray-100 transition-colors flex items-center justify-center gap-1.5">
                        ดูรายละเอียด →
                      </button>
                      <button 
                        onClick={(e) => { e.stopPropagation(); setSnoozeAlertTarget({ type: "warranty", id: alert.data.id }); }}
                        className="px-3 py-2 bg-amber-50 text-amber-700 text-sm font-semibold rounded-xl hover:bg-amber-100 transition-colors flex items-center justify-center gap-1.5"
                        title="เลื่อนแจ้งเตือน"
                      >
                         ⏱️
                      </button>
                    </div>
                  </div>
                );
              }

              if (alert.type === "calibration") {
                const daysLeft = calibrationDaysLeft(alert.data.calibrationDate);
                const isOverdue = daysLeft !== null && daysLeft <= 0;
                return (
                  <div key={idx} onClick={() => setSelectedAlert(alert)} className="bg-white rounded-2xl p-5 border border-gray-100 hover:border-cyan-200 hover:shadow-lg transition-all cursor-pointer group relative overflow-hidden flex flex-col">
                    <div className={`absolute top-0 left-0 w-1 h-full ${isOverdue ? "bg-red-500" : "bg-cyan-500"}`}></div>
                    <div className="flex justify-between items-start mb-4">
                      <div className={`px-2.5 py-1 rounded-md text-xs font-bold ${isOverdue ? "bg-red-50 text-red-700" : "bg-cyan-50 text-cyan-700"}`}>
                        🔧 {isOverdue ? "เลยกำหนดสอบเทียบ" : "ใกล้ถึงกำหนดสอบเทียบ"}
                      </div>
                      <span className={`text-xs font-bold ${isOverdue ? "text-red-600 bg-red-50 px-2 py-0.5 rounded-full" : "text-cyan-600 bg-cyan-50 px-2 py-0.5 rounded-full"}`}>
                        {isOverdue ? `เลยมาแล้ว ${Math.abs(daysLeft!)} วัน` : `เหลือ ${daysLeft} วัน`}
                      </span>
                    </div>

                    <h4 className="font-bold text-gray-900 mb-1 line-clamp-1">{alert.data.customerName || "ลูกค้าทั่วไป"}</h4>
                    <p className="text-sm text-gray-500 mb-1 line-clamp-1" dangerouslySetInnerHTML={{ __html: alert.data.productName || "ไม่ระบุสินค้า" }} />
                    <p className="text-xs text-gray-400 font-mono mb-4">S/N: {alert.data.serialNumber || "—"}</p>

                    <div className="mt-auto flex gap-2 w-full opacity-0 group-hover:opacity-100 transition-opacity">
                      <button className="flex-1 px-3 py-2 bg-gray-50 text-gray-700 text-sm font-semibold rounded-xl hover:bg-gray-100 transition-colors flex items-center justify-center gap-1.5">
                        ดูรายละเอียด →
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); setSnoozeAlertTarget({ type: "calibration", id: alert.data.id }); }}
                        className="px-3 py-2 bg-amber-50 text-amber-700 text-sm font-semibold rounded-xl hover:bg-amber-100 transition-colors flex items-center justify-center gap-1.5"
                        title="เลื่อนแจ้งเตือน"
                      >
                         ⏱️
                      </button>
                    </div>
                  </div>
                );
              }

              if (alert.type === "incomplete") {
                // Report 7 — a sale can now be saved with the serial left
                // blank, so this card has to answer "WHICH machine, from WHICH
                // bill?" on its own: customer + company, the model, where the
                // row came from (ใบเสนอราคา / a recorded sale), when it was
                // written, and — when one bill dropped several identical
                // machines in here — its position among them.
                const missingSerial = !alert.data.serialNumber;
                const fromSale = !!alert.data.salesRecordId;
                const seq = incompleteSeq.get(String(alert.data.id));
                return (
                  <div key={idx} onClick={() => setSelectedAlert(alert)} className="bg-white rounded-2xl p-5 border border-gray-100 hover:border-rose-200 hover:shadow-lg transition-all cursor-pointer group relative overflow-hidden flex flex-col">
                    <div className="absolute top-0 left-0 w-1 h-full bg-rose-500"></div>
                    <div className="flex justify-between items-start mb-4 gap-2">
                      <div className="px-2.5 py-1 rounded-md text-xs font-bold bg-rose-50 text-rose-700">
                        ⚠️ ข้อมูลไม่ครบ
                      </div>
                      {seq && seq.total > 1 && (
                        <span className="text-[11px] font-bold text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full shrink-0" title={`ใบขายใบเดียวกันนี้มี ${seq.total} เครื่องที่ข้อมูลยังไม่ครบ — นี่คือเครื่องที่ ${seq.index} เรียงตามลำดับที่บันทึก`}>
                          {seq.index}/{seq.total} ในใบขายเดียวกัน
                        </span>
                      )}
                    </div>

                    <h4 className="font-bold text-gray-900 mb-0.5 line-clamp-1">{alert.data.customerName || "ลูกค้าทั่วไป"}</h4>
                    {alert.data.companyName && (
                      <p className="text-xs text-gray-400 mb-1 line-clamp-1">{alert.data.companyName}</p>
                    )}
                    <p className="text-sm text-gray-500 mb-1 line-clamp-1" dangerouslySetInnerHTML={{ __html: alert.data.productName || "ไม่ระบุสินค้า" }} />
                    <p className="text-xs text-gray-400 font-mono mb-2 line-clamp-1">
                      S/N: {alert.data.serialNumber || "— ยังไม่ได้ใส่"}
                    </p>

                    <div className="flex flex-wrap gap-1 mb-2">
                      {missingSerial && <span className="text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-100 px-1.5 py-0.5 rounded">ยังไม่ได้ใส่ Serial Number</span>}
                      {!alert.data.warrantyStartDate && <span className="text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-100 px-1.5 py-0.5 rounded">ยังไม่ได้ใส่วันเริ่มประกัน</span>}
                    </div>

                    {/* Where this machine came from — the only way to find the
                        right physical unit when it has no serial to look up. */}
                    <div className="text-[11px] text-gray-400 mb-4 space-y-0.5">
                      <div className="line-clamp-1">
                        {alert.data.quotationNumber
                          ? `จากใบเสนอราคา ${alert.data.quotationNumber}`
                          : fromSale
                            ? "จากการบันทึกรายการขาย"
                            : "เพิ่มไว้ในระบบเอง (ไม่ได้มาจากใบขาย)"}
                      </div>
                      {alert.data.createdAt && (
                        <div>บันทึกเมื่อ {formatDisplayDate(alert.data.createdAt)}</div>
                      )}
                    </div>

                    <div className="mt-auto flex gap-2 w-full">
                      <button className="flex-1 px-3 py-2 bg-rose-50 text-rose-700 text-sm font-semibold rounded-xl hover:bg-rose-100 transition-colors flex items-center justify-center gap-1.5">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                        {missingSerial ? "ใส่ Serial Number" : "เพิ่มข้อมูล"}
                      </button>
                      <button 
                        onClick={(e) => { e.stopPropagation(); setSnoozeAlertTarget({ type: "incomplete", id: alert.data.id }); }}
                        className="px-3 py-2 bg-amber-50 text-amber-700 text-sm font-semibold rounded-xl hover:bg-amber-100 transition-colors flex items-center justify-center gap-1.5"
                        title="เลื่อนแจ้งเตือน"
                      >
                         ⏱️
                      </button>
                    </div>
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
                    
                    <div className="mt-auto flex gap-2 w-full">
                      <button className="flex-1 px-3 py-2 bg-gray-900 text-white text-sm font-semibold rounded-xl hover:bg-gray-800 transition-colors flex items-center justify-center gap-1.5">
                        ตามเอกสาร →
                      </button>
                      <button 
                        onClick={(e) => { e.stopPropagation(); setSnoozeAlertTarget({ type: "missing_doc", id: alert.data.id }); }}
                        className="px-3 py-2 bg-amber-50 text-amber-700 text-sm font-semibold rounded-xl hover:bg-amber-100 transition-colors flex items-center justify-center gap-1.5"
                        title="เลื่อนแจ้งเตือน"
                      >
                         ⏱️
                      </button>
                    </div>
                  </div>
                );
              }
            })}
          </div>
        )}
        {(activeTab === "all" || activeTab === "incomplete") && incompleteHiddenCount > 0 && (
          <p className="text-center text-sm text-gray-500 mt-6">
            และอีก {incompleteHiddenCount} รายการที่ข้อมูลไม่ครบ (แสดงผลสูงสุด {ALERT_ROW_CAP} รายการ)
          </p>
        )}
        {/* Same treatment as ข้อมูลไม่ครบ: the category has no date window, so
            the backlog can be long. Say how much is over the cap instead of
            quietly dropping it (task 9.8). */}
        {(activeTab === "all" || activeTab === "customer_call") && callFollowUpsHiddenCount > 0 && (
          <p className="text-center text-sm text-gray-500 mt-3">
            และอีก {callFollowUpsHiddenCount} รายการนัดโทรลูกค้า (แสดงผลสูงสุด {ALERT_ROW_CAP} รายการ)
          </p>
        )}
        {/* On "ทั้งหมด" the missing call cards would otherwise be invisible. */}
        {activeTab === "all" && callFollowUpsFailed && !isLoading && (
          <p className="text-center text-sm text-gray-500 mt-3">
            ⚠️ โหลดรายการ “นัดโทรลูกค้า” ไม่สำเร็จ จึงยังไม่แสดงในหน้านี้{" "}
            <button onClick={fetchAlerts} className="font-semibold text-violet-700 underline underline-offset-2 hover:text-violet-800">
              ลองใหม่
            </button>
          </p>
        )}

        {/* ── กระดานงานที่บันทึกเอง ───────────────────────────────────────────
            A SEPARATE block, deliberately outside the alert grid above and
            outside every branch of it: it is not an alert, it is not a tab, and
            it stays in the same place no matter which alert tab is selected —
            including while the alert feed is loading or has failed entirely
            (tasks 11.1-11.3, 11.16). */}
        {/* ref/id/tabIndex/scroll-mt are the jump button's landing pad:
            `tabIndex={-1}` lets it MOVE FOCUS here (so a keyboard user carries
            on inside the board instead of at the top of the page again), and
            the `scroll-mt-*` pair keeps the STICKY header off the board's
            heading after the scroll — the header is a tall stacked block on a
            phone and a single row from `sm` up, hence the two values. Nothing
            inside the board changes. */}
        <div
          id="task-board"
          ref={taskBoardRef}
          tabIndex={-1}
          className="mt-10 pt-8 border-t border-gray-200 scroll-mt-64 sm:scroll-mt-44 focus:outline-none"
        >
          <TaskBoardSection
            topics={topics}
            topicsLoading={topicsLoading}
            topicsError={topicsError}
            onRetryTopics={fetchTopics}
            onCreateTask={() => setTaskModal({ task: null })}
            onEditTask={(task) => setTaskModal({ task })}
            onManageTopics={() => setShowTopicManager(true)}
            refreshKey={boardRefreshKey}
            revealTask={revealTask}
            onToast={showToast}
            onUnauthorized={handleUnauthorized}
          />
        </div>
      </div>

      {/* ── ปุ่มลอยไปยังกระดาน "สิ่งที่ต้องทำ" ──────────────────────────────
          With a long alert feed the board ends up screens below the fold. This
          is fixed to the BOTTOM-LEFT corner, which is free on this page:
          GlobalAdminBell owns that corner elsewhere but renders null on
          /crm/alerts, so the two can never overlap at any width. It hides
          itself once the board is on screen. */}
      <TaskBoardJumpButton targetRef={taskBoardRef} count={dueTaskCount} />

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

      {/* ── Snooze Alert Modal ─────────────────────────────────────────── */}
      {snoozeAlertTarget && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in fade-in" onClick={() => setSnoozeAlertTarget(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden animate-in zoom-in-95" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
              <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                ⏱️ เลื่อนการแจ้งเตือน
              </h2>
              <button
                onClick={() => setSnoozeAlertTarget(null)}
                className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <form onSubmit={handleSnooze} className="p-6 space-y-5">
              <div className="flex gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input 
                    type="radio" 
                    name="snoozeMode" 
                    checked={snoozeMode === "days"} 
                    onChange={() => setSnoozeMode("days")}
                    className="w-4 h-4 text-amber-500 focus:ring-amber-500"
                  />
                  <span className="text-sm font-semibold text-gray-700">เลื่อนเป็นจำนวนวัน</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input 
                    type="radio" 
                    name="snoozeMode" 
                    checked={snoozeMode === "date"} 
                    onChange={() => setSnoozeMode("date")}
                    className="w-4 h-4 text-amber-500 focus:ring-amber-500"
                  />
                  <span className="text-sm font-semibold text-gray-700">ระบุวันที่</span>
                </label>
              </div>

              {snoozeMode === "days" ? (
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wider">เลื่อนไปอีก (วัน)</label>
                  {/* PROJECT RULE — every dropdown is `SearchableDropdown`, never
                      a native <select>. A native one is painted by the OPERATING
                      SYSTEM, so on a dark-mode machine it opens as a dark grey
                      popup in the middle of this white modal.

                      `searchable={false}`: five fixed durations, so a search box
                      would be dead weight. Nothing is lost by dropping the
                      native control here — the <select> carried no `required`
                      and `snoozeDays` starts at 3, so this branch of
                      `handleSnooze` can never see an empty value (unlike the
                      ระบุวันที่ branch, which keeps its own explicit checks).
                      Values stay numeric in state; only the dropdown speaks
                      strings. */}
                  <SearchableDropdown
                    searchable={false}
                    value={String(snoozeDays)}
                    onChange={(value) => setSnoozeDays(Number(value))}
                    options={SNOOZE_DAY_OPTIONS}
                    buttonClassName="h-[46px] px-4 rounded-xl border-gray-200 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
                  />
                </div>
              ) : (
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wider">เลือกวันที่ที่ต้องการให้เตือน</label>
                  <input 
                    type="date" 
                    required 
                    value={snoozeDate}
                    onChange={(e) => setSnoozeDate(e.target.value)}
                    className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 text-gray-700 bg-white"
                  />
                  <p className="mt-2 text-xs text-amber-600 font-medium">* ระบบจะแจ้งเตือนใหม่ในเวลา 6:00 น. ของวันที่เลือก</p>
                </div>
              )}

              <div className="pt-2 flex justify-end gap-3">
                <button 
                  type="button" 
                  onClick={() => setSnoozeAlertTarget(null)} 
                  className="px-4 py-2 text-gray-600 font-medium hover:bg-gray-100 rounded-xl transition-colors text-sm"
                >
                  ยกเลิก
                </button>
                <button 
                  type="submit" 
                  disabled={isSnoozing} 
                  className="px-5 py-2 bg-amber-500 hover:bg-amber-600 text-white font-semibold rounded-xl shadow-sm disabled:opacity-50 transition-colors text-sm flex items-center gap-1.5"
                >
                  {isSnoozing ? "กำลังบันทึก..." : "ยืนยัน"}
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
                {/* A customer-scoped call has no machine behind it, so there is
                    no product row to show (task 9.3). */}
                {selectedAlert.type !== "customer_call" && (
                  <div className="col-span-2">
                    <div className="text-gray-500 mb-1">สินค้า</div>
                    <div className="font-semibold text-gray-800" dangerouslySetInnerHTML={{ __html: selectedAlert.data.productName || "—" }} />
                  </div>
                )}

                {(selectedAlert.type === "schedule" || selectedAlert.type === "customer_call") && (
                  <>
                    <div>
                      <div className="text-gray-500 mb-1">ประเภท</div>
                      <div className="font-semibold text-gray-800">
                        {selectedAlert.type === "customer_call"
                          ? "นัดโทรลูกค้า"
                          : selectedAlert.data.scheduleType === "service"
                            ? "Service"
                            : "โทรติดตาม"}
                      </div>
                    </div>
                    <div>
                      <div className="text-gray-500 mb-1">กำหนดการ</div>
                      <div className="font-semibold text-gray-800">{formatDisplayDate(selectedAlert.data.scheduledDate)}</div>
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

                {selectedAlert.type === "calibration" && (
                  <>
                    <div>
                      <div className="text-gray-500 mb-1">Serial Number</div>
                      <div className="font-mono text-gray-800">{selectedAlert.data.serialNumber || "—"}</div>
                    </div>
                    <div>
                      <div className="text-gray-500 mb-1">สอบเทียบล่าสุด</div>
                      <div className="font-semibold text-gray-800">{selectedAlert.data.calibrationDate || "—"}</div>
                    </div>
                    <div>
                      <div className="text-gray-500 mb-1">กำหนดสอบเทียบครั้งถัดไป</div>
                      <div className="font-semibold text-gray-800">
                        {calibrationDueDate(selectedAlert.data.calibrationDate) || "—"}
                      </div>
                    </div>
                  </>
                )}

                {selectedAlert.type === "incomplete" && (
                  <>
                    {/* Report 7 — the machine may have been saved without a
                        serial on purpose, so the details have to identify the
                        unit some OTHER way: its bill, its quotation number and
                        when it was written. */}
                    <div>
                      <div className="text-gray-500 mb-1">Serial Number</div>
                      <div className="font-mono text-gray-800">
                        {selectedAlert.data.serialNumber || "ยังไม่ได้ใส่"}
                      </div>
                    </div>
                    <div>
                      <div className="text-gray-500 mb-1">เลขที่ใบเสนอราคา</div>
                      <div className="font-semibold text-gray-800">
                        {selectedAlert.data.quotationNumber || "—"}
                      </div>
                    </div>
                    <div>
                      <div className="text-gray-500 mb-1">ที่มา</div>
                      <div className="font-semibold text-gray-800">
                        {selectedAlert.data.salesRecordId
                          ? "บันทึกจากรายการขาย"
                          : "เพิ่มไว้ในระบบเอง"}
                      </div>
                    </div>
                    <div>
                      <div className="text-gray-500 mb-1">บันทึกเมื่อ</div>
                      <div className="font-semibold text-gray-800">
                        {formatDisplayDate(selectedAlert.data.createdAt) || "—"}
                      </div>
                    </div>
                    <div className="col-span-2">
                      <div className="text-gray-500 mb-1">สิ่งที่ขาด</div>
                      <div className="flex flex-col gap-1.5 mt-1">
                        {!selectedAlert.data.serialNumber && <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-white border border-rose-100 text-rose-700 w-fit">❌ ยังไม่ได้ใส่ Serial Number ของเครื่องนี้</span>}
                        {!selectedAlert.data.warrantyStartDate && <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-white border border-rose-100 text-rose-700 w-fit">❌ ยังไม่ได้ใส่วันเริ่มประกัน</span>}
                      </div>
                      <div className="text-xs text-gray-500 mt-2">
                        กด «ไปแก้ไขข้อมูล» เพื่อเติมข้อมูลเครื่องนี้ — เมื่อใส่ครบแล้ว
                        รายการนี้จะหายไปจากหัวข้อ «ข้อมูลไม่ครบ» เอง
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
              {selectedAlert.type === "warranty" && (
                <button
                  onClick={() => setDeclineRenewalTarget(selectedAlert.data)}
                  className="px-5 py-2.5 bg-white border border-gray-200 text-gray-700 font-semibold rounded-xl hover:bg-gray-50 transition-all text-sm shadow-sm mr-auto"
                >
                  ลูกค้าไม่ต่อประกัน
                </button>
              )}
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

      {/* Decline-renewal confirmation */}
      {declineRenewalTarget && (
        <ConfirmDialog
          title="ยืนยันว่าลูกค้าไม่ต่อประกัน"
          message={`ระบบจะบันทึกว่าอุปกรณ์นี้หมดประกันแล้ว และลูกค้าไม่ต่อประกัน (S/N: ${declineRenewalTarget.serialNumber || "—"}) คุณแน่ใจหรือไม่?`}
          confirmText="ยืนยัน"
          loadingText="กำลังบันทึก..."
          cancelText="ยกเลิก"
          loading={isDecliningRenewal}
          onConfirm={handleDeclineRenewal}
          onCancel={() => setDeclineRenewalTarget(null)}
        />
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

      {/* ── Edit a customer-scoped follow-up call ───────────────────────────
          The whole point of the fix in `handleEditClick`: this form opens with
          no equipment request at all, because there is no equipment. */}
      {editingSchedule && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in fade-in" onClick={() => !isSavingSchedule && setEditingSchedule(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden animate-in zoom-in-95" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
              <h2 className="text-lg font-bold text-gray-800">📞 แก้ไขนัดโทรลูกค้า</h2>
              <button
                onClick={() => setEditingSchedule(null)}
                className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <form onSubmit={handleSaveSchedule} className="p-6 space-y-4">
              <div>
                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">ลูกค้า</div>
                <div className="font-semibold text-gray-800">{editingSchedule.customerName}</div>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">วันที่นัด <span className="text-red-500">*</span></label>
                {/* Project rule: dates use DatePicker, never a native control. */}
                <DatePicker
                  selected={parseDateValue(editingSchedule.scheduledDate)}
                  onChange={(date) =>
                    setEditingSchedule((prev) =>
                      prev ? { ...prev, scheduledDate: date ? toLocalDateString(date) : "" } : prev
                    )
                  }
                  placeholderText="เลือกวันที่นัด"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">ผู้รับผิดชอบ</label>
                <input
                  type="text"
                  value={editingSchedule.assignedToAdminId}
                  onChange={(e) =>
                    setEditingSchedule((prev) => (prev ? { ...prev, assignedToAdminId: e.target.value } : prev))
                  }
                  className="w-full px-4 py-2 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500"
                  placeholder="ชื่อผู้ที่จะโทรหาลูกค้า"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">โน้ต</label>
                <textarea
                  value={editingSchedule.notes}
                  onChange={(e) =>
                    setEditingSchedule((prev) => (prev ? { ...prev, notes: e.target.value } : prev))
                  }
                  rows={3}
                  className="w-full px-4 py-2 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500 resize-y"
                  placeholder="เรื่องที่ต้องคุยกับลูกค้า..."
                />
              </div>
              <div className="pt-2 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setEditingSchedule(null)}
                  className="px-5 py-2.5 text-gray-600 font-medium hover:bg-gray-100 rounded-xl transition-colors"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={isSavingSchedule}
                  className="px-6 py-2.5 bg-violet-600 hover:bg-violet-700 text-white font-semibold rounded-xl shadow-sm disabled:opacity-50 transition-colors"
                >
                  {isSavingSchedule ? "กำลังบันทึก..." : "บันทึกข้อมูล"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Task board modals ───────────────────────────────────────────────
          `revealTask` is what makes a save visible: the board switches to the
          view/filter that shows it and says which topic it landed under. */}
      {taskModal && (
        <TaskFormModal
          task={taskModal.task}
          topics={activeTopics}
          onClose={() => setTaskModal(null)}
          onSaved={(task) => {
            setTaskModal(null);
            setRevealTask(task);
            showToast("บันทึกงานสำเร็จ", "success");
          }}
        />
      )}

      {showTopicManager && (
        <TaskTopicManagerModal
          initialTopics={topics}
          onClose={() => setShowTopicManager(false)}
          onTopicsChanged={(next) => setTopics(next)}
          // A rename or recolour rewrites no task row, but every card displays
          // it — so the list has to be re-pulled.
          onSaveSuccess={() => setBoardRefreshKey((key) => key + 1)}
        />
      )}

      {/* ── คู่มือการใช้งาน ─────────────────────────────────────────────────
          Rendered last so it sits above every other layer, and fed the exact
          windows this page requested from /api/admin/alerts — the guide quotes
          those, never a number typed into its own text (tasks.md 18.14). */}
      {isGuideOpen && (
        <AlertsGuidePanel
          warrantyDays={ALERT_WARRANTY_DAYS}
          scheduleDays={ALERT_SCHEDULE_DAYS}
          onClose={() => setIsGuideOpen(false)}
        />
      )}

    </div>
  );
}

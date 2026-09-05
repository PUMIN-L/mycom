"use client";

/**
 * TaskBoardSection — the manual "post-it" board that sits on /crm/alerts.
 *
 * WHAT IT IS: a block of notes the ADMIN wrote for himself ("โทรหาเจ้านี้",
 * "ทำใบเสนอราคาให้เจ้านั้น"). It is NOT an alert: it is never part of the
 * alert tab strip, its cards never carry a "เลื่อนแจ้งเตือน" button, and it
 * never writes to `alert_snoozes`. Its tone is deliberately different from the
 * white automatic-alert cards, and every card is stamped "บันทึกเอง".
 *
 * WHAT IT OWNS: loading `/api/admin/tasks`, its own loading / empty / error
 * states, the topic filter chips, the ที่ต้องทำ ⇄ เสร็จแล้ว toggle, and the
 * complete / reopen / delete actions. A failure here is contained: the alert
 * grid keeps working, and the section shows a Thai message with a retry button
 * for ITSELF only. It never renders a count of 0 for a list that failed to
 * load — 0 always means "there is nothing".
 *
 * WHAT IT DOES NOT OWN (passed in by the parent page):
 *   - the create/edit modal → `onCreateTask` / `onEditTask`
 *   - the topic manager modal → `onManageTopics`
 *   - the topic list itself → `topics` (pass EVERY topic, hidden ones
 *     included, i.e. `listTopics(true)` / `?includeHidden=1`; the chips filter
 *     out the inactive ones themselves but still need to name a hidden topic
 *     that holds work)
 *   - the liveness of link targets → `linkTargetIndex` (see LinkTargetIndex in
 *     app/lib/taskBoard.ts: a target type that is ABSENT means "not checked",
 *     so its chips stay clickable — only a type that was looked up and missed
 *     marks a chip "ถูกลบแล้ว")
 *
 * WIRING NOTES
 *   - After the create/edit modal saves, hand the saved task back as
 *     `revealTask`. The board reloads, switches to the view/filter that
 *     actually shows it, and says which topic it landed under — saving must
 *     never look like nothing happened (task 11.14).
 *   - Bump `refreshKey` to force a reload after anything else changes tasks
 *     or topics.
 *   - `onTasksChanged` fires after every complete / reopen / delete so the
 *     page can refresh the bell count (`dueTaskCount`) alongside.
 *
 * Spec: openspec/changes/add-crm-task-board — tasks 11.4-11.15, 13.1-13.4.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Toast from "./Toast";
import ConfirmDialog from "./ConfirmDialog";
import { bangkokDateString } from "../lib/dateFormat";
import type { CrmTask, TaskStatus, TaskTopic } from "../lib/types";
import {
  ALL_CHIP_KEY,
  DELETED_TARGET_LABEL,
  NO_DUE_DATE_LABEL,
  buildTopicChips,
  chipKeyForTask,
  countDueTasks,
  dueMarkerOf,
  filterTasksByChip,
  resolveTaskLinks,
  resolveTaskTopic,
  sortTasksByCompletion,
  sortTasksForBoard,
  type LinkTargetIndex,
  type TopicChip,
} from "../lib/taskBoard";

export interface TaskBoardSectionProps {
  /** Every topic, hidden ones included. Owned by the parent so the topic
   * manager modal can mutate it without this component refetching. */
  topics: TaskTopic[];
  /** True while the parent is loading topics (chips render as a placeholder). */
  topicsLoading?: boolean;
  /** Thai message when the parent's topic load failed. The task list still
   * renders — the two failures are independent. */
  topicsError?: string | null;
  /** Retry for the topic load only. Shown next to `topicsError`. */
  onRetryTopics?: () => void;
  /** Opens the create modal (another component). */
  onCreateTask: () => void;
  /** Opens the edit modal for one task — also the "ย้ายหัวข้อ" path for a task
   * whose topic row is gone. */
  onEditTask: (task: CrmTask) => void;
  /** Opens the topic manager modal. The button is hidden when not provided. */
  onManageTopics?: () => void;
  /** Change this to force a reload of the task list. */
  refreshKey?: number | string;
  /** The task the admin just saved — reveals it (view + filter + a notice). */
  revealTask?: CrmTask | null;
  /** Use the page's toast instead of this section's own. */
  onToast?: (message: string, type: "success" | "error") => void;
  /** Fired after a complete / reopen / delete so the page can refresh the bell. */
  onTasksChanged?: () => void;
  /** Called on a 401 so the page can send the admin to /login. */
  onUnauthorized?: () => void;
  /** targetId → current label, per target type. See LinkTargetIndex. */
  linkTargetIndex?: LinkTargetIndex | null;
}

/** Static Tailwind class strings per topic colour token — never built by
 * string concatenation, which the JIT cannot see. */
const TOPIC_TONES: Record<
  string,
  { card: string; pin: string; chip: string; chipOn: string; count: string }
> = {
  blue: {
    card: "bg-blue-50 border-blue-200",
    pin: "bg-blue-200 text-blue-800",
    chip: "bg-white border-blue-200 text-blue-700 hover:bg-blue-50",
    chipOn: "bg-blue-600 border-blue-600 text-white",
    count: "bg-blue-100 text-blue-700",
  },
  amber: {
    card: "bg-amber-50 border-amber-200",
    pin: "bg-amber-200 text-amber-900",
    chip: "bg-white border-amber-200 text-amber-700 hover:bg-amber-50",
    chipOn: "bg-amber-500 border-amber-500 text-white",
    count: "bg-amber-100 text-amber-800",
  },
  green: {
    card: "bg-green-50 border-green-200",
    pin: "bg-green-200 text-green-800",
    chip: "bg-white border-green-200 text-green-700 hover:bg-green-50",
    chipOn: "bg-green-600 border-green-600 text-white",
    count: "bg-green-100 text-green-700",
  },
  rose: {
    card: "bg-rose-50 border-rose-200",
    pin: "bg-rose-200 text-rose-800",
    chip: "bg-white border-rose-200 text-rose-700 hover:bg-rose-50",
    chipOn: "bg-rose-600 border-rose-600 text-white",
    count: "bg-rose-100 text-rose-700",
  },
  purple: {
    card: "bg-purple-50 border-purple-200",
    pin: "bg-purple-200 text-purple-800",
    chip: "bg-white border-purple-200 text-purple-700 hover:bg-purple-50",
    chipOn: "bg-purple-600 border-purple-600 text-white",
    count: "bg-purple-100 text-purple-700",
  },
  teal: {
    card: "bg-teal-50 border-teal-200",
    pin: "bg-teal-200 text-teal-800",
    chip: "bg-white border-teal-200 text-teal-700 hover:bg-teal-50",
    chipOn: "bg-teal-600 border-teal-600 text-white",
    count: "bg-teal-100 text-teal-700",
  },
  slate: {
    card: "bg-slate-50 border-slate-200",
    pin: "bg-slate-200 text-slate-700",
    chip: "bg-white border-slate-200 text-slate-600 hover:bg-slate-50",
    chipOn: "bg-slate-700 border-slate-700 text-white",
    count: "bg-slate-100 text-slate-700",
  },
};

const toneOf = (color: string | null | undefined) => TOPIC_TONES[color ?? ""] ?? TOPIC_TONES.slate;

export default function TaskBoardSection({
  topics,
  topicsLoading = false,
  topicsError = null,
  onRetryTopics,
  onCreateTask,
  onEditTask,
  onManageTopics,
  refreshKey,
  revealTask = null,
  onToast,
  onTasksChanged,
  onUnauthorized,
  linkTargetIndex = null,
}: TaskBoardSectionProps) {
  const [tasks, setTasks] = useState<CrmTask[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  // Thai, user-facing. While it is set, `tasks` stays null and NO count is
  // rendered for this section — a 0 here would be a lie (task 11.16).
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const [view, setViewState] = useState<TaskStatus>("pending");
  const [chipKey, setChipKeyState] = useState<string>(ALL_CHIP_KEY);
  // Today's Asia/Bangkok calendar day — the SAME day the bell counts by (D6),
  // never the browser's own timezone. Held in state and refreshed on every
  // load so a tab left open overnight cannot keep calling yesterday "today".
  const [today, setToday] = useState<string>(() => bangkokDateString(new Date()));

  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CrmTask | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  // Only used when the parent did not pass `onToast`.
  const [localToast, setLocalToast] = useState<{
    message: string;
    type: "success" | "error";
  } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const notify = useCallback(
    (message: string, type: "success" | "error") => {
      if (onToast) {
        onToast(message, type);
        return;
      }
      setLocalToast({ message, type });
      if (toastTimer.current) clearTimeout(toastTimer.current);
      toastTimer.current = setTimeout(() => setLocalToast(null), 3000);
    },
    [onToast]
  );

  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    []
  );

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  // Switching view or filter makes a "saved over there" notice stale, so the
  // two always move together.
  const setView = useCallback((next: TaskStatus) => {
    setViewState(next);
    setSavedNotice(null);
  }, []);
  const setChipKey = useCallback((next: string) => {
    setChipKeyState(next);
    setSavedNotice(null);
  }, []);

  // ── Load ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setIsLoading(true);
      try {
        const res = await fetch(`/api/admin/tasks?status=${view}`);
        if (res.status === 401) {
          onUnauthorized?.();
          if (!cancelled) {
            setTasks(null);
            setLoadError("เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่");
          }
          return;
        }
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data?.error || "โหลดรายการงานไม่สำเร็จ");
        }
        const data = await res.json();
        if (cancelled) return;
        setTasks(Array.isArray(data) ? (data as CrmTask[]) : []);
        setToday(bangkokDateString(new Date()));
        setLoadError(null);
      } catch (err) {
        if (cancelled) return;
        console.error(err);
        // Keep `tasks` null so nothing renders a count for a failed load.
        setTasks(null);
        setLoadError(err instanceof Error ? err.message : "โหลดรายการงานไม่สำเร็จ");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [view, reloadToken, refreshKey, onUnauthorized]);

  // ── Reveal a freshly saved task (task 11.14) ───────────────────────────────
  // A save into a topic the open filter hides would otherwise look like the
  // button did nothing. `revealTask` is a fresh object per save, so its
  // identity is the trigger; the ref makes the same save fire exactly once.
  const revealedRef = useRef<CrmTask | null>(null);
  useEffect(() => {
    if (!revealTask || revealedRef.current === revealTask) return;
    revealedRef.current = revealTask;

    const topic = resolveTaskTopic(revealTask, topics);
    const targetChip = chipKeyForTask(revealTask, topics);

    setViewState(revealTask.status === "done" ? "done" : "pending");
    // Only move the filter when the open one would hide the task — "ทั้งหมด"
    // and the task's own topic both already show it.
    setChipKeyState((current) =>
      current === ALL_CHIP_KEY || current === targetChip ? current : targetChip
    );
    setSavedNotice(`บันทึก “${revealTask.title}” ไว้ใต้หัวข้อ “${topic.name}” แล้ว`);
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealTask]);

  // ── Derived data ───────────────────────────────────────────────────────────
  const orderedTasks = useMemo(() => {
    if (!tasks) return [];
    return view === "done" ? sortTasksByCompletion(tasks) : sortTasksForBoard(tasks, today);
  }, [tasks, view, today]);

  const chips: TopicChip[] = useMemo(
    () => (tasks ? buildTopicChips(orderedTasks, topics) : []),
    [tasks, orderedTasks, topics]
  );

  // A chip that disappears (its topic was deleted, or its last task moved on)
  // must not strand the board on a filter that no longer exists — so the
  // SELECTION is resolved during render rather than corrected afterwards by an
  // effect, which would flash one empty frame first.
  const activeChipKey =
    chips.length === 0 || chips.some((chip) => chip.key === chipKey) ? chipKey : ALL_CHIP_KEY;

  const visibleTasks = useMemo(
    () => filterTasksByChip(orderedTasks, activeChipKey, topics),
    [orderedTasks, activeChipKey, topics]
  );

  const dueCount = useMemo(
    () => (tasks && view === "pending" ? countDueTasks(tasks, today) : null),
    [tasks, view, today]
  );

  // ── Actions ────────────────────────────────────────────────────────────────
  const setStatus = async (task: CrmTask, status: TaskStatus) => {
    if (busyTaskId) return;
    setBusyTaskId(task.id);
    try {
      const res = await fetch(`/api/admin/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || "อัปเดตงานไม่สำเร็จ");
      }
      notify(status === "done" ? "ปิดงานเป็นสำเร็จแล้ว" : "เปิดงานกลับมาแล้ว", "success");
      reload(); // refresh THIS list only
      onTasksChanged?.();
    } catch (err) {
      console.error(err);
      notify(err instanceof Error ? err.message : "อัปเดตงานไม่สำเร็จ", "error");
    } finally {
      setBusyTaskId(null);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget || isDeleting) return;
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/admin/tasks/${deleteTarget.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || "ลบงานไม่สำเร็จ");
      }
      notify("ลบงานแล้ว", "success");
      setDeleteTarget(null);
      reload();
      onTasksChanged?.();
    } catch (err) {
      console.error(err);
      notify(err instanceof Error ? err.message : "ลบงานไม่สำเร็จ", "error");
    } finally {
      setIsDeleting(false);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  const headerCount = tasks && !loadError ? visibleTasks.length : null;
  // Named so an empty result can say WHICH topic is being filtered — "nothing
  // here" and "nothing on the whole board" must not look identical.
  const activeChip = chips.find((chip) => chip.key === activeChipKey) ?? null;
  const isFiltered = activeChipKey !== ALL_CHIP_KEY && activeChip !== null;

  return (
    <section
      aria-label="กระดานงานที่บันทึกเอง"
      className="rounded-3xl border-2 border-dashed border-amber-300 bg-amber-50/60 p-5 sm:p-6 shadow-sm"
    >
      {/* Header — deliberately not styled like the alert cards above it */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-5">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <div className="w-10 h-10 bg-amber-200 text-amber-900 rounded-xl flex items-center justify-center text-xl shadow-sm">
              🗒️
            </div>
            <h2 className="text-xl font-bold text-gray-900 tracking-tight">สิ่งที่ต้องทำ</h2>
            <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-amber-200 text-amber-900">
              บันทึกเอง
            </span>
            {headerCount !== null && (
              <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-white text-gray-700 border border-amber-200">
                {headerCount} งาน
              </span>
            )}
            {dueCount !== null && dueCount > 0 && (
              <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-red-100 text-red-700">
                ถึงกำหนดแล้ว {dueCount}
              </span>
            )}
          </div>
          <p className="text-sm text-gray-600 font-medium mt-2">
            รายการที่คุณจดไว้เอง ไม่ใช่แจ้งเตือนอัตโนมัติของระบบ — อยู่จนกว่าคุณจะกดว่าเสร็จ
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {onManageTopics && (
            <button
              onClick={onManageTopics}
              className="px-4 py-2 bg-white border border-amber-200 text-gray-700 font-semibold rounded-xl hover:bg-amber-50 transition-all text-sm shadow-sm whitespace-nowrap"
            >
              🏷️ จัดการหัวข้อ
            </button>
          )}
          <button
            onClick={onCreateTask}
            className="px-4 py-2 bg-amber-500 text-white font-semibold rounded-xl hover:bg-amber-600 transition-all text-sm shadow-sm whitespace-nowrap"
          >
            ✏️ สร้างงานใหม่
          </button>
        </div>
      </div>

      {/* ที่ต้องทำ / เสร็จแล้ว — completing a task moves it here, never away */}
      <div className="flex items-center gap-2 mb-4">
        <div className="inline-flex bg-white border border-amber-200 rounded-xl p-1 shadow-sm">
          {(
            [
              { id: "pending" as TaskStatus, label: "ที่ต้องทำ" },
              { id: "done" as TaskStatus, label: "เสร็จแล้ว" },
            ] as const
          ).map((option) => (
            <button
              key={option.id}
              onClick={() => setView(option.id)}
              aria-pressed={view === option.id}
              className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-all ${
                view === option.id
                  ? "bg-amber-500 text-white shadow-sm"
                  : "text-gray-600 hover:bg-amber-50"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {/* Topic filter chips */}
      {topicsError ? (
        <div className="flex items-center gap-3 flex-wrap mb-4 text-sm bg-white border border-amber-200 rounded-xl px-4 py-3">
          <span className="text-gray-700 font-semibold">⚠️ {topicsError}</span>
          <span className="text-gray-500">ยังดูและปิดงานได้ตามปกติ</span>
          {onRetryTopics && (
            <button
              onClick={onRetryTopics}
              className="px-3 py-1.5 bg-gray-50 text-gray-700 text-xs font-semibold rounded-lg hover:bg-gray-100 transition-colors"
            >
              ลองโหลดหัวข้ออีกครั้ง
            </button>
          )}
        </div>
      ) : topicsLoading ? (
        <div className="mb-4 text-sm text-gray-500 font-medium">กำลังโหลดหัวข้อ...</div>
      ) : (
        chips.length > 0 && (
          <div className="flex gap-2 flex-wrap mb-5">
            {chips.map((chip) => {
              const tone = toneOf(chip.color);
              const isOn = chip.key === activeChipKey;
              return (
                <button
                  key={chip.key}
                  onClick={() => setChipKey(chip.key)}
                  aria-pressed={isOn}
                  title={
                    chip.kind === "hidden"
                      ? "หัวข้อนี้ถูกซ่อนอยู่ แต่ยังมีงานค้างอยู่"
                      : chip.kind === "unassigned"
                        ? "งานที่หาหัวข้อไม่เจอ"
                        : undefined
                  }
                  className={`flex items-center gap-2 px-3.5 py-1.5 rounded-full text-sm font-semibold border transition-all ${
                    isOn ? tone.chipOn : tone.chip
                  } ${chip.kind === "hidden" ? "border-dashed" : ""}`}
                >
                  <span aria-hidden>{chip.icon}</span>
                  {chip.label}
                  <span
                    className={`px-1.5 py-0.5 rounded-full text-[11px] font-bold ${
                      isOn ? "bg-white/25 text-white" : tone.count
                    }`}
                  >
                    {chip.count}
                  </span>
                </button>
              );
            })}
          </div>
        )
      )}

      {/* "your new task went over there" notice (task 11.14) */}
      {savedNotice && (
        <div className="flex items-start justify-between gap-3 mb-4 bg-white border border-amber-200 rounded-xl px-4 py-3 text-sm">
          <span className="text-gray-700 font-medium">✅ {savedNotice}</span>
          <button
            onClick={() => setSavedNotice(null)}
            className="text-gray-400 hover:text-gray-700 font-bold shrink-0"
            aria-label="ปิดข้อความ"
          >
            ✕
          </button>
        </div>
      )}

      {/* Body: loading → error → empty → cards */}
      {isLoading && !tasks ? (
        <div className="flex flex-col items-center justify-center py-14 text-gray-500">
          <div className="w-8 h-8 border-4 border-amber-200 border-t-amber-500 rounded-full animate-spin mb-3" />
          <p className="font-medium">กำลังโหลดรายการงาน...</p>
        </div>
      ) : loadError ? (
        // This section's OWN failure: no count, no cards, no fake empty state.
        <div className="bg-white rounded-2xl border border-red-200 p-8 text-center">
          <div className="text-3xl mb-2">⚠️</div>
          <h3 className="font-bold text-gray-900 mb-1">โหลดรายการงานไม่สำเร็จ</h3>
          <p className="text-sm text-gray-600 mb-4">{loadError}</p>
          <button
            onClick={reload}
            className="px-4 py-2 bg-gray-900 text-white text-sm font-semibold rounded-xl hover:bg-gray-800 transition-colors"
          >
            ลองอีกครั้ง
          </button>
        </div>
      ) : visibleTasks.length === 0 ? (
        <div className="bg-white/80 rounded-2xl border border-amber-200 p-10 text-center">
          <div className="text-5xl mb-3">{isFiltered ? "🔍" : "🗒️"}</div>
          <h3 className="text-lg font-bold text-gray-800 mb-1">
            {isFiltered
              ? // Say the topic out loud: an empty FILTER must never be mistaken
                // for an empty board (the tasks are still there, just not here).
                view === "done"
                ? `ยังไม่มีงานที่เสร็จแล้วในหัวข้อ “${activeChip?.label}”`
                : `ไม่มีงานค้างในหัวข้อ “${activeChip?.label}”`
              : view === "done"
                ? "ยังไม่มีงานที่ทำเสร็จ"
                : "ยังไม่มีงานบนกระดาน"}
          </h3>
          <p className="text-sm text-gray-500 mb-5">
            {isFiltered
              ? "งานหัวข้ออื่นยังอยู่ครบ — การกรองเป็นแค่มุมมอง ไม่ได้ลบอะไรทิ้ง"
              : view === "done"
                ? "งานที่กด “เสร็จแล้ว” จะมาเก็บไว้ที่นี่ ไม่หายไปไหน"
                : "จดสิ่งที่ต้องทำเอง เช่น “โทรหาลูกค้า ก.” หรือ “ทำใบเสนอราคาให้ ข.” แล้วมันจะค้างอยู่จนกว่าคุณจะกดว่าเสร็จ"}
          </p>
          <div className="flex items-center justify-center gap-2 flex-wrap">
            {isFiltered && (
              <button
                onClick={() => setChipKey(ALL_CHIP_KEY)}
                className="px-5 py-2.5 bg-white border border-amber-300 text-gray-700 font-semibold rounded-xl hover:bg-amber-50 transition-all text-sm shadow-sm"
              >
                ← ดูทั้งหมด
              </button>
            )}
            {view === "pending" && (
              <button
                onClick={onCreateTask}
                className="px-5 py-2.5 bg-amber-500 text-white font-semibold rounded-xl hover:bg-amber-600 transition-all text-sm shadow-sm"
              >
                ✏️ {isFiltered ? "สร้างงานใหม่" : "สร้างงานแรก"}
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {visibleTasks.map((task) => {
            const topic = resolveTaskTopic(task, topics);
            const tone = toneOf(topic.color);
            const marker = dueMarkerOf(task.dueDate, today);
            const links = resolveTaskLinks(task.links, linkTargetIndex);
            const isBusy = busyTaskId === task.id;
            const isDone = task.status === "done";

            return (
              <article
                key={task.id}
                className={`relative flex flex-col rounded-2xl border p-4 shadow-sm transition-all hover:shadow-md ${tone.card} ${
                  isDone ? "opacity-75" : ""
                }`}
              >
                {/* Topic + "written by me" stamp */}
                <div className="flex items-start justify-between gap-2 mb-2">
                  <span
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold ${tone.pin}`}
                  >
                    <span aria-hidden>{topic.icon}</span>
                    {topic.name}
                    {!topic.isActive && topic.isKnown && (
                      <span className="font-semibold opacity-70">(ซ่อนอยู่)</span>
                    )}
                  </span>
                  <span className="shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold bg-white/80 text-gray-600 border border-white">
                    บันทึกเอง
                  </span>
                </div>

                {/* Overdue / due-today marker */}
                {!isDone && marker.isUrgent && (
                  <div
                    className={`inline-flex self-start items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold mb-2 ${
                      marker.tone === "overdue"
                        ? "bg-red-600 text-white"
                        : "bg-orange-500 text-white"
                    }`}
                  >
                    {marker.tone === "overdue" ? "⏰" : "📌"} {marker.label}
                  </div>
                )}

                <h4 className="font-bold text-gray-900 leading-snug mb-1 break-words">
                  {task.title}
                </h4>

                {task.detail && (
                  <p className="text-sm text-gray-600 whitespace-pre-wrap line-clamp-3 mb-2">
                    {task.detail}
                  </p>
                )}

                {/* Due date — always says something, never a blank or Invalid Date */}
                <p className="text-xs font-semibold text-gray-500 mb-2">
                  📅 กำหนด:{" "}
                  <span
                    className={
                      !isDone && marker.tone === "overdue"
                        ? "text-red-600"
                        : !isDone && marker.tone === "today"
                          ? "text-orange-600"
                          : "text-gray-700"
                    }
                  >
                    {marker.dateLabel}
                  </span>
                  {marker.dateLabel !== NO_DUE_DATE_LABEL && !isDone && marker.tone === "future" && (
                    <span className="text-gray-400 font-medium"> · {marker.label}</span>
                  )}
                </p>

                {isDone && task.completedAt && (
                  <p className="text-xs font-semibold text-green-700 mb-2">
                    ✅ ปิดงานเมื่อ {new Date(task.completedAt).toLocaleString("th-TH")}
                  </p>
                )}

                {/* Link chips */}
                {links.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {links.map((link) =>
                      link.isDead || !link.href ? (
                        <span
                          key={`${link.targetType}-${link.targetId}`}
                          title={`${link.typeLabel} นี้ถูกลบไปแล้ว`}
                          aria-disabled="true"
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold bg-white/60 text-gray-400 border border-gray-200 line-through decoration-gray-300 cursor-not-allowed"
                        >
                          <span aria-hidden>{link.icon}</span>
                          {link.label} ({DELETED_TARGET_LABEL})
                        </span>
                      ) : (
                        <Link
                          key={`${link.targetType}-${link.targetId}`}
                          href={link.href}
                          title={`เปิด${link.typeLabel}: ${link.label}`}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold bg-white text-gray-700 border border-gray-200 hover:border-gray-400 hover:bg-gray-50 transition-colors"
                        >
                          <span aria-hidden>{link.icon}</span>
                          {link.label}
                        </Link>
                      )
                    )}
                  </div>
                )}

                {/* Actions — note there is deliberately NO snooze button here */}
                <div className="mt-auto pt-2 flex gap-2">
                  {isDone ? (
                    <button
                      onClick={() => setStatus(task, "pending")}
                      disabled={isBusy}
                      className="flex-1 px-3 py-2 bg-white text-gray-700 text-sm font-semibold rounded-xl border border-gray-200 hover:bg-gray-50 transition-colors disabled:opacity-60"
                    >
                      ↩️ เปิดใหม่
                    </button>
                  ) : (
                    <button
                      onClick={() => setStatus(task, "done")}
                      disabled={isBusy}
                      className="flex-1 px-3 py-2 bg-emerald-600 text-white text-sm font-semibold rounded-xl hover:bg-emerald-700 transition-colors disabled:opacity-60"
                    >
                      ✓ เสร็จแล้ว
                    </button>
                  )}
                  <button
                    onClick={() => onEditTask(task)}
                    className="px-3 py-2 bg-white text-gray-700 text-sm font-semibold rounded-xl border border-gray-200 hover:bg-gray-50 transition-colors"
                    title={topic.isKnown ? "แก้ไขงาน" : "แก้ไขงาน / ย้ายไปหัวข้ออื่น"}
                  >
                    {topic.isKnown ? "✏️" : "✏️ ย้ายหัวข้อ"}
                  </button>
                  <button
                    onClick={() => setDeleteTarget(task)}
                    className="px-3 py-2 bg-white text-red-600 text-sm font-semibold rounded-xl border border-gray-200 hover:bg-red-50 transition-colors"
                    title="ลบงาน"
                  >
                    🗑️
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {deleteTarget && (
        <ConfirmDialog
          title="ยืนยันการลบงาน"
          message={`ต้องการลบงาน “${deleteTarget.title}” ออกจากกระดานหรือไม่?\nลิงก์ของงานนี้จะถูกลบไปด้วย แต่ลูกค้า/เครื่อง/ใบเสนอราคา/เอกสารที่ผูกไว้จะไม่ถูกแตะต้อง`}
          confirmText="ลบงาน"
          loadingText="กำลังลบ..."
          cancelText="ยกเลิก"
          loading={isDeleting}
          onConfirm={handleDelete}
          onCancel={() => (isDeleting ? undefined : setDeleteTarget(null))}
        />
      )}

      {localToast && <Toast message={localToast.message} type={localToast.type} />}
    </section>
  );
}

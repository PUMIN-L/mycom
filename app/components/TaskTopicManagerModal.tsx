"use client";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Spinner from "./Spinner";
import ConfirmDialog from "./ConfirmDialog";
import { TASK_TOPIC_COLORS } from "../lib/types";
import type { TaskTopic } from "../lib/types";

// Manage-topics modal for the manual task board on /crm/alerts.
// Spec: openspec/changes/add-crm-task-board (tasks.md §14).
//
// The board's headings are ROWS, not an enum — the owner adds his own over
// time. This modal is the only place they are created, renamed, re-emoji'd,
// recoloured, reordered, hidden and (rarely) deleted.
//
// Two rules drive the whole design and are stated to the admin on screen:
//   • Hiding a topic deletes NOTHING. `isActive = false` only takes it out of
//     the "new task" dropdown; every task already filed under it stays on the
//     board, keeps its badge and keeps counting towards the bell.
//   • A topic that any task still references CANNOT be deleted — `topicId` is
//     a soft link with no FK, so deleting would silently orphan that history.
//     The delete button is disabled with that explanation, and if the server
//     answers 400 anyway (another tab just filed work under it) its Thai
//     message is shown VERBATIM, because that message is the explanation.

// ── Colour tokens ───────────────────────────────────────────────────────────
// `task_topics.color` is a TOKEN ("blue", "amber", …), never CSS from the
// user. Tokens are mapped to a fixed, statically-written class set here so no
// value out of the DB is ever concatenated into a class or style attribute,
// and an unknown token simply renders neutral.

interface TopicColorStyle {
  /** Thai label of the colour, shown in the picker. */
  label: string;
  /** Solid swatch used in the colour picker. */
  swatch: string;
  /** Soft badge (topic pill) — background + text + border. */
  badge: string;
}

const TOPIC_COLOR_STYLES: Record<string, TopicColorStyle> = {
  blue: {
    label: "น้ำเงิน",
    swatch: "bg-blue-500",
    badge: "bg-blue-50 text-blue-700 border-blue-200",
  },
  amber: {
    label: "เหลืองอำพัน",
    swatch: "bg-amber-500",
    badge: "bg-amber-50 text-amber-700 border-amber-200",
  },
  green: {
    label: "เขียว",
    swatch: "bg-green-500",
    badge: "bg-green-50 text-green-700 border-green-200",
  },
  rose: {
    label: "ชมพูแดง",
    swatch: "bg-rose-500",
    badge: "bg-rose-50 text-rose-700 border-rose-200",
  },
  purple: {
    label: "ม่วง",
    swatch: "bg-purple-500",
    badge: "bg-purple-50 text-purple-700 border-purple-200",
  },
  teal: {
    label: "เขียวน้ำทะเล",
    swatch: "bg-teal-500",
    badge: "bg-teal-50 text-teal-700 border-teal-200",
  },
  slate: {
    label: "เทา",
    swatch: "bg-slate-500",
    badge: "bg-slate-100 text-slate-700 border-slate-200",
  },
};

const NEUTRAL_COLOR_STYLE: TopicColorStyle = {
  label: "เทา",
  swatch: "bg-gray-400",
  badge: "bg-gray-100 text-gray-600 border-gray-200",
};

/** Never throws and never trusts the DB string: an unrecognised token (data
 * edited outside the app) renders neutral instead of producing a broken or
 * user-controlled class. */
function colorStyle(token: string | undefined): TopicColorStyle {
  return (token && TOPIC_COLOR_STYLES[token]) || NEUTRAL_COLOR_STYLE;
}

const DEFAULT_COLOR: string = TASK_TOPIC_COLORS[0];
const DEFAULT_ICON = "📌";

/** Curated emoji for the picker. The admin picks one — he never types CSS, and
 * he does not have to hunt through the OS emoji panel for the common cases. */
const EMOJI_CHOICES = [
  "📞", "🚗", "📄", "🔧", "📌", "✅", "⏰", "📝",
  "📦", "💰", "🧾", "🛠️", "🧪", "🔬", "⚙️", "🚚",
  "🏢", "👤", "📅", "⭐", "❗", "🔔", "💬", "📊",
  "🖨️", "🧰", "🩺", "♻️", "🗂️", "📮", "🤝", "🚩",
];

/** Tasks are counted through the board listing, which the store caps. Past the
 * cap a topic could look empty when it is not — so a zero count from a capped
 * response is treated as "unknown" and the delete button stays enabled, with
 * the server's 400 as the real guard. */
const TASK_COUNT_FETCH_LIMIT = 500;

// ── Props ───────────────────────────────────────────────────────────────────

export interface TaskTopicManagerModalProps {
  /**
   * Close the modal. Called LAST, after any pending reorder has been flushed
   * and after the refresh callbacks below have fired, so the board never has
   * to reload the page to catch up (tasks.md 14.7).
   */
  onClose: () => void;
  /**
   * Fired with the full, freshly-ordered topic set — hidden topics INCLUDED —
   * after every successful change, and once more when the modal closes if
   * anything changed at all. Feed it straight into whatever state backs the
   * filter chips and the topic dropdown of the task form: the array is already
   * in `sortOrder` order, which is what makes a reorder show up in both places
   * (tasks.md 14.6).
   */
  onTopicsChanged?: (topics: TaskTopic[]) => void;
  /**
   * Plain "something changed, go refetch" ping (repo idiom, cf.
   * `EquipmentEditModal.onSaveSuccess`). Fired alongside `onTopicsChanged`.
   * Use it to re-pull the task list too: a rename or recolour changes what
   * every existing card displays, without any task row being rewritten.
   */
  onSaveSuccess?: () => void;
  /**
   * Optional seed so the list paints immediately when the board already holds
   * topics. It is refetched with `includeHidden=1` on open regardless, because
   * the board itself only ever loads the active ones.
   */
  initialTopics?: TaskTopic[];
  /**
   * Optional map of `topicId → number of tasks filed under it` (pending AND
   * done) that the board may already know. Used only to pre-disable the delete
   * button before this modal's own count fetch lands; the server stays the
   * authority.
   */
  taskCounts?: Record<number, number>;
}

// ── Component ───────────────────────────────────────────────────────────────

export default function TaskTopicManagerModal({
  onClose,
  onTopicsChanged,
  onSaveSuccess,
  initialTopics,
  taskCounts: initialTaskCounts,
}: TaskTopicManagerModalProps) {
  const [topics, setTopics] = useState<TaskTopic[]>(initialTopics ?? []);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  // topicId → task count. `null` until known; a topic missing from a known map
  // simply has no tasks.
  const [counts, setCounts] = useState<Record<number, number> | null>(
    initialTaskCounts ? { ...initialTaskCounts } : null
  );
  /** True when the count fetch hit the listing cap, i.e. a 0 means "unknown". */
  const [countsCapped, setCountsCapped] = useState(false);

  // Add form
  const [newName, setNewName] = useState("");
  const [newIcon, setNewIcon] = useState(DEFAULT_ICON);
  const [newColor, setNewColor] = useState(DEFAULT_COLOR);
  const [addError, setAddError] = useState("");
  const [adding, setAdding] = useState(false);

  // Row editing
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editIcon, setEditIcon] = useState(DEFAULT_ICON);
  const [editColor, setEditColor] = useState(DEFAULT_COLOR);
  const [editError, setEditError] = useState("");

  // Per-row async state and per-row server messages (the delete 400 lands here
  // and is rendered exactly as the server wrote it).
  const [busyId, setBusyId] = useState<number | null>(null);
  const [rowError, setRowError] = useState<{ id: number; message: string } | null>(null);

  // Reorder is staged locally and written in ONE PATCH for the whole set.
  const [orderDirty, setOrderDirty] = useState(false);
  const [savingOrder, setSavingOrder] = useState(false);
  const [orderError, setOrderError] = useState("");

  const [confirmDelete, setConfirmDelete] = useState<TaskTopic | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [closing, setClosing] = useState(false);

  // Whether anything at all was written, so closing knows if the board needs a
  // refresh. A ref (not state) because the close handler reads it after awaits.
  const changedRef = useRef(false);
  // Mirrors `topics` so the async handlers (which read it after an await) never
  // work from a stale closure. Handlers keep it in step themselves; this effect
  // is the safety net for any other path that sets state.
  const topicsRef = useRef<TaskTopic[]>(topics);
  useEffect(() => {
    topicsRef.current = topics;
  }, [topics]);

  const markChanged = useCallback(
    (next: TaskTopic[]) => {
      changedRef.current = true;
      setTopics(next);
      topicsRef.current = next;
      onTopicsChanged?.(next);
      onSaveSuccess?.();
    },
    [onTopicsChanged, onSaveSuccess]
  );

  /** Reads `{ error }` from a failed response and returns it VERBATIM — these
   * messages are written in Thai for the admin and explain the actual reason
   * (e.g. "หัวข้อนี้มีงานอยู่ ไม่สามารถลบได้ กรุณาซ่อนแทน"). A generic
   * "เกิดข้อผิดพลาด" would throw that explanation away. */
  const readError = useCallback(async (res: Response, fallback: string): Promise<string> => {
    try {
      const data = await res.json();
      const message = typeof data?.error === "string" ? data.error.trim() : "";
      return message || fallback;
    } catch {
      return fallback;
    }
  }, []);

  // ── Loading ───────────────────────────────────────────────────────────────

  const loadTopics = useCallback(async () => {
    // includeHidden=1: this modal is the one screen that must show hidden
    // topics, otherwise they could never be brought back.
    const res = await fetch("/api/admin/task-topics?includeHidden=1");
    if (!res.ok) throw new Error(await readError(res, "โหลดหัวข้องานไม่สำเร็จ"));
    const data = await res.json();
    return Array.isArray(data) ? (data as TaskTopic[]) : [];
  }, [readError]);

  const loadCounts = useCallback(async () => {
    // The topics endpoint carries no counts, so the board listing is used to
    // work out which topics are still in use (pending AND done).
    const res = await fetch(`/api/admin/tasks?limit=${TASK_COUNT_FETCH_LIMIT}`);
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data)) return null;
    const map: Record<number, number> = {};
    for (const task of data) {
      const id = Number(task?.topicId);
      if (Number.isInteger(id)) map[id] = (map[id] ?? 0) + 1;
    }
    return { map, capped: data.length >= TASK_COUNT_FETCH_LIMIT };
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setLoadError("");
      try {
        const list = await loadTopics();
        if (!alive) return;
        setTopics(list);
        topicsRef.current = list;
      } catch (error) {
        if (alive) setLoadError(error instanceof Error ? error.message : "โหลดหัวข้องานไม่สำเร็จ");
      } finally {
        if (alive) setLoading(false);
      }
      // Counts are a nice-to-have: a failure only means the delete button
      // relies on the server's 400 instead of being pre-disabled.
      try {
        const result = await loadCounts();
        if (alive && result) {
          setCounts(result.map);
          setCountsCapped(result.capped);
        }
      } catch {
        /* ignore — server guard still applies */
      }
    })();
    return () => {
      alive = false;
    };
  }, [loadTopics, loadCounts]);

  // ── Reorder ───────────────────────────────────────────────────────────────

  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= topics.length) return;
    const next = [...topics];
    [next[index], next[target]] = [next[target], next[index]];
    setTopics(next);
    topicsRef.current = next;
    setOrderDirty(true);
    setOrderError("");
  };

  /** ONE PATCH with the whole ordered id set — never one call per row. The
   * store rewrites every `sortOrder` in a single transaction, so the order the
   * admin sees here is exactly the order the chips and the form dropdown get. */
  const saveOrder = useCallback(async (): Promise<boolean> => {
    const ids = topicsRef.current.map((topic) => topic.id);
    if (ids.length === 0) return true;
    setSavingOrder(true);
    setOrderError("");
    try {
      const res = await fetch("/api/admin/task-topics/reorder", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      if (!res.ok) {
        setOrderError(await readError(res, "จัดลำดับหัวข้องานไม่สำเร็จ"));
        return false;
      }
      const data = await res.json();
      const next: TaskTopic[] = Array.isArray(data?.topics)
        ? data.topics
        : await loadTopics().catch(() => topicsRef.current);
      setOrderDirty(false);
      markChanged(next);
      return true;
    } catch {
      setOrderError("จัดลำดับหัวข้องานไม่สำเร็จ");
      return false;
    } finally {
      setSavingOrder(false);
    }
  }, [readError, loadTopics, markChanged]);

  // ── Close ─────────────────────────────────────────────────────────────────

  /** Flushes an unsaved reorder first — closing must never silently drop the
   * order the admin just arranged — then hands the fresh set to the board so
   * the chips, the dropdown and the cards refresh without a page reload. */
  const requestClose = useCallback(async () => {
    if (closing || adding || deleting || busyId !== null || confirmDelete) return;
    setClosing(true);
    try {
      if (orderDirty) {
        const ok = await saveOrder();
        if (!ok) {
          // Keep the modal open so the failure (and the arranged order) is not
          // lost behind a closed dialog.
          setClosing(false);
          return;
        }
      }
      if (changedRef.current) {
        onTopicsChanged?.(topicsRef.current);
        onSaveSuccess?.();
      }
      onClose();
    } finally {
      setClosing(false);
    }
  }, [
    closing,
    adding,
    deleting,
    busyId,
    confirmDelete,
    orderDirty,
    saveOrder,
    onTopicsChanged,
    onSaveSuccess,
    onClose,
  ]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      // Escape dismisses the delete confirmation first, never the whole modal
      // out from under it.
      if (confirmDelete) {
        if (!deleting) setConfirmDelete(null);
        return;
      }
      void requestClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [requestClose, confirmDelete, deleting]);

  // ── Mutations ─────────────────────────────────────────────────────────────

  const handleAdd = async (event: React.FormEvent) => {
    event.preventDefault();
    if (adding) return;
    const name = newName.trim();
    if (!name) {
      setAddError("กรุณาระบุชื่อหัวข้อ");
      return;
    }
    setAdding(true);
    setAddError("");
    try {
      const res = await fetch("/api/admin/task-topics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, icon: newIcon, color: newColor }),
      });
      if (!res.ok) {
        setAddError(await readError(res, "บันทึกหัวข้องานไม่สำเร็จ"));
        return;
      }
      const created: TaskTopic = await res.json();
      markChanged([...topicsRef.current, created]);
      setNewName("");
      setNewIcon(DEFAULT_ICON);
      setNewColor(DEFAULT_COLOR);
    } catch {
      setAddError("บันทึกหัวข้องานไม่สำเร็จ");
    } finally {
      setAdding(false);
    }
  };

  const startEdit = (topic: TaskTopic) => {
    setEditingId(topic.id);
    setEditName(topic.name);
    setEditIcon(topic.icon || DEFAULT_ICON);
    setEditColor(TOPIC_COLOR_STYLES[topic.color] ? topic.color : DEFAULT_COLOR);
    setEditError("");
    setRowError(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditError("");
  };

  /** Renaming / recolouring touches `task_topics` only. Every task keeps its
   * `topicId`, so all of them — open and closed — show the new heading at once
   * without a single task row being rewritten. */
  const saveEdit = async (topic: TaskTopic) => {
    if (busyId !== null) return;
    const name = editName.trim();
    if (!name) {
      setEditError("กรุณาระบุชื่อหัวข้อ");
      return;
    }
    setBusyId(topic.id);
    setEditError("");
    try {
      const res = await fetch(`/api/admin/task-topics/${topic.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, icon: editIcon, color: editColor }),
      });
      if (!res.ok) {
        setEditError(await readError(res, "อัปเดตหัวข้องานไม่สำเร็จ"));
        return;
      }
      const updated: TaskTopic = await res.json();
      markChanged(
        topicsRef.current.map((row) => (row.id === topic.id ? { ...row, ...updated } : row))
      );
      setEditingId(null);
    } catch {
      setEditError("อัปเดตหัวข้องานไม่สำเร็จ");
    } finally {
      setBusyId(null);
    }
  };

  /** Hide / un-hide. A flag flip and nothing else: no task is deleted, moved
   * or reassigned — see the standing note rendered above the list. */
  const toggleActive = async (topic: TaskTopic) => {
    if (busyId !== null) return;
    setBusyId(topic.id);
    setRowError(null);
    try {
      const res = await fetch(`/api/admin/task-topics/${topic.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !topic.isActive }),
      });
      if (!res.ok) {
        setRowError({
          id: topic.id,
          message: await readError(res, "อัปเดตหัวข้องานไม่สำเร็จ"),
        });
        return;
      }
      const updated: TaskTopic = await res.json();
      markChanged(
        topicsRef.current.map((row) => (row.id === topic.id ? { ...row, ...updated } : row))
      );
    } catch {
      setRowError({ id: topic.id, message: "อัปเดตหัวข้องานไม่สำเร็จ" });
    } finally {
      setBusyId(null);
    }
  };

  /** Only ever reached for a topic with no tasks. If the server still says 400
   * — another tab filed work under it a second ago — its message is shown as
   * written, because that message is the reason. */
  const handleDelete = async () => {
    const topic = confirmDelete;
    if (!topic || deleting) return;
    setDeleting(true);
    setRowError(null);
    try {
      const res = await fetch(`/api/admin/task-topics/${topic.id}`, { method: "DELETE" });
      if (!res.ok) {
        setRowError({
          id: topic.id,
          message: await readError(res, "ลบหัวข้องานไม่สำเร็จ"),
        });
        setConfirmDelete(null);
        // The topic is still there, and it now demonstrably has tasks: refresh
        // the counts so the button locks itself the way it should have.
        try {
          const result = await loadCounts();
          if (result) {
            setCounts(result.map);
            setCountsCapped(result.capped);
          }
        } catch {
          /* ignore */
        }
        return;
      }
      markChanged(topicsRef.current.filter((row) => row.id !== topic.id));
      setConfirmDelete(null);
      if (editingId === topic.id) setEditingId(null);
    } catch {
      setRowError({ id: topic.id, message: "ลบหัวข้องานไม่สำเร็จ" });
      setConfirmDelete(null);
    } finally {
      setDeleting(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  const busy = adding || deleting || savingOrder || busyId !== null || closing;

  const countFor = (topicId: number): number | null => {
    if (!counts) return null;
    const value = counts[topicId] ?? 0;
    // Under a capped listing a 0 proves nothing.
    if (value === 0 && countsCapped) return null;
    return value;
  };

  const previewColor = colorStyle(newColor);
  const newNameTrimmed = newName.trim();

  const listBody = useMemo(() => {
    if (loading) {
      return (
        <div className="flex items-center justify-center gap-2 py-10 text-gray-500">
          <Spinner className="h-5 w-5 text-gray-400" />
          กำลังโหลดหัวข้อ...
        </div>
      );
    }
    if (loadError) {
      return (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {loadError}
        </p>
      );
    }
    if (topics.length === 0) {
      return (
        <p className="rounded-xl border border-dashed border-gray-200 px-4 py-8 text-center text-sm text-gray-500">
          ยังไม่มีหัวข้องาน — เพิ่มหัวข้อแรกได้จากช่องด้านบน
        </p>
      );
    }
    return null;
  }, [loading, loadError, topics.length]);

  return (
    <div
      className="fixed inset-0 z-200 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
      onClick={() => void requestClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="จัดการหัวข้องาน"
        className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 p-6">
          <div>
            <h3 className="text-xl font-bold text-gray-800">จัดการหัวข้องาน</h3>
            <p className="mt-0.5 text-xs text-gray-500">
              หัวข้อของกระดานงานที่คุณจดเอง — เพิ่ม แก้ชื่อ เปลี่ยนอีโมจิ/สี และจัดลำดับได้
            </p>
          </div>
          <button
            type="button"
            onClick={() => void requestClose()}
            disabled={busy}
            aria-label="ปิด"
            className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto p-6">
          {/* Add form */}
          <form
            onSubmit={handleAdd}
            className="space-y-3 rounded-2xl border border-gray-200 bg-gray-50/70 p-4"
          >
            <p className="text-sm font-semibold text-gray-700">เพิ่มหัวข้อใหม่</p>
            <div className="flex flex-wrap items-start gap-3">
              <div className="min-w-48 flex-1">
                <label className="mb-1.5 block text-xs font-semibold text-gray-600">
                  ชื่อหัวข้อ <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={newName}
                  onChange={(event) => {
                    setNewName(event.target.value);
                    if (addError) setAddError("");
                  }}
                  maxLength={255}
                  placeholder="เช่น รอเอกสารจากลูกค้า"
                  className="w-full rounded-xl border border-gray-200 bg-white px-4 py-2.5 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>
              <div className="w-40">
                <label className="mb-1.5 block text-xs font-semibold text-gray-600">
                  ตัวอย่าง
                </label>
                <span
                  className={`inline-flex max-w-full items-center gap-1.5 truncate rounded-full border px-3 py-1.5 text-sm font-semibold ${previewColor.badge}`}
                >
                  <span>{newIcon || DEFAULT_ICON}</span>
                  <span className="truncate">{newNameTrimmed || "ชื่อหัวข้อ"}</span>
                </span>
              </div>
            </div>

            <EmojiField label="อีโมจิ" value={newIcon} onChange={setNewIcon} idSuffix="new" />
            <ColorField value={newColor} onChange={setNewColor} idSuffix="new" />

            {addError && <p className="text-xs font-medium text-red-600">{addError}</p>}

            <button
              type="submit"
              disabled={adding || !newNameTrimmed}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50"
            >
              {adding && <Spinner className="h-4 w-4 text-white" />}
              {adding ? "กำลังเพิ่ม..." : "เพิ่มหัวข้อ"}
            </button>
          </form>

          {/* Standing explanation: hiding is not deleting. */}
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-800">
            <span className="font-semibold">การซ่อนหัวข้อไม่ได้ลบงานที่อยู่ข้างใต้</span> — งานทุกใบ
            (ทั้งที่ยังค้างและที่ปิดไปแล้ว) ยังอยู่ครบบนกระดาน ยังเห็นชื่อหัวข้อเดิม และยังถูกนับในกระดิ่งตามปกติ
            หัวข้อที่ซ่อนแค่หายไปจากช่อง &quot;หัวข้อ&quot; ตอนสร้างงานใหม่เท่านั้น
            และกดเอากลับมาแสดงได้ทุกเมื่อ
          </div>

          {/* Topic list */}
          {listBody}

          {!loading && !loadError && topics.length > 0 && (
            <ul className="space-y-2">
              {topics.map((topic, index) => {
                const style = colorStyle(topic.color);
                const isEditing = editingId === topic.id;
                const rowBusy = busyId === topic.id;
                const count = countFor(topic.id);
                const inUse = count !== null && count > 0;
                const error = rowError?.id === topic.id ? rowError.message : "";

                return (
                  <li
                    key={topic.id}
                    className={`rounded-2xl border p-3 transition ${
                      topic.isActive ? "border-gray-200 bg-white" : "border-gray-200 bg-gray-50"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      {/* Order controls */}
                      <div className="flex flex-col gap-1 pt-0.5">
                        <button
                          type="button"
                          onClick={() => move(index, -1)}
                          disabled={index === 0 || busy}
                          aria-label={`เลื่อน ${topic.name} ขึ้น`}
                          className="rounded-lg border border-gray-200 px-2 py-0.5 text-xs text-gray-500 transition hover:bg-gray-100 disabled:opacity-30"
                        >
                          ▲
                        </button>
                        <button
                          type="button"
                          onClick={() => move(index, 1)}
                          disabled={index === topics.length - 1 || busy}
                          aria-label={`เลื่อน ${topic.name} ลง`}
                          className="rounded-lg border border-gray-200 px-2 py-0.5 text-xs text-gray-500 transition hover:bg-gray-100 disabled:opacity-30"
                        >
                          ▼
                        </button>
                      </div>

                      <div className="min-w-0 flex-1">
                        {isEditing ? (
                          <div className="space-y-3">
                            <input
                              type="text"
                              value={editName}
                              onChange={(event) => {
                                setEditName(event.target.value);
                                if (editError) setEditError("");
                              }}
                              maxLength={255}
                              className="w-full rounded-xl border border-gray-200 px-4 py-2 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                              placeholder="ชื่อหัวข้อ"
                            />
                            <EmojiField
                              label="อีโมจิ"
                              value={editIcon}
                              onChange={setEditIcon}
                              idSuffix={`edit-${topic.id}`}
                            />
                            <ColorField
                              value={editColor}
                              onChange={setEditColor}
                              idSuffix={`edit-${topic.id}`}
                            />
                            {editError && (
                              <p className="text-xs font-medium text-red-600">{editError}</p>
                            )}
                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={() => void saveEdit(topic)}
                                disabled={rowBusy}
                                className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50"
                              >
                                {rowBusy && <Spinner className="h-4 w-4 text-white" />}
                                {rowBusy ? "กำลังบันทึก..." : "บันทึก"}
                              </button>
                              <button
                                type="button"
                                onClick={cancelEdit}
                                disabled={rowBusy}
                                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-600 transition hover:bg-gray-50 disabled:opacity-50"
                              >
                                ยกเลิก
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-semibold ${style.badge} ${
                                topic.isActive ? "" : "opacity-60"
                              }`}
                            >
                              <span>{topic.icon || DEFAULT_ICON}</span>
                              <span className="max-w-[16rem] truncate">{topic.name}</span>
                            </span>
                            {!topic.isActive && (
                              <span className="rounded-full bg-gray-200 px-2 py-0.5 text-[11px] font-semibold text-gray-600">
                                ซ่อนอยู่
                              </span>
                            )}
                            <span className="text-xs text-gray-500">
                              {count === null
                                ? "ยังไม่ทราบจำนวนงาน (ระบบจะตรวจอีกครั้งตอนกดลบ)"
                                : count > 0
                                  ? `มีงานอยู่ ${count} ใบ`
                                  : "ยังไม่มีงานในหัวข้อนี้"}
                            </span>
                          </div>
                        )}

                        {!isEditing && (
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={() => startEdit(topic)}
                              disabled={busy}
                              className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-700 transition hover:bg-gray-50 disabled:opacity-50"
                            >
                              แก้ไข
                            </button>
                            <button
                              type="button"
                              onClick={() => void toggleActive(topic)}
                              disabled={busy}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-700 transition hover:bg-gray-50 disabled:opacity-50"
                            >
                              {rowBusy && <Spinner className="h-3 w-3 text-gray-500" />}
                              {topic.isActive ? "ซ่อนหัวข้อ" : "เอากลับมาแสดง"}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setRowError(null);
                                setConfirmDelete(topic);
                              }}
                              disabled={busy || inUse}
                              title={
                                inUse
                                  ? "หัวข้อนี้มีงานอยู่ ลบไม่ได้ — ให้กด “ซ่อนหัวข้อ” แทน งานเดิมจะยังอยู่ครบ"
                                  : undefined
                              }
                              className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              ลบหัวข้อ
                            </button>
                            {inUse && (
                              <span className="text-[11px] text-gray-500">
                                ลบไม่ได้เพราะมีงาน {count} ใบอยู่ใต้หัวข้อนี้ — ให้กด
                                &quot;ซ่อนหัวข้อ&quot; แทน แล้วงานเดิมจะยังอยู่ครบ
                              </span>
                            )}
                          </div>
                        )}

                        {/* Server-written explanation, shown exactly as sent. */}
                        {error && (
                          <p className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
                            {error}
                          </p>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 bg-white p-4">
          <div className="min-w-0 text-xs">
            {orderError ? (
              <span className="font-medium text-red-600">{orderError}</span>
            ) : orderDirty ? (
              <span className="text-amber-700">ลำดับที่จัดใหม่ยังไม่ได้บันทึก</span>
            ) : (
              <span className="text-gray-500">
                ลำดับนี้จะใช้ทั้งในแถบตัวกรองและช่องเลือกหัวข้อของฟอร์มงาน
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void saveOrder()}
              disabled={!orderDirty || savingOrder || busy}
              className="inline-flex items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm font-semibold text-indigo-700 transition hover:bg-indigo-100 disabled:opacity-40"
            >
              {savingOrder && <Spinner className="h-4 w-4 text-indigo-600" />}
              {savingOrder ? "กำลังบันทึกลำดับ..." : "บันทึกลำดับ"}
            </button>
            <button
              type="button"
              onClick={() => void requestClose()}
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-xl bg-gray-800 px-5 py-2 text-sm font-semibold text-white transition hover:bg-gray-900 disabled:opacity-50"
            >
              {closing && <Spinner className="h-4 w-4 text-white" />}
              เสร็จสิ้น
            </button>
          </div>
        </div>
      </div>

      {/* The confirm dialog renders inside this backdrop, so its clicks must be
          stopped here or they would bubble up and close the whole modal. */}
      {confirmDelete && (
        <div onClick={(event) => event.stopPropagation()}>
          <ConfirmDialog
          title="ยืนยันการลบหัวข้อ"
          message={`ลบหัวข้อ "${confirmDelete.name}" ใช่หรือไม่?\n\nหัวข้อนี้ยังไม่มีงานอยู่ข้างใต้ จึงลบได้โดยไม่มีงานใดหายไป\nถ้าอยากเก็บงานเดิมไว้แต่ไม่อยากใช้หัวข้อนี้แล้ว ให้กด "ซ่อนหัวข้อ" แทน`}
          confirmText="ลบหัวข้อ"
          loadingText="กำลังลบ..."
          onConfirm={() => void handleDelete()}
            onCancel={() => setConfirmDelete(null)}
            loading={deleting}
          />
        </div>
      )}
    </div>
  );
}

// ── Sub-fields ──────────────────────────────────────────────────────────────

/** Emoji chooser. Inline (not an absolutely-positioned popover) so it can
 * never be clipped by the modal's own scroll container.
 *
 * The grid is a shortcut, not a ceiling: the free field below it takes any
 * emoji from the OS keyboard. It is an ICON, never a colour — the colour is
 * always a token from the fixed list (see ColorField), so nothing typed here
 * can reach a class or a style attribute. The store sanitizes it and trims to
 * 8 code points. */
function EmojiField({
  label,
  value,
  onChange,
  idSuffix,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  idSuffix: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <span className="mb-1.5 block text-xs font-semibold text-gray-600">{label}</span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          aria-expanded={open}
          aria-controls={`emoji-panel-${idSuffix}`}
          className="flex h-10 w-12 items-center justify-center rounded-xl border border-gray-200 bg-white text-xl transition hover:bg-gray-50"
        >
          {value || DEFAULT_ICON}
        </button>
        <span className="text-xs text-gray-500">
          {open ? "เลือกอีโมจิด้านล่าง" : "กดเพื่อเลือกอีโมจิ"}
        </span>
      </div>
      {open && (
        <div
          id={`emoji-panel-${idSuffix}`}
          className="mt-2 rounded-xl border border-gray-200 bg-white p-2"
        >
          <div className="grid max-h-40 grid-cols-8 gap-1 overflow-y-auto">
            {EMOJI_CHOICES.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => {
                  onChange(emoji);
                  setOpen(false);
                }}
                aria-label={`ใช้อีโมจิ ${emoji}`}
                aria-pressed={value === emoji}
                className={`flex h-9 items-center justify-center rounded-lg text-lg transition hover:bg-gray-100 ${
                  value === emoji ? "bg-indigo-50 ring-2 ring-indigo-400" : ""
                }`}
              >
                {emoji}
              </button>
            ))}
          </div>
          <div className="mt-2 border-t border-gray-100 pt-2">
            <label
              htmlFor={`emoji-custom-${idSuffix}`}
              className="mb-1 block text-[11px] font-semibold text-gray-500"
            >
              หรือพิมพ์/วางอีโมจิเอง
            </label>
            <input
              id={`emoji-custom-${idSuffix}`}
              type="text"
              value={value}
              onChange={(event) => onChange([...event.target.value].slice(0, 8).join(""))}
              placeholder={DEFAULT_ICON}
              className="w-24 rounded-lg border border-gray-200 px-3 py-1.5 text-lg focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            />
          </div>
        </div>
      )}
    </div>
  );
}

/** Colour chooser, restricted to the fixed token set. There is deliberately no
 * free-text field: a colour outside the token list is rejected by the store
 * with a 400, and nothing the admin types may ever reach a class or style. */
function ColorField({
  value,
  onChange,
  idSuffix,
}: {
  value: string;
  onChange: (value: string) => void;
  idSuffix: string;
}) {
  return (
    <div>
      <span className="mb-1.5 block text-xs font-semibold text-gray-600">สีของหัวข้อ</span>
      <div className="flex flex-wrap gap-2">
        {TASK_TOPIC_COLORS.map((token) => {
          const style = colorStyle(token);
          const selected = value === token;
          return (
            <button
              key={`${idSuffix}-${token}`}
              type="button"
              onClick={() => onChange(token)}
              aria-label={`สี${style.label}`}
              aria-pressed={selected}
              title={style.label}
              className={`h-8 w-8 rounded-full ${style.swatch} transition ${
                selected
                  ? "ring-2 ring-gray-800 ring-offset-2"
                  : "opacity-70 hover:opacity-100"
              }`}
            />
          );
        })}
      </div>
    </div>
  );
}

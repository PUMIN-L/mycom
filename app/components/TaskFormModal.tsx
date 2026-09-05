"use client";

/**
 * TaskFormModal — the create/edit form for one post-it on the manual task board
 * (`/crm/alerts`), including its link picker. Tasks 12.1-12.11.
 *
 * Fields: หัวข้อ (required), ชื่องาน (required), รายละเอียด (optional),
 * กำหนดวัน (OPTIONAL — a task with no deadline is a perfectly normal post-it,
 * so the date has an explicit "ล้างวันที่" button that puts it back to having
 * none) and ลิงก์ (optional, any number, across all four kinds).
 *
 * The link picker is two steps: pick one of the four target kinds, then pick
 * the record with a SearchableDropdown (never a native <select> — AGENTS.md).
 * It reuses the EXISTING list endpoints through the shared loader in
 * `TaskLinkChips` (`/api/customers`, `/api/admin/equipments`, `/api/quotations`,
 * `/api/documents`) — this feature adds no search endpoints of its own, and the
 * loader keeps it to one request per kind for the whole page.
 *
 * What gets stored for a link:
 *   • `targetId` is always the STABLE id — `customers.id`,
 *     `customer_equipments.id`, `quotations.id` (NEVER `docNo`, which the admin
 *     can edit and which is rewritten when a quotation is cloned) and
 *     `documents.id`.
 *   • `label` is a SNAPSHOT of the exact text the row showed in the list at
 *     pick time. It is what keeps a chip readable after the target is deleted
 *     or purged, so it is captured here and sent in the payload.
 * Picking the same target twice adds nothing (deduped in-form; the table's
 * PRIMARY KEY (taskId, targetType, targetId) is the second line of defence).
 *
 * Failure behaviour that matters (task 12.10): the target directories are
 * OPTIONAL to the form. If they fail to load, the form says so, offers
 * "ลองใหม่" next to that one picker, and still saves a task with no links —
 * it never hangs and never blocks on them.
 *
 * Props
 * -----
 *   task          the task being edited, with its `links`. Omit / null to
 *                 create. Edit mode pre-fills every field, links included, and
 *                 each link can be removed one at a time.
 *   topics        the ACTIVE topics, already in board order — the dropdown
 *                 shows them in the given order. When the task being edited
 *                 sits under a topic that is hidden or gone, that topic is
 *                 appended as an extra option so the field is never blank and
 *                 the task can be saved without being forced to move.
 *   defaultTopicId  pre-selected topic for a new task (e.g. the topic filter
 *                 the board currently has open). Ignored in edit mode.
 *   onClose       close without saving. Also fired by Escape and by the
 *                 backdrop — both are ignored while a save is in flight.
 *   onSaved(task) the API answered. THE PARENT closes the modal (and shows the
 *                 toast, refreshes the board and makes sure the saved task is
 *                 visible under the current filter — task 11.14). This
 *                 component stays disabled after a success so a second submit
 *                 cannot slip in before the parent unmounts it.
 *
 * Double-submit (task 12.11): the save button is disabled from the moment the
 * request starts, and an in-flight ref rejects re-entry even if a click sneaks
 * past — one click, one task.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DatePicker from "./DatePicker";
import SearchableDropdown from "./SearchableDropdown";
import type { SearchableDropdownOption } from "./SearchableDropdown";
import Spinner from "./Spinner";
import TaskLinkChips, {
  TASK_LINK_KIND_META,
  reloadTaskLinkTargets,
  useTaskLinkTargets,
} from "./TaskLinkChips";
import { TASK_LINK_TARGETS, type CrmTask, type TaskLink, type TaskLinkTarget, type TaskTopic } from "../lib/types";
import { toLocalDateString } from "../lib/dateFormat";

export interface TaskFormModalProps {
  task?: CrmTask | null;
  topics: TaskTopic[];
  defaultTopicId?: number | null;
  onClose: () => void;
  onSaved: (task: CrmTask) => void;
}

/** What the payload carries per link — the store's `TaskLinkInput`. */
interface TaskLinkPayload {
  targetType: TaskLinkTarget;
  targetId: string;
  label: string;
}

const MAX_TITLE = 255;
const MAX_DETAIL = 5000;

/** "YYYY-MM-DD" → a LOCAL Date, so the picker cannot shift the day by a
 * timezone offset the way `new Date("2026-01-01")` (UTC midnight) does. */
function parseDateValue(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? "").trim());
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Reads the Thai message out of a route's `{ error }` body; falls back to a
 * generic one so the admin never sees a bare status code. */
async function readApiError(res: Response, fallback: string): Promise<string> {
  try {
    const body = await res.json();
    const message = typeof body?.error === "string" ? body.error.trim() : "";
    return message || fallback;
  } catch {
    return fallback;
  }
}

export default function TaskFormModal({
  task,
  topics,
  defaultTopicId,
  onClose,
  onSaved,
}: TaskFormModalProps) {
  const isEdit = Boolean(task?.id);

  const [topicId, setTopicId] = useState<string>(() => {
    if (task?.topicId) return String(task.topicId);
    if (defaultTopicId) return String(defaultTopicId);
    return topics.length === 1 ? String(topics[0].id) : "";
  });
  const [title, setTitle] = useState<string>(task?.title ?? "");
  const [detail, setDetail] = useState<string>(task?.detail ?? "");
  const [dueDate, setDueDate] = useState<string>(task?.dueDate ?? "");
  const [links, setLinks] = useState<TaskLinkPayload[]>(() =>
    (task?.links ?? [])
      .filter((link) => (TASK_LINK_TARGETS as readonly string[]).includes(link?.targetType))
      .map((link) => ({
        targetType: link.targetType,
        targetId: String(link.targetId ?? ""),
        label: String(link.label ?? ""),
      }))
      .filter((link) => link.targetId !== "")
  );

  const [pickerKind, setPickerKind] = useState<TaskLinkTarget>("customer");
  const [pickerNote, setPickerNote] = useState<string>("");
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string>("");
  const savingRef = useRef(false);

  // Only the kinds actually in play are fetched: the kind whose picker is open,
  // plus the kinds of the links already on the task (so their chips can resolve
  // to current names). One request per kind, page-wide.
  const neededKinds = useMemo(() => {
    const wanted = new Set<TaskLinkTarget>([pickerKind]);
    for (const link of links) wanted.add(link.targetType);
    return TASK_LINK_TARGETS.filter((kind) => wanted.has(kind));
  }, [pickerKind, links]);
  const targets = useTaskLinkTargets(neededKinds);
  const kindState = targets[pickerKind];

  // Escape closes, exactly like clicking the backdrop — but never mid-save.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !savingRef.current) onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  // ── Topic options ─────────────────────────────────────────────────────────

  const topicOptions: SearchableDropdownOption[] = useMemo(() => {
    const options: SearchableDropdownOption[] = topics.map((topic) => ({
      value: String(topic.id),
      label: `${topic.icon ? `${topic.icon} ` : ""}${topic.name}`.trim(),
    }));
    // The task being edited may sit under a topic that has since been hidden
    // (or deleted). Keep it selectable so the form is never blank and the admin
    // is never forced to re-file the task just to fix a typo.
    const orphanTopic =
      task?.topicId && !options.some((o) => o.value === String(task.topicId))
        ? [
            {
              value: String(task.topicId),
              label: `${task.topicIcon ? `${task.topicIcon} ` : ""}${
                task.topicName || "ไม่ระบุหัวข้อ"
              }`.trim(),
              subLabel: "หัวข้อนี้ถูกซ่อนหรือถูกลบไปแล้ว",
            },
          ]
        : [];
    return [...options, ...orphanTopic];
    // `task` whole, not its three fields: the React Compiler infers the object
    // itself and refuses to keep a narrower manual dependency list.
  }, [topics, task]);

  // ── Link picker ───────────────────────────────────────────────────────────

  const kindOptions: SearchableDropdownOption[] = useMemo(
    () =>
      TASK_LINK_TARGETS.map((kind) => ({
        value: kind,
        label: `${TASK_LINK_KIND_META[kind].icon} ${TASK_LINK_KIND_META[kind].pickerLabel}`,
      })),
    []
  );

  const pickedIds = useMemo(
    () => new Set(links.map((link) => `${link.targetType}:${link.targetId}`)),
    [links]
  );

  const targetOptions: SearchableDropdownOption[] = useMemo(
    () =>
      kindState.options.map((option) => {
        const already = pickedIds.has(`${pickerKind}:${option.id}`);
        return {
          value: option.id,
          label: option.label || `#${option.id}`,
          subLabel: already ? "ผูกไว้กับงานนี้แล้ว" : option.subLabel,
          disabled: already,
        };
      }),
    [kindState.options, pickedIds, pickerKind]
  );

  /**
   * Add the picked record. The label snapshot is taken RIGHT HERE, from the
   * text the list is showing at this moment (task 12.7) — not looked up again
   * at save time, when the row could already read differently.
   */
  const addLink = useCallback(
    (targetId: string) => {
      const id = String(targetId ?? "").trim();
      if (!id) return;
      const option = kindState.byId.get(id);
      const label = (option?.label ?? "").trim();
      // The duplicate check reads `links` here rather than inside the updater:
      // a `setState` updater must stay pure (React may run it twice), so it is
      // no place to also set the note.
      const duplicate = links.some(
        (link) => link.targetType === pickerKind && link.targetId === id
      );
      if (duplicate) {
        setPickerNote(`"${label || id}" ถูกผูกไว้กับงานนี้แล้ว`);
        return;
      }
      setPickerNote("");
      setLinks((prev) =>
        prev.some((link) => link.targetType === pickerKind && link.targetId === id)
          ? prev
          : [...prev, { targetType: pickerKind, targetId: id, label }]
      );
    },
    [kindState.byId, links, pickerKind]
  );

  const removeLink = useCallback((link: Pick<TaskLink, "targetType" | "targetId">) => {
    setPickerNote("");
    setLinks((prev) =>
      prev.filter(
        (item) => !(item.targetType === link.targetType && item.targetId === link.targetId)
      )
    );
  }, []);

  /** The picked links, shaped as `TaskLink` rows so the card's own chips render
   * them — same component, same "(ถูกลบแล้ว)" treatment for a link whose target
   * died while the task sat on the board. Navigation is off: clicking a chip
   * must not carry the admin out of a half-filled form. */
  const draftLinkRows: TaskLink[] = useMemo(
    () =>
      links.map((link) => ({
        taskId: task?.id ?? "",
        targetType: link.targetType,
        targetId: link.targetId,
        label: link.label,
        createdAt: "",
      })),
    [links, task?.id]
  );

  // ── Save ──────────────────────────────────────────────────────────────────

  const trimmedTitle = title.trim();
  const missingTopic = !topicId;
  const missingTitle = trimmedTitle === "";

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    // Belt and braces against a double click: the button is disabled below, and
    // this ref rejects any submit that still gets through.
    if (savingRef.current) return;
    setSubmitAttempted(true);
    setSaveError("");
    if (missingTopic || missingTitle) return;

    savingRef.current = true;
    setIsSaving(true);
    try {
      const payload = {
        topicId: Number(topicId),
        title: trimmedTitle.substring(0, MAX_TITLE),
        detail: detail.trim().substring(0, MAX_DETAIL) || null,
        // null, not "", is what clears the column — a task with no deadline.
        dueDate: dueDate || null,
        links,
      };
      const res = await fetch(
        isEdit ? `/api/admin/tasks/${encodeURIComponent(task!.id)}` : "/api/admin/tasks",
        {
          method: isEdit ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      if (!res.ok) {
        setSaveError(await readApiError(res, isEdit ? "อัปเดตงานไม่สำเร็จ" : "บันทึกงานไม่สำเร็จ"));
        savingRef.current = false;
        setIsSaving(false);
        return;
      }
      const saved: CrmTask = await res.json();
      // Stay disabled on success: the parent closes this modal, and nothing
      // should be submittable in the gap before it unmounts.
      onSaved(saved);
    } catch {
      setSaveError("เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
      savingRef.current = false;
      setIsSaving(false);
    }
  };

  const inputClass =
    "w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400";

  return (
    <div
      className="fixed inset-0 bg-black/40 backdrop-blur-sm z-200 flex items-center justify-center p-4 animate-fade-in"
      onClick={() => {
        if (!isSaving) onClose();
      }}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={isEdit ? "แก้ไขงาน" : "สร้างงานใหม่"}
      >
        <div className="p-6 border-b border-gray-100 flex justify-between items-center sticky top-0 bg-white z-10">
          <div>
            <h3 className="text-xl font-bold text-gray-800">
              {isEdit ? "แก้ไขงาน" : "สร้างงานใหม่"}
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">
              งานที่คุณบันทึกเอง ไม่ใช่แจ้งเตือนอัตโนมัติของระบบ
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-40"
            aria-label="ปิด"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* หัวข้อ (บังคับ) */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">
              หัวข้อ <span className="text-red-500">*</span>
            </label>
            {topics.length === 0 && !task?.topicId ? (
              <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5">
                ยังไม่มีหัวข้อให้เลือก กรุณาเพิ่มหัวข้อจากปุ่ม &quot;จัดการหัวข้อ&quot; ก่อนสร้างงาน
              </p>
            ) : (
              <SearchableDropdown
                options={topicOptions}
                value={topicId}
                onChange={setTopicId}
                placeholder="เลือกหัวข้อของงาน..."
                buttonClassName="py-2.5 rounded-xl"
              />
            )}
            {submitAttempted && missingTopic && (
              <p className="text-red-500 text-xs mt-1">กรุณาเลือกหัวข้อของงาน</p>
            )}
          </div>

          {/* ชื่องาน (บังคับ) */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">
              ชื่องาน <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={title}
              maxLength={MAX_TITLE}
              onChange={(e) => setTitle(e.target.value)}
              className={inputClass}
              placeholder="เช่น โทรหาคุณสมชาย เรื่องใบเสนอราคา"
            />
            {submitAttempted && missingTitle && (
              <p className="text-red-500 text-xs mt-1">กรุณาระบุชื่องาน</p>
            )}
          </div>

          {/* รายละเอียด (ไม่บังคับ) */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">
              รายละเอียด <span className="text-gray-400 font-normal">(ไม่บังคับ)</span>
            </label>
            <textarea
              value={detail}
              rows={3}
              maxLength={MAX_DETAIL}
              onChange={(e) => setDetail(e.target.value)}
              className={`${inputClass} resize-y`}
              placeholder="รายละเอียดเพิ่มเติมของงานนี้"
            />
          </div>

          {/* กำหนดวัน (ไม่บังคับ) */}
          <div className="relative z-50">
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">
              กำหนดวัน <span className="text-gray-400 font-normal">(ไม่บังคับ)</span>
            </label>
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <DatePicker
                  selected={parseDateValue(dueDate)}
                  onChange={(date) => setDueDate(date ? toLocalDateString(date) : "")}
                  placeholderText="ไม่มีกำหนด"
                  isClearable
                />
              </div>
              {/* An explicit way back to "no deadline" — the picker's own ✕ is
                  easy to miss, and a task without a due date is a normal state. */}
              <button
                type="button"
                onClick={() => setDueDate("")}
                disabled={!dueDate}
                className="px-3 py-2.5 text-sm font-semibold rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
              >
                ล้างวันที่
              </button>
            </div>
            <p className="text-xs text-gray-400 mt-1">
              {dueDate ? `กำหนดวันที่ ${dueDate}` : "งานนี้จะแสดงเป็น “ไม่มีกำหนด”"}
            </p>
          </div>

          {/* ลิงก์ (ไม่บังคับ, หลายรายการ) */}
          <div className="border-t border-gray-100 pt-5">
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">
              ลิงก์ที่เกี่ยวข้อง <span className="text-gray-400 font-normal">(ไม่บังคับ ผูกได้หลายรายการ)</span>
            </label>
            <p className="text-xs text-gray-500 mb-3">
              เลือกชนิดปลายทาง แล้วค้นหารายการที่ต้องการผูก — ผูกข้ามชนิดกันในงานเดียวได้
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)] gap-2">
              <SearchableDropdown
                options={kindOptions}
                value={pickerKind}
                onChange={(value) => {
                  setPickerKind(value as TaskLinkTarget);
                  setPickerNote("");
                }}
                searchable={false}
                placeholder="ชนิดปลายทาง"
                buttonClassName="py-2.5 rounded-xl"
              />

              {kindState.options.length > 0 ? (
                <SearchableDropdown
                  options={targetOptions}
                  // Always "" — a pick is consumed immediately and turned into a
                  // chip, so the box is ready for the next one.
                  value=""
                  onChange={addLink}
                  placeholder={`ค้นหา${TASK_LINK_KIND_META[pickerKind].pickerLabel}...`}
                  buttonClassName="py-2.5 rounded-xl"
                />
              ) : (
                <div className="flex items-center gap-2 px-3 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-500 bg-gray-50">
                  {kindState.status === "loading" || kindState.status === "idle" ? (
                    <>
                      <Spinner className="h-4 w-4 text-indigo-500" />
                      <span>กำลังโหลดรายการ{TASK_LINK_KIND_META[pickerKind].pickerLabel}...</span>
                    </>
                  ) : kindState.status === "error" ? (
                    <>
                      <span className="text-rose-600">{kindState.error}</span>
                      <button
                        type="button"
                        onClick={() => reloadTaskLinkTargets([pickerKind])}
                        className="ml-auto px-2.5 py-1 text-xs font-semibold rounded-lg bg-white border border-gray-200 text-gray-700 hover:bg-gray-100 transition-colors"
                      >
                        ลองใหม่
                      </button>
                    </>
                  ) : (
                    <span>ยังไม่มี{TASK_LINK_KIND_META[pickerKind].pickerLabel}ในระบบ</span>
                  )}
                </div>
              )}
            </div>

            {/* Loading/error next to a picker that still has usable (older)
                rows — the message must not hide the list it is about. */}
            {kindState.options.length > 0 && kindState.status === "error" && (
              <p className="text-xs text-rose-600 mt-1.5 flex items-center gap-2">
                {kindState.error} — รายการที่เห็นอาจไม่ใช่ล่าสุด
                <button
                  type="button"
                  onClick={() => reloadTaskLinkTargets([pickerKind])}
                  className="px-2 py-0.5 text-xs font-semibold rounded-lg bg-white border border-gray-200 text-gray-700 hover:bg-gray-100 transition-colors"
                >
                  ลองใหม่
                </button>
              </p>
            )}
            {kindState.status === "error" && (
              <p className="text-xs text-gray-500 mt-1.5">
                โหลดรายการปลายทางไม่สำเร็จก็ยังบันทึกงานได้ตามปกติ (งานจะไม่มีลิงก์)
              </p>
            )}
            {pickerNote && <p className="text-xs text-amber-600 mt-1.5">{pickerNote}</p>}

            <div className="mt-3">
              {links.length > 0 ? (
                <TaskLinkChips
                  links={draftLinkRows}
                  navigable={false}
                  onRemove={removeLink}
                  targets={targets}
                  size="sm"
                />
              ) : (
                <p className="text-xs text-gray-400">ยังไม่ได้ผูกลิงก์กับงานนี้</p>
              )}
            </div>
          </div>

          {saveError && (
            <p className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-4 py-2.5">
              {saveError}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="px-4 py-2.5 text-sm font-semibold rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-40"
            >
              ยกเลิก
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="px-5 py-2.5 text-sm font-semibold rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed inline-flex items-center gap-2"
            >
              {isSaving && <Spinner className="h-4 w-4 text-white" />}
              {isSaving ? "กำลังบันทึก..." : isEdit ? "บันทึกการแก้ไข" : "สร้างงาน"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

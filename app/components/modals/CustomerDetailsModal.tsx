"use client";

/**
 * CustomerDetailsModal — the customer detail view: department / email /
 * phone, inline-editable "บันทึกลูกค้า", the นัดโทรลูกค้า section, and the
 * "สร้างสิ่งที่ต้องทำ" quick-create button.
 *
 * Extracted (spec: open-customer-profile-in-place) from what used to be
 * inline JSX in `app/customers/page.tsx` — that page was the ONLY place this
 * view could be reached from, so opening it from `/crm/alerts` (the "แก้ไข"
 * button on a นัดโทรลูกค้า card) meant navigating away to `/customers`
 * entirely. This component is now shared the same way `EquipmentDetailsModal`
 * already is between the "อุปกรณ์ที่ขาย" tab and the equipment-scoped alert
 * cards: one file, opened in place wherever it is needed, never a second copy
 * of this UI.
 *
 * Props
 * -----
 *   customer   the customer to show. The caller owns "which customer is
 *              being viewed" — this component holds no id state of its own.
 *   onClose    close without navigating anywhere.
 *   onSaved    the note was saved. Receives the UPDATED customer row; the
 *              caller decides what to do with it (update a list, update its
 *              own "currently viewing" state) — this component never assumes
 *              there IS a list to patch, which is true on /crm/alerts.
 *   showToast     the host page's own toast function (`(message, type) =>
 *                 void`) — both current callers already have one; this never
 *                 introduces a second feedback mechanism the way
 *                 `EquipmentDetailsModal` deliberately keeps using `alert()`
 *                 for its OTHER messages, because IT has no toast system to
 *                 match. The one exception is the task-created confirmation,
 *                 which both modals show via the shared `TaskCreatedNotice`
 *                 dialog instead of either `showToast` or `alert()`.
 *   onTaskCreated optional. Fired after the quick-create button saves a task,
 *                 so a host with its own task board (only /crm/alerts today)
 *                 can reveal it there instead of requiring a manual refresh.
 *   onEdit        optional. Given by a host that has the customer form
 *                 (/customers): the window then shows "แก้ไขข้อมูล", which
 *                 hands over to that form — no closing the window to hunt
 *                 for the row's pencil.
 *   onOpenCompany optional. Given when the host can show the customer's
 *                 company: the company name becomes a button that goes there.
 *
 * A dialog proper: Esc closes it (first leaving the note edit, if one is
 * open — asking when there is typing to lose), the focus moves into it when it
 * opens and back to where it came from when it closes.
 */

import { useState, useRef, useEffect, useCallback } from "react";
import type { Customer, TaskTopic, CrmTask } from "../../lib/types";
import CustomerCallScheduleSection from "./CustomerCallScheduleSection";
import TaskFormModal, { type TaskLinkPayload } from "../TaskFormModal";
import { buildTaskLinkLabel } from "../TaskLinkChips";
import { ensureTaskTopicsLoaded } from "../useTaskTopics";
import TaskCreatedNotice from "./TaskCreatedNotice";
import ConfirmDialog from "../ConfirmDialog";
import CopyText from "../CopyText";
import { useModalEscape } from "../useModalEscape";
import { errorMessageOf } from "../../lib/apiErrorMessage";
import { formatThaiPhone } from "../../lib/phone";

/** customers.note: the routes cut at 2,000 characters. */
const CUSTOMER_NOTE_MAX = 2000;
/** From here the counter turns amber: the log is nearly full. */
const NOTE_NEARLY_FULL = 1800;

/** What an unsaved note edit is in the way of. */
type Leaving = "close" | "cancel" | "edit" | "company";

export interface CustomerDetailsModalProps {
  customer: Customer;
  onClose: () => void;
  onSaved: (updated: Customer) => void;
  showToast: (message: string, type: "success" | "error") => void;
  // Fired after the quick-create "สร้างสิ่งที่ต้องทำ" button saves a task —
  // lets a host page with its own task board (e.g. /crm/alerts) reveal the
  // new task there instead of requiring a manual refresh. Hosts with no task
  // board of their own (/customers) simply omit it.
  onTaskCreated?: (task: CrmTask) => void;
  onEdit?: () => void;
  onOpenCompany?: () => void;
}

export default function CustomerDetailsModal({
  customer,
  onClose,
  onSaved,
  showToast,
  onTaskCreated,
  onEdit,
  onOpenCompany,
}: CustomerDetailsModalProps) {
  // Inline "บันทึกลูกค้า" editing directly inside this modal — no need to
  // close it and reopen a separate edit-customer modal.
  const [isEditingNote, setIsEditingNote] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [isSavingNote, setIsSavingNote] = useState(false);
  const savingNoteRef = useRef(false);
  // These two keep the edit box the SAME SIZE the note was while reading it.
  // A customer note here is a call log that grows for years — five or six
  // dated entries is normal — so a fixed `rows={3}` box meant pressing แก้ไข
  // shrank a full screen of history into a four-line porthole the admin had
  // to scroll through to find the end. `noteViewRef` measures the rendered
  // paragraph the moment แก้ไข is pressed, and that height becomes the
  // textarea's floor.
  const noteViewRef = useRef<HTMLParagraphElement | null>(null);
  const [noteMinHeight, setNoteMinHeight] = useState<number | null>(null);
  // The log is written downwards — the newest call goes at the END — but a
  // freshly focused textarea puts the cursor at the start. When an edit
  // starts, the cursor is moved to the end and that end brought into view.
  const noteBoxRef = useRef<HTMLTextAreaElement | null>(null);
  const noteActionsRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!isEditingNote) return;
    const box = noteBoxRef.current;
    if (box) box.setSelectionRange(box.value.length, box.value.length);
    noteActionsRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [isEditingNote]);

  // A note edit that would be lost: closing (the backdrop, ✕, Esc), ยกเลิก,
  // or leaving for the edit form / the company waits here for a yes. A call
  // log is years of typing; one click a few pixels outside the box used to
  // throw an edit of it away unasked.
  const [confirmDiscard, setConfirmDiscard] = useState<Leaving | null>(null);
  const noteDirty = isEditingNote && noteDraft !== (customer.note || "");
  const noteTooLong = noteDraft.length > CUSTOMER_NOTE_MAX;

  // Reset inline note-editing whenever a DIFFERENT customer is shown (the
  // host swapped `customer` without unmounting this component — e.g.
  // /customers switching from viewing A to viewing B) — stale draft text
  // must never leak between customers.
  useEffect(() => {
    setIsEditingNote(false);
    setConfirmDiscard(null);
  }, [customer.id]);

  // A refresh or a closed tab mid-edit gets the browser's own warning.
  useEffect(() => {
    if (!noteDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [noteDirty]);

  const leave = (to: Leaving) => {
    if (to === "close") onClose();
    else if (to === "cancel") setIsEditingNote(false);
    else if (to === "edit") onEdit?.();
    else onOpenCompany?.();
  };
  /** Every way out of a note edit — the backdrop, ✕, Esc, ยกเลิก, แก้ไขข้อมูล,
   *  the company's name: asks first when the edit would be lost, and never
   *  while it is being saved. */
  const requestLeave = (to: Leaving) => {
    if (savingNoteRef.current) return;
    if (noteDirty) setConfirmDiscard(to);
    else leave(to);
  };

  // ── The window as a dialog ─────────────────────────────────────────────────
  const dialogRef = useRef<HTMLDivElement>(null);
  // Esc, one step at a time: the question first, then the note edit, then the
  // window. (A window opened over this one — the task form, a call-schedule
  // form — takes its own Esc: see lib/dialogLayer.ts.)
  useModalEscape(dialogRef, () => {
    if (confirmDiscard) setConfirmDiscard(null);
    else requestLeave(isEditingNote ? "cancel" : "close");
  });
  // Focus in on open, back to the opener (the row, the card) on close.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus();
    return () => {
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  const startEditingNote = () => {
    // Measure BEFORE the paragraph unmounts — once `isEditingNote` flips, the
    // element is gone and its height is unrecoverable.
    setNoteMinHeight(noteViewRef.current?.offsetHeight ?? null);
    setNoteDraft(customer.note || "");
    setIsEditingNote(true);
  };

  const handleSaveNote = async () => {
    // The ref as well as the disabled button: a double click lands before
    // React has re-rendered the button disabled.
    if (savingNoteRef.current) return;
    if (noteDraft.length > CUSTOMER_NOTE_MAX) {
      // บันทึก is off while it is too long; this is Ctrl + Enter.
      showToast("บันทึกลูกค้าต้องไม่เกิน 2,000 ตัวอักษร", "error");
      return;
    }
    savingNoteRef.current = true;
    setIsSavingNote(true);
    let failed: string | null = null;
    let body: { noteUpdatedAt?: string | null } | null = null;
    try {
      const res = await fetch(`/api/customers/${customer.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...customer, note: noteDraft }),
      });
      // The route says why ("ไม่พบลูกค้า", an expired session…) — said as is.
      if (!res.ok) failed = await errorMessageOf(res, "เกิดข้อผิดพลาดในการบันทึก");
      else body = await res.json().catch(() => null);
    } catch (err) {
      console.error(err);
      failed = "บันทึกไม่สำเร็จ ตรวจสอบการเชื่อมต่อแล้วลองใหม่";
    } finally {
      savingNoteRef.current = false;
      setIsSavingNote(false);
    }
    if (failed) {
      // Still editing, with what was typed.
      showToast(failed, "error");
      return;
    }
    // The server decides whether the note actually changed and when; the
    // host re-sorts /customers by this, so it must be the stored value, not a
    // client clock's guess.
    const updated: Customer = {
      ...customer,
      note: noteDraft,
      noteUpdatedAt:
        body && "noteUpdatedAt" in body ? (body.noteUpdatedAt ?? null) : customer.noteUpdatedAt,
    };
    setIsEditingNote(false);
    showToast("บันทึกข้อมูลลูกค้าสำเร็จ", "success");
    onSaved(updated);
  };

  // ── "สร้างสิ่งที่ต้องทำ" ────────────────────────────────────────────────────
  //
  // `taskTopics === null` means "not resolved on THIS modal instance yet" —
  // distinct from `[]` ("resolved, and there are genuinely none"). The actual
  // fetch (if any) is owned by `useTaskTopics.ts`'s module-level cache, shared
  // with `EquipmentDetailsModal`'s own button — a load done from either one
  // covers both, for the whole session.
  const [taskTopics, setTaskTopics] = useState<TaskTopic[] | null>(null);
  const [isLoadingTaskTopics, setIsLoadingTaskTopics] = useState(false);
  const [showTaskForm, setShowTaskForm] = useState(false);
  const [taskCreatedMessage, setTaskCreatedMessage] = useState<string | null>(null);

  const handleOpenTaskForm = useCallback(async () => {
    if (isLoadingTaskTopics) return;
    let topics = taskTopics;
    if (topics === null) {
      setIsLoadingTaskTopics(true);
      const loaded = await ensureTaskTopicsLoaded();
      setIsLoadingTaskTopics(false);
      if (loaded === null) {
        showToast("โหลดหัวข้องานไม่สำเร็จ กรุณาลองใหม่", "error");
        return;
      }
      topics = loaded;
      setTaskTopics(topics);
    }
    if (topics.length === 0) {
      showToast("ยังไม่มีหัวข้องาน กรุณาไปสร้างหัวข้อที่หน้ากระดานงานก่อน", "error");
      return;
    }
    setShowTaskForm(true);
  }, [isLoadingTaskTopics, taskTopics, showToast]);

  /** The customer link `TaskFormModal` opens pre-seeded with — computed with
   *  the SAME function the form's own link picker uses (`TaskLinkChips.tsx`),
   *  so the chip reads identically whichever way it was added. */
  const taskFormInitialLinks: TaskLinkPayload[] = [
    {
      targetType: "customer",
      targetId: customer.id,
      label: buildTaskLinkLabel("customer", {
        name: customer.name,
        companyName: customer.companyName,
      }),
    },
  ];

  const copied = () => showToast("คัดลอกแล้ว", "success");
  const copyFailed = () => showToast("คัดลอกไม่สำเร็จ", "error");

  return (
    <>
      {/* z-100: over the admin bell (z-90), which used to float on top of this
          window and lead off the page when clicked. */}
      <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm z-100 flex items-center justify-center p-4 animate-fade-in" onClick={() => requestLeave("close")}>
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="customer-details-title"
          tabIndex={-1}
          className="bg-white rounded-3xl shadow-2xl max-w-2xl w-full max-h-[85vh] overflow-hidden flex flex-col outline-none"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header — a flex sibling ABOVE the scrollable body below, not
              `position: sticky` inside one shared scroll box. `sticky` looks
              identical when nothing scrolls, but Chromium has a real bug
              where a sticky child can escape its ancestor's
              `border-radius` clip once that ancestor actually scrolls —
              which is exactly why this modal's top corners looked square
              only once its note/schedule content grew long enough to
              scroll, while EquipmentDetailsModal's (also `sticky`) looked
              fine in a screenshot that never needed to scroll. Splitting
              header/body into their own flex boxes, with `overflow-hidden`
              on the rounded outer box, makes the rounding correct
              regardless of scroll state. */}
          <div className="p-6 border-b border-gray-100 flex justify-between items-center gap-3 shrink-0">
            <div className="flex items-center gap-4 min-w-0">
              {/* An icon, not the name's first letter: most names start with
                  "คุณ", so nearly every circle read "ค". */}
              <div className="w-14 h-14 rounded-2xl bg-orange-100 text-orange-600 flex items-center justify-center shrink-0">
                <svg aria-hidden="true" className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"></path></svg>
              </div>
              <div className="min-w-0">
                <h2 id="customer-details-title" className="text-xl font-bold text-gray-900 truncate" title={customer.name}>{customer.name}</h2>
                {customer.companyName &&
                  (onOpenCompany ? (
                    <button
                      type="button"
                      onClick={() => requestLeave("company")}
                      title="ดูข้อมูลบริษัท"
                      className="block max-w-full text-left text-sm text-orange-600 font-medium mt-0.5 truncate hover:text-orange-700 hover:underline underline-offset-2"
                    >
                      {customer.companyName}
                    </button>
                  ) : (
                    <p className="text-sm text-orange-600 font-medium mt-0.5 truncate">{customer.companyName}</p>
                  ))}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {onEdit && (
                <button
                  type="button"
                  onClick={() => requestLeave("edit")}
                  className="flex items-center gap-1.5 px-3 py-2 text-sm font-semibold text-gray-700 bg-white border border-gray-200 hover:bg-gray-50 rounded-xl transition-colors"
                >
                  <svg aria-hidden="true" className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                  แก้ไขข้อมูล
                </button>
              )}
              <button
                type="button"
                onClick={handleOpenTaskForm}
                disabled={isLoadingTaskTopics}
                className="flex items-center gap-1.5 px-3 py-2 text-sm font-semibold text-orange-700 bg-orange-50 hover:bg-orange-100 rounded-xl transition-colors disabled:opacity-50"
              >
                {isLoadingTaskTopics ? (
                  <>
                    <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    กำลังโหลด...
                  </>
                ) : (
                  <>📝 สร้างสิ่งที่ต้องทำ</>
                )}
              </button>
              <button type="button" onClick={() => requestLeave("close")} aria-label="ปิด" className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors">
                <svg aria-hidden="true" className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
              </button>
            </div>
          </div>

          <div className="p-6 space-y-4 overflow-y-auto min-h-0">
            {/* Department, phone, e-mail: label and value on one line each —
                three full-width cards pushed the call log off the screen.
                Phone and e-mail copy on click, as in the list. */}
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 bg-gray-50 rounded-2xl border border-gray-100 px-5 py-4 text-sm">
              <dt className="text-gray-500">แผนก</dt>
              <dd className="text-gray-900 font-medium min-w-0 break-words">{customer.department || "-"}</dd>
              <dt className="text-gray-500">เบอร์โทร</dt>
              <dd className="text-gray-900 font-medium tabular-nums min-w-0 break-words">
                <CopyText value={formatThaiPhone(customer.phone)} onCopied={copied} onFailed={copyFailed} />
              </dd>
              <dt className="text-gray-500">อีเมล</dt>
              <dd className="text-gray-900 font-medium min-w-0 break-all">
                <CopyText value={customer.email} onCopied={copied} onFailed={copyFailed} />
              </dd>
            </dl>

            <div className="bg-orange-50 rounded-2xl p-5 border border-orange-100">
              <div className="flex justify-between items-center mb-2">
                <h3 className="text-sm font-semibold text-orange-400 uppercase tracking-wider">บันทึกลูกค้า</h3>
                {!isEditingNote && (
                  <button
                    type="button"
                    onClick={startEditingNote}
                    className="text-xs font-semibold text-orange-600 hover:text-orange-700"
                  >
                    ✏️ แก้ไข
                  </button>
                )}
              </div>
              {isEditingNote ? (
                <div className="space-y-2">
                  <textarea
                    rows={3}
                    autoFocus
                    aria-label="บันทึกลูกค้า"
                    aria-invalid={noteTooLong}
                    // Grow with the text, and never start smaller than the
                    // note looked a moment ago. `height:auto` first is what
                    // lets it SHRINK again after a deletion — without it
                    // scrollHeight only ever reports the taller past size.
                    // `min-height` then clamps the result, so the box is
                    // max(what fits, what was on screen while reading).
                    ref={(el) => {
                      noteBoxRef.current = el;
                      if (!el) return;
                      el.style.height = "auto";
                      el.style.height = `${el.scrollHeight}px`;
                    }}
                    style={noteMinHeight ? { minHeight: noteMinHeight } : undefined}
                    // Same type size and same colour as the paragraph above,
                    // so pressing แก้ไข does not also reflow and recolour the
                    // text the admin was mid-way through reading. resize-none
                    // because the box already sizes itself, and a
                    // hand-dragged smaller box would clip text under
                    // overflow-hidden.
                    className={`w-full bg-white border rounded-xl px-4 py-2.5 text-orange-900 focus:outline-none focus:ring-2 resize-none overflow-hidden ${
                      noteTooLong ? "border-red-400 focus:ring-red-500" : "border-orange-200 focus:ring-orange-500"
                    }`}
                    value={noteDraft}
                    onChange={(e) => {
                      setNoteDraft(e.target.value);
                      e.currentTarget.style.height = "auto";
                      e.currentTarget.style.height = `${e.currentTarget.scrollHeight}px`;
                    }}
                    onKeyDown={(e) => {
                      // Enter is a new line here; Ctrl / ⌘ + Enter saves.
                      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                        e.preventDefault();
                        handleSaveNote();
                      }
                    }}
                  />
                  <div ref={noteActionsRef} className="flex flex-wrap items-center justify-between gap-2">
                    {/* The log grows for years and the column holds 2,000
                        characters: said while typing, not only on บันทึก. */}
                    <p
                      data-testid="note-counter"
                      className={`text-xs tabular-nums ${
                        noteTooLong ? "text-red-600 font-semibold" : noteDraft.length >= NOTE_NEARLY_FULL ? "text-amber-600 font-semibold" : "text-orange-400"
                      }`}
                    >
                      {noteDraft.length.toLocaleString("th-TH")} / {CUSTOMER_NOTE_MAX.toLocaleString("th-TH")}
                      {noteTooLong && (
                        <span role="alert"> — เกิน {(noteDraft.length - CUSTOMER_NOTE_MAX).toLocaleString("th-TH")} ตัวอักษร ตัดให้สั้นลงก่อนบันทึก</span>
                      )}
                    </p>
                    <div className="flex items-center gap-2 ml-auto">
                      <span className="hidden sm:inline text-[11px] text-orange-400">Ctrl + Enter บันทึก · Esc ยกเลิก</span>
                      <button
                        type="button"
                        onClick={() => requestLeave("cancel")}
                        disabled={isSavingNote}
                        className="px-3 py-1.5 text-xs font-semibold text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
                      >
                        ยกเลิก
                      </button>
                      <button
                        type="button"
                        onClick={handleSaveNote}
                        disabled={isSavingNote || noteTooLong}
                        className="px-3 py-1.5 text-xs font-semibold text-white bg-orange-600 rounded-lg hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        {isSavingNote ? "กำลังบันทึก..." : "บันทึก"}
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <p ref={noteViewRef} className="text-orange-900 whitespace-pre-wrap">
                  {customer.note || "-"}
                </p>
              )}
            </div>

            <CustomerCallScheduleSection customerId={customer.id} />
          </div>
        </div>
      </div>

      {/* "สร้างสิ่งที่ต้องทำ" — a sibling modal (own backdrop, z-200 > this
          modal's z-100) rather than nested inside the markup above, so
          closing this one leaves the customer details modal exactly as it
          was. `taskTopics` is asserted non-null by `handleOpenTaskForm`
          before this ever opens. */}
      {showTaskForm && taskTopics && (
        <TaskFormModal
          topics={taskTopics}
          initialLinks={taskFormInitialLinks}
          onClose={() => setShowTaskForm(false)}
          onSaved={(task) => {
            setShowTaskForm(false);
            setTaskCreatedMessage("ผูกกับลูกค้ารายนี้แล้ว");
            onTaskCreated?.(task);
          }}
        />
      )}

      {confirmDiscard && (
        <ConfirmDialog
          title="ยังไม่ได้บันทึก"
          message={
            confirmDiscard === "cancel"
              ? "บันทึกลูกค้าที่แก้ไว้จะหายไป ยกเลิกการแก้ไขเลยไหม?"
              : "บันทึกลูกค้าที่แก้ไว้จะหายไป ปิดหน้าต่างนี้เลยไหม?"
          }
          confirmText={confirmDiscard === "cancel" ? "ทิ้งที่แก้ไว้" : "ปิดโดยไม่บันทึก"}
          cancelText="กลับไปแก้ต่อ"
          onConfirm={() => {
            const to = confirmDiscard;
            setConfirmDiscard(null);
            leave(to);
          }}
          onCancel={() => setConfirmDiscard(null)}
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

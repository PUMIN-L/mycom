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
 */

import { useState, useRef, useEffect, useCallback } from "react";
import type { Customer, TaskTopic, CrmTask } from "../../lib/types";
import CustomerCallScheduleSection from "./CustomerCallScheduleSection";
import TaskFormModal, { type TaskLinkPayload } from "../TaskFormModal";
import { buildTaskLinkLabel } from "../TaskLinkChips";
import { ensureTaskTopicsLoaded } from "../useTaskTopics";
import TaskCreatedNotice from "./TaskCreatedNotice";

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
}

export default function CustomerDetailsModal({
  customer,
  onClose,
  onSaved,
  showToast,
  onTaskCreated,
}: CustomerDetailsModalProps) {
  // Inline "บันทึกลูกค้า" editing directly inside this modal — no need to
  // close it and reopen a separate edit-customer modal.
  const [isEditingNote, setIsEditingNote] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [isSavingNote, setIsSavingNote] = useState(false);
  // These two keep the edit box the SAME SIZE the note was while reading it.
  // A customer note here is a call log that grows for years — five or six
  // dated entries is normal — so a fixed `rows={3}` box meant pressing แก้ไข
  // shrank a full screen of history into a four-line porthole the admin had
  // to scroll through to find the end. `noteViewRef` measures the rendered
  // paragraph the moment แก้ไข is pressed, and that height becomes the
  // textarea's floor.
  const noteViewRef = useRef<HTMLParagraphElement | null>(null);
  const [noteMinHeight, setNoteMinHeight] = useState<number | null>(null);

  // Reset inline note-editing whenever a DIFFERENT customer is shown (the
  // host swapped `customer` without unmounting this component — e.g.
  // /customers switching from viewing A to viewing B) — stale draft text
  // must never leak between customers.
  useEffect(() => {
    setIsEditingNote(false);
  }, [customer.id]);

  const handleSaveNote = async () => {
    if (isSavingNote) return;
    if (noteDraft.length > 2000) {
      showToast("บันทึกลูกค้าต้องไม่เกิน 2000 ตัวอักษร", "error");
      return;
    }
    setIsSavingNote(true);
    try {
      const res = await fetch(`/api/customers/${customer.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...customer, note: noteDraft }),
      });
      if (!res.ok) throw new Error("Failed to save");
      const updated = { ...customer, note: noteDraft };
      setIsEditingNote(false);
      showToast("บันทึกข้อมูลลูกค้าสำเร็จ", "success");
      onSaved(updated);
    } catch (err) {
      console.error(err);
      showToast("เกิดข้อผิดพลาดในการบันทึก", "error");
    } finally {
      setIsSavingNote(false);
    }
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

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-gray-900/40 backdrop-blur-sm" onClick={onClose}></div>
        <div className="relative bg-white rounded-3xl shadow-2xl max-w-xl w-full p-8 max-h-[85vh] overflow-y-auto transform transition-all">
          <div className="absolute top-0 right-0 p-4 flex items-center gap-2">
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
            <button onClick={onClose} aria-label="ปิด" className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
            </button>
          </div>
          <div className="flex items-center gap-5 mb-8">
            <div className="w-20 h-20 rounded-full bg-gradient-to-tr from-orange-200 to-orange-100 border-4 border-white shadow-sm flex items-center justify-center text-orange-700 font-bold text-3xl">
              {customer.name.charAt(0)}
            </div>
            <div>
              <h2 className="text-2xl font-bold text-gray-900">{customer.name}</h2>
              <p className="text-orange-600 font-medium">{customer.companyName}</p>
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex items-center p-4 bg-gray-50 rounded-2xl border border-gray-100">
              <div className="p-2 bg-white rounded-xl shadow-sm mr-4 text-gray-400">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"></path></svg>
              </div>
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase">แผนก</p>
                <p className="text-gray-900 font-medium">{customer.department || "-"}</p>
              </div>
            </div>

            <div className="flex items-center p-4 bg-gray-50 rounded-2xl border border-gray-100">
              <div className="p-2 bg-white rounded-xl shadow-sm mr-4 text-gray-400">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"></path></svg>
              </div>
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase">อีเมล</p>
                <p className="text-gray-900 font-medium">{customer.email || "-"}</p>
              </div>
            </div>

            <div className="flex items-center p-4 bg-gray-50 rounded-2xl border border-gray-100">
              <div className="p-2 bg-white rounded-xl shadow-sm mr-4 text-gray-400">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"></path></svg>
              </div>
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase">เบอร์โทรศัพท์</p>
                <p className="text-gray-900 font-medium">{customer.phone || "-"}</p>
              </div>
            </div>

            <div className="bg-orange-50 rounded-2xl p-5 border border-orange-100 mt-4">
              <div className="flex justify-between items-center mb-2">
                <h3 className="text-sm font-semibold text-orange-400 uppercase tracking-wider">บันทึกลูกค้า</h3>
                {!isEditingNote && (
                  <button
                    type="button"
                    onClick={() => {
                      // Measure BEFORE the paragraph unmounts — once
                      // `isEditingNote` flips, the element is gone and its
                      // height is unrecoverable.
                      setNoteMinHeight(noteViewRef.current?.offsetHeight ?? null);
                      setNoteDraft(customer.note || "");
                      setIsEditingNote(true);
                    }}
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
                    // Grow with the text, and never start smaller than the
                    // note looked a moment ago. `height:auto` first is what
                    // lets it SHRINK again after a deletion — without it
                    // scrollHeight only ever reports the taller past size.
                    // `min-height` then clamps the result, so the box is
                    // max(what fits, what was on screen while reading).
                    ref={(el) => {
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
                    className="w-full bg-white border border-orange-200 rounded-xl px-4 py-2.5 text-orange-900 focus:outline-none focus:ring-2 focus:ring-orange-500 resize-none overflow-hidden"
                    value={noteDraft}
                    onChange={(e) => {
                      setNoteDraft(e.target.value);
                      e.currentTarget.style.height = "auto";
                      e.currentTarget.style.height = `${e.currentTarget.scrollHeight}px`;
                    }}
                  />
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setIsEditingNote(false)}
                      disabled={isSavingNote}
                      className="px-3 py-1.5 text-xs font-semibold text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
                    >
                      ยกเลิก
                    </button>
                    <button
                      type="button"
                      onClick={handleSaveNote}
                      disabled={isSavingNote}
                      className="px-3 py-1.5 text-xs font-semibold text-white bg-orange-600 rounded-lg hover:bg-orange-700 disabled:opacity-50 transition-colors"
                    >
                      {isSavingNote ? "กำลังบันทึก..." : "บันทึก"}
                    </button>
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
          modal's z-50) rather than nested inside the markup above, so
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

      {taskCreatedMessage && (
        <TaskCreatedNotice
          message={taskCreatedMessage}
          onClose={() => setTaskCreatedMessage(null)}
        />
      )}
    </>
  );
}

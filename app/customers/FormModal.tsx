"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import ConfirmDialog from "../components/ConfirmDialog";
import { useModalEscape } from "../components/useModalEscape";

/**
 * The add / edit window of /customers' three forms (company, customer,
 * salesperson): a header, a scrolling body holding the <form>, a footer with
 * ยกเลิก / บันทึกข้อมูล.
 *
 * Closing it with typing in it — the backdrop, ✕, ยกเลิก or Esc — asks first:
 * a click a few pixels outside the box used to throw the whole form away.
 * While a save is under way it cannot be closed, and บันทึกข้อมูล is off
 * (the form's own handler is guarded too: a double click used to POST twice).
 *
 * Keys: Enter in a one-line field saves (the form's own behaviour — the
 * submit button belongs to it by `form=`), Ctrl / ⌘ + Enter saves from a
 * multi-line one, Esc closes. The focus comes in with the form (the cursor is
 * put in its first field) and goes back to whatever opened it. The form is
 * `noValidate`: what is wrong is said in Thai under the field by the form
 * itself, not in the browser's English bubble.
 */
export default function FormModal({
  formId,
  title,
  subject,
  maxWidthClass = "max-w-xl",
  dirty,
  saving,
  error,
  onSubmit,
  onClose,
  children,
}: {
  formId: string;
  title: string;
  /** Who is being edited, under the title — an edit form used to look the
   *  same whoever it was for. */
  subject?: string;
  maxWidthClass?: string;
  /** Whether anything differs from what the form opened with. */
  dirty: boolean;
  saving: boolean;
  /** Why the last save was refused — shown at the top of the form, which
   *  stays open with what was typed. Cleared (null) while a save is under
   *  way, so each refusal is a new message to bring into view. */
  error?: string | null;
  onSubmit: () => void;
  /** Close for good — called once any question has been answered. */
  onClose: () => void;
  children: ReactNode;
}) {
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  const requestClose = () => {
    if (saving) return;
    if (dirty) setConfirmDiscard(true);
    else onClose();
  };

  // Esc: first out of the "ยังไม่ได้บันทึก" question (back to the form), then
  // out of the form — asking, when there is typing to lose.
  useModalEscape(dialogRef, () => {
    if (confirmDiscard) setConfirmDiscard(false);
    else requestClose();
  });

  // Whatever had focus when the form opened (a row's pencil, เพิ่มลูกค้า) gets
  // it back when the form goes — noted while rendering for the first time,
  // before anything in the form can take the focus. The cursor is put in the
  // first field HERE, not by `autoFocus`: in development React runs every
  // effect's cleanup once right after mounting, and that cleanup (focus back
  // to the opener) left a freshly opened form without the cursor.
  const [opener] = useState<HTMLElement | null>(() =>
    typeof document !== "undefined" && document.activeElement instanceof HTMLElement ? document.activeElement : null
  );
  useEffect(() => {
    bodyRef.current?.querySelector<HTMLElement>("input, textarea")?.focus();
    return () => {
      if (opener?.isConnected) opener.focus();
    };
  }, [opener]);

  // A refresh or a closed tab with typing in the form gets the browser's own
  // warning, as on /suppliers and the product pages.
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  // A refused save, brought into view — the admin may be at the bottom of a
  // long form, and the message is at its top.
  useEffect(() => {
    if (!error) return;
    bodyRef.current?.querySelector<HTMLElement>("[data-problem]")?.scrollIntoView?.({ block: "nearest" });
  }, [error]);

  const titleId = `${formId}-title`;

  return (
    <>
      <div className="fixed inset-0 z-100 flex items-center justify-center p-4">
        <div
          className="absolute inset-0 bg-gray-900/40 backdrop-blur-sm"
          onClick={requestClose}
          data-testid={`${formId}-backdrop`}
        ></div>
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          className={`relative bg-white rounded-3xl shadow-2xl w-full max-h-[90vh] flex flex-col overflow-hidden ${maxWidthClass}`}
        >
          <div className="px-8 py-5 border-b border-gray-100 flex justify-between items-center gap-4 bg-white shrink-0">
            <div className="min-w-0">
              <h2 id={titleId} className="text-2xl font-bold text-gray-800">{title}</h2>
              {subject && (
                <p className="text-sm text-gray-500 mt-0.5 truncate" data-testid="form-subject" title={subject}>
                  {subject}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={requestClose}
              disabled={saving}
              aria-label="ปิด"
              className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors disabled:opacity-50 shrink-0"
            >
              <svg aria-hidden="true" className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
            </button>
          </div>

          <div ref={bodyRef} className="overflow-y-auto flex-1 px-8 py-6">
            {error && (
              <p
                role="alert"
                data-problem
                className="mb-5 text-sm text-red-700 bg-red-50 border border-red-100 rounded-xl px-4 py-3 whitespace-pre-wrap"
              >
                {error}
              </p>
            )}
            <form
              id={formId}
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                onSubmit();
              }}
              onKeyDown={(e) => {
                // From a multi-line field, where Enter is a new line.
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  onSubmit();
                }
              }}
            >
              {children}
            </form>
          </div>

          <div className="px-8 py-4 border-t border-gray-100 bg-gray-50/50 flex flex-wrap items-center justify-between gap-3 shrink-0">
            <p className="text-xs text-gray-400">Enter บันทึก (ในช่องหลายบรรทัดใช้ Ctrl + Enter) · Esc ปิด</p>
            <div className="flex gap-3 ml-auto">
              <button
                type="button"
                onClick={requestClose}
                disabled={saving}
                className="px-6 py-2.5 font-semibold text-gray-600 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 transition-all shadow-sm disabled:opacity-50"
              >
                ยกเลิก
              </button>
              <button
                type="submit"
                form={formId}
                disabled={saving}
                className="px-6 py-2.5 bg-orange-500 text-white font-semibold rounded-xl hover:bg-orange-600 transition-all shadow-sm hover:shadow-md disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {saving ? "กำลังบันทึก..." : "บันทึกข้อมูล"}
              </button>
            </div>
          </div>
        </div>
      </div>

      {confirmDiscard && (
        <ConfirmDialog
          title="ยังไม่ได้บันทึก"
          message="สิ่งที่แก้ไว้จะหายไป ปิดหน้าต่างนี้เลยไหม?"
          confirmText="ปิดโดยไม่บันทึก"
          cancelText="กลับไปแก้ต่อ"
          onConfirm={() => {
            setConfirmDiscard(false);
            onClose();
          }}
          onCancel={() => setConfirmDiscard(false)}
        />
      )}
    </>
  );
}

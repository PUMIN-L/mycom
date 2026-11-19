"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import ConfirmDialog from "../components/ConfirmDialog";
import { useModalEscape } from "../components/useModalEscape";

/**
 * The window around /dashboard's บันทึกยอดขาย / แก้ไขรายการ form: a header,
 * a scrolling body, and a footer with ยกเลิก plus the page's own buttons.
 *
 * Closing it with typing in it — the backdrop, ✕, ยกเลิก or Esc — asks first.
 * A click a few pixels outside the box, or Esc pressed to close a dropdown
 * list, used to throw the whole bill away. While a save (or the serial check
 * before it) is under way it cannot be closed at all: closing mid-check used
 * to let the save carry on behind a closed form.
 *
 * Esc closes one thing at a time: an open dropdown list first (lib/dialogLayer.ts),
 * then whatever `interceptEscape` claims (the page's own questions over the
 * form), then the "ยังไม่ได้บันทึก" question, and only then the form.
 */
export default function SaleFormShell({
  title,
  dirty,
  busy,
  onClose,
  interceptEscape,
  actions,
  notice,
  summary,
  children,
}: {
  title: string;
  /** Whether anything differs from what the form opened with. */
  dirty: boolean;
  /** Saving, or checking before saving — the form stays open. */
  busy: boolean;
  /** Close for good — called once any question has been answered. */
  onClose: () => void;
  /** Closes a question the page has open over the form; true when it did. */
  interceptEscape?: () => boolean;
  /** The footer's buttons after ยกเลิก (the save button). */
  actions: ReactNode;
  /** Said above the footer's buttons — what still stops the save (item 4). */
  notice?: ReactNode;
  /** Beside the footer's buttons — the bill's money as it stands (item 9). */
  summary?: ReactNode;
  children: ReactNode;
}) {
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  const requestClose = () => {
    if (busy) return;
    if (dirty) setConfirmDiscard(true);
    else onClose();
  };

  useModalEscape(dialogRef, () => {
    if (interceptEscape?.()) return;
    if (confirmDiscard) setConfirmDiscard(false);
    else requestClose();
  });

  // The focus comes into the window as it opens, and goes back to whatever
  // opened it (บันทึกยอดขาย, a row's แก้ไข) as it closes. The opener is noted
  // while rendering for the first time, before anything inside can take it.
  const [opener] = useState<HTMLElement | null>(() =>
    typeof document !== "undefined" && document.activeElement instanceof HTMLElement ? document.activeElement : null
  );
  useEffect(() => {
    dialogRef.current?.focus();
    return () => {
      if (opener?.isConnected) opener.focus();
    };
  }, [opener]);

  // A refresh or a closed tab with typing in the form gets the browser's own
  // warning, as on /customers and /suppliers.
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  return (
    <>
      {/* z-100: above the admin bell (z-90), which used to float over the form. */}
      <div className="fixed inset-0 z-100 flex items-center justify-center p-4">
        {/* The backdrop is its own layer, not the parent of the box: a drag
            that starts in a field and ends outside the box (selecting text)
            is then not a click on it. */}
        <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={requestClose} data-testid="sale-form-backdrop"></div>
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="sale-form-title"
          tabIndex={-1}
          className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden outline-none"
        >
          <div className="p-6 border-b border-gray-100 flex justify-between items-center gap-4 shrink-0">
            <h3 id="sale-form-title" className="text-xl font-bold text-gray-800">{title}</h3>
            <button
              type="button"
              onClick={requestClose}
              disabled={busy}
              aria-label="ปิด"
              className="p-2 text-gray-400 hover:text-gray-600 rounded-full hover:bg-gray-100 transition-colors disabled:opacity-50"
            >
              <svg aria-hidden="true" className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-6 space-y-4">{children}</div>

          <div className="p-6 border-t border-gray-100 space-y-3 shrink-0">
            {notice}
            <div className="flex flex-wrap items-center justify-end gap-3">
              {summary && <div className="mr-auto min-w-0">{summary}</div>}
              <button
                type="button"
                onClick={requestClose}
                disabled={busy}
                className="px-5 py-2.5 bg-gray-100 text-gray-700 rounded-xl font-semibold hover:bg-gray-200 transition-all text-sm disabled:opacity-50"
              >
                ยกเลิก
              </button>
              {actions}
            </div>
          </div>
        </div>
      </div>

      {confirmDiscard && (
        <ConfirmDialog
          title="ยังไม่ได้บันทึก"
          message="สิ่งที่กรอกไว้ในฟอร์มนี้จะหายไป ปิดฟอร์มเลยไหม?"
          confirmText="ปิดโดยไม่บันทึก"
          cancelText="กลับไปกรอกต่อ"
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

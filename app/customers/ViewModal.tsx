"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { useModalEscape } from "../components/useModalEscape";

/**
 * The read-only window of a company or a salesperson on /customers: an icon,
 * the name, what it is — and แก้ไข beside ✕, so fixing what you are looking
 * at does not mean closing the window and finding the row's pencil again.
 *
 * A proper dialog: Esc and the backdrop close it, the focus moves into it
 * when it opens and goes back to the row it was opened from when it closes.
 * `z-100` puts it over the admin bell (z-90).
 */
export default function ViewModal({
  name,
  kind,
  icon,
  onClose,
  onEdit,
  children,
}: {
  /** The record's name — the window's title. */
  name: string;
  /** What it is, under the name ("ข้อมูลบริษัท"). */
  kind: ReactNode;
  icon: ReactNode;
  onClose: () => void;
  onEdit: () => void;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalEscape(dialogRef, onClose);

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus();
    return () => {
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  return (
    <div className="fixed inset-0 z-100 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-gray-900/40 backdrop-blur-sm" onClick={onClose} data-testid="view-backdrop"></div>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="view-modal-title"
        tabIndex={-1}
        className="relative bg-white rounded-3xl shadow-2xl max-w-xl w-full max-h-[90vh] overflow-y-auto p-8 outline-none"
      >
        <div className="flex items-start justify-between gap-4 mb-6">
          <div className="flex items-center gap-4 min-w-0">
            <div className="w-16 h-16 bg-orange-100 text-orange-600 rounded-2xl flex items-center justify-center shrink-0">
              {icon}
            </div>
            <div className="min-w-0">
              <h2 id="view-modal-title" className="text-2xl font-bold text-gray-900 break-words">{name}</h2>
              <p className="text-gray-500">{kind}</p>
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={onEdit}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-semibold text-orange-700 bg-orange-50 hover:bg-orange-100 rounded-xl transition-colors"
            >
              <svg aria-hidden="true" className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
              แก้ไข
            </button>
            <button
              type="button"
              aria-label="ปิด"
              onClick={onClose}
              className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors"
            >
              <svg aria-hidden="true" className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
            </button>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}

"use client";

import type React from "react";

/**
 * The icon buttons at the end of a clickable table row: copy (optional), edit,
 * delete. Delete waits for the row (`group`) to be hovered or focused — a red
 * "ลบ" on every one of hundreds of rows was one slip away. A click here never
 * reaches the row; of the keys, only Enter / Space (the button's own) are kept
 * from it, so Esc still reaches a window-level listener.
 */
export default function RowActions({
  name,
  onEdit,
  onDelete,
  onCopy,
}: {
  name: string;
  onEdit: () => void;
  onDelete: () => void;
  onCopy?: () => void;
}) {
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  const stopActivation = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") e.stopPropagation();
  };
  return (
    <div className="flex items-center justify-end gap-1">
      {onCopy && (
        <button
          type="button"
          onClick={(e) => { stop(e); onCopy(); }}
          onKeyDown={stopActivation}
          aria-label={`ทำสำเนา ${name}`}
          title="ทำสำเนา"
          className="p-1.5 text-gray-400 hover:text-orange-600 hover:bg-orange-50 rounded-lg transition-colors"
        >
          <svg aria-hidden="true" className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
        </button>
      )}
      <button
        type="button"
        onClick={(e) => { stop(e); onEdit(); }}
        onKeyDown={stopActivation}
        aria-label={`แก้ไข ${name}`}
        title="แก้ไข"
        className="p-1.5 text-gray-400 hover:text-orange-600 hover:bg-orange-50 rounded-lg transition-colors"
      >
        <svg aria-hidden="true" className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
      </button>
      <button
        type="button"
        onClick={(e) => { stop(e); onDelete(); }}
        onKeyDown={stopActivation}
        aria-label={`ลบ ${name}`}
        title="ลบ"
        className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100"
      >
        <svg aria-hidden="true" className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
      </button>
    </div>
  );
}

/** Enter / Space on a FOCUSED row opens it — a clickable row is otherwise
 *  mouse-only. A key pressed on a button inside the row is that button's. */
export function openOnKey(open: () => void) {
  return (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      open();
    }
  };
}

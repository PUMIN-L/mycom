"use client";

import { useState } from "react";

/**
 * A table pager: which rows of how many, first / previous / next / last, and a
 * box to type a page number into — a list of ~6,000 customers is 120 pages,
 * and stepping through them one "ถัดไป" at a time was the only way across.
 * Renders nothing when everything fits on one page.
 */
export default function Pagination({
  page,
  totalPages,
  totalItems,
  perPage,
  onPageChange,
  testId,
}: {
  page: number;
  totalPages: number;
  totalItems: number;
  perPage: number;
  onPageChange: (page: number) => void;
  testId?: string;
}) {
  // What is typed, until Enter or leaving the box applies it — null means
  // "showing the current page". Kept apart from `page` so a half-typed number
  // never moves the table, and a page changed from outside (a new search) is
  // simply shown.
  const [typed, setTyped] = useState<string | null>(null);
  const fmt = (n: number) => n.toLocaleString("th-TH");

  if (totalPages <= 1) return null;

  const go = (target: number) => onPageChange(Math.min(totalPages, Math.max(1, target)));
  const applyTyped = () => {
    if (typed === null) return;
    const n = Number(typed);
    if (Number.isInteger(n) && typed.trim() !== "") go(n);
    setTyped(null);
  };

  const button =
    "px-3 py-1.5 text-sm bg-white border border-gray-200 text-gray-600 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed";

  return (
    <div className="flex flex-wrap justify-between items-center gap-3 mt-6" data-testid={testId}>
      <div className="text-sm text-gray-500">
        แสดง {fmt((page - 1) * perPage + 1)} ถึง {fmt(Math.min(page * perPage, totalItems))} จาก {fmt(totalItems)} รายการ
      </div>
      <div className="flex items-center gap-1">
        <button type="button" disabled={page === 1} onClick={() => go(1)} aria-label="หน้าแรก" title="หน้าแรก" className={button}>
          «
        </button>
        <button type="button" disabled={page === 1} onClick={() => go(page - 1)} className={button}>
          ก่อนหน้า
        </button>
        <label className="flex items-center gap-1.5 px-2 text-sm font-medium text-gray-700">
          หน้า
          <input
            type="text"
            inputMode="numeric"
            aria-label="ไปที่หน้า"
            value={typed ?? String(page)}
            onChange={(e) => setTyped(e.target.value.replace(/\D/g, ""))}
            onBlur={applyTyped}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                applyTyped();
              }
            }}
            className="w-12 rounded-lg border border-gray-200 px-2 py-1 text-center tabular-nums outline-none focus:ring-2 focus:ring-orange-500"
          />
          <span>/ {totalPages}</span>
        </label>
        <button type="button" disabled={page === totalPages} onClick={() => go(page + 1)} className={button}>
          ถัดไป
        </button>
        <button type="button" disabled={page === totalPages} onClick={() => go(totalPages)} aria-label="หน้าสุดท้าย" title="หน้าสุดท้าย" className={button}>
          »
        </button>
      </div>
    </div>
  );
}

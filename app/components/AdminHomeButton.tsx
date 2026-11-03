"use client";

import Link from "next/link";
import type React from "react";

export const ADMIN_HOME_HREF = "/adminpanel";
export const ADMIN_HOME_LABEL = "กลับหน้าระบบจัดการ";

/**
 * The way back to the admin hub, the same on every admin page: a real button
 * — bordered, a home icon, dark text, 40px tall — where several pages had a
 * faint grey "← กลับไป Admin Panel" that was easy to miss and hard to hit on
 * a phone, and each page worded it differently.
 *
 * Always a link to /adminpanel, so it can be opened in a new tab. A page with
 * unsaved work passes `onNavigate` (its leave guard): a plain click then goes
 * through that instead; a ctrl / ⌘ / shift / middle click still opens a new
 * tab and leaves this one, and its work, alone.
 */
export default function AdminHomeButton({
  onNavigate,
  className = "",
}: {
  onNavigate?: () => void;
  className?: string;
}) {
  const onClick = onNavigate
    ? (e: React.MouseEvent<HTMLAnchorElement>) => {
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        onNavigate();
      }
    : undefined;
  return (
    <Link
      href={ADMIN_HOME_HREF}
      onClick={onClick}
      className={`inline-flex min-h-10 shrink-0 items-center gap-2 whitespace-nowrap rounded-xl border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-800 shadow-sm transition-colors hover:border-orange-300 hover:bg-orange-50 hover:text-orange-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400 focus-visible:ring-offset-1 ${className}`}
    >
      <svg aria-hidden="true" className="h-5 w-5 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
        />
      </svg>
      {ADMIN_HOME_LABEL}
    </Link>
  );
}

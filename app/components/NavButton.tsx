"use client";

import Link from "next/link";
import type React from "react";

export type NavButtonIcon = "home" | "dashboard" | "back";

const ICON_PATHS: Record<NavButtonIcon, string> = {
  home: "M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6",
  dashboard:
    "M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z",
  back: "M10 19l-7-7m0 0l7-7m-7 7h18",
};

/**
 * A "go back to …" control that reads as a button — bordered, an orange icon,
 * dark text, 40px tall — the same wherever a page leads back somewhere. Pages
 * used to do this with a faint grey "← กลับไป …" text link: easy to miss, hard
 * to hit on a phone, and worded differently on every page.
 *
 * Always a real link (so ctrl / ⌘ / middle click opens a new tab). A page with
 * unsaved work passes `onNavigate`, its leave guard: a plain click then goes
 * through that instead, while a modified click still opens a new tab and
 * leaves this one, and its work, alone.
 */
export default function NavButton({
  href,
  label,
  icon = "back",
  onNavigate,
  className = "",
}: {
  href: string;
  label: string;
  icon?: NavButtonIcon;
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
      href={href}
      onClick={onClick}
      className={`inline-flex min-h-10 shrink-0 items-center gap-2 whitespace-nowrap rounded-xl border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-800 shadow-sm transition-colors hover:border-orange-300 hover:bg-orange-50 hover:text-orange-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400 focus-visible:ring-offset-1 ${className}`}
    >
      <svg aria-hidden="true" className="h-5 w-5 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={ICON_PATHS[icon]} />
      </svg>
      {label}
    </Link>
  );
}

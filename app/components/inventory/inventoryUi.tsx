"use client";
// Small shared pieces of the /assets and /stock pages.

import { useCallback, useEffect, useRef, useState } from "react";
import type { InventoryKind } from "../../lib/types";
import { inventoryStatus, inventoryStatusLabel } from "../../lib/inventoryStatus";
import { toLocalDateString } from "../../lib/dateFormat";

export type ToastState = { message: string; type: "success" | "error" } | null;

/** A toast that stays its full time: a new one replaces the old and restarts
 *  the clock (the old one's timer no longer cuts the new one short). */
export function useToast(ms = 3500): [ToastState, (message: string, type?: "success" | "error") => void] {
  const [toast, setToast] = useState<ToastState>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const show = useCallback(
    (message: string, type: "success" | "error" = "success") => {
      if (timer.current) clearTimeout(timer.current);
      setToast({ message, type });
      timer.current = setTimeout(() => setToast(null), ms);
    },
    [ms]
  );
  return [toast, show];
}

/** "฿1,500" / "฿1,500.50" */
export function formatBaht(n: number): string {
  const whole = Number.isInteger(n);
  return `฿${n.toLocaleString("th-TH", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 })}`;
}

export function StatusBadge({ kind, status, className = "" }: { kind: InventoryKind; status: string; className?: string }) {
  const def = inventoryStatus(kind, status);
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-semibold ${
        def?.badge ?? "bg-gray-100 text-gray-600 border-gray-200"
      } ${className}`}
    >
      {inventoryStatusLabel(kind, status)}
    </span>
  );
}

/** "YYYY-MM-DD" → a local Date for the date picker (null when empty/invalid). */
export function dateFromString(value: string | null | undefined): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? "");
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export function stringFromDate(date: Date | null): string {
  return date ? toLocalDateString(date) : "";
}

/** fetch + JSON, throwing the server's Thai message on a non-2xx answer. */
export async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* empty or non-JSON body */
  }
  if (!res.ok) {
    const message = (data as { error?: unknown } | null)?.error;
    if (res.status === 401) throw new Error("หมดเวลาการเข้าสู่ระบบ กรุณาเข้าสู่ระบบใหม่");
    throw new Error(typeof message === "string" && message ? message : "เกิดข้อผิดพลาด กรุณาลองใหม่");
  }
  return data as T;
}

/** The API base of one register. */
export function inventoryApi(kind: InventoryKind): string {
  return `/api/admin/inventory/${kind}`;
}

// text-base below sm: iOS Safari zooms the page into any field under 16px.
export const inputClass =
  "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-base sm:text-sm text-gray-900 shadow-sm focus:border-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-100";

export function Field({
  label,
  required,
  children,
  hint,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
  hint?: React.ReactNode;
}) {
  return (
    // A div, not a <label>: the control inside may be a dropdown button, and a
    // label would forward every click on its text to it.
    <div className="block">
      <span className="mb-1 block text-sm font-semibold text-gray-700">
        {label}
        {required && <span className="text-red-500"> *</span>}
      </span>
      {children}
      {hint && <span className="mt-1 block text-xs">{hint}</span>}
    </div>
  );
}

/** A dialog box: full width on a phone, centred on a larger screen. Above the
 *  admin bell (GlobalAdminBell, z-[90], bottom-left), which would otherwise sit
 *  on a phone dialog's buttons; below ConfirmDialog (z-[100]). */
export function Modal({
  title,
  onClose,
  children,
  footer,
  wide,
  error,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
  /** Shown in the footer, beside the buttons — never at the bottom of a long
   *  form, scrolled out of sight of the button that was just pressed. */
  error?: string;
}) {
  return (
    <div className="fixed inset-0 z-[95] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div
        className={`flex max-h-[92vh] supports-[height:100dvh]:max-h-[92dvh] w-full flex-col rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl ${
          wide ? "sm:max-w-2xl" : "sm:max-w-lg"
        }`}
      >
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <h2 className="text-lg font-bold text-gray-900">{title}</h2>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700" aria-label="ปิด">
            ✕
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {(footer || error) && (
          <div className="flex flex-wrap justify-end gap-2 border-t border-gray-100 px-5 py-3">
            {error && (
              <p role="alert" className="w-full whitespace-pre-wrap rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-600">
                {error}
              </p>
            )}
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

export const primaryButton =
  "inline-flex items-center justify-center gap-1.5 rounded-xl bg-orange-500 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-orange-600 disabled:opacity-60";
export const secondaryButton =
  "inline-flex items-center justify-center gap-1.5 rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 disabled:opacity-60";
export const dangerButton =
  "inline-flex items-center justify-center gap-1.5 rounded-xl bg-red-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-red-600 disabled:opacity-60";

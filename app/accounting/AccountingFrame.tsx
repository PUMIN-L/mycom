"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import AdminHomeButton from "../components/AdminHomeButton";
import Spinner from "../components/Spinner";
import { SESSION_EXPIRED_MESSAGE } from "../lib/apiErrorMessage";

/** The module's pages, in the order its tabs show them. */
export const ACCOUNTING_TABS = [
  { key: "home", href: "/accounting", label: "หน้าหลักบัญชี" },
  { key: "orders", href: "/accounting/sales-orders", label: "PO ลูกค้า" },
  { key: "invoices", href: "/accounting/invoices", label: "ใบแจ้งหนี้ / ใบกำกับภาษี" },
  { key: "receipts", href: "/accounting/receipts", label: "ใบเสร็จรับเงิน" },
  { key: "receivables", href: "/accounting/receivables", label: "ลูกหนี้คงค้าง" },
  { key: "settings", href: "/accounting/settings", label: "ตั้งค่าบัญชี" },
] as const;
export type AccountingTabKey = (typeof ACCOUNTING_TABS)[number]["key"];

type Gate =
  | { state: "loading" }
  | { state: "ok"; username: string }
  | { state: "needs-2fa" }
  | { state: "disabled" }
  | { state: "signed-out" }
  | { state: "error" };

/**
 * Asks /api/accounting/status whether the signed-in admin may use the module.
 * The routes check the same things on every request — this only decides what
 * the page SHOWS instead of a wall of failed requests.
 */
export function useAccountingGate(): { gate: Gate; retry: () => void } {
  const [gate, setGate] = useState<Gate>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let next: Gate;
      try {
        const res = await fetch("/api/accounting/status", { cache: "no-store" });
        if (res.status === 401) next = { state: "signed-out" };
        else if (res.status === 404) next = { state: "disabled" };
        else if (!res.ok) next = { state: "error" };
        else {
          const body = await res.json();
          next = body?.twoFactorEnabled ? { state: "ok", username: String(body.username ?? "") } : { state: "needs-2fa" };
        }
      } catch {
        next = { state: "error" };
      }
      if (!cancelled) setGate(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [attempt]);
  const retry = useCallback(() => {
    setGate({ state: "loading" });
    setAttempt((n) => n + 1);
  }, []);
  return { gate, retry };
}

function GatePanel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-8 text-center max-w-xl mx-auto" role="alert">
      <h2 className="text-lg font-bold text-gray-900 mb-2">{title}</h2>
      <div className="text-sm text-gray-600 space-y-3">{children}</div>
    </div>
  );
}

/**
 * Every accounting page: the header (title, tabs, the way back to the admin
 * hub) and, until the admin may use the module, a plain explanation instead
 * of the page — "turn 2FA on first", "sign in again", "could not check".
 */
export default function AccountingFrame({
  tab,
  title,
  actions,
  children,
}: {
  tab: AccountingTabKey;
  title: string;
  /** Buttons at the right of the title (e.g. สร้างใหม่). */
  actions?: ReactNode;
  children: ReactNode;
}) {
  const { gate, retry } = useAccountingGate();

  return (
    <main className="min-h-screen bg-gray-50 pb-32">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-4">
          <div className="min-w-0">
            <p className="text-sm text-gray-500 mb-1">ระบบบัญชี</p>
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">{title}</h1>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <AdminHomeButton />
            {gate.state === "ok" && actions}
          </div>
        </div>

        <nav aria-label="เมนูระบบบัญชี" className="flex gap-1 border-b border-gray-200 mb-6 overflow-x-auto">
          {ACCOUNTING_TABS.map((t) => (
            <Link
              key={t.key}
              href={t.href}
              aria-current={t.key === tab ? "page" : undefined}
              className={`px-4 py-2.5 text-sm font-semibold whitespace-nowrap border-b-2 -mb-px transition-colors ${
                t.key === tab ? "border-sky-600 text-sky-700" : "border-transparent text-gray-500 hover:text-gray-800"
              }`}
            >
              {t.label}
            </Link>
          ))}
        </nav>

        {gate.state === "loading" && (
          <div className="flex justify-center py-16 text-gray-500" aria-live="polite">
            <Spinner className="h-6 w-6 text-sky-600" />
            <span className="sr-only">กำลังตรวจสอบสิทธิ์…</span>
          </div>
        )}
        {gate.state === "needs-2fa" && (
          <GatePanel title="เปิดการยืนยันตัวตนสองขั้นตอน (2FA) ก่อนใช้ระบบบัญชี">
            <p>
              ระบบบัญชีเก็บข้อมูลเงินและเลขผู้เสียภาษีของลูกค้าทุกราย จึงเปิดให้ใช้เฉพาะบัญชีที่เปิด 2FA แล้ว —
              ถ้ารหัสผ่านรั่ว คนอื่นก็ยังเข้าไม่ได้
            </p>
            <Link
              href="/settings#two-factor"
              className="inline-block px-5 py-2.5 rounded-xl bg-sky-600 text-white font-semibold hover:bg-sky-700"
            >
              ไปเปิด 2FA ที่หน้าตั้งค่า
            </Link>
          </GatePanel>
        )}
        {gate.state === "signed-out" && (
          <GatePanel title={SESSION_EXPIRED_MESSAGE}>
            <Link href="/login?next=/accounting" className="inline-block px-5 py-2.5 rounded-xl bg-sky-600 text-white font-semibold hover:bg-sky-700">
              เข้าสู่ระบบ
            </Link>
          </GatePanel>
        )}
        {gate.state === "disabled" && (
          <GatePanel title="ระบบบัญชียังไม่เปิดใช้งาน">
            <p>ระบบนี้ยังอยู่ระหว่างทำ จะเปิดให้ใช้เมื่อพร้อม</p>
          </GatePanel>
        )}
        {gate.state === "error" && (
          <GatePanel title="ตรวจสอบสิทธิ์ไม่สำเร็จ">
            <p>ตรวจสอบการเชื่อมต่อแล้วลองใหม่</p>
            <button type="button" onClick={retry} className="px-5 py-2.5 rounded-xl border border-gray-300 font-semibold hover:bg-gray-50">
              ลองใหม่
            </button>
          </GatePanel>
        )}
        {gate.state === "ok" && children}
      </div>
    </main>
  );
}

"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import AccountingFrame from "./AccountingFrame";
import Spinner from "../components/Spinner";
import { formatDisplayDateTime } from "../lib/dateFormat";
import type { AccountingSettings, AuditEntry } from "../lib/accounting/types";

export default function AccountingHomePage() {
  return (
    <AccountingFrame tab="home" title="หน้าหลักบัญชี">
      <HomeBody />
    </AccountingFrame>
  );
}

type Loaded = { settings: AccountingSettings; audit: AuditEntry[] };

function HomeBody() {
  const [state, setState] = useState<{ status: "loading" } | { status: "error" } | ({ status: "ok" } & Loaded)>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [settingsRes, auditRes] = await Promise.all([
          fetch("/api/accounting/settings", { cache: "no-store" }),
          fetch("/api/accounting/audit?limit=10", { cache: "no-store" }),
        ]);
        if (!settingsRes.ok || !auditRes.ok) throw new Error("load failed");
        const loaded: Loaded = { settings: await settingsRes.json(), audit: await auditRes.json() };
        if (!cancelled) setState({ status: "ok", ...loaded });
      } catch {
        if (!cancelled) setState({ status: "error" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  if (state.status === "loading") {
    return (
      <div className="flex justify-center py-16">
        <Spinner className="h-6 w-6 text-sky-600" />
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div role="alert" className="bg-white rounded-2xl border border-red-100 p-6 text-center space-y-3">
        <p className="text-red-700">โหลดข้อมูลระบบบัญชีไม่สำเร็จ</p>
        <button
          type="button"
          onClick={() => { setState({ status: "loading" }); setAttempt((n) => n + 1); }}
          className="px-5 py-2.5 rounded-xl border border-gray-300 font-semibold hover:bg-gray-50"
        >
          ลองใหม่
        </button>
      </div>
    );
  }

  const { settings, audit } = state;
  const steps = [
    { done: !!settings.sellerVersionId, label: "ข้อมูลบริษัทสำหรับพิมพ์บนเอกสาร (ชื่อ ที่อยู่ เลขผู้เสียภาษี)", href: "/accounting/settings" },
    { done: settings.bankAccounts.some((b) => b.isActive), label: "บัญชีธนาคารที่รับเงิน", href: "/accounting/settings" },
    { done: true, label: "เปิดการยืนยันตัวตนสองขั้นตอน (2FA)", href: "/settings#two-factor" },
  ];
  const ready = steps.every((s) => s.done);

  return (
    <div className="space-y-6">
      <section className="bg-white rounded-2xl border border-gray-200 p-6" aria-labelledby="acc-setup-title">
        <h2 id="acc-setup-title" className="text-lg font-bold text-gray-900 mb-1">
          {ready ? "พร้อมออกเอกสารแล้ว" : "ตั้งค่าให้ครบก่อนเริ่มออกเอกสาร"}
        </h2>
        <p className="text-sm text-gray-500 mb-4">ข้อมูลเหล่านี้พิมพ์บนใบแจ้งหนี้และใบกำกับภาษีทุกใบ</p>
        <ul className="space-y-2" data-testid="acc-setup-steps">
          {steps.map((s) => (
            <li key={s.label} className="flex items-center gap-3">
              <span
                aria-hidden="true"
                className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${s.done ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}
              >
                {s.done ? "✓" : "!"}
              </span>
              <span className="flex-1 text-gray-800">{s.label}</span>
              <span className="sr-only">{s.done ? "เรียบร้อย" : "ยังไม่ได้ทำ"}</span>
              {!s.done && (
                <Link href={s.href} className="text-sm font-semibold text-sky-700 hover:text-sky-800">ไปตั้งค่า</Link>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="bg-white rounded-2xl border border-gray-200 p-6" aria-labelledby="acc-audit-title">
        <h2 id="acc-audit-title" className="text-lg font-bold text-gray-900 mb-4">การทำรายการล่าสุด</h2>
        {audit.length === 0 ? (
          <p className="text-sm text-gray-500">ยังไม่มีการทำรายการ</p>
        ) : (
          <ul className="divide-y divide-gray-100" data-testid="acc-audit">
            {audit.map((a) => (
              <li key={a.id} className="py-2.5 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                <span className="text-gray-500 tabular-nums w-40 shrink-0">{formatDisplayDateTime(a.at)}</span>
                <span className="text-gray-800 flex-1 min-w-0">
                  {a.docNo && <span className="font-semibold mr-1">{a.docNo}</span>}
                  {a.detail || a.action}
                </span>
                <span className="text-gray-500">{a.username}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { errorMessageOf } from "../lib/apiErrorMessage";
import { formatDisplayDate } from "../lib/dateFormat";
import { formatSatang } from "../lib/accounting/money";

interface BacklogRow {
  id: string;
  customerPoNo: string;
  buyerName: string;
  projectName: string;
  expectedDeliveryDate: string | null;
  backlogSatang: number;
  late: boolean;
}
interface Backlog {
  rows: BacklogRow[];
  totals: { backlogSatang: number; count: number; lateSatang: number; lateCount: number };
}

/** Rows shown here; the rest are a click away on /accounting/sales-orders. */
const SHOWN = 8;

type State = { status: "loading" } | { status: "hidden" } | { status: "error"; message: string } | { status: "ok"; data: Backlog };

/**
 * "ยอดรอส่งของ · ณ วันนี้" — what customers have ordered (a PO received) and
 * we have not delivered or invoiced yet. As of TODAY, whatever period the page
 * shows above, and kept OUT of its sales figures: it becomes sales delivery by
 * delivery, when each is invoiced. Late deliveries first, in red.
 */
export default function BacklogSection() {
  const [state, setState] = useState<State>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/accounting/sales-orders/backlog", { cache: "no-store" });
        // The module switched off for this deployment: nothing to show.
        if (res.status === 404) {
          if (!cancelled) setState({ status: "hidden" });
          return;
        }
        if (!res.ok) {
          const message = await errorMessageOf(res, "โหลดยอดรอส่งของไม่สำเร็จ");
          if (!cancelled) setState({ status: "error", message });
          return;
        }
        const data = (await res.json()) as Partial<Backlog> | null;
        if (cancelled) return;
        // A side section must never take the dashboard down with it.
        if (!data || !Array.isArray(data.rows) || !data.totals || typeof data.totals.backlogSatang !== "number") {
          setState({ status: "error", message: "โหลดยอดรอส่งของไม่สำเร็จ" });
          return;
        }
        setState({ status: "ok", data: data as Backlog });
      } catch {
        if (!cancelled) setState({ status: "error", message: "โหลดยอดรอส่งของไม่สำเร็จ ตรวจสอบการเชื่อมต่อแล้วลองใหม่" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  if (state.status === "hidden") return null;

  return (
    <section className="bg-white rounded-2xl p-6 shadow-sm border border-amber-200 mb-8" aria-labelledby="backlog-title" data-testid="backlog-section">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 mb-4">
        <div>
          <h2 id="backlog-title" className="text-lg font-bold text-gray-800">ยอดรอส่งของ · ณ วันนี้</h2>
          <p className="text-sm text-gray-500">ลูกค้าออก PO แล้ว ยังไม่ส่งของ / ยังไม่ออกใบแจ้งหนี้ — ไม่รวมในยอดขายด้านบน</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Link href="/accounting/sales-orders" className="text-sm font-semibold text-sky-700 hover:text-sky-800">ดู PO ทั้งหมด</Link>
          <Link href="/accounting/sales-orders/new" className="px-4 py-2 rounded-full bg-white border border-amber-300 text-amber-800 text-sm font-semibold hover:bg-amber-50">
            + รับ PO ลูกค้า
          </Link>
        </div>
      </div>

      {state.status === "loading" && <div className="h-16 rounded-xl bg-gray-100 animate-pulse" aria-label="กำลังโหลดยอดรอส่งของ" />}
      {state.status === "error" && (
        <div role="alert" className="text-sm space-y-2">
          <p className="text-red-700">{state.message}</p>
          <button type="button" onClick={() => { setState({ status: "loading" }); setAttempt((n) => n + 1); }}
            className="font-semibold text-sky-700 hover:text-sky-800">ลองใหม่</button>
        </div>
      )}
      {state.status === "ok" && <BacklogBody data={state.data} />}
    </section>
  );
}

function BacklogBody({ data }: { data: Backlog }) {
  const { totals } = data;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4" data-testid="backlog-totals">
        <div className="rounded-xl bg-amber-50/60 border border-amber-100 px-4 py-3">
          <p className="text-sm text-gray-600">รอส่งทั้งหมด (ก่อน VAT)</p>
          <p className="text-2xl font-bold tabular-nums text-gray-900">฿{formatSatang(totals.backlogSatang)}</p>
          <p className="text-xs text-gray-500">{totals.count} PO</p>
        </div>
        <div className={`rounded-xl border px-4 py-3 ${totals.lateCount > 0 ? "bg-red-50 border-red-100" : "bg-gray-50 border-gray-100"}`}>
          <p className="text-sm text-gray-600">เกินกำหนดส่ง</p>
          <p className={`text-2xl font-bold tabular-nums ${totals.lateCount > 0 ? "text-red-600" : "text-gray-900"}`}>฿{formatSatang(totals.lateSatang)}</p>
          <p className="text-xs text-gray-500">{totals.lateCount} PO</p>
        </div>
      </div>

      {data.rows.length === 0 ? (
        <p className="text-sm text-gray-500">ไม่มี PO ที่รอส่งของ</p>
      ) : (
        <>
          <table className="w-full text-sm hidden md:table" data-testid="backlog-table">
            <thead>
              <tr className="text-left text-gray-500 border-b border-gray-100">
                <th className="pb-2 pr-4 font-semibold">PO ลูกค้า</th>
                <th className="pb-2 pr-4 font-semibold">ลูกค้า</th>
                <th className="pb-2 pr-4 font-semibold text-right">รอส่ง (ก่อน VAT)</th>
                <th className="pb-2 pr-4 font-semibold">กำหนดส่ง</th>
                <th className="pb-2"><span className="sr-only">ส่งของ</span></th>
              </tr>
            </thead>
            <tbody>
              {data.rows.slice(0, SHOWN).map((r) => (
                <tr key={r.id} className="border-b border-gray-50">
                  <td className="py-2.5 pr-4">
                    <Link href={`/accounting/sales-orders/${r.id}`} className="font-semibold tabular-nums text-gray-900 hover:text-sky-700">{r.customerPoNo}</Link>
                  </td>
                  <td className="py-2.5 pr-4">
                    <div className="text-gray-900">{r.buyerName}</div>
                    {r.projectName && <div className="text-xs text-gray-500">{r.projectName}</div>}
                  </td>
                  <td className="py-2.5 pr-4 text-right tabular-nums font-semibold">{formatSatang(r.backlogSatang)}</td>
                  <td className={`py-2.5 pr-4 tabular-nums whitespace-nowrap ${r.late ? "text-red-600 font-semibold" : "text-gray-700"}`}>
                    {r.expectedDeliveryDate ? formatDisplayDate(r.expectedDeliveryDate) : "—"}
                    {r.late && " (เลยแล้ว)"}
                  </td>
                  <td className="py-2.5 text-right">
                    <Link href={`/accounting/invoices/new?fromOrder=${encodeURIComponent(r.id)}`}
                      className="px-3 py-1.5 rounded-full bg-[#065f46] text-white text-xs font-semibold hover:bg-[#047857] whitespace-nowrap">
                      ส่งของ ▸
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <ul className="md:hidden divide-y divide-gray-100">
            {data.rows.slice(0, SHOWN).map((r) => (
              <li key={r.id} className="py-3 flex items-center justify-between gap-3">
                <Link href={`/accounting/sales-orders/${r.id}`} className="min-w-0">
                  <p className="font-semibold tabular-nums text-gray-900">{r.customerPoNo}</p>
                  <p className="text-sm text-gray-600 truncate">{r.buyerName}</p>
                  <p className={`text-xs tabular-nums ${r.late ? "text-red-600 font-semibold" : "text-gray-500"}`}>
                    {formatSatang(r.backlogSatang)} · {r.expectedDeliveryDate ? `ส่ง ${formatDisplayDate(r.expectedDeliveryDate)}` : "ไม่ระบุกำหนดส่ง"}
                    {r.late && " (เลยแล้ว)"}
                  </p>
                </Link>
                <Link href={`/accounting/invoices/new?fromOrder=${encodeURIComponent(r.id)}`}
                  className="px-3 py-1.5 rounded-full bg-[#065f46] text-white text-xs font-semibold whitespace-nowrap">
                  ส่งของ ▸
                </Link>
              </li>
            ))}
          </ul>
          {data.rows.length > SHOWN && (
            <Link href="/accounting/sales-orders" className="inline-block text-sm font-semibold text-sky-700 hover:text-sky-800">
              ดูอีก {data.rows.length - SHOWN} PO →
            </Link>
          )}
        </>
      )}
    </div>
  );
}

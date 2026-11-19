"use client";

import Link from "next/link";
import { Fragment, useEffect, useState } from "react";
import AccountingFrame from "../AccountingFrame";
import Spinner from "../../components/Spinner";
import { Cert50Dialog } from "../payments/PaymentsPanel";
import { errorMessageOf } from "../../lib/apiErrorMessage";
import { formatDisplayDate } from "../../lib/dateFormat";
import { formatSatang } from "../../lib/accounting/money";
import { AGEING_BUCKETS, type AgeingBucket } from "../../lib/accounting/paymentRules";

interface ReceivableInvoiceView {
  id: string;
  docNo: string | null;
  issueDate: string;
  dueDate: string | null;
  totalSatang: number;
  paidSatang: number;
  outstandingSatang: number;
  daysOverdue: number;
  bucket: AgeingBucket;
}
interface GroupView {
  key: string;
  name: string;
  outstandingSatang: number;
  buckets: Record<AgeingBucket, number>;
  invoices: ReceivableInvoiceView[];
}
interface MissingCert50View {
  paymentId: string;
  invoiceId: string;
  /** A deposit's withholding — paid against a customer PO. */
  deposit?: boolean;
  /** Received against a billing note — the note it names. */
  billing?: boolean;
  invoiceNo: string | null;
  buyerName: string;
  paidDate: string;
  receiptNo: string;
  whtPercent: number;
  whtSatang: number;
}
interface ReceivablesView {
  today: string;
  groups: GroupView[];
  totals: Record<AgeingBucket, number> & { all: number };
  missingCert50: MissingCert50View[];
  missingCert50Satang: number;
  /** Paid beyond what a credit note left the invoice at (step 8). */
  refundsDue?: { invoiceId: string; invoiceNo: string | null; buyerName: string; refundDueSatang: number }[];
}

export default function ReceivablesPage() {
  return (
    <AccountingFrame tab="receivables" title="ลูกหนี้คงค้าง">
      <Receivables />
    </AccountingFrame>
  );
}

const BUCKET_TONE: Record<AgeingBucket, string> = {
  current: "text-gray-900",
  d1_30: "text-amber-700",
  d31_60: "text-orange-700",
  d61_90: "text-red-600",
  d90plus: "text-red-700 font-bold",
};

/**
 * Who owes what as of today, by customer and by how late (from the due
 * date) — and the 50 ทวิ certificates still to come in, each one ticked off
 * here when the paper arrives.
 */
function Receivables() {
  const [state, setState] = useState<{ status: "loading" } | { status: "error"; message: string } | { status: "ok"; data: ReceivablesView }>({ status: "loading" });
  const [reload, setReload] = useState(0);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [cert50, setCert50] = useState<MissingCert50View | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/accounting/receivables", { cache: "no-store" });
        if (!res.ok) {
          const message = await errorMessageOf(res, "โหลดลูกหนี้คงค้างไม่สำเร็จ");
          if (!cancelled) setState({ status: "error", message });
          return;
        }
        const data: ReceivablesView = await res.json();
        if (!cancelled) setState({ status: "ok", data });
      } catch {
        if (!cancelled) setState({ status: "error", message: "โหลดลูกหนี้คงค้างไม่สำเร็จ ตรวจสอบการเชื่อมต่อแล้วลองใหม่" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reload]);

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
        <p className="text-red-700">{state.message}</p>
        <button type="button" onClick={() => { setState({ status: "loading" }); setReload((n) => n + 1); }}
          className="px-5 py-2.5 rounded-xl border border-gray-300 font-semibold hover:bg-gray-50">ลองใหม่</button>
      </div>
    );
  }

  const { data } = state;
  const overdue = data.totals.all - data.totals.current;
  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4" data-testid="receivables-summary">
        <Card label="ค้างรับทั้งหมด" value={`฿${formatSatang(data.totals.all)}`} note={`${data.groups.length} ราย`} tone="text-orange-600" />
        <Card label="ยังไม่ถึงกำหนด" value={`฿${formatSatang(data.totals.current)}`} note={`ณ วันที่ ${formatDisplayDate(data.today)}`} tone="text-gray-900" />
        <Card label="เกินกำหนดแล้ว" value={`฿${formatSatang(overdue)}`} note={data.totals.d90plus > 0 ? `เกิน 90 วัน ฿${formatSatang(data.totals.d90plus)}` : "ไม่มีที่เกิน 90 วัน"} tone={overdue > 0 ? "text-red-600" : "text-gray-900"} />
        <Card label="รอ 50 ทวิ จากลูกค้า" value={`฿${formatSatang(data.missingCert50Satang)}`} note={`${data.missingCert50.length} รายการ`} tone={data.missingCert50.length > 0 ? "text-amber-700" : "text-gray-900"} />
      </div>

      {(data.refundsDue ?? []).length > 0 && (
        <section className="bg-white rounded-2xl border border-red-200 overflow-hidden" data-testid="refunds-due">
          <h2 className="px-5 pt-4 pb-1 font-bold text-red-700">ต้องคืนเงินลูกค้า</h2>
          <p className="px-5 pb-3 text-sm text-gray-500">ใบลดหนี้ลดยอดลงมากกว่าที่ยังค้าง ลูกค้าจึงจ่ายเกิน — คืนเงิน (เปิดใบแจ้งหนี้ แล้วกด บันทึกคืนเงินลูกค้า) หรือเก็บไว้หักใบถัดไป</p>
          <ul className="divide-y divide-gray-100 text-sm tabular-nums">
            {(data.refundsDue ?? []).map((r) => (
              <li key={r.invoiceId} className="px-5 py-2.5 flex justify-between gap-3">
                <span>
                  <Link href={`/accounting/invoices/${r.invoiceId}`} className="font-semibold text-sky-700 hover:text-sky-800">{r.invoiceNo}</Link>
                  <span className="text-gray-600"> · {r.buyerName}</span>
                </span>
                <span className="font-semibold text-red-600">{formatSatang(r.refundDueSatang)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        <h2 className="px-5 pt-4 pb-2 font-bold text-gray-900">อายุลูกหนี้ตามลูกค้า</h2>
        {data.groups.length === 0 ? (
          <p className="px-5 pb-6 text-gray-500">ไม่มียอดค้างรับ — ทุกใบเก็บเงินครบแล้ว</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm tabular-nums" data-testid="ageing-table">
              <thead>
                <tr className="bg-sky-600 text-white text-left">
                  <th className="py-3 px-4 font-semibold">ลูกค้า</th>
                  {AGEING_BUCKETS.map((b) => (
                    <th key={b.key} className="py-3 px-3 font-semibold text-right whitespace-nowrap">{b.label}</th>
                  ))}
                  <th className="py-3 px-4 font-semibold text-right">รวม</th>
                </tr>
              </thead>
              <tbody>
                {data.groups.map((g) => {
                  const expanded = open.has(g.key);
                  return (
                    <Fragment key={g.key}>
                      <tr className="border-t border-gray-100 hover:bg-sky-50/40">
                        <td className="py-3 px-4">
                          <button type="button" onClick={() => toggle(g.key)} aria-expanded={expanded} className="text-left font-semibold text-gray-900 hover:text-sky-700">
                            <span aria-hidden="true" className="inline-block w-4 text-gray-400">{expanded ? "▾" : "▸"}</span>
                            {g.name}
                            <span className="ml-1 font-normal text-gray-500">({g.invoices.length} ใบ)</span>
                          </button>
                          <Link
                            href={`/accounting/billing-notes/new?${g.key.startsWith("co:") ? `companyId=${encodeURIComponent(g.key.slice(3))}` : `buyerName=${encodeURIComponent(g.name)}`}`}
                            className="ml-3 text-xs font-semibold text-sky-700 hover:text-sky-800 whitespace-nowrap"
                          >
                            ออกใบวางบิล
                          </Link>
                        </td>
                        {AGEING_BUCKETS.map((b) => (
                          <td key={b.key} className={`py-3 px-3 text-right ${g.buckets[b.key] > 0 ? BUCKET_TONE[b.key] : "text-gray-300"}`}>
                            {g.buckets[b.key] > 0 ? formatSatang(g.buckets[b.key]) : "—"}
                          </td>
                        ))}
                        <td className="py-3 px-4 text-right font-bold">{formatSatang(g.outstandingSatang)}</td>
                      </tr>
                      {expanded &&
                        g.invoices.map((inv) => (
                          <tr key={inv.id} className="bg-gray-50/70 text-gray-700">
                            <td className="py-2 px-4 pl-10" colSpan={2}>
                              <Link href={`/accounting/invoices/${inv.id}`} className="font-semibold text-sky-700 hover:text-sky-800">{inv.docNo}</Link>
                              <span className="text-gray-500"> · {formatDisplayDate(inv.issueDate)}</span>
                            </td>
                            <td className="py-2 px-3 text-right" colSpan={2}>
                              {inv.dueDate ? `ครบ ${formatDisplayDate(inv.dueDate)}` : "—"}
                            </td>
                            <td className={`py-2 px-3 text-right ${inv.daysOverdue > 0 ? "text-red-600 font-semibold" : "text-gray-500"}`} colSpan={2}>
                              {inv.daysOverdue > 0 ? `เกิน ${inv.daysOverdue} วัน` : "ยังไม่ถึงกำหนด"}
                            </td>
                            <td className="py-2 px-4 text-right">
                              {formatSatang(inv.outstandingSatang)}
                              {inv.paidSatang > 0 && <div className="text-xs text-gray-500">จาก {formatSatang(inv.totalSatang)}</div>}
                            </td>
                          </tr>
                        ))}
                    </Fragment>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-200 bg-gray-50 font-bold">
                  <td className="py-3 px-4">รวม</td>
                  {AGEING_BUCKETS.map((b) => (
                    <td key={b.key} className="py-3 px-3 text-right">{formatSatang(data.totals[b.key])}</td>
                  ))}
                  <td className="py-3 px-4 text-right">{formatSatang(data.totals.all)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>

      <section className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        <h2 className="px-5 pt-4 pb-1 font-bold text-gray-900">ยังไม่ได้รับ 50 ทวิ</h2>
        <p className="px-5 pb-3 text-sm text-gray-500">ลูกค้าหัก ณ ที่จ่ายแล้วแต่ยังไม่ส่งหนังสือรับรอง — ต้องใช้ตอนยื่นภาษีเงินได้นิติบุคคล</p>
        {data.missingCert50.length === 0 ? (
          <p className="px-5 pb-6 text-gray-500">ได้รับครบทุกใบแล้ว</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm tabular-nums" data-testid="cert50-table">
              <thead>
                <tr className="border-y border-gray-200 bg-gray-50 text-left text-gray-600">
                  <th className="py-2.5 px-4 font-semibold">วันที่รับเงิน</th>
                  <th className="py-2.5 px-4 font-semibold">ลูกค้า</th>
                  <th className="py-2.5 px-4 font-semibold">ใบแจ้งหนี้ / ใบเสร็จ</th>
                  <th className="py-2.5 px-4 font-semibold text-right">ยอดที่ถูกหัก</th>
                  <th className="py-2.5 px-4"><span className="sr-only">ทำรายการ</span></th>
                </tr>
              </thead>
              <tbody>
                {data.missingCert50.map((m) => (
                  <tr key={m.paymentId} className="border-t border-gray-100">
                    <td className="py-2.5 px-4 whitespace-nowrap">{formatDisplayDate(m.paidDate)}</td>
                    <td className="py-2.5 px-4">{m.buyerName}</td>
                    <td className="py-2.5 px-4">
                      <Link
                        href={m.deposit ? `/accounting/sales-orders/${m.invoiceId}` : m.billing ? `/accounting/billing-notes/${m.invoiceId}` : `/accounting/invoices/${m.invoiceId}`}
                        className="text-sky-700 hover:text-sky-800"
                      >
                        {m.invoiceNo}
                        {m.deposit && " (มัดจำ)"}
                      </Link>
                      {m.receiptNo && <span className="text-gray-500"> / {m.receiptNo}</span>}
                    </td>
                    <td className="py-2.5 px-4 text-right">
                      {formatSatang(m.whtSatang)} <span className="text-gray-500">({m.whtPercent}%)</span>
                    </td>
                    <td className="py-2.5 px-4 text-right">
                      <button type="button" onClick={() => setCert50(m)} className="px-3 py-1.5 rounded-lg border border-sky-200 text-sky-700 font-semibold hover:bg-sky-50 whitespace-nowrap">
                        ได้รับแล้ว
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {cert50 && (
        <Cert50Dialog
          payment={{ id: cert50.paymentId, paidDate: cert50.paidDate, whtPercent: cert50.whtPercent, whtSatang: cert50.whtSatang, cert50Note: "" }}
          onCancel={() => setCert50(null)}
          onSaved={() => {
            setCert50(null);
            setReload((n) => n + 1);
          }}
        />
      )}
    </div>
  );
}

function Card({ label, value, note, tone }: { label: string; value: string; note: string; tone: string }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-5">
      <p className="text-sm text-gray-500">{label}</p>
      <p className={`text-2xl font-bold tabular-nums ${tone}`}>{value}</p>
      <p className="text-xs text-gray-400">{note}</p>
    </div>
  );
}

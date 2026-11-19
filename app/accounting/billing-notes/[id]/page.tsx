"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import AccountingFrame from "../../AccountingFrame";
import BillingNotePaper from "../BillingNotePaper";
import DocumentDeleteDialog, { type DeletionImpactView } from "../../DocumentDeleteDialog";
import PaymentDialog from "../../payments/PaymentDialog";
import { Cert50Dialog, VoidPaymentDialog, type PaymentView } from "../../payments/PaymentsPanel";
import Spinner from "../../../components/Spinner";
import { useModalEscape } from "../../../components/useModalEscape";
import { errorMessageOf } from "../../../lib/apiErrorMessage";
import { formatDisplayDate } from "../../../lib/dateFormat";
import { formatSatang } from "../../../lib/accounting/money";
import { methodLabel, receiptTitle } from "../../../lib/accounting/paymentRules";
import {
  BILLING_LIMITS,
  BILLING_STATUS_LABELS,
  BILLING_STATUS_STYLES,
  suggestedBillingWhtSatang,
  type BilledInvoice,
  type BillingStatus,
} from "../../../lib/accounting/billingRules";
import type { SellerProfile } from "../../../lib/accounting/types";
import { useAccountingSettings } from "../../useAccountingSettings";

export default function BillingNotePage() {
  const { id } = useParams<{ id: string }>();
  const [title, setTitle] = useState("ใบวางบิล");
  return (
    <AccountingFrame tab="billing" title={title}>
      <BillingNote id={String(id)} onTitle={setTitle} />
    </AccountingFrame>
  );
}

interface InvoiceView extends BilledInvoice {
  docNo: string | null;
  issueDate: string;
  dueDate: string | null;
  status: string;
  billedSatang: number;
  outstandingSatang: number;
}

interface PaymentRow extends PaymentView {
  documentId: string;
  documentNo: string | null;
  groupId: string | null;
}

interface Loaded {
  note: {
    id: string;
    docNo: string | null;
    status: string;
    issueDate: string;
    dueDate: string | null;
    buyerName: string;
    buyerAddress: string;
    buyerTaxId: string;
    buyerBranch: string;
    totalSatang: number;
    note: string;
    voidReason: string | null;
  };
  billingStatus: BillingStatus;
  invoices: InvoiceView[];
  outstandingSatang: number;
  receivedSatang: number;
  payments: PaymentRow[];
  defaultWhtPercent: number;
  seller: SellerProfile | null;
  impact: DeletionImpactView;
}

type State = { status: "loading" } | { status: "error"; message: string } | ({ status: "ok" } & Loaded);

/** One payment received against the note — every invoice's share of it, under the same receipt(s). */
interface PaymentGroup {
  key: string;
  first: PaymentRow;
  rows: PaymentRow[];
  amountSatang: number;
  whtSatang: number;
  receipts: { id: string; docNo: string }[];
}

function groupsOf(payments: PaymentRow[]): PaymentGroup[] {
  const groups = new Map<string, PaymentGroup>();
  for (const p of payments) {
    const key = p.groupId ?? p.id;
    const g = groups.get(key) ?? { key, first: p, rows: [], amountSatang: 0, whtSatang: 0, receipts: [] };
    g.rows.push(p);
    g.amountSatang += p.amountSatang;
    g.whtSatang += p.whtSatang;
    if (p.receiptId && p.receiptNo && !g.receipts.some((r) => r.id === p.receiptId)) g.receipts.push({ id: p.receiptId, docNo: p.receiptNo });
    groups.set(key, g);
  }
  return [...groups.values()];
}

/**
 * One billing note: the paper to print, its invoices as they stand now, the
 * money received against it, and what can be done — receive against it
 * (spread over its invoices, one receipt for all), cancel it, delete it.
 */
function BillingNote({ id, onTitle }: { id: string; onTitle: (title: string) => void }) {
  const router = useRouter();
  const settings = useAccountingSettings();
  const [state, setState] = useState<State>({ status: "loading" });
  const [reload, setReload] = useState(0);
  const [dialog, setDialog] = useState<"pay" | "void" | "delete" | null>(null);
  const [voiding, setVoiding] = useState<PaymentView | null>(null);
  const [cert50, setCert50] = useState<PaymentView | null>(null);
  const [recorded, setRecorded] = useState<{ id: string; docNo: string; title: string }[] | null>(null);
  const [copyLabel, setCopyLabel] = useState<string | null>("ต้นฉบับ");
  const again = () => setReload((n) => n + 1);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/accounting/billing-notes/${encodeURIComponent(id)}`, { cache: "no-store" });
        if (!res.ok) {
          const message = await errorMessageOf(res, "โหลดใบวางบิลไม่สำเร็จ");
          if (!cancelled) setState({ status: "error", message });
          return;
        }
        const body = (await res.json()) as Partial<Loaded> | null;
        if (cancelled) return;
        if (!body?.note || !Array.isArray(body.invoices) || !Array.isArray(body.payments)) {
          setState({ status: "error", message: "โหลดใบวางบิลไม่สำเร็จ" });
          return;
        }
        setState({ status: "ok", ...(body as Loaded) });
        onTitle(`ใบวางบิล ${body.note.docNo ?? ""}`);
      } catch {
        if (!cancelled) setState({ status: "error", message: "โหลดใบวางบิลไม่สำเร็จ ตรวจสอบการเชื่อมต่อแล้วลองใหม่" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, reload, onTitle]);

  if (state.status === "loading" || settings.state.status === "loading") {
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
        <div className="flex justify-center gap-3">
          <button type="button" onClick={again} className="px-5 py-2.5 rounded-xl border border-gray-300 font-semibold hover:bg-gray-50">ลองใหม่</button>
          <Link href="/accounting/billing-notes" className="px-5 py-2.5 rounded-xl border border-gray-300 font-semibold hover:bg-gray-50">กลับไปรายการ</Link>
        </div>
      </div>
    );
  }

  const n = state.note;
  const cancelled = n.status === "void";
  const owing = state.invoices.filter((i) => i.status === "issued" && i.outstandingSatang > 0);
  const live = state.payments.filter((p) => !p.voidedAt);
  const groups = groupsOf(state.payments);
  const bankAccounts = settings.state.status === "ok" ? settings.state.settings.bankAccounts : [];
  const kinds = new Set(owing.map((i) => i.receiptIsTaxInvoice));
  const receiptLabel =
    kinds.size > 1
      ? "ออกใบเสร็จรวมจากระบบ 2 ใบ — ใบเสร็จรับเงิน (สินค้า) และใบเสร็จรับเงิน/ใบกำกับภาษี (บริการ)"
      : `ออก${receiptTitle(kinds.has(true))}รวมใบเดียวจากระบบ`;
  const printAs = (label: string) => {
    setCopyLabel(label);
    setTimeout(() => window.print(), 0);
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[1fr_20rem] gap-6 items-start">
      <div className="space-y-4 min-w-0">
        {cancelled && (
          <div role="status" className="rounded-xl border border-gray-300 bg-gray-50 px-4 py-3 text-sm text-gray-700">
            <p className="font-semibold">ใบวางบิลนี้ถูกยกเลิกแล้ว</p>
            {n.voidReason && <p>เหตุผล: {n.voidReason}</p>}
          </div>
        )}
        {recorded && recorded.length > 0 && (
          <div role="status" className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-900">
            บันทึกรับชำระแล้ว — ออก{" "}
            {recorded.map((r, i) => (
              <span key={r.id}>
                {i > 0 && " และ "}
                <Link href={`/accounting/receipts/${r.id}`} className="font-semibold underline">{r.title} {r.docNo}</Link>
              </span>
            ))}
          </div>
        )}

        <BillingNotePaper
          doc={n}
          invoices={state.invoices.map((i) => ({ id: i.id, docNo: i.docNo, issueDate: i.issueDate, dueDate: i.dueDate, billedSatang: i.billedSatang }))}
          seller={state.seller ?? { name: "", address: "", taxId: "", branchCode: "", phone: "", email: "" }}
          copyLabel={copyLabel}
        />

        <section className="bg-white rounded-2xl border border-gray-200 p-5" aria-labelledby="billing-now">
          <h2 id="billing-now" className="font-bold text-gray-900 mb-2">ใบแจ้งหนี้ในใบวางบิล ตอนนี้</h2>
          <ul className="divide-y divide-gray-100 text-sm" data-testid="billing-invoices">
            {state.invoices.map((i) => (
              <li key={i.id} className="py-2 flex flex-wrap items-center justify-between gap-2 tabular-nums">
                <Link href={`/accounting/invoices/${i.id}`} className="font-semibold text-sky-700 hover:text-sky-800">{i.docNo}</Link>
                <span className="text-gray-500">วางบิล {formatSatang(i.billedSatang)}</span>
                <span className={i.outstandingSatang > 0 ? "font-semibold text-orange-600" : "text-green-700 font-semibold"}>
                  {i.status !== "issued" ? "ยกเลิกแล้ว" : i.outstandingSatang > 0 ? `ค้าง ${formatSatang(i.outstandingSatang)}` : "ชำระครบ"}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="bg-white rounded-2xl border border-gray-200 p-5" aria-labelledby="billing-payments">
          <h2 id="billing-payments" className="font-bold text-gray-900 mb-2">การรับชำระตามใบวางบิล</h2>
          {groups.length === 0 ? (
            <p className="text-sm text-gray-500">ยังไม่มีการรับชำระ</p>
          ) : (
            <ul className="divide-y divide-gray-100 text-sm" data-testid="billing-payment-groups">
              {groups.map((g) => {
                const voided = Boolean(g.first.voidedAt);
                const merged: PaymentView = { ...g.first, amountSatang: g.amountSatang, whtSatang: g.whtSatang };
                return (
                  <li key={g.key} className="py-2.5 space-y-0.5">
                    <div className="flex items-baseline justify-between gap-2 tabular-nums">
                      <span className={voided ? "text-gray-400" : "text-gray-700"}>
                        {formatDisplayDate(g.first.paidDate)} · {methodLabel(g.first.method)} · {g.rows.length} ใบแจ้งหนี้
                      </span>
                      <span className={`font-semibold ${voided ? "line-through text-gray-400" : "text-gray-900"}`}>{formatSatang(g.amountSatang)}</span>
                    </div>
                    <div className="flex flex-wrap gap-x-3">
                      {g.receipts.map((r) => (
                        <Link key={r.id} href={`/accounting/receipts/${r.id}`} className="font-semibold text-sky-700 hover:text-sky-800 tabular-nums">ใบเสร็จ {r.docNo}</Link>
                      ))}
                      {g.receipts.length === 0 && g.first.externalReceiptNo && <span>ใบเสร็จจากที่อื่น {g.first.externalReceiptNo}</span>}
                    </div>
                    {g.whtSatang > 0 && (
                      <div className="tabular-nums text-gray-600">
                        หัก ณ ที่จ่าย {formatSatang(g.whtSatang)}
                        {!voided && (g.first.cert50Received ? " · 50 ทวิ ได้รับแล้ว" : " · ยังไม่ได้รับ 50 ทวิ")}
                      </div>
                    )}
                    {voided ? (
                      <div className="text-red-600">ยกเลิกแล้ว: {g.first.voidReason}</div>
                    ) : (
                      <div className="flex gap-3 pt-1">
                        {g.whtSatang > 0 && (
                          <button type="button" onClick={() => setCert50(merged)} className="text-xs font-semibold text-sky-700 hover:text-sky-800">
                            {g.first.cert50Received ? "แก้ 50 ทวิ" : "ได้รับ 50 ทวิ แล้ว"}
                          </button>
                        )}
                        <button type="button" onClick={() => setVoiding(merged)} className="text-xs font-semibold text-red-600 hover:text-red-700">
                          ยกเลิกรายการ (ทุกใบแจ้งหนี้)
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      <aside className="space-y-4 xl:sticky xl:top-6" aria-label="การทำรายการกับใบวางบิล">
        <div className="bg-white rounded-2xl border border-gray-200 p-5 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <span className="font-bold tabular-nums">{n.docNo}</span>
            <span className={`inline-block px-3 py-1 rounded-md text-sm font-semibold ${BILLING_STATUS_STYLES[state.billingStatus]}`}>{BILLING_STATUS_LABELS[state.billingStatus]}</span>
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm tabular-nums">
            <dt className="text-gray-500">ยอดวางบิล</dt>
            <dd className="text-right">{formatSatang(n.totalSatang)}</dd>
            <dt className="text-gray-500">รับชำระแล้ว</dt>
            <dd className="text-right">{formatSatang(state.receivedSatang)}</dd>
            <dt className="text-gray-500">ยังค้าง</dt>
            <dd className="text-right font-semibold" data-testid="billing-outstanding">{formatSatang(state.outstandingSatang)}</dd>
          </dl>
          {!cancelled && state.outstandingSatang > 0 && (
            <button type="button" onClick={() => setDialog("pay")} className="w-full px-3 py-2.5 rounded-xl bg-green-600 text-white font-semibold hover:bg-green-700">
              รับชำระตามใบวางบิล
            </button>
          )}
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => printAs("ต้นฉบับ")} className="px-3 py-2.5 rounded-xl bg-sky-600 text-white font-semibold hover:bg-sky-700">พิมพ์ต้นฉบับ</button>
            <button type="button" onClick={() => printAs("สำเนา")} className="px-3 py-2.5 rounded-xl border border-sky-200 text-sky-700 font-semibold hover:bg-sky-50">พิมพ์สำเนา</button>
          </div>
        </div>
        {!cancelled && live.length === 0 && (
          <button type="button" onClick={() => setDialog("void")} className="w-full px-4 py-2.5 rounded-xl border border-amber-300 text-amber-800 font-semibold hover:bg-amber-50">
            ยกเลิกใบวางบิล
          </button>
        )}
        <button type="button" onClick={() => setDialog("delete")} className="w-full px-4 py-2.5 rounded-xl border border-red-200 text-red-600 font-semibold hover:bg-red-50">
          ลบใบวางบิล
        </button>
      </aside>

      {dialog === "pay" && (
        <PaymentDialog
          kind="billing"
          invoice={{ id: n.id, docNo: n.docNo, issueDate: n.issueDate, totalSatang: state.outstandingSatang }}
          context={{
            outstandingSatang: state.outstandingSatang,
            serviceBaseSatang: owing.reduce((s, i) => s + i.serviceBaseSatang, 0),
            defaultWhtPercent: state.defaultWhtPercent,
            receiptIsTaxInvoice: kinds.has(true) && kinds.size === 1,
          }}
          bankAccounts={bankAccounts}
          suggestWht={(amount, pct) => suggestedBillingWhtSatang(owing, amount, pct)}
          receiptLabel={receiptLabel}
          onCancel={() => setDialog(null)}
          onRecorded={(result) => {
            setDialog(null);
            setRecorded(result.receipts ?? (result.receipt ? [result.receipt] : []));
            again();
          }}
        />
      )}
      {dialog === "void" && <VoidBillingDialog id={n.id} docNo={n.docNo} onCancel={() => setDialog(null)} onDone={() => { setDialog(null); again(); }} />}
      {dialog === "delete" && (
        <DocumentDeleteDialog
          docType="BN"
          documentId={n.id}
          label={`ใบวางบิล ${n.docNo ?? ""}`}
          impact={state.impact}
          onCancel={() => setDialog(null)}
          onDeleted={() => router.push("/accounting/billing-notes")}
        />
      )}
      {voiding && <VoidPaymentDialog payment={voiding} onCancel={() => setVoiding(null)} onDone={() => { setVoiding(null); again(); }} />}
      {cert50 && <Cert50Dialog payment={cert50} onCancel={() => setCert50(null)} onSaved={() => { setCert50(null); again(); }} />}
    </div>
  );
}

/** Cancels the billing note — with a reason (not a tax document: no password). */
function VoidBillingDialog({ id, docNo, onCancel, onDone }: { id: string; docNo: string | null; onCancel: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useModalEscape(ref, () => {
    if (!busy) onCancel();
  });
  const go = async () => {
    if (busy) return;
    if (!reason.trim()) {
      setError("กรุณาบอกเหตุผลที่ยกเลิก");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/accounting/billing-notes/${encodeURIComponent(id)}/void`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      if (!res.ok) {
        setError(await errorMessageOf(res, "ยกเลิกใบวางบิลไม่สำเร็จ"));
        return;
      }
      onDone();
    } catch {
      setError("ยกเลิกใบวางบิลไม่สำเร็จ ตรวจสอบการเชื่อมต่อแล้วลองใหม่");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="fixed inset-0 z-110 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => !busy && onCancel()}></div>
      <div ref={ref} role="dialog" aria-modal="true" aria-label="ยกเลิกใบวางบิลนี้?" className="relative bg-white rounded-2xl shadow-2xl p-6 w-full max-w-md space-y-3">
        <h2 className="text-lg font-bold text-gray-900">ยกเลิกใบวางบิลนี้?</h2>
        <p className="text-sm text-gray-700">ใบวางบิล {docNo} จะถูกทำเครื่องหมายยกเลิก (เลขที่ยังอยู่ในทะเบียน) — ใบแจ้งหนี้ในใบนี้ยังค้างชำระตามเดิม</p>
        <div>
          <label htmlFor="billing-void-reason" className="block text-sm font-semibold text-gray-700 mb-1">เหตุผล <span className="text-red-500">*</span></label>
          <input id="billing-void-reason" className="w-full border border-gray-200 rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-sky-500"
            maxLength={BILLING_LIMITS.voidReason} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="เช่น ลูกค้าขอให้วางบิลใหม่" />
        </div>
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <div className="flex gap-3 pt-2">
          <button type="button" onClick={onCancel} disabled={busy} className="flex-1 px-4 py-2.5 rounded-xl border border-gray-300 font-semibold hover:bg-gray-50 disabled:opacity-60">กลับ</button>
          <button type="button" onClick={() => void go()} disabled={busy} className="flex-1 px-4 py-2.5 rounded-xl bg-amber-600 text-white font-semibold hover:bg-amber-700 disabled:opacity-60">
            {busy ? "กำลังยกเลิก…" : "ยืนยันยกเลิก"}
          </button>
        </div>
      </div>
    </div>
  );
}

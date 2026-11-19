"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import Spinner from "../../components/Spinner";
import { useModalEscape } from "../../components/useModalEscape";
import PasswordConfirmDialog from "../PasswordConfirmDialog";
import { errorMessageOf } from "../../lib/apiErrorMessage";
import { formatDisplayDate } from "../../lib/dateFormat";
import { formatSatang } from "../../lib/accounting/money";
import { PAYMENT_LIMITS, methodLabel } from "../../lib/accounting/paymentRules";
import type { PaymentDialogContext } from "./PaymentDialog";

/** One payment as GET /api/accounting/documents/[id]/payments lists it. */
export interface PaymentView {
  id: string;
  receiptId: string | null;
  receiptNo: string | null;
  receiptStatus: string | null;
  paidDate: string;
  method: string;
  bankLabel: string;
  amountSatang: number;
  whtPercent: number;
  whtSatang: number;
  feeSatang: number;
  netSatang: number;
  cert50Received: boolean;
  cert50Note: string;
  externalReceiptNo: string;
  note: string;
  voidedAt: string | null;
  voidReason: string | null;
  /** Received against a billing note (step 7): it goes as it came — every invoice's share together. */
  billingNoteId?: string | null;
  groupId?: string | null;
}

export type PaymentsState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ok"; payments: PaymentView[]; context: PaymentDialogContext };

/** The invoice's payments and what the payment dialog needs; `reload` after any change. */
export function useInvoicePayments(invoiceId: string): { state: PaymentsState; reload: () => void } {
  return usePaymentsAt(`/api/accounting/documents/${encodeURIComponent(invoiceId)}/payments`);
}

/** A customer PO's deposits and what the deposit dialog needs (step 6). */
export function useOrderDeposits(salesOrderId: string): { state: PaymentsState; reload: () => void } {
  return usePaymentsAt(`/api/accounting/sales-orders/${encodeURIComponent(salesOrderId)}/deposits`);
}

function usePaymentsAt(url: string): { state: PaymentsState; reload: () => void } {
  const [state, setState] = useState<PaymentsState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) {
          const message = await errorMessageOf(res, "โหลดรายการรับชำระไม่สำเร็จ");
          if (!cancelled) setState({ status: "error", message });
          return;
        }
        const body = await res.json();
        if (cancelled) return;
        // A side panel must never take the invoice page down with it.
        if (!body || !Array.isArray(body.payments)) {
          setState({ status: "error", message: "โหลดรายการรับชำระไม่สำเร็จ" });
          return;
        }
        const { payments, ...context } = body;
        setState({ status: "ok", payments, context });
      } catch {
        if (!cancelled) setState({ status: "error", message: "โหลดรายการรับชำระไม่สำเร็จ ตรวจสอบการเชื่อมต่อแล้วลองใหม่" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url, attempt]);
  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  return { state, reload };
}

/**
 * The invoice's money received, oldest first: each payment's receipt, the
 * withholding and whether its 50 ทวิ came in, what actually arrived; a voided
 * one struck through with its reason.
 */
export default function PaymentsPanel({
  state,
  onChanged,
  onRetry,
  title = "การรับชำระ",
  emptyText = "ยังไม่มีการรับชำระ",
}: {
  state: PaymentsState;
  onChanged: () => void;
  onRetry: () => void;
  title?: string;
  emptyText?: string;
}) {
  const [voiding, setVoiding] = useState<PaymentView | null>(null);
  const [cert50, setCert50] = useState<PaymentView | null>(null);

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-5" data-testid="payments-panel">
      <h2 className="text-sm font-bold text-gray-900 mb-2">{title}</h2>
      {state.status === "loading" && <Spinner className="h-4 w-4 text-sky-600" />}
      {state.status === "error" && (
        <div role="alert" className="text-sm space-y-2">
          <p className="text-red-700">{state.message}</p>
          <button type="button" onClick={onRetry} className="font-semibold text-sky-700 hover:text-sky-800">ลองใหม่</button>
        </div>
      )}
      {state.status === "ok" && state.payments.length === 0 && <p className="text-sm text-gray-500">{emptyText}</p>}
      {state.status === "ok" && state.payments.length > 0 && (
        <ul className="divide-y divide-gray-100 text-sm">
          {state.payments.map((p) => {
            const voided = Boolean(p.voidedAt);
            return (
              <li key={p.id} className="py-2.5 space-y-0.5" data-testid="payment-row">
                <div className="flex items-baseline justify-between gap-2 tabular-nums">
                  <span className={voided ? "text-gray-400" : "text-gray-700"}>
                    {formatDisplayDate(p.paidDate)} · {methodLabel(p.method)}
                  </span>
                  <span className={`font-semibold ${voided ? "line-through text-gray-400" : "text-gray-900"}`}>{formatSatang(p.amountSatang)}</span>
                </div>
                <div className={voided ? "text-gray-400" : "text-gray-600"}>
                  {p.receiptId && p.receiptNo ? (
                    <Link href={`/accounting/receipts/${p.receiptId}`} className="font-semibold text-sky-700 hover:text-sky-800 tabular-nums">
                      ใบเสร็จ {p.receiptNo}
                    </Link>
                  ) : p.externalReceiptNo ? (
                    <span>ใบเสร็จจากที่อื่น {p.externalReceiptNo}</span>
                  ) : null}
                </div>
                {p.whtSatang > 0 && (
                  <div className="flex flex-wrap items-center gap-x-2 tabular-nums">
                    <span className={voided ? "text-gray-400" : "text-gray-600"}>หัก ณ ที่จ่าย {p.whtPercent}% {formatSatang(p.whtSatang)}</span>
                    {!voided &&
                      (p.cert50Received ? (
                        <span className="px-1.5 py-0.5 rounded bg-green-50 text-green-700 text-xs font-semibold">50 ทวิ ได้รับแล้ว</span>
                      ) : (
                        <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 text-xs font-semibold">ยังไม่ได้รับ 50 ทวิ</span>
                      ))}
                  </div>
                )}
                {!voided && p.cert50Received && p.cert50Note && <div className="text-gray-500 text-xs">50 ทวิ เก็บที่: {p.cert50Note}</div>}
                {!voided && (
                  <div className="text-gray-500 tabular-nums">
                    เงินเข้า {formatSatang(p.netSatang)}
                    {p.feeSatang > 0 && ` (ค่าธรรมเนียม ${formatSatang(p.feeSatang)})`}
                    {p.bankLabel && ` · ${p.bankLabel}`}
                  </div>
                )}
                {p.note && <div className="text-gray-500">{p.note}</div>}
                {p.groupId && p.billingNoteId && (
                  <div className="text-gray-500">
                    รับตามใบวางบิล ·{" "}
                    <Link href={`/accounting/billing-notes/${p.billingNoteId}`} className="font-semibold text-sky-700 hover:text-sky-800">ดูใบวางบิล</Link>
                    {!voided && <span className="block text-xs text-amber-700">ยกเลิกรายการนี้ = ยกเลิกการรับชำระทั้งใบวางบิล (ทุกใบแจ้งหนี้ และใบเสร็จรวม)</span>}
                  </div>
                )}
                {voided ? (
                  <div className="text-red-600">ยกเลิกแล้ว: {p.voidReason}</div>
                ) : (
                  <div className="flex gap-3 pt-1">
                    {p.whtSatang > 0 && (
                      <button type="button" onClick={() => setCert50(p)} className="text-xs font-semibold text-sky-700 hover:text-sky-800">
                        {p.cert50Received ? "แก้ 50 ทวิ" : "ได้รับ 50 ทวิ แล้ว"}
                      </button>
                    )}
                    <button type="button" onClick={() => setVoiding(p)} className="text-xs font-semibold text-red-600 hover:text-red-700">
                      ยกเลิกรายการ
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {voiding && (
        <VoidPaymentDialog
          payment={voiding}
          onCancel={() => setVoiding(null)}
          onDone={() => {
            setVoiding(null);
            onChanged();
          }}
        />
      )}
      {cert50 && (
        <Cert50Dialog
          payment={cert50}
          onCancel={() => setCert50(null)}
          onSaved={() => {
            setCert50(null);
            onChanged();
          }}
        />
      )}
    </div>
  );
}

/** Voids a payment and its receipt — a reason, then the password. */
export function VoidPaymentDialog({ payment, onCancel, onDone }: { payment: PaymentView; onCancel: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const submit = async (password: string): Promise<string | null> => {
    if (!reason.trim()) return "กรุณาบอกเหตุผลที่ยกเลิก";
    const res = await fetch(`/api/accounting/payments/${encodeURIComponent(payment.id)}/void`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: reason.trim(), password }),
    });
    return res.ok ? null : errorMessageOf(res, "ยกเลิกรายการรับชำระไม่สำเร็จ");
  };
  return (
    <PasswordConfirmDialog title="ยกเลิกรายการรับชำระ?" confirmText="ยกเลิกรายการ" danger onSubmit={submit} onCancel={onCancel} onDone={onDone}>
      <ul className="list-disc pl-5 space-y-1">
        <li className="tabular-nums">
          ยอด {formatSatang(payment.amountSatang)} บาท วันที่ {formatDisplayDate(payment.paidDate)} จะกลับเป็นยอดค้างชำระ
        </li>
        {payment.receiptNo && <li>ใบเสร็จ {payment.receiptNo} จะถูกยกเลิก (เลขที่ยังอยู่ในทะเบียน พร้อมเหตุผล)</li>}
        {payment.groupId && (
          <li className="text-amber-800">รับตามใบวางบิล — ทุกใบแจ้งหนี้ที่รับชำระครั้งนี้ และใบเสร็จรวม จะถูกยกเลิกด้วยกัน</li>
        )}
      </ul>
      <div>
        <label htmlFor="void-reason" className="block text-sm font-semibold text-gray-700 mb-1">
          เหตุผลที่ยกเลิก <span className="text-red-500">*</span>
        </label>
        <input
          id="void-reason"
          className="w-full border border-gray-200 rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-sky-500"
          maxLength={PAYMENT_LIMITS.voidReason}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="เช่น บันทึกยอดผิด"
        />
      </div>
    </PasswordConfirmDialog>
  );
}

/** The 50 ทวิ came in (and where the paper is kept) — or, to undo a slip, not yet. */
export function Cert50Dialog({
  payment,
  onCancel,
  onSaved,
}: {
  payment: Pick<PaymentView, "id" | "paidDate" | "whtPercent" | "whtSatang" | "cert50Note">;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [received, setReceived] = useState(true);
  const [note, setNote] = useState(payment.cert50Note);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useModalEscape(ref, () => {
    if (!busy) onCancel();
  });

  const save = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/accounting/payments/${encodeURIComponent(payment.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cert50Received: received, cert50Note: received ? note.trim() : "" }),
      });
      if (!res.ok) {
        setError(await errorMessageOf(res, "บันทึกไม่สำเร็จ"));
        return;
      }
      onSaved();
    } catch {
      setError("บันทึกไม่สำเร็จ ตรวจสอบการเชื่อมต่อแล้วลองใหม่");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-110 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => !busy && onCancel()}></div>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="cert50-title" className="relative bg-white rounded-2xl shadow-2xl p-6 w-full max-w-md space-y-3">
        <h2 id="cert50-title" className="text-lg font-bold text-gray-900">หนังสือรับรองการหักภาษี (50 ทวิ)</h2>
        <p className="text-sm text-gray-600 tabular-nums">
          รับเงินวันที่ {formatDisplayDate(payment.paidDate)} · หัก {payment.whtPercent}% {formatSatang(payment.whtSatang)} บาท
        </p>
        <label className="flex items-center gap-2 text-sm text-gray-800">
          <input type="checkbox" className="h-4 w-4 accent-sky-600" checked={received} onChange={(e) => setReceived(e.target.checked)} />
          ได้รับ 50 ทวิ จากลูกค้าแล้ว
        </label>
        {received && (
          <div>
            <label htmlFor="cert50-note" className="block text-sm font-semibold text-gray-700 mb-1">เก็บไว้ที่</label>
            <input
              id="cert50-note"
              className="w-full border border-gray-200 rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-sky-500"
              maxLength={PAYMENT_LIMITS.cert50Note}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="เช่น แฟ้ม 50 ทวิ ปี 2569"
            />
          </div>
        )}
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <div className="flex gap-3 pt-2">
          <button type="button" onClick={onCancel} disabled={busy} className="flex-1 px-4 py-2.5 rounded-xl border border-gray-300 font-semibold hover:bg-gray-50 disabled:opacity-60">ยกเลิก</button>
          <button type="button" onClick={() => void save()} disabled={busy} className="flex-1 px-4 py-2.5 rounded-xl bg-sky-600 text-white font-semibold hover:bg-sky-700 disabled:opacity-60">
            {busy ? "กำลังบันทึก…" : "บันทึก"}
          </button>
        </div>
      </div>
    </div>
  );
}

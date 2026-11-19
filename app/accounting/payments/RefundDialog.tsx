"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import SearchableDropdown from "../../components/SearchableDropdown";
import { useModalEscape } from "../../components/useModalEscape";
import { errorMessageOf } from "../../lib/apiErrorMessage";
import { bangkokDateString, formatDisplayDate, isValidDateString } from "../../lib/dateFormat";
import { formatSatang, parseBahtToSatang } from "../../lib/accounting/money";
import { PAYMENT_LIMITS, PAYMENT_METHODS, type PaymentMethod } from "../../lib/accounting/paymentRules";
import type { BankAccount } from "../../lib/accounting/types";

const LABEL = "block text-sm font-semibold text-gray-700 mb-1";
function inputClass(invalid?: boolean) {
  return `w-full border rounded-xl px-3 py-2 outline-none transition-all focus:ring-2 ${
    invalid ? "bg-red-50 border-red-500 focus:ring-red-500" : "bg-white border-gray-200 focus:ring-sky-500"
  }`;
}

interface RefundProblems {
  paidDate?: string;
  amountSatang?: string;
  bankAccountId?: string;
}

/** What is wrong with a refund, field by field — the server checks the same again. */
export function refundProblems(
  input: { paidDate: string; amountSatang: number; method: PaymentMethod; bankAccountId: string },
  opts: { today: string; refundDueSatang: number; hasAccounts: boolean }
): RefundProblems {
  const p: RefundProblems = {};
  if (!isValidDateString(input.paidDate)) p.paidDate = "กรุณาเลือกวันที่คืนเงิน";
  else if (input.paidDate > opts.today) p.paidDate = "วันที่คืนเงินต้องไม่เป็นวันในอนาคต";
  if (!Number.isSafeInteger(input.amountSatang) || input.amountSatang <= 0) p.amountSatang = "กรุณากรอกยอดที่คืน";
  else if (input.amountSatang > opts.refundDueSatang) p.amountSatang = `คืนได้ไม่เกิน ${formatSatang(opts.refundDueSatang)} บาท`;
  if (input.method !== "cash" && opts.hasAccounts && !input.bankAccountId) p.bankAccountId = "กรุณาเลือกบัญชีที่โอนคืน";
  return p;
}

/**
 * บันทึกคืนเงินลูกค้า (step 8) — a credit note took off more than the invoice
 * still owed, so the customer paid too much: the money handed back, a payment
 * of a negative amount (no receipt). Opens with all of what is due back.
 */
export default function RefundDialog({
  invoice,
  refundDueSatang,
  bankAccounts,
  onCancel,
  onDone,
}: {
  invoice: { id: string; docNo: string | null; issueDate: string };
  refundDueSatang: number;
  bankAccounts: BankAccount[];
  onCancel: () => void;
  onDone: () => void;
}) {
  const today = bangkokDateString(new Date());
  const activeAccounts = useMemo(() => bankAccounts.filter((b) => b.isActive), [bankAccounts]);
  const [paidDate, setPaidDate] = useState(today);
  const [amount, setAmount] = useState(formatSatang(refundDueSatang));
  const [method, setMethod] = useState<PaymentMethod>("transfer");
  const [bankAccountId, setBankAccountId] = useState(activeAccounts[0]?.id ?? "");
  const [note, setNote] = useState("");
  const [checked, setChecked] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useModalEscape(ref, () => {
    if (!busy) onCancel();
  });

  const amountSatang = amount.trim() === "" ? -1 : parseBahtToSatang(amount) ?? -1;
  const input = { paidDate, amountSatang, method, bankAccountId: method === "cash" ? "" : bankAccountId };
  const shown = checked ? refundProblems(input, { today, refundDueSatang, hasAccounts: activeAccounts.length > 0 }) : {};

  const save = async () => {
    if (busy) return;
    setChecked(true);
    setServerError(null);
    const found = refundProblems(input, { today, refundDueSatang, hasAccounts: activeAccounts.length > 0 });
    if (Object.keys(found).length > 0) {
      requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>("[aria-invalid='true']")?.focus());
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/accounting/documents/${encodeURIComponent(invoice.id)}/refunds`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...input, note: note.trim() }),
      });
      if (!res.ok) {
        setServerError(await errorMessageOf(res, "บันทึกคืนเงินไม่สำเร็จ"));
        return;
      }
      onDone();
    } catch {
      setServerError("บันทึกคืนเงินไม่สำเร็จ ตรวจสอบการเชื่อมต่อแล้วลองใหม่");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-110 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => !busy && onCancel()}></div>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="refund-title" className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[92vh] flex flex-col">
        <div className="px-6 pt-6 pb-3 border-b border-gray-100">
          <h2 id="refund-title" className="text-lg font-bold text-gray-900">บันทึกคืนเงินลูกค้า</h2>
          <p className="text-sm text-gray-600 tabular-nums">
            {invoice.docNo} · ต้องคืน <span className="font-semibold text-gray-900">{formatSatang(refundDueSatang)}</span> บาท
          </p>
        </div>
        <div className="px-6 py-4 space-y-4 overflow-y-auto">
          <p className="text-xs text-gray-500">ใบลดหนี้ลดยอดลงมากกว่าที่ยังค้าง ลูกค้าจึงจ่ายเกิน — บันทึกเงินที่คืนจริง ไม่ออกใบเสร็จ (ถ้าจะเก็บไว้หักใบถัดไป ไม่ต้องบันทึกตรงนี้)</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="refund-date" className={LABEL}>วันที่คืนเงิน</label>
              <input id="refund-date" type="date" max={today} className={inputClass(!!shown.paidDate)} aria-invalid={shown.paidDate ? true : undefined}
                value={paidDate} onChange={(e) => setPaidDate(e.target.value)} />
              {shown.paidDate && <p data-field-error className="mt-1 text-sm text-red-600">{shown.paidDate}</p>}
              {!shown.paidDate && paidDate && paidDate < invoice.issueDate && (
                <p className="mt-1 text-xs text-amber-700">ก่อนวันที่ของใบแจ้งหนี้ ({formatDisplayDate(invoice.issueDate)})</p>
              )}
            </div>
            <div>
              <label htmlFor="refund-amount" className={LABEL}>ยอดที่คืน (บาท)</label>
              <input id="refund-amount" inputMode="decimal" className={`${inputClass(!!shown.amountSatang)} text-right tabular-nums`} aria-invalid={shown.amountSatang ? true : undefined}
                value={amount} onChange={(e) => setAmount(e.target.value)} />
              {shown.amountSatang && <p data-field-error className="mt-1 text-sm text-red-600">{shown.amountSatang}</p>}
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="refund-method" className={LABEL}>วิธีคืนเงิน</label>
              <SearchableDropdown id="refund-method" value={method} onChange={(v) => setMethod(v as PaymentMethod)} options={PAYMENT_METHODS} searchable={false} />
            </div>
            {method !== "cash" && (
              <div>
                <label htmlFor="refund-bank" className={LABEL}>จากบัญชี</label>
                {activeAccounts.length > 0 ? (
                  <SearchableDropdown
                    id="refund-bank"
                    value={bankAccountId}
                    onChange={setBankAccountId}
                    options={activeAccounts.map((b) => ({ value: b.id, label: `${b.bankName} ${b.accountNo}`, subLabel: b.accountName || undefined }))}
                    searchable={false}
                    placeholder="เลือกบัญชี"
                    describedBy={shown.bankAccountId ? "refund-bank-error" : undefined}
                  />
                ) : (
                  <p className="text-sm text-gray-500 pt-2">
                    ยังไม่ได้เพิ่มบัญชีธนาคาร — <Link href="/accounting/settings" className="text-sky-700 font-semibold">เพิ่มที่ตั้งค่าบัญชี</Link>
                  </p>
                )}
                {shown.bankAccountId && <p id="refund-bank-error" data-field-error className="mt-1 text-sm text-red-600">{shown.bankAccountId}</p>}
              </div>
            )}
          </div>
          <div>
            <label htmlFor="refund-note" className={LABEL}>หมายเหตุ</label>
            <input id="refund-note" className={inputClass()} maxLength={PAYMENT_LIMITS.note} value={note} onChange={(e) => setNote(e.target.value)} placeholder="เช่น โอนคืนตามใบลดหนี้ CN…" />
          </div>
          {serverError && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{serverError}</p>}
        </div>
        <div className="px-6 py-4 border-t border-gray-100 flex gap-3">
          <button type="button" onClick={onCancel} disabled={busy} className="flex-1 px-4 py-2.5 rounded-xl border border-gray-300 font-semibold hover:bg-gray-50 disabled:opacity-60">
            ยกเลิก
          </button>
          <button type="button" onClick={() => void save()} disabled={busy} className="flex-1 px-4 py-2.5 rounded-xl bg-red-600 text-white font-semibold hover:bg-red-700 disabled:opacity-60">
            {busy ? "กำลังบันทึก…" : "บันทึกคืนเงิน"}
          </button>
        </div>
      </div>
    </div>
  );
}

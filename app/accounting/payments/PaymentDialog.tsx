"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import SearchableDropdown from "../../components/SearchableDropdown";
import { useModalEscape } from "../../components/useModalEscape";
import { errorMessageOf } from "../../lib/apiErrorMessage";
import { bangkokDateString, formatDisplayDate, isValidDateString } from "../../lib/dateFormat";
import { formatSatang, parseBahtToSatang } from "../../lib/accounting/money";
import {
  PAYMENT_LIMITS,
  PAYMENT_METHODS,
  WHT_RATES,
  cleanPaymentInput,
  firstPaymentProblem,
  paymentProblems,
  receiptTitle,
  suggestedWhtSatang,
  type PaymentMethod,
  type PaymentProblems,
} from "../../lib/accounting/paymentRules";
import type { BankAccount } from "../../lib/accounting/types";

/** What GET /api/accounting/documents/[id]/payments answers, less the list. */
export interface PaymentDialogContext {
  outstandingSatang: number;
  serviceBaseSatang: number;
  defaultWhtPercent: number;
  receiptIsTaxInvoice: boolean;
}

export interface RecordedPaymentView {
  receipt: { id: string; docNo: string; title: string } | null;
  paidSatang: number;
  /** Against a billing note: the receipt(s) issued — one, or two when goods and services mix. */
  receipts?: { id: string; docNo: string; title: string }[];
}

const LABEL = "block text-sm font-semibold text-gray-700 mb-1";
function inputClass(invalid?: boolean) {
  return `w-full border rounded-xl px-3 py-2 outline-none transition-all focus:ring-2 ${
    invalid ? "bg-red-50 border-red-500 focus:ring-red-500" : "bg-white border-gray-200 focus:ring-sky-500"
  }`;
}
function Problem({ id, children }: { id: string; children: string | undefined }) {
  if (!children) return null;
  return (
    <p id={id} data-field-error className="mt-1 text-sm text-red-600">
      {children}
    </p>
  );
}

const moneyOf = (text: string, emptyIs: number) => (text.trim() === "" ? emptyIs : parseBahtToSatang(text) ?? -1);

/**
 * รับชำระเงิน — one payment against an issued invoice. Opens with what is
 * still owed, the customer's usual withholding worked out on the invoice's
 * services (goods are not withheld), and says which receipt it will issue
 * (and its number) or takes the number of one issued elsewhere.
 *
 * kind "deposit" — รับเงินมัดจำ against a customer PO (step 6): the ceiling is
 * what the PO still holds, the receipt is always our ใบเสร็จรับเงิน/ใบกำกับภาษี.
 */
export default function PaymentDialog({
  invoice,
  context,
  bankAccounts,
  onCancel,
  onRecorded,
  kind = "payment",
  initialAmountSatang = null,
  suggestWht,
  receiptLabel,
}: {
  /** What is paid: the invoice — or, for a deposit, the PO ("PO …" as its docNo). */
  invoice: { id: string; docNo: string | null; issueDate: string; totalSatang: number };
  context: PaymentDialogContext;
  bankAccounts: BankAccount[];
  onCancel: () => void;
  onRecorded: (result: RecordedPaymentView) => void;
  /** "billing": against a billing note (step 7) — spread over its invoices, one receipt for all. */
  kind?: "payment" | "deposit" | "billing";
  /** The amount to open with (an item of the payment plan); null = what is owed (a deposit: nothing). */
  initialAmountSatang?: number | null;
  /** Works the withholding out for an amount at a rate — a billing note's, over each of its invoices. */
  suggestWht?: (amountSatang: number, whtPercent: number) => number;
  /** What issuing from the system gives, in place of "ออก<title>จากระบบ". */
  receiptLabel?: string;
}) {
  const deposit = kind === "deposit";
  const billing = kind === "billing";
  const today = bangkokDateString(new Date());
  const activeAccounts = useMemo(() => bankAccounts.filter((b) => b.isActive), [bankAccounts]);
  const hasServices = context.serviceBaseSatang > 0;
  const rateOptions = useMemo(() => {
    const rates: number[] = [...WHT_RATES];
    if (context.defaultWhtPercent > 0 && !rates.includes(context.defaultWhtPercent)) rates.push(context.defaultWhtPercent);
    return rates.sort((a, b) => a - b).map((r) => ({ value: String(r), label: r === 0 ? "ไม่หัก" : `${r}%` }));
  }, [context.defaultWhtPercent]);

  const [paidDate, setPaidDate] = useState(today);
  const [amount, setAmount] = useState(
    initialAmountSatang !== null ? formatSatang(Math.min(initialAmountSatang, context.outstandingSatang)) : deposit ? "" : formatSatang(context.outstandingSatang)
  );
  const [method, setMethod] = useState<PaymentMethod>("transfer");
  const [bankAccountId, setBankAccountId] = useState(activeAccounts[0]?.id ?? "");
  const [whtPercent, setWhtPercent] = useState(hasServices ? String(context.defaultWhtPercent || 0) : "0");
  const [whtText, setWhtText] = useState<string | null>(null); // null = worked out from the rate
  const [fee, setFee] = useState("");
  const [cert50Received, setCert50Received] = useState(false);
  const [cert50Note, setCert50Note] = useState("");
  const [receiptMode, setReceiptMode] = useState<"system" | "external">("system");
  const [externalReceiptNo, setExternalReceiptNo] = useState("");
  const [note, setNote] = useState("");
  const [problems, setProblems] = useState<PaymentProblems | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The preview belongs to the date it was asked for — never shown for another.
  const [preview, setPreview] = useState<{ date: string; docNo: string } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useModalEscape(ref, () => {
    if (!busy) onCancel();
  });

  const amountSatang = moneyOf(amount, -1);
  const suggested = suggestWht
    ? suggestWht(amountSatang, Number(whtPercent))
    : suggestedWhtSatang(amountSatang, invoice.totalSatang, context.serviceBaseSatang, Number(whtPercent));
  const whtSatang = whtText === null ? suggested : moneyOf(whtText, 0);
  const feeSatang = moneyOf(fee, 0);
  const netSatang = amountSatang - whtSatang - feeSatang;
  const issuing = deposit || receiptMode === "system";
  const title = receiptTitle(context.receiptIsTaxInvoice);

  // The number the receipt would get on this date — a preview; the real one is handed out on save.
  useEffect(() => {
    if (!issuing || !isValidDateString(paidDate)) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/accounting/documents/next-number?type=RE&date=${encodeURIComponent(paidDate)}`, { cache: "no-store" });
        const body = res.ok ? await res.json() : null;
        if (!cancelled && typeof body?.docNo === "string") setPreview({ date: paidDate, docNo: body.docNo });
      } catch {
        /* the preview is a nicety — the number is handed out on save either way */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [paidDate, issuing]);
  const nextNo = preview?.date === paidDate ? preview.docNo : null;

  const input = () =>
    cleanPaymentInput({
      paidDate,
      method,
      bankAccountId: method === "cash" ? "" : bankAccountId,
      amountSatang,
      whtPercent: Number(whtPercent),
      whtSatang,
      feeSatang,
      cert50Received,
      cert50Note,
      externalReceiptNo: issuing ? "" : externalReceiptNo,
      note,
    });
  const checks = (): PaymentProblems => {
    const p = paymentProblems(input(), { outstandingSatang: context.outstandingSatang, today, deposit });
    if (!issuing && !externalReceiptNo.trim()) p.externalReceiptNo = "กรุณากรอกเลขที่ใบเสร็จที่ออกจากที่อื่น";
    if (method !== "cash" && activeAccounts.length > 0 && !bankAccountId) p.bankAccountId = "กรุณาเลือกบัญชีที่รับเงิน";
    return p;
  };
  // Shown once save was pressed, then kept up to date as the fields change.
  const shown = problems ? checks() : {};

  const save = async () => {
    if (busy) return;
    const found = checks();
    setProblems(found);
    setServerError(null);
    if (firstPaymentProblem(found)) {
      requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>("[aria-invalid='true']")?.focus());
      return;
    }
    setBusy(true);
    try {
      const url = deposit
        ? `/api/accounting/sales-orders/${encodeURIComponent(invoice.id)}/deposits`
        : billing
          ? `/api/accounting/billing-notes/${encodeURIComponent(invoice.id)}/payments`
          : `/api/accounting/documents/${encodeURIComponent(invoice.id)}/payments`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input()),
      });
      if (!res.ok) {
        setServerError(await errorMessageOf(res, deposit ? "บันทึกเงินมัดจำไม่สำเร็จ" : "บันทึกรับชำระไม่สำเร็จ"));
        return;
      }
      onRecorded(await res.json());
    } catch {
      setServerError(`${deposit ? "บันทึกเงินมัดจำไม่สำเร็จ" : "บันทึกรับชำระไม่สำเร็จ"} ตรวจสอบการเชื่อมต่อแล้วลองใหม่`);
    } finally {
      setBusy(false);
    }
  };

  const invalid = (key: keyof PaymentProblems) => (shown[key] ? true : undefined);

  return (
    <div className="fixed inset-0 z-110 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => !busy && onCancel()}></div>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="payment-title"
        className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[92vh] flex flex-col"
      >
        <div className="px-6 pt-6 pb-3 border-b border-gray-100">
          <h2 id="payment-title" className="text-lg font-bold text-gray-900">{deposit ? "รับเงินมัดจำ" : billing ? "รับชำระตามใบวางบิล" : "รับชำระเงิน"}</h2>
          <p className="text-sm text-gray-600 tabular-nums">
            {invoice.docNo} · {deposit ? "รับมัดจำได้ไม่เกิน" : "ค้างชำระ"} <span className="font-semibold text-gray-900">{formatSatang(context.outstandingSatang)}</span> บาท
            {deposit && " (รวม VAT)"}
          </p>
        </div>

        <div className="px-6 py-4 space-y-4 overflow-y-auto">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="pay-date" className={LABEL}>วันที่รับเงิน</label>
              <input id="pay-date" type="date" max={today} className={inputClass(!!shown.paidDate)} aria-invalid={invalid("paidDate")}
                value={paidDate} onChange={(e) => setPaidDate(e.target.value)} />
              <Problem id="pay-date-error">{shown.paidDate}</Problem>
              {!shown.paidDate && paidDate && paidDate < invoice.issueDate && (
                <p className="mt-1 text-xs text-amber-700">ก่อนวันที่ของ{deposit ? " PO" : billing ? "ใบวางบิล" : "ใบแจ้งหนี้"} ({formatDisplayDate(invoice.issueDate)})</p>
              )}
            </div>
            <div>
              <label htmlFor="pay-amount" className={LABEL}>ยอดที่ลูกค้าชำระ (บาท)</label>
              <input id="pay-amount" inputMode="decimal" className={`${inputClass(!!shown.amountSatang)} text-right tabular-nums`} aria-invalid={invalid("amountSatang")}
                value={amount} onChange={(e) => setAmount(e.target.value)} />
              <Problem id="pay-amount-error">{shown.amountSatang}</Problem>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="pay-method" className={LABEL}>วิธีรับเงิน</label>
              <SearchableDropdown id="pay-method" value={method} onChange={(v) => setMethod(v as PaymentMethod)} options={PAYMENT_METHODS} searchable={false} />
            </div>
            {method !== "cash" && (
              <div>
                <label htmlFor="pay-bank" className={LABEL}>เข้าบัญชี</label>
                {activeAccounts.length > 0 ? (
                  <SearchableDropdown
                    id="pay-bank"
                    value={bankAccountId}
                    onChange={setBankAccountId}
                    options={activeAccounts.map((b) => ({ value: b.id, label: `${b.bankName} ${b.accountNo}`, subLabel: b.accountName || undefined }))}
                    searchable={false}
                    placeholder="เลือกบัญชี"
                    describedBy={shown.bankAccountId ? "pay-bank-error" : undefined}
                  />
                ) : (
                  <p className="text-sm text-gray-500 pt-2">
                    ยังไม่ได้เพิ่มบัญชีธนาคาร — <Link href="/accounting/settings" className="text-sky-700 font-semibold">เพิ่มที่ตั้งค่าบัญชี</Link>
                  </p>
                )}
                <Problem id="pay-bank-error">{shown.bankAccountId}</Problem>
              </div>
            )}
          </div>

          <fieldset className="rounded-xl border border-gray-200 p-3 space-y-3">
            <legend className="px-1 text-sm font-semibold text-gray-700">ภาษีหัก ณ ที่จ่าย</legend>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="pay-whtRate" className={LABEL}>อัตรา</label>
                <SearchableDropdown
                  id="pay-whtRate"
                  value={whtPercent}
                  onChange={(v) => {
                    setWhtPercent(v);
                    setWhtText(null);
                  }}
                  options={rateOptions}
                  searchable={false}
                  describedBy={shown.whtPercent ? "pay-whtRate-error" : undefined}
                />
                <Problem id="pay-whtRate-error">{shown.whtPercent}</Problem>
              </div>
              <div>
                <label htmlFor="pay-wht" className={LABEL}>ยอดที่ถูกหัก (บาท)</label>
                <input id="pay-wht" inputMode="decimal" className={`${inputClass(!!shown.whtSatang)} text-right tabular-nums`} aria-invalid={invalid("whtSatang")}
                  value={whtText ?? formatSatang(suggested)} onChange={(e) => setWhtText(e.target.value)} />
                <Problem id="pay-wht-error">{shown.whtSatang}</Problem>
                {whtText !== null && (
                  <button type="button" onClick={() => setWhtText(null)} className="mt-1 text-xs font-semibold text-sky-700 hover:text-sky-800">
                    คำนวณใหม่จากอัตรา
                  </button>
                )}
              </div>
            </div>
            <p className="text-xs text-gray-500">
              {hasServices
                ? `คิดจากค่าบริการก่อน VAT ${formatSatang(context.serviceBaseSatang)} บาท ตามสัดส่วนที่ชำระ — ค่าสินค้าไม่ถูกหัก`
                : "ใบนี้มีแต่สินค้า — ปกติไม่ถูกหัก ณ ที่จ่าย"}
              {context.defaultWhtPercent > 0 && ` · ลูกค้ารายนี้หักประจำ ${context.defaultWhtPercent}%`}
            </p>
            {whtSatang > 0 && (
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm text-gray-800">
                  <input type="checkbox" className="h-4 w-4 accent-sky-600" checked={cert50Received} onChange={(e) => setCert50Received(e.target.checked)} />
                  ได้รับหนังสือรับรองการหักภาษี (50 ทวิ) แล้ว
                </label>
                {cert50Received && (
                  <div>
                    <label htmlFor="pay-cert50Note" className={LABEL}>เก็บ 50 ทวิ ไว้ที่</label>
                    <input id="pay-cert50Note" className={inputClass(!!shown.cert50Note)} maxLength={PAYMENT_LIMITS.cert50Note} aria-invalid={invalid("cert50Note")}
                      value={cert50Note} onChange={(e) => setCert50Note(e.target.value)} placeholder="เช่น แฟ้ม 50 ทวิ ปี 2569" />
                    <Problem id="pay-cert50Note-error">{shown.cert50Note}</Problem>
                  </div>
                )}
              </div>
            )}
          </fieldset>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
            <div>
              <label htmlFor="pay-fee" className={LABEL}>ค่าธรรมเนียมธนาคาร (บาท)</label>
              <input id="pay-fee" inputMode="decimal" className={`${inputClass(!!shown.feeSatang)} text-right tabular-nums`} aria-invalid={invalid("feeSatang")}
                value={fee} onChange={(e) => setFee(e.target.value)} placeholder="0.00" />
              <Problem id="pay-fee-error">{shown.feeSatang}</Problem>
            </div>
            <div className="rounded-xl bg-sky-50 border border-sky-100 px-3 py-2 text-right" data-testid="payment-net">
              <p className="text-xs text-sky-800">เงินที่ได้รับจริง</p>
              <p className="text-xl font-bold tabular-nums text-sky-900">{amountSatang >= 0 && whtSatang >= 0 && feeSatang >= 0 ? formatSatang(netSatang) : "—"}</p>
            </div>
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold text-gray-700 mb-1">ใบเสร็จ</legend>
            <label className="flex items-start gap-2 text-sm text-gray-800">
              {/* A deposit has one way only — no choice to offer. */}
              {!deposit && (
                <input type="radio" name="receipt-mode" className="mt-0.5 h-4 w-4 accent-sky-600" checked={issuing} onChange={() => setReceiptMode("system")} />
              )}
              <span>
                {receiptLabel ?? `ออก${title}จากระบบ`}
                {nextNo && <span className="text-gray-500 tabular-nums"> — จะได้เลขที่ {nextNo}</span>}
              </span>
            </label>
            {deposit ? (
              <p className="text-xs text-gray-500">เงินมัดจำก่อนส่งของถึงกำหนดเสีย VAT ตอนรับเงิน — ออกใบกำกับภาษีให้ทุกครั้ง และหักออกจากใบแจ้งหนี้ตอนส่งของ (ก่อน VAT)</p>
            ) : (
              <label className="flex items-start gap-2 text-sm text-gray-800">
                <input type="radio" name="receipt-mode" className="mt-0.5 h-4 w-4 accent-sky-600" checked={!issuing} onChange={() => setReceiptMode("external")} />
                <span>ออกใบเสร็จจากที่อื่นแล้ว (เช่น เล่มเขียนมือ)</span>
              </label>
            )}
            {!issuing && (
              <div>
                <label htmlFor="pay-externalNo" className={LABEL}>เลขที่ใบเสร็จตามเอกสารจริง</label>
                <input id="pay-externalNo" className={inputClass(!!shown.externalReceiptNo)} maxLength={PAYMENT_LIMITS.externalReceiptNo} aria-invalid={invalid("externalReceiptNo")}
                  value={externalReceiptNo} onChange={(e) => setExternalReceiptNo(e.target.value)} />
                <Problem id="pay-externalNo-error">{shown.externalReceiptNo}</Problem>
              </div>
            )}
          </fieldset>

          <div>
            <label htmlFor="pay-note" className={LABEL}>หมายเหตุ</label>
            <input id="pay-note" className={inputClass(!!shown.note)} maxLength={PAYMENT_LIMITS.note} aria-invalid={invalid("note")}
              value={note} onChange={(e) => setNote(e.target.value)} placeholder={method === "cheque" ? "เลขที่เช็ค / ธนาคาร / วันที่บนเช็ค" : ""} />
            <Problem id="pay-note-error">{shown.note}</Problem>
          </div>

          {serverError && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{serverError}</p>}
        </div>

        <div className="px-6 py-4 border-t border-gray-100 flex gap-3">
          <button type="button" onClick={onCancel} disabled={busy} className="flex-1 px-4 py-2.5 rounded-xl border border-gray-300 font-semibold hover:bg-gray-50 disabled:opacity-60">
            ยกเลิก
          </button>
          <button type="button" onClick={() => void save()} disabled={busy} className="flex-1 px-4 py-2.5 rounded-xl bg-green-600 text-white font-semibold hover:bg-green-700 disabled:opacity-60">
            {busy ? "กำลังบันทึก…" : deposit ? "บันทึกรับมัดจำ" : "บันทึกรับชำระ"}
          </button>
        </div>
      </div>
    </div>
  );
}

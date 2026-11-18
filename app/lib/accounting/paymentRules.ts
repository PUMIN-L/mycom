// The rules of a payment against an invoice — pure, shared by the payment
// dialog and the API (step 4, ARCHITECTURE.md §8g).
//
//   amount   what this payment SETTLES on the invoice (before withholding)
//   wht      withheld by the customer (หัก ณ ที่จ่าย) — a tax credit for us,
//            backed by the 50 ทวิ certificate they send
//   fee      kept by the bank
//   net      what actually arrived = amount − wht − fee
import { daysBetweenDateStrings, isValidDateString } from "../dateFormat";
import { MAX_AMOUNT_SATANG, allocateProportionally } from "./money";

export type PaymentMethod = "transfer" | "cash" | "cheque";
export const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: "transfer", label: "โอนเงิน" },
  { value: "cash", label: "เงินสด" },
  { value: "cheque", label: "เช็ค" },
];
export const methodLabel = (method: string) => PAYMENT_METHODS.find((m) => m.value === method)?.label ?? method;

/** The rates the dialog offers (a customer's usual one is set on the customer). */
export const WHT_RATES = [0, 1, 2, 3, 5] as const;

export interface PaymentInput {
  paidDate: string;
  method: PaymentMethod;
  /** Which of our accounts it went into — none for cash. */
  bankAccountId: string;
  amountSatang: number;
  whtPercent: number;
  whtSatang: number;
  feeSatang: number;
  /** The 50 ทวิ certificate is in hand, and where it is kept (no file — the owner's choice). */
  cert50Received: boolean;
  cert50Note: string;
  /** A receipt already issued elsewhere (a hand-written book): its number — then the system issues none. */
  externalReceiptNo: string;
  note: string;
}

export const PAYMENT_LIMITS = { cert50Note: 255, externalReceiptNo: 60, note: 500, whtPercentMax: 15, voidReason: 300 } as const;

const INTERNAL_NUMBER = /^(INV|RE|BN|CN)\d{10}$/;

const text = (v: unknown, max: number) => (typeof v === "string" || typeof v === "number" ? String(v).trim().slice(0, max) : "");
const int = (v: unknown, fallback: number) => {
  if (v === null || v === undefined || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : fallback;
};

/**
 * What the browser sent, made safe to check: unknown methods become a
 * transfer, cash goes into no account, and a text one past its limit is kept
 * that long so the check can say "too long" instead of cutting it silently.
 * No withholding means no rate and no certificate.
 */
export function cleanPaymentInput(raw: unknown): PaymentInput {
  const b = (raw ?? {}) as Record<string, unknown>;
  const method = PAYMENT_METHODS.some((m) => m.value === b.method) ? (b.method as PaymentMethod) : "transfer";
  const pct = b.whtPercent === null || b.whtPercent === undefined || b.whtPercent === "" ? 0 : Number(b.whtPercent);
  const whtSatang = int(b.whtSatang, 0);
  const withheld = whtSatang !== 0;
  const cert50Received = withheld && b.cert50Received === true;
  return {
    paidDate: text(b.paidDate, 10),
    method,
    bankAccountId: method === "cash" ? "" : text(b.bankAccountId, 36),
    amountSatang: int(b.amountSatang, -1),
    whtPercent: !withheld ? 0 : Number.isFinite(pct) ? Math.round(pct * 100) / 100 : -1,
    whtSatang,
    feeSatang: int(b.feeSatang, 0),
    cert50Received,
    cert50Note: cert50Received ? text(b.cert50Note, PAYMENT_LIMITS.cert50Note + 1) : "",
    externalReceiptNo: text(b.externalReceiptNo, PAYMENT_LIMITS.externalReceiptNo + 1),
    note: text(b.note, PAYMENT_LIMITS.note + 1),
  };
}

export type PaymentProblems = Partial<Record<keyof PaymentInput, string>>;

/**
 * What is wrong with a payment, by field, in Thai. `outstandingSatang`: what
 * the invoice still owes; `today`: Bangkok's date (money cannot arrive
 * tomorrow).
 */
export function paymentProblems(p: PaymentInput, ctx: { outstandingSatang: number; today: string }): PaymentProblems {
  const problems: PaymentProblems = {};
  if (!isValidDateString(p.paidDate)) problems.paidDate = "กรุณาเลือกวันที่รับเงิน";
  else if (p.paidDate > ctx.today) problems.paidDate = "วันที่รับเงินต้องไม่เกินวันนี้";

  if (!Number.isSafeInteger(p.amountSatang) || p.amountSatang <= 0) problems.amountSatang = "กรุณากรอกยอดที่ลูกค้าชำระ";
  else if (p.amountSatang > MAX_AMOUNT_SATANG) problems.amountSatang = "ยอดเงินสูงเกินไป";
  else if (p.amountSatang > ctx.outstandingSatang) {
    problems.amountSatang = ctx.outstandingSatang > 0 ? "ยอดเกินยอดค้างชำระของใบนี้" : "ใบนี้ไม่มียอดค้างชำระแล้ว";
  }

  if (p.whtSatang < 0) problems.whtSatang = "ยอดหัก ณ ที่จ่ายติดลบไม่ได้";
  else if (p.amountSatang > 0 && p.whtSatang > p.amountSatang) problems.whtSatang = "ยอดหัก ณ ที่จ่ายมากกว่ายอดที่ชำระ";
  if (p.whtSatang > 0 && (p.whtPercent <= 0 || p.whtPercent > PAYMENT_LIMITS.whtPercentMax)) {
    problems.whtPercent = "กรุณาเลือกอัตราหัก ณ ที่จ่าย";
  }

  if (p.feeSatang < 0) problems.feeSatang = "ค่าธรรมเนียมติดลบไม่ได้";
  else if (p.amountSatang > 0 && p.whtSatang >= 0 && p.feeSatang > p.amountSatang - p.whtSatang) {
    problems.feeSatang = "ค่าธรรมเนียมมากกว่าเงินที่ได้รับ";
  }

  if (p.cert50Note.length > PAYMENT_LIMITS.cert50Note) problems.cert50Note = `ยาวเกิน ${PAYMENT_LIMITS.cert50Note} ตัวอักษร`;
  if (p.externalReceiptNo.length > PAYMENT_LIMITS.externalReceiptNo) {
    problems.externalReceiptNo = `เลขที่ยาวเกิน ${PAYMENT_LIMITS.externalReceiptNo} ตัวอักษร`;
  } else if (INTERNAL_NUMBER.test(p.externalReceiptNo)) {
    problems.externalReceiptNo = "เลขนี้มีรูปแบบเดียวกับเลขที่ระบบออกเอง — ใช้เลขตามที่พิมพ์บนใบเสร็จจริง";
  }
  if (p.note.length > PAYMENT_LIMITS.note) problems.note = `หมายเหตุยาวเกิน ${PAYMENT_LIMITS.note} ตัวอักษร`;
  return problems;
}

/** The first problem, in the order the dialog shows its fields. */
export function firstPaymentProblem(problems: PaymentProblems): string | null {
  const order: (keyof PaymentInput)[] = [
    "paidDate", "amountSatang", "method", "bankAccountId", "whtPercent", "whtSatang", "feeSatang",
    "cert50Received", "cert50Note", "externalReceiptNo", "note",
  ];
  for (const key of order) if (problems[key]) return problems[key]!;
  return null;
}

/** What arrived: amount − withholding − bank fee. */
export function netReceivedSatang(p: Pick<PaymentInput, "amountSatang" | "whtSatang" | "feeSatang">): number {
  return p.amountSatang - p.whtSatang - p.feeSatang;
}

/**
 * The part of an invoice's VAT base that is SERVICES — what withholding is
 * computed on (the price of goods is not withheld). The VAT base is shared
 * over the lines by their amounts, as for the dashboard sale.
 */
export function serviceBaseSatang(doc: {
  vatBaseSatang: number;
  lines: readonly { lineType: string; amountSatang: number }[];
}): number {
  if (doc.lines.length === 0) return 0;
  const shares = allocateProportionally(doc.lines.map((l) => l.amountSatang), doc.vatBaseSatang);
  return doc.lines.reduce((sum, l, i) => sum + (l.lineType === "service" ? shares[i] : 0), 0);
}

/**
 * round(a × b × … ÷ divisor), half up, EXACTLY: the products of satang here
 * pass 2^53 on large bills, where a float would round a tax figure the wrong
 * way at a half. Non-negative integers only.
 */
function mulDivRound(factors: number[], divisor: number): number {
  const n = factors.reduce((p, f) => p * BigInt(Math.round(f)), BigInt(1));
  const d = BigInt(Math.round(divisor));
  const q = n / d;
  return Number((n % d) * BigInt(2) >= d ? q + BigInt(1) : q);
}

/**
 * Withholding for a payment of `amountSatang` on an invoice of `totalSatang`
 * whose service base is `serviceBase`: the paid share of the service base,
 * times the rate, half up at the satang. A full payment withholds
 * rate × service base; a half payment half of that.
 */
export function suggestedWhtSatang(amountSatang: number, totalSatang: number, serviceBase: number, whtPercent: number): number {
  if (!(amountSatang > 0 && totalSatang > 0 && serviceBase > 0 && whtPercent > 0)) return 0;
  return mulDivRound([amountSatang, serviceBase, whtPercent * 100], totalSatang * 10000);
}

/**
 * The VAT inside a payment — what its receipt (a tax invoice, for services)
 * declares. Its share of the invoice's VAT; the payment that settles the
 * invoice takes what is left, so every receipt of an invoice adds up to the
 * invoice's VAT exactly, satang for satang.
 */
export function receiptVatSatang(
  amountSatang: number,
  invoice: { totalSatang: number; vatSatang: number },
  before: { paidSatang: number; vatSatang: number }
): number {
  if (invoice.totalSatang <= 0 || amountSatang <= 0) return 0;
  if (before.paidSatang + amountSatang >= invoice.totalSatang) return Math.max(0, invoice.vatSatang - before.vatSatang);
  return vatShareSatang(amountSatang, invoice);
}

/** The plain share of the invoice's VAT in a payment (no settling remainder). */
export function vatShareSatang(amountSatang: number, invoice: { totalSatang: number; vatSatang: number }): number {
  if (!(invoice.totalSatang > 0 && amountSatang > 0 && invoice.vatSatang > 0)) return 0;
  return mulDivRound([amountSatang, invoice.vatSatang], invoice.totalSatang);
}

/** "ใบเสร็จรับเงิน" or, when the receipt is the tax invoice (services: tax falls due on payment), with "/ใบกำกับภาษี". */
export function receiptTitle(isTaxInvoice: boolean): string {
  return isTaxInvoice ? "ใบเสร็จรับเงิน/ใบกำกับภาษี" : "ใบเสร็จรับเงิน";
}

// ── Receivables (ลูกหนี้คงค้าง) ─────────────────────────────────────────────

export type AgeingBucket = "current" | "d1_30" | "d31_60" | "d61_90" | "d90plus";
export const AGEING_BUCKETS: { key: AgeingBucket; label: string }[] = [
  { key: "current", label: "ยังไม่ถึงกำหนด" },
  { key: "d1_30", label: "เกิน 1–30 วัน" },
  { key: "d31_60", label: "31–60 วัน" },
  { key: "d61_90", label: "61–90 วัน" },
  { key: "d90plus", label: "เกิน 90 วัน" },
];

/** How late an invoice is on `today`: 0 until the day after its due date (no due date = due on its issue date). */
export function daysOverdue(inv: { dueDate: string | null; issueDate: string }, today: string): number {
  return Math.max(0, daysBetweenDateStrings(inv.dueDate ?? inv.issueDate, today) ?? 0);
}

export function ageingBucketOf(days: number): AgeingBucket {
  if (days <= 0) return "current";
  if (days <= 30) return "d1_30";
  if (days <= 60) return "d31_60";
  if (days <= 90) return "d61_90";
  return "d90plus";
}

export interface ReceivableInvoice {
  id: string;
  docNo: string | null;
  source: string;
  issueDate: string;
  dueDate: string | null;
  companyId: string;
  buyerName: string;
  totalSatang: number;
  paidSatang: number;
}

export interface ReceivableGroup {
  key: string;
  name: string;
  outstandingSatang: number;
  buckets: Record<AgeingBucket, number>;
  /** The latest of its invoices, in days — for "who is most late" ordering. */
  maxDaysOverdue: number;
  invoices: (ReceivableInvoice & { outstandingSatang: number; daysOverdue: number; bucket: AgeingBucket })[];
}

const emptyBuckets = (): Record<AgeingBucket, number> => ({ current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90plus: 0 });

/**
 * Open invoices by customer (the customer record when linked, else the name
 * printed), each split into ageing buckets. Most late first; then most owed.
 */
export function groupReceivables(rows: readonly ReceivableInvoice[], today: string): { groups: ReceivableGroup[]; totals: Record<AgeingBucket, number> & { all: number } } {
  const groups = new Map<string, ReceivableGroup>();
  const totals = { ...emptyBuckets(), all: 0 };
  for (const r of rows) {
    const outstanding = r.totalSatang - r.paidSatang;
    if (outstanding <= 0) continue;
    const late = daysOverdue(r, today);
    const bucket = ageingBucketOf(late);
    const key = r.companyId ? `co:${r.companyId}` : `name:${r.buyerName.trim().toLowerCase()}`;
    let g = groups.get(key);
    if (!g) {
      g = { key, name: r.buyerName.trim(), outstandingSatang: 0, buckets: emptyBuckets(), maxDaysOverdue: 0, invoices: [] };
      groups.set(key, g);
    }
    // A customer renamed since: the name on the latest invoice.
    if (g.invoices.every((i) => i.issueDate <= r.issueDate)) g.name = r.buyerName.trim();
    g.outstandingSatang += outstanding;
    g.buckets[bucket] += outstanding;
    g.maxDaysOverdue = Math.max(g.maxDaysOverdue, late);
    g.invoices.push({ ...r, outstandingSatang: outstanding, daysOverdue: late, bucket });
    totals[bucket] += outstanding;
    totals.all += outstanding;
  }
  const list = [...groups.values()];
  for (const g of list) g.invoices.sort((a, b) => b.daysOverdue - a.daysOverdue || a.issueDate.localeCompare(b.issueDate));
  list.sort((a, b) => b.maxDaysOverdue - a.maxDaysOverdue || b.outstandingSatang - a.outstandingSatang || a.name.localeCompare(b.name, "th"));
  return { groups: list, totals };
}

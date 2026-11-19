// Billing notes (ใบวางบิล, docType BN) — pure, shared by the pages and the API
// (step 7, ARCHITECTURE.md §8g).
//
// A billing note lists one customer's open invoices for them to pay together
// (on its due date — วันนัดชำระ). It is not a tax document. Money received
// against it is spread over its invoices, oldest first: one payment row per
// invoice (each invoice owes less), all under ONE receipt — two when goods and
// services are mixed, since the services' receipt is the tax invoice and the
// goods' is not.
import { isValidDateString } from "../dateFormat";
import { allocateProportionally } from "./money";
import { receiptVatSatang, suggestedWhtSatang } from "./paymentRules";

export interface BillingNoteInput {
  /** The customer — the record when linked ("" when typed by hand: matched by name). */
  companyId: string;
  buyerName: string;
  invoiceIds: string[];
  issueDate: string;
  /** วันนัดชำระ / นัดรับเช็ค — "" when not agreed. */
  dueDate: string;
  note: string;
}

export const BILLING_LIMITS = { invoices: 100, note: 1000, voidReason: 300 } as const;

const text = (v: unknown, max: number) => (typeof v === "string" || typeof v === "number" ? String(v) : "").trim().slice(0, max);

export function cleanBillingNoteInput(raw: unknown): BillingNoteInput {
  const b = (raw ?? {}) as Record<string, unknown>;
  const ids = Array.isArray(b.invoiceIds) ? b.invoiceIds : [];
  return {
    companyId: text(b.companyId, 255),
    buyerName: text(b.buyerName, 255),
    // Each invoice once, in the order given.
    invoiceIds: [...new Set(ids.map((id) => text(id, 36)).filter(Boolean))].slice(0, BILLING_LIMITS.invoices + 1),
    issueDate: text(b.issueDate, 10),
    dueDate: text(b.dueDate, 10),
    note: text(b.note, BILLING_LIMITS.note + 1),
  };
}

export type BillingNoteProblems = Partial<Record<keyof BillingNoteInput, string>>;

export function billingNoteProblems(input: BillingNoteInput): BillingNoteProblems {
  const p: BillingNoteProblems = {};
  if (!input.companyId && !input.buyerName) p.buyerName = "กรุณาเลือกลูกค้า";
  if (input.invoiceIds.length === 0) p.invoiceIds = "กรุณาเลือกใบแจ้งหนี้อย่างน้อย 1 ใบ";
  else if (input.invoiceIds.length > BILLING_LIMITS.invoices) p.invoiceIds = `ใบวางบิลหนึ่งใบมีได้ไม่เกิน ${BILLING_LIMITS.invoices} ใบแจ้งหนี้`;
  if (!isValidDateString(input.issueDate)) p.issueDate = "กรุณาเลือกวันที่วางบิล";
  if (input.dueDate) {
    if (!isValidDateString(input.dueDate)) p.dueDate = "วันนัดชำระไม่ถูกต้อง";
    else if (isValidDateString(input.issueDate) && input.dueDate < input.issueDate) p.dueDate = "วันนัดชำระต้องไม่ก่อนวันที่วางบิล";
  }
  if (input.note.length > BILLING_LIMITS.note) p.note = `หมายเหตุยาวเกิน ${BILLING_LIMITS.note} ตัวอักษร`;
  return p;
}

export const firstBillingProblem = (p: BillingNoteProblems) =>
  (["buyerName", "invoiceIds", "issueDate", "dueDate", "note"] as const).map((k) => p[k]).find(Boolean) ?? null;

// ── Money received against a billing note ───────────────────────────────────

/** One of a billing note's invoices, as it stands when the money comes in. */
export interface BilledInvoice {
  id: string;
  totalSatang: number;
  vatSatang: number;
  /** Received on it so far, and the VAT those payments declared. */
  paidSatang: number;
  vatPaidSatang: number;
  /** Its services before VAT — the withholding base. */
  serviceBaseSatang: number;
  /** Its receipt is the tax invoice (services only: VAT falls due on payment). */
  receiptIsTaxInvoice: boolean;
}

export interface BillingShare {
  invoiceId: string;
  amountSatang: number;
  whtSatang: number;
  feeSatang: number;
  /** Its share of its invoice's VAT (the settling payment takes what is left). */
  vatSatang: number;
  receiptIsTaxInvoice: boolean;
}

const owedOf = (inv: BilledInvoice) => Math.max(0, inv.totalSatang - inv.paidSatang);

/** What the billing note's invoices still owe, all together. */
export const billedOutstandingSatang = (invoices: readonly BilledInvoice[]) => invoices.reduce((s, i) => s + owedOf(i), 0);

/**
 * `amountSatang` spread over the invoices in their order (the oldest first),
 * each taking what it still owes; the withholding spread by each share's
 * services (by amount when nothing is a service — what the customer withheld
 * is what they withheld), the bank fee by amount. Each share adds up exactly.
 */
export function spreadBillingPayment(
  invoices: readonly BilledInvoice[],
  pay: { amountSatang: number; whtSatang: number; feeSatang: number }
): BillingShare[] {
  let left = Math.max(0, pay.amountSatang);
  const taken = invoices
    .map((inv) => {
      const amount = Math.min(owedOf(inv), left);
      left -= amount;
      return { inv, amount };
    })
    .filter((t) => t.amount > 0);
  const amounts = taken.map((t) => t.amount);
  // 1% stands for any rate: only the proportions matter.
  const serviceWeights = taken.map((t) => suggestedWhtSatang(t.amount, t.inv.totalSatang, t.inv.serviceBaseSatang, 100));
  const whtWeights = serviceWeights.some((w) => w > 0) ? serviceWeights : amounts;
  const wht = allocateProportionally(whtWeights, Math.max(0, pay.whtSatang));
  const fee = allocateProportionally(amounts, Math.max(0, pay.feeSatang));
  return taken.map((t, i) => ({
    invoiceId: t.inv.id,
    amountSatang: t.amount,
    whtSatang: wht[i],
    feeSatang: fee[i],
    vatSatang: receiptVatSatang(t.amount, t.inv, { paidSatang: t.inv.paidSatang, vatSatang: t.inv.vatPaidSatang }),
    receiptIsTaxInvoice: t.inv.receiptIsTaxInvoice,
  }));
}

/** The withholding to suggest for paying `amountSatang` at `whtPercent` — each invoice's services, as they are paid. */
export function suggestedBillingWhtSatang(invoices: readonly BilledInvoice[], amountSatang: number, whtPercent: number): number {
  return spreadBillingPayment(invoices, { amountSatang, whtSatang: 0, feeSatang: 0 }).reduce((sum, s) => {
    const inv = invoices.find((i) => i.id === s.invoiceId)!;
    return sum + suggestedWhtSatang(s.amountSatang, inv.totalSatang, inv.serviceBaseSatang, whtPercent);
  }, 0);
}

// ── Where a billing note stands ─────────────────────────────────────────────

export type BillingStatus = "open" | "partial" | "paid" | "cancelled";

export const BILLING_STATUS_LABELS: Record<BillingStatus, string> = {
  open: "รอชำระ",
  partial: "ชำระบางส่วน",
  paid: "ชำระครบ",
  cancelled: "ยกเลิก",
};

export const BILLING_STATUS_STYLES: Record<BillingStatus, string> = {
  open: "bg-orange-50 text-orange-600",
  partial: "bg-sky-50 text-sky-700",
  paid: "bg-green-50 text-green-700",
  cancelled: "bg-gray-100 text-gray-500",
};

/**
 * From its invoices as they are now — paid on the billing note or directly:
 * every one settled → ชำระครบ; something received → บางส่วน.
 */
export function billingStatusOf(note: { status: string }, invoices: readonly { totalSatang: number; paidSatang: number; billedSatang: number }[]): BillingStatus {
  if (note.status === "void") return "cancelled";
  if (invoices.length > 0 && invoices.every((i) => i.paidSatang >= i.totalSatang)) return "paid";
  // Anything received since it was billed (what it owed then, less what it owes now).
  return invoices.some((i) => i.billedSatang - Math.max(0, i.totalSatang - i.paidSatang) > 0) ? "partial" : "open";
}

// Deposits (มัดจำ) and a customer PO's payment plan (แผนเก็บเงิน) — pure,
// shared by the dialogs, the delivery invoice and the API (step 6,
// ARCHITECTURE.md §8g).
//
// A deposit is money received against a customer PO BEFORE delivery. Its
// receipt is always a ใบเสร็จรับเงิน/ใบกำกับภาษี: VAT falls due when money
// comes in before the goods go (or the work is done). Each delivery invoice
// then deducts its share of the deposit BEFORE VAT (`depositSatang`), so VAT is
// charged once — on the deposit's receipt, then on what is left.
import { isValidDateString } from "../dateFormat";
import { MAX_AMOUNT_SATANG, lineAmountSatang, mulDivRound, qtyHundredths } from "./money";
import { remainingQty, type OrderForDelivery } from "./orderRules";
import type { DocLineInput } from "./invoiceRules";

const rateHundredths = (vatRate: number) => Math.round(Number(vatRate) * 100);

/** The VAT inside an amount that includes it — what a deposit's receipt shows. */
export function vatInsideSatang(amountSatang: number, vatRate: number): number {
  const rate = rateHundredths(vatRate);
  if (amountSatang <= 0 || rate <= 0) return 0;
  return mulDivRound([amountSatang, rate], 10000 + rate);
}

/** A PO's deposits: received (before VAT, from their receipts) and already deducted by issued invoices. */
export interface DepositBalance {
  receivedExVatSatang: number;
  deductedSatang: number;
}

/** What is left to deduct, before VAT. */
export const depositLeftSatang = (b: DepositBalance) => Math.max(0, b.receivedExVatSatang - b.deductedSatang);

/**
 * The most a new deposit may be (VAT included): the deposits not yet deducted
 * must never exceed what the PO still holds before VAT — a deposit is a part
 * of what is still to be delivered, never more.
 */
export function depositRoomSatang(b: DepositBalance & { backlogSatang: number; vatRate: number }): number {
  const room = b.backlogSatang - depositLeftSatang(b);
  if (room <= 0) return 0;
  let amount = room + Math.round((room * rateHundredths(b.vatRate)) / 10000);
  while (amount > 0 && amount - vatInsideSatang(amount, b.vatRate) > room) amount -= 1;
  return amount;
}

/**
 * The deposit a delivery invoice deducts, before VAT: what is left of it in
 * proportion to what this delivery sends of what the PO still holds; the
 * delivery that empties the PO takes all of it. Never more than `capSatang` —
 * the delivery's own value before VAT (its VAT base cannot go below nothing).
 */
export function deliveryDepositSatang(
  order: OrderForDelivery & { depositLeftSatang: number },
  lines: readonly DocLineInput[],
  completesOrder: boolean,
  capSatang: number
): number {
  const left = Math.max(0, order.depositLeftSatang);
  const cap = Math.max(0, capSatang);
  if (left <= 0 || cap <= 0) return 0;
  if (completesOrder) return Math.min(left, cap);
  const stillHeld = order.lines.reduce((sum, l) => {
    const q = qtyHundredths(l.qty);
    const amount = lineAmountSatang(l);
    return q > 0 && amount > 0 ? sum + mulDivRound([amount, qtyHundredths(remainingQty(l))], q) : sum;
  }, 0);
  if (stillHeld <= 0) return 0;
  const ours = new Set(order.lines.map((l) => l.id));
  const sent = lines
    .filter((l) => l.sourceLineId && ours.has(l.sourceLineId))
    .reduce((sum, l) => sum + Math.max(0, lineAmountSatang(l)), 0);
  return Math.min(left, cap, mulDivRound([left, Math.min(sent, stillHeld)], stillHeld));
}

// ── The payment plan ─────────────────────────────────────────────────────────

/** "deposit": received before delivery (a deposit receipt); "invoice": collected on the delivery invoices. */
export type PlanStage = "deposit" | "invoice";

export const PLAN_STAGES: { value: PlanStage; label: string }[] = [
  { value: "deposit", label: "มัดจำ (ก่อนส่งของ)" },
  { value: "invoice", label: "เก็บตามใบแจ้งหนี้" },
];

export interface PlanItemInput {
  label: string;
  stage: PlanStage;
  /** VAT included — what the customer pays. */
  amountSatang: number;
  /** "" = no date. */
  dueDate: string;
}

export const PLAN_LIMITS = { items: 24, label: 100 } as const;

const text = (v: unknown, max: number) => (typeof v === "string" || typeof v === "number" ? String(v) : "").trim().slice(0, max);

/** What the browser sent, as the API takes it — text kept one over its limit, so the rules can say so. */
export function cleanPlan(raw: unknown): PlanItemInput[] {
  const items = Array.isArray(raw) ? raw.slice(0, PLAN_LIMITS.items + 1) : [];
  return items.map((it) => {
    const item = (it ?? {}) as Record<string, unknown>;
    const amount = Number(item.amountSatang);
    return {
      label: text(item.label, PLAN_LIMITS.label + 1),
      stage: item.stage === "deposit" ? "deposit" : "invoice",
      amountSatang: Number.isFinite(amount) ? Math.round(amount) : -1,
      dueDate: text(item.dueDate, 10),
    };
  });
}

export interface PlanProblems {
  items: Record<number, Partial<Record<keyof PlanItemInput, string>>>;
  total: string | null;
  first: string | null;
}

/** What is wrong with a plan for a PO of `orderTotalSatang` (VAT included). An empty plan is fine — it is optional. */
export function planProblems(items: readonly PlanItemInput[], orderTotalSatang: number): PlanProblems {
  const problems: PlanProblems["items"] = {};
  items.forEach((it, i) => {
    const p: Partial<Record<keyof PlanItemInput, string>> = {};
    if (!it.label) p.label = "กรุณาตั้งชื่องวด เช่น มัดจำ 30%";
    else if (it.label.length > PLAN_LIMITS.label) p.label = `ชื่องวดยาวเกิน ${PLAN_LIMITS.label} ตัวอักษร`;
    if (!(it.amountSatang > 0)) p.amountSatang = "ยอดต้องมากกว่า 0";
    else if (it.amountSatang > MAX_AMOUNT_SATANG) p.amountSatang = "ยอดสูงเกินไป";
    if (it.dueDate && !isValidDateString(it.dueDate)) p.dueDate = "วันที่ไม่ถูกต้อง";
    if (Object.keys(p).length > 0) problems[i] = p;
  });
  let total: string | null = null;
  if (items.length > PLAN_LIMITS.items) total = `แผนหนึ่ง PO มีได้ไม่เกิน ${PLAN_LIMITS.items} งวด`;
  else if (Object.keys(problems).length === 0) {
    const sum = items.reduce((s, it) => s + it.amountSatang, 0);
    if (sum > orderTotalSatang) total = "ยอดรวมทุกงวดเกินยอด PO (รวม VAT)";
  }
  const first = total ?? Object.values(problems).flatMap((p) => Object.values(p)).find(Boolean) ?? null;
  return { items: problems, total, first };
}

export type PlanItemStatus = "paid" | "partial" | "open";

export const PLAN_STATUS_LABELS: Record<PlanItemStatus, string> = {
  paid: "รับครบ",
  partial: "รับบางส่วน",
  open: "ยังไม่ได้รับ",
};

export interface PlanItemProgress {
  /** Money of its stage that has come in, applied to the plan's items in order. */
  receivedSatang: number;
  status: PlanItemStatus;
  /** Its date has passed with something still to come in. */
  late: boolean;
}

/**
 * Where each item of a plan stands, from the money that actually came in —
 * deposits for the deposit items, payments on the PO's invoices for the
 * others — applied to each stage's items in order. Nothing stored goes stale:
 * a payment voided puts its item back.
 */
export function planProgress(
  items: readonly Pick<PlanItemInput, "stage" | "amountSatang" | "dueDate">[],
  received: { depositSatang: number; invoiceSatang: number },
  today: string
): PlanItemProgress[] {
  const pool: Record<PlanStage, number> = { deposit: Math.max(0, received.depositSatang), invoice: Math.max(0, received.invoiceSatang) };
  return items.map((it) => {
    const take = Math.min(pool[it.stage], Math.max(0, it.amountSatang));
    pool[it.stage] -= take;
    const status: PlanItemStatus = take >= it.amountSatang ? "paid" : take > 0 ? "partial" : "open";
    return { receivedSatang: take, status, late: status !== "paid" && !!it.dueDate && it.dueDate < today };
  });
}

// The rules of a customer PO ("PO ลูกค้า", docType SO) — pure, shared by the
// form, the dashboard's backlog and the API (step 5, ARCHITECTURE.md §8g).
//
// A customer PO is NOT a sale: it is what the customer has ordered and we have
// not delivered yet. It becomes sales delivery by delivery — each delivery an
// invoice of its own, its lines pointing back at the PO's lines
// (`sourceLineId`), the PO's `deliveredQty` re-summed from them. Never called
// "ใบสั่งซื้อ": that is OUR order to a supplier (/purchase-order).
import { isValidDateString } from "../dateFormat";
import { cleanInvoiceInput, invoiceProblems, type DocLineInput, type InvoiceInput, type InvoiceProblems } from "./invoiceRules";
import { lineAmountSatang, mulDivRound, qtyHundredths } from "./money";

export interface OrderInput extends InvoiceInput {
  /** When the customer expects the goods ("" = not said). */
  expectedDeliveryDate: string;
  /** Where the customer's PO paper is kept — no file (the owner's choice). */
  storageNote: string;
}

export const ORDER_LIMITS = { storageNote: 255 } as const;

const text = (v: unknown, max: number) =>
  (typeof v === "string" || typeof v === "number" ? String(v) : "").trim().slice(0, max);

/**
 * What the browser sent, as the API takes it. A PO is never a tax invoice and
 * never registers a machine — a line may be MARKED as one (with its warranty),
 * so its delivery invoice opens with the box ticked; the serials come then.
 */
export function cleanOrderInput(raw: unknown): OrderInput {
  const body = (raw ?? {}) as Record<string, unknown>;
  const base = cleanInvoiceInput(raw);
  return {
    ...base,
    isTaxInvoice: false,
    salesOrderId: "",
    lines: base.lines.map((l) => ({ ...l, serials: "", sourceLineId: "" })),
    expectedDeliveryDate: text(body.expectedDeliveryDate, 10),
    storageNote: text(body.storageNote, ORDER_LIMITS.storageNote + 1),
  };
}

export type OrderProblems = InvoiceProblems & {
  fields: InvoiceProblems["fields"] & Partial<Record<"expectedDeliveryDate" | "storageNote", string>>;
};

/** What is wrong with a PO — the invoice's rules, plus the customer's PO number. */
export function orderProblems(input: OrderInput, vatRate: number): OrderProblems {
  // Machines are registered by each delivery invoice, within its own cap — not by the PO.
  const base = invoiceProblems(input, vatRate, { machinesCap: false });
  const fields: OrderProblems["fields"] = { ...base.fields };
  if (fields.issueDate) fields.issueDate = "กรุณาเลือกวันที่ของ PO";
  if (!input.customerPoNo) fields.customerPoNo = "กรุณากรอกเลขที่ PO ของลูกค้า";
  if (input.expectedDeliveryDate) {
    if (!isValidDateString(input.expectedDeliveryDate)) fields.expectedDeliveryDate = "กำหนดส่งไม่ถูกต้อง";
    else if (isValidDateString(input.issueDate) && input.expectedDeliveryDate < input.issueDate) {
      fields.expectedDeliveryDate = "กำหนดส่งต้องไม่ก่อนวันที่ของ PO";
    }
  }
  if (input.storageNote.length > ORDER_LIMITS.storageNote) fields.storageNote = `ยาวเกิน ${ORDER_LIMITS.storageNote} ตัวอักษร`;
  const first =
    (["customerPoNo", "issueDate", "expectedDeliveryDate", "buyerName"] as const).map((k) => fields[k]).find(Boolean) ??
    Object.values(fields).find(Boolean) ??
    Object.values(base.lines).flatMap((p) => Object.values(p)).find(Boolean) ??
    null;
  return { fields, lines: base.lines, first };
}

// ── Delivery progress ────────────────────────────────────────────────────────

export interface OrderLineProgress {
  qty: number;
  deliveredQty: number;
}

/** What is left to deliver on a line — in hundredths, so 2.5 − 1.25 is exactly 1.25. */
export function remainingQty(line: OrderLineProgress): number {
  return Math.max(0, qtyHundredths(line.qty) - qtyHundredths(line.deliveredQty)) / 100;
}

export type OrderStatus = "open" | "partial" | "complete" | "cancelled";

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  open: "รอส่งของ",
  partial: "ส่งบางส่วน",
  complete: "ส่งครบ",
  cancelled: "ยกเลิก",
};

export const ORDER_STATUS_STYLES: Record<OrderStatus, string> = {
  open: "bg-orange-50 text-orange-600",
  partial: "bg-sky-50 text-sky-700",
  complete: "bg-green-50 text-green-700",
  cancelled: "bg-gray-100 text-gray-500",
};

/** รอส่งของ → ส่งบางส่วน → ส่งครบ; ยกเลิก (with a reason) whatever was delivered. */
export function orderStatusOf(order: { status: string; lines: readonly OrderLineProgress[] }): OrderStatus {
  if (order.status === "void") return "cancelled";
  const delivered = order.lines.some((l) => qtyHundredths(l.deliveredQty) > 0);
  if (!delivered) return "open";
  return order.lines.every((l) => remainingQty(l) <= 0) ? "complete" : "partial";
}

/**
 * What the PO still holds, ex VAT — the dashboard's ยอดรอส่ง. Each line's
 * undelivered share of its amount, then the PO's VAT base in that proportion
 * (so the bill discount, and VAT out of inclusive prices, come off it too).
 * A cancelled PO holds nothing.
 */
export function backlogSatang(order: {
  status: string;
  vatBaseSatang: number;
  lines: readonly (OrderLineProgress & { amountSatang: number })[];
}): number {
  if (order.status === "void") return 0;
  const all = order.lines.reduce((s, l) => s + Math.max(0, l.amountSatang), 0);
  if (all <= 0 || order.vatBaseSatang <= 0) return 0;
  const left = order.lines.reduce((s, l) => {
    const q = qtyHundredths(l.qty);
    if (q <= 0 || l.amountSatang <= 0) return s;
    return s + mulDivRound([l.amountSatang, Math.round(remainingQty(l) * 100)], q);
  }, 0);
  return Math.min(order.vatBaseSatang, mulDivRound([order.vatBaseSatang, left], all));
}

/** A PO is late once its delivery date has passed with something still to deliver. */
export function isOrderLate(order: { expectedDeliveryDate: string | null }, backlog: number, today: string): boolean {
  return backlog > 0 && !!order.expectedDeliveryDate && order.expectedDeliveryDate < today;
}

// ── A delivery: the invoice that sends (part of) a PO ───────────────────────

export interface OrderLineForDelivery extends DocLineInput {
  id: string;
  deliveredQty: number;
  /** Discount already put on this line's earlier deliveries (issued invoices). */
  invoicedDiscountSatang: number;
}

export interface OrderForDelivery {
  id: string;
  customerPoNo: string;
  discountSatang: number;
  /** Bill discount already put on its earlier deliveries. */
  invoicedDiscountSatang: number;
  lines: readonly OrderLineForDelivery[];
}

/**
 * A PO line's discount for delivering `qty` of it: in proportion to the
 * quantity; the delivery that takes the rest of the line takes the rest of its
 * discount — so a line delivered in parts is discounted exactly as ordered, to
 * the satang.
 */
export function deliveryLineDiscount(line: OrderLineForDelivery, qty: number): number {
  const sent = qtyHundredths(Number.isFinite(qty) ? qty : 0);
  const discountLeft = Math.max(0, line.discountSatang - line.invoicedDiscountSatang);
  if (sent <= 0 || discountLeft <= 0) return 0;
  if (sent >= qtyHundredths(remainingQty(line))) return discountLeft;
  return Math.min(discountLeft, mulDivRound([line.discountSatang, sent], qtyHundredths(line.qty)));
}

/** The lines a delivery invoice opens with: everything still to deliver, each pointing at its PO line. */
export function deliveryLinesOf(order: OrderForDelivery): DocLineInput[] {
  return order.lines
    .filter((l) => remainingQty(l) > 0)
    .map((l) => ({
      lineType: l.lineType,
      productId: l.productId,
      name: l.name,
      qty: remainingQty(l),
      unit: l.unit,
      unitPriceSatang: l.unitPriceSatang,
      discountSatang: deliveryLineDiscount(l, remainingQty(l)),
      isMachine: l.isMachine,
      serials: "",
      warrantyMonths: l.warrantyMonths,
      sourceLineId: l.id,
    }));
}

/**
 * The bill discount for a delivery of `lines` (their amounts after line
 * discounts): the PO's bill discount in proportion to what is delivered out
 * of the PO's whole; a delivery that empties the PO takes what is left of it.
 * Only the PO's own lines count — a line added to the delivery (transport,
 * say) was never under the PO's discount.
 */
export function deliveryBillDiscount(order: OrderForDelivery, lines: readonly DocLineInput[], completesOrder: boolean): number {
  const left = Math.max(0, order.discountSatang - order.invoicedDiscountSatang);
  if (left <= 0) return 0;
  if (completesOrder) return left;
  const amountOf = (l: Pick<DocLineInput, "qty" | "unitPriceSatang" | "discountSatang">) => Math.max(0, lineAmountSatang(l));
  const all = order.lines.reduce((s, l) => s + amountOf(l), 0);
  if (all <= 0) return 0;
  const ours = new Set(order.lines.map((l) => l.id));
  const now = lines.filter((l) => l.sourceLineId && ours.has(l.sourceLineId)).reduce((s, l) => s + amountOf(l), 0);
  return Math.min(left, mulDivRound([order.discountSatang, now], all));
}

/** Whether delivering `lines` takes everything the PO still holds. */
export function deliveryCompletesOrder(order: OrderForDelivery, lines: readonly DocLineInput[]): boolean {
  return order.lines.every((ol) => {
    const left = qtyHundredths(remainingQty(ol));
    if (left <= 0) return true;
    const sent = lines.filter((l) => l.sourceLineId === ol.id).reduce((s, l) => s + qtyHundredths(l.qty), 0);
    return sent >= left;
  });
}

/** Lines of a delivery that send more of a PO line than it still holds — by index, in Thai. */
export function overDeliveryProblems(order: OrderForDelivery, lines: readonly DocLineInput[]): Record<number, string> {
  const problems: Record<number, string> = {};
  const byLine = new Map(order.lines.map((l) => [l.id, l]));
  const sentSoFar = new Map<string, number>();
  lines.forEach((l, i) => {
    if (!l.sourceLineId) return;
    const ol = byLine.get(l.sourceLineId);
    if (!ol) {
      problems[i] = "รายการนี้ไม่อยู่ใน PO แล้ว — ลบรายการนี้แล้วเพิ่มใหม่";
      return;
    }
    const sent = (sentSoFar.get(ol.id) ?? 0) + qtyHundredths(Number.isFinite(l.qty) ? l.qty : 0);
    sentSoFar.set(ol.id, sent);
    const left = qtyHundredths(remainingQty(ol));
    if (sent > left) {
      const leftText = (left / 100).toLocaleString("en-US", { maximumFractionDigits: 2 });
      problems[i] = left > 0 ? `เกินจำนวนที่เหลือใน PO (เหลือ ${leftText}${ol.unit ? ` ${ol.unit}` : ""})` : "รายการนี้ใน PO ส่งครบแล้ว";
    }
  });
  return problems;
}

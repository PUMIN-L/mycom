// Quotation money math — subtotal, discount (฿ or %), VAT 7%, grand total.
// Single source of truth used by the builder UI AND the saved-list summary, so
// the two can never drift. Pure + dependency-free for unit testing.

export interface QuoteTotalsInput {
  items?: { qty?: number; unitPrice?: number }[];
  discount?: number;
  discountType?: "amount" | "percent";
  vatEnabled?: boolean;
}

export interface QuoteTotals {
  subtotal: number;
  discountValue: number;
  afterDiscount: number;
  vat: number;
  grandTotal: number;
}

export const VAT_RATE = 0.07;

/**
 * True if any line item has a negative qty or unitPrice. computeQuoteTotals()
 * alone isn't a reliable guard against this: a negative subtotal combined
 * with the default (amount) discount type clamps discountValue down to that
 * same negative subtotal (`Math.min(discount, subtotal)`), which cancels out
 * to a grandTotal of exactly 0 — a negative input silently laundered into a
 * falsely "valid" total. Callers that need to reject negative inputs (e.g.
 * before saving a quotation/billing document) must check this too, not just
 * `grandTotal < 0`.
 */
export function hasNegativeLineItem(input: QuoteTotalsInput): boolean {
  const items = Array.isArray(input.items) ? input.items : [];
  return items.some(
    (it) => (Number(it.qty) || 0) < 0 || (Number(it.unitPrice) || 0) < 0
  );
}

export function computeQuoteTotals(input: QuoteTotalsInput): QuoteTotals {
  const items = Array.isArray(input.items) ? input.items : [];
  const subtotal = items.reduce(
    (sum, it) => sum + (Number(it.qty) || 0) * (Number(it.unitPrice) || 0),
    0
  );
  const discount = Math.max(Number(input.discount) || 0, 0);
  // Percent discounts are capped at 100%; ฿ discounts can't exceed the subtotal.
  const discountValue =
    input.discountType === "percent"
      ? (subtotal * Math.min(discount, 100)) / 100
      : Math.min(discount, subtotal);
  const afterDiscount = subtotal - discountValue;
  const vat = input.vatEnabled ? afterDiscount * VAT_RATE : 0;
  const grandTotal = afterDiscount + vat;
  return { subtotal, discountValue, afterDiscount, vat, grandTotal };
}

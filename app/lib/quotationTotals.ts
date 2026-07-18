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

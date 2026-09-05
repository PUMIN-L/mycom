// Quotation money math — per-line discounts, subtotal, document-level discount
// (฿ or %), VAT 7%, grand total.
// Single source of truth used by the builder UI AND the saved-list summary, so
// the two can never drift. Pure + dependency-free for unit testing.
//
// ── Discount order (decided by the owner) ────────────────────────────────────
// "หักรายเครื่องก่อน แล้วค่อยหักท้ายใบอีกที" — each line is discounted first,
// the discounted line amounts are summed, and THEN the document-level discount
// comes off that sum. VAT is charged on what is left after BOTH.
//
//   line.amount      = qty × unitPrice                     (gross, per line)
//   line.netAmount   = amount − line discount              (floored at 0)
//   subtotal         = Σ line.amount                       (gross)
//   afterLineDiscounts = Σ line.netAmount
//   afterDiscount    = afterLineDiscounts − document discount
//   vat              = afterDiscount × 7%   (when vatEnabled)
//   grandTotal       = afterDiscount + vat
//
// ── Backwards compatibility ─────────────────────────────────────────────────
// A quotation is stored as one JSON blob, so every quote saved before per-line
// discounts existed simply has no `discount`/`discountType` key on its items.
// A missing (or zero, or negative) per-line discount is treated as no discount
// at all AND takes the untouched pass-through path below, so such a quote
// produces bit-for-bit the same numbers it produced before this feature.

export interface QuoteLineInput {
  qty?: number;
  unitPrice?: number;
  /** Per-line discount. Missing/zero/negative ⇒ no discount (old quotes). */
  discount?: number;
  /** How to read `discount`. Anything but "percent" means baht, matching the
   *  document-level field. */
  discountType?: "amount" | "percent";
}

export interface QuoteTotalsInput {
  items?: QuoteLineInput[];
  discount?: number;
  discountType?: "amount" | "percent";
  vatEnabled?: boolean;
}

/** Per-line breakdown, so the UI can print a "ราคาหลังลด" column and the
 *  document total stays explainable line by line. */
export interface QuoteLineTotal {
  /** qty × unitPrice, before any discount. */
  amount: number;
  /** Baht actually taken off this line (never negative, never > `amount`). */
  discountValue: number;
  /** `amount − discountValue`. Floored at 0 — see computeLineTotal(). */
  netAmount: number;
}

export interface QuoteTotals {
  /** Σ of the gross line amounts — unchanged meaning from before per-line
   *  discounts existed. */
  subtotal: number;
  /** Per-line breakdown, in the same order as `items`. */
  lines: QuoteLineTotal[];
  /** Σ of the per-line discounts. */
  lineDiscountTotal: number;
  /** Σ of the discounted line amounts — what the document-level discount is
   *  taken off. Equals `subtotal` when no line carries a discount. */
  afterLineDiscounts: number;
  /** The document-level discount in baht. */
  discountValue: number;
  /** `afterLineDiscounts − discountValue` — the VAT base. */
  afterDiscount: number;
  vat: number;
  grandTotal: number;
}

export const VAT_RATE = 0.07;

/**
 * Round to the satang (2 dp), nudging by a relative epsilon so a value that is
 * *mathematically* an exact half-satang rounds up like a human would expect
 * rather than being dragged down by its binary representation (7.5% of 1234.60
 * is 92.595, which floats store as 92.59499999999998 → 92.60, not 92.59).
 */
function round2(n: number): number {
  const scaled = n * 100;
  const rounded =
    Math.round(scaled + Math.sign(scaled) * Math.abs(scaled) * 1e-12) / 100;
  return rounded === 0 ? 0 : rounded; // normalise -0 to 0
}

/**
 * Money for one line.
 *
 * Rules:
 * - A missing/zero/negative discount is no discount, and the line's amount is
 *   passed through *completely untouched* (not even re-rounded) so old quotes
 *   keep computing to the exact same floats they always did.
 * - A discount is capped at the line's own amount, so a line can never go
 *   negative: over-discounting floors that line at 0 and the excess is simply
 *   dropped. It is NOT credited back against the other lines and it does NOT
 *   reduce the document-level total beyond this line's own amount.
 * - A percent discount is capped at 100%.
 * - Once a line actually carries a discount, both the discount and the net are
 *   settled to the satang, so the amounts printed on the PDF sum exactly to the
 *   printed subtotal instead of drifting by a fraction of a satang.
 * - A negative line amount (bad input — see hasNegativeLineItem) gets a cap of
 *   0, i.e. no discount, so a per-line discount can never deepen it.
 */
export function computeLineTotal(item: QuoteLineInput): QuoteLineTotal {
  const amount = (Number(item?.qty) || 0) * (Number(item?.unitPrice) || 0);
  const discount = Math.max(Number(item?.discount) || 0, 0);

  // No discount on this line (the old-quote path): pass the amount straight
  // through, byte-for-byte identical to the pre-per-line-discount behaviour.
  if (discount === 0) {
    return { amount, discountValue: 0, netAmount: amount };
  }

  // Never discount against a negative line, and never below zero.
  const cap = Math.max(amount, 0);
  const raw =
    item.discountType === "percent"
      ? (cap * Math.min(discount, 100)) / 100
      : Math.min(discount, cap);

  const discountValue = round2(raw);
  const netAmount = round2(amount - discountValue);
  return { amount, discountValue, netAmount };
}

/**
 * Set (or clear) ONE line's discount amount without ever writing a meaningless
 * key onto the line.
 *
 * Why this exists rather than a plain `{ ...line, discount: v }`: a quotation is
 * one JSON blob, and a line saved before per-line discounts existed carries NO
 * `discount` key at all. The builder's money box is `FormattedNumberInput`,
 * which fires `onChange` on every BLUR — so merely clicking into the discount
 * box of a reopened old quotation and tabbing out would stamp `discount: 0`
 * onto that line: the unsaved-changes fingerprint flips, and saving rewrites the
 * stored blob of a document nobody actually edited.
 *
 * Zero (or negative, or unparseable) therefore REMOVES the key instead of
 * storing it, and a line that is already keyless is returned by reference so it
 * cannot even churn a re-render. `discountType` is deliberately left alone here
 * — see setLineDiscountType().
 */
export function setLineDiscountAmount<T extends QuoteLineInput>(
  line: T,
  amount: unknown
): T {
  const next = Math.max(Number(amount) || 0, 0);
  if (next > 0) return { ...line, discount: next };
  if (!("discount" in line)) return line;
  const { discount: _dropped, ...rest } = line;
  return rest as unknown as T;
}

/**
 * Set ONE line's discount type, storing it only when it actually carries
 * information.
 *
 * `computeLineTotal` reads anything that is not exactly "percent" as baht, so a
 * stored `discountType: "amount"` and a missing key are the same value — and the
 * missing one is what every pre-existing quotation has. Choosing "บาท (฿)" thus
 * clears the key rather than writing the default, which keeps an old quote's
 * blob byte-for-byte intact even if the admin toggles the dropdown back and
 * forth while reading it.
 *
 * The amount is NOT cleared alongside it, and the type is NOT cleared when the
 * amount goes to zero: an admin who picks "%" and only then types "10" must get
 * 10 percent off, not ฿10.
 */
export function setLineDiscountType<T extends QuoteLineInput>(
  line: T,
  type: unknown
): T {
  if (type === "percent") return { ...line, discountType: "percent" };
  if (!("discountType" in line)) return line;
  const { discountType: _dropped, ...rest } = line;
  return rest as unknown as T;
}

/**
 * True if any line item has a negative qty or unitPrice. computeQuoteTotals()
 * alone isn't a reliable guard against this: a negative subtotal combined
 * with the default (amount) discount type clamps discountValue down to that
 * same negative subtotal (`Math.min(discount, base)`), which cancels out
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

  const lines = items.map(computeLineTotal);
  const subtotal = lines.reduce((sum, l) => sum + l.amount, 0);
  const lineDiscountTotal = lines.reduce((sum, l) => sum + l.discountValue, 0);
  const afterLineDiscounts = lines.reduce((sum, l) => sum + l.netAmount, 0);

  const discount = Math.max(Number(input.discount) || 0, 0);
  // The document-level discount comes off the ALREADY line-discounted sum.
  // Percent discounts are capped at 100%; ฿ discounts can't exceed that sum.
  const discountValue =
    input.discountType === "percent"
      ? (afterLineDiscounts * Math.min(discount, 100)) / 100
      : Math.min(discount, afterLineDiscounts);
  const afterDiscount = afterLineDiscounts - discountValue;
  const vat = input.vatEnabled ? afterDiscount * VAT_RATE : 0;
  const grandTotal = afterDiscount + vat;

  return {
    subtotal,
    lines,
    lineDiscountTotal,
    afterLineDiscounts,
    discountValue,
    afterDiscount,
    vat,
    grandTotal,
  };
}

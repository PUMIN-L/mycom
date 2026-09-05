// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  computeQuoteTotals,
  computeLineTotal,
  hasNegativeLineItem,
  setLineDiscountAmount,
  setLineDiscountType,
  VAT_RATE,
} from '@/app/lib/quotationTotals';

describe('quotationTotals', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('VAT_RATE', () => {
    it('is 7%', () => {
      expect(VAT_RATE).toBe(0.07);
    });
  });

  describe('computeQuoteTotals', () => {
    it('returns all zeros when items is undefined', () => {
      expect(computeQuoteTotals({})).toEqual({
        subtotal: 0,
        lines: [],
        lineDiscountTotal: 0,
        afterLineDiscounts: 0,
        discountValue: 0,
        afterDiscount: 0,
        vat: 0,
        grandTotal: 0,
      });
    });

    it('returns all zeros when items is an empty array', () => {
      expect(computeQuoteTotals({ items: [] })).toEqual({
        subtotal: 0,
        lines: [],
        lineDiscountTotal: 0,
        afterLineDiscounts: 0,
        discountValue: 0,
        afterDiscount: 0,
        vat: 0,
        grandTotal: 0,
      });
    });

    it('sums subtotal from qty * unitPrice across items', () => {
      const result = computeQuoteTotals({
        items: [
          { qty: 2, unitPrice: 100 },
          { qty: 3, unitPrice: 50 },
        ],
      });
      expect(result.subtotal).toBe(350);
      expect(result.discountValue).toBe(0);
      expect(result.afterDiscount).toBe(350);
      expect(result.vat).toBe(0);
      expect(result.grandTotal).toBe(350);
    });

    it('treats missing qty or unitPrice as 0', () => {
      const result = computeQuoteTotals({
        items: [
          { unitPrice: 100 }, // no qty -> 0
          { qty: 5 }, // no unitPrice -> 0
          { qty: 4, unitPrice: 25 }, // 100
        ],
      });
      expect(result.subtotal).toBe(100);
      expect(result.discountValue).toBe(0);
      expect(result.afterDiscount).toBe(100);
      expect(result.vat).toBe(0);
      expect(result.grandTotal).toBe(100);
    });

    it('clamps an amount discount to the subtotal (cannot exceed it)', () => {
      const result = computeQuoteTotals({
        items: [{ qty: 1, unitPrice: 100 }],
        discount: 200,
        discountType: 'amount',
      });
      expect(result.subtotal).toBe(100);
      expect(result.discountValue).toBe(100);
      expect(result.afterDiscount).toBe(0);
      expect(result.vat).toBe(0);
      expect(result.grandTotal).toBe(0);
    });

    it('applies an amount discount below the subtotal directly', () => {
      const result = computeQuoteTotals({
        items: [{ qty: 1, unitPrice: 1000 }],
        discount: 100,
        discountType: 'amount',
      });
      expect(result.subtotal).toBe(1000);
      expect(result.discountValue).toBe(100);
      expect(result.afterDiscount).toBe(900);
      expect(result.vat).toBe(0);
      expect(result.grandTotal).toBe(900);
    });

    it('caps a percent discount at 100%', () => {
      const result = computeQuoteTotals({
        items: [{ qty: 1, unitPrice: 1000 }],
        discount: 150,
        discountType: 'percent',
      });
      expect(result.subtotal).toBe(1000);
      expect(result.discountValue).toBe(1000); // 100% of subtotal, not 150%
      expect(result.afterDiscount).toBe(0);
      expect(result.vat).toBe(0);
      expect(result.grandTotal).toBe(0);
    });

    it('applies a percent discount below 100% proportionally', () => {
      const result = computeQuoteTotals({
        items: [{ qty: 1, unitPrice: 1000 }],
        discount: 10,
        discountType: 'percent',
      });
      expect(result.subtotal).toBe(1000);
      expect(result.discountValue).toBe(100);
      expect(result.afterDiscount).toBe(900);
      expect(result.vat).toBe(0);
      expect(result.grandTotal).toBe(900);
    });

    it('clamps a negative discount to 0', () => {
      const result = computeQuoteTotals({
        items: [{ qty: 1, unitPrice: 1000 }],
        discount: -50,
        discountType: 'amount',
      });
      expect(result.subtotal).toBe(1000);
      expect(result.discountValue).toBe(0);
      expect(result.afterDiscount).toBe(1000);
      expect(result.vat).toBe(0);
      expect(result.grandTotal).toBe(1000);
    });

    it('applies 7% VAT only when vatEnabled is true', () => {
      const result = computeQuoteTotals({
        items: [{ qty: 1, unitPrice: 1000 }],
        vatEnabled: true,
      });
      expect(result.subtotal).toBe(1000);
      expect(result.discountValue).toBe(0);
      expect(result.afterDiscount).toBe(1000);
      expect(result.vat).toBeCloseTo(70, 10);
      expect(result.grandTotal).toBeCloseTo(1070, 10);
    });

    it('computes grandTotal as afterDiscount + VAT with a discount applied', () => {
      const result = computeQuoteTotals({
        items: [{ qty: 1, unitPrice: 1000 }],
        discount: 100,
        discountType: 'amount',
        vatEnabled: true,
      });
      expect(result.subtotal).toBe(1000);
      expect(result.discountValue).toBe(100);
      expect(result.afterDiscount).toBe(900);
      expect(result.vat).toBeCloseTo(63, 10);
      expect(result.grandTotal).toBeCloseTo(963, 10);
    });

    it('does not apply VAT when vatEnabled is false', () => {
      const result = computeQuoteTotals({
        items: [{ qty: 1, unitPrice: 1000 }],
        vatEnabled: false,
      });
      expect(result.vat).toBe(0);
      expect(result.grandTotal).toBe(1000);
    });

    it('a negative-qty item with the default (amount) discount type silently nets to a "valid" 0 total', () => {
      // Documents the exact loophole hasNegativeLineItem() exists to close:
      // Math.min(discount, subtotal) with discount=0 and a negative subtotal
      // clamps discountValue down to that same negative subtotal, cancelling
      // it out — grandTotal ends up 0, not negative, so a naive
      // `grandTotal < 0` check alone would miss this input entirely.
      const result = computeQuoteTotals({ items: [{ qty: -5, unitPrice: 1000 }] });
      expect(result.subtotal).toBe(-5000);
      expect(result.grandTotal).toBe(0);
    });

    it('exposes an empty per-line breakdown that mirrors the item list', () => {
      const result = computeQuoteTotals({
        items: [
          { qty: 2, unitPrice: 100 },
          { qty: 3, unitPrice: 50 },
        ],
      });
      expect(result.lines).toEqual([
        { amount: 200, discountValue: 0, netAmount: 200 },
        { amount: 150, discountValue: 0, netAmount: 150 },
      ]);
      expect(result.lineDiscountTotal).toBe(0);
      expect(result.afterLineDiscounts).toBe(350);
    });
  });

  // ── ITEM 7: per-line discounts ────────────────────────────────────────────
  // Owner's rule: "หักรายเครื่องก่อน แล้วค่อยหักท้ายใบอีกที" — discount each
  // line, sum the discounted lines, THEN take the document-level discount off
  // that sum, THEN charge VAT on what's left.
  describe('computeQuoteTotals — per-line discounts', () => {
    it('applies a baht discount to a single line', () => {
      const result = computeQuoteTotals({
        items: [{ qty: 2, unitPrice: 500, discount: 150, discountType: 'amount' }],
      });
      expect(result.subtotal).toBe(1000);
      expect(result.lines).toEqual([
        { amount: 1000, discountValue: 150, netAmount: 850 },
      ]);
      expect(result.lineDiscountTotal).toBe(150);
      expect(result.afterLineDiscounts).toBe(850);
      expect(result.grandTotal).toBe(850);
    });

    it('applies a percent discount to a single line', () => {
      const result = computeQuoteTotals({
        items: [{ qty: 1, unitPrice: 1200, discount: 10, discountType: 'percent' }],
      });
      expect(result.subtotal).toBe(1200);
      expect(result.lines).toEqual([
        { amount: 1200, discountValue: 120, netAmount: 1080 },
      ]);
      expect(result.afterLineDiscounts).toBe(1080);
      expect(result.grandTotal).toBe(1080);
    });

    it('defaults a per-line discount with no discountType to baht', () => {
      const result = computeQuoteTotals({
        items: [{ qty: 1, unitPrice: 1000, discount: 10 }],
      });
      // 10 baht off, NOT 10 percent.
      expect(result.lines[0]).toEqual({
        amount: 1000,
        discountValue: 10,
        netAmount: 990,
      });
    });

    it('mixes baht and percent discounts across lines', () => {
      const result = computeQuoteTotals({
        items: [
          { qty: 1, unitPrice: 1000, discount: 100, discountType: 'amount' },
          { qty: 2, unitPrice: 500, discount: 20, discountType: 'percent' },
          { qty: 1, unitPrice: 250 }, // untouched
        ],
      });
      expect(result.subtotal).toBe(2250);
      expect(result.lines).toEqual([
        { amount: 1000, discountValue: 100, netAmount: 900 },
        { amount: 1000, discountValue: 200, netAmount: 800 },
        { amount: 250, discountValue: 0, netAmount: 250 },
      ]);
      expect(result.lineDiscountTotal).toBe(300);
      expect(result.afterLineDiscounts).toBe(1950);
      expect(result.grandTotal).toBe(1950);
    });

    it('clamps a negative per-line discount to 0', () => {
      const result = computeQuoteTotals({
        items: [{ qty: 1, unitPrice: 1000, discount: -50, discountType: 'amount' }],
      });
      expect(result.lines[0]).toEqual({
        amount: 1000,
        discountValue: 0,
        netAmount: 1000,
      });
      expect(result.grandTotal).toBe(1000);
    });

    it('caps a per-line percent discount at 100%', () => {
      const result = computeQuoteTotals({
        items: [{ qty: 1, unitPrice: 800, discount: 250, discountType: 'percent' }],
      });
      expect(result.lines[0]).toEqual({
        amount: 800,
        discountValue: 800,
        netAmount: 0,
      });
    });

    it('zeroes a line at a 100% discount without touching the other lines', () => {
      const result = computeQuoteTotals({
        items: [
          { qty: 1, unitPrice: 900, discount: 100, discountType: 'percent' },
          { qty: 1, unitPrice: 600 },
        ],
      });
      expect(result.subtotal).toBe(1500);
      expect(result.lines).toEqual([
        { amount: 900, discountValue: 900, netAmount: 0 },
        { amount: 600, discountValue: 0, netAmount: 600 },
      ]);
      expect(result.lineDiscountTotal).toBe(900);
      expect(result.afterLineDiscounts).toBe(600);
      expect(result.grandTotal).toBe(600);
    });

    it('floors an over-large per-line discount at the line — it never credits other lines', () => {
      // 5,000 off a 1,000 line takes 1,000, not 5,000. The extra 4,000 is
      // dropped: the 2,000 line beside it is untouched and the document total
      // is 2,000, NOT -2,000 and NOT 2,000 reduced any further.
      const result = computeQuoteTotals({
        items: [
          { qty: 1, unitPrice: 1000, discount: 5000, discountType: 'amount' },
          { qty: 1, unitPrice: 2000 },
        ],
      });
      expect(result.lines).toEqual([
        { amount: 1000, discountValue: 1000, netAmount: 0 },
        { amount: 2000, discountValue: 0, netAmount: 2000 },
      ]);
      expect(result.lineDiscountTotal).toBe(1000); // not 5000
      expect(result.afterLineDiscounts).toBe(2000);
      expect(result.grandTotal).toBe(2000);
    });

    it('never lets a discounted line go negative', () => {
      const result = computeQuoteTotals({
        items: [{ qty: 1, unitPrice: 100, discount: 999999, discountType: 'amount' }],
      });
      expect(result.lines[0].netAmount).toBe(0);
      expect(result.lines[0].netAmount).toBeGreaterThanOrEqual(0);
      expect(result.grandTotal).toBe(0);
    });

    it('applies the document-level discount AFTER the per-line ones (baht)', () => {
      // Lines: 1000 −10% = 900, and 500 −50 = 450 → 1350.
      // Document: −350 off 1350 → 1000. (Order matters: −350 off the *gross*
      // 1500 would have been 1150.)
      const result = computeQuoteTotals({
        items: [
          { qty: 1, unitPrice: 1000, discount: 10, discountType: 'percent' },
          { qty: 1, unitPrice: 500, discount: 50, discountType: 'amount' },
        ],
        discount: 350,
        discountType: 'amount',
      });
      expect(result.subtotal).toBe(1500);
      expect(result.lineDiscountTotal).toBe(150);
      expect(result.afterLineDiscounts).toBe(1350);
      expect(result.discountValue).toBe(350);
      expect(result.afterDiscount).toBe(1000);
      expect(result.grandTotal).toBe(1000);
    });

    it('takes a document-level PERCENT discount off the line-discounted sum, not the gross subtotal', () => {
      const result = computeQuoteTotals({
        items: [{ qty: 1, unitPrice: 1000, discount: 20, discountType: 'percent' }],
        discount: 10,
        discountType: 'percent',
      });
      expect(result.subtotal).toBe(1000);
      expect(result.afterLineDiscounts).toBe(800);
      // 10% of 800 = 80 — NOT 10% of the gross 1000.
      expect(result.discountValue).toBe(80);
      expect(result.afterDiscount).toBe(720);
      expect(result.grandTotal).toBe(720);
    });

    it('clamps a document-level baht discount to the line-discounted sum', () => {
      const result = computeQuoteTotals({
        items: [{ qty: 1, unitPrice: 1000, discount: 40, discountType: 'percent' }],
        discount: 5000,
        discountType: 'amount',
      });
      expect(result.afterLineDiscounts).toBe(600);
      expect(result.discountValue).toBe(600); // clamped, not 5000
      expect(result.afterDiscount).toBe(0);
      expect(result.grandTotal).toBe(0);
    });

    it('computes VAT on the amount left after BOTH discount levels', () => {
      // 2000 gross → −25% per line = 1500 → −500 document = 1000 → VAT 70.
      const result = computeQuoteTotals({
        items: [{ qty: 2, unitPrice: 1000, discount: 25, discountType: 'percent' }],
        discount: 500,
        discountType: 'amount',
        vatEnabled: true,
      });
      expect(result.subtotal).toBe(2000);
      expect(result.afterLineDiscounts).toBe(1500);
      expect(result.afterDiscount).toBe(1000);
      expect(result.vat).toBeCloseTo(70, 10);
      expect(result.grandTotal).toBeCloseTo(1070, 10);
      // The VAT base is afterDiscount, never the gross subtotal.
      expect(result.vat).toBeCloseTo(result.afterDiscount * VAT_RATE, 10);
    });

    it('charges no VAT when every line is fully discounted away', () => {
      const result = computeQuoteTotals({
        items: [{ qty: 1, unitPrice: 1000, discount: 100, discountType: 'percent' }],
        vatEnabled: true,
      });
      expect(result.afterDiscount).toBe(0);
      expect(result.vat).toBe(0);
      expect(result.grandTotal).toBe(0);
    });

    it('rounds a per-line discount to the satang so printed lines sum to the printed subtotal', () => {
      // 7.5% of 1234.60 is exactly 92.595 — a float stores it as
      // 92.59499999999998, which would print as 92.59 while the untouched
      // remainder printed as 1142.01, i.e. one satang adrift.
      const result = computeQuoteTotals({
        items: [{ qty: 1, unitPrice: 1234.6, discount: 7.5, discountType: 'percent' }],
      });
      expect(result.lines[0].discountValue).toBe(92.6);
      expect(result.lines[0].netAmount).toBe(1142);
      // No sub-satang residue anywhere in the chain.
      expect(result.afterLineDiscounts).toBe(1142);
      expect(result.lines[0].discountValue + result.lines[0].netAmount).toBe(
        result.lines[0].amount
      );
    });

    it('keeps the per-line nets summing exactly to afterLineDiscounts across many odd lines', () => {
      const result = computeQuoteTotals({
        items: [
          { qty: 3, unitPrice: 33.33, discount: 7, discountType: 'percent' },
          { qty: 7, unitPrice: 19.99, discount: 3.5, discountType: 'percent' },
          { qty: 1, unitPrice: 0.05, discount: 33.3333, discountType: 'percent' },
        ],
      });
      const summed = result.lines.reduce((s, l) => s + l.netAmount, 0);
      expect(result.afterLineDiscounts).toBeCloseTo(summed, 10);
      // Every printed line value is a whole number of satang.
      for (const line of result.lines) {
        expect(Math.round(line.discountValue * 100)).toBeCloseTo(
          line.discountValue * 100,
          9
        );
        expect(Math.round(line.netAmount * 100)).toBeCloseTo(line.netAmount * 100, 9);
      }
    });

    it('ignores a per-line discount on a negative line rather than deepening it', () => {
      // Bad input that hasNegativeLineItem() is there to reject — but while it
      // is in hand, a per-line discount must not make it worse.
      const result = computeQuoteTotals({
        items: [{ qty: -2, unitPrice: 500, discount: 50, discountType: 'percent' }],
      });
      expect(result.lines[0]).toEqual({
        amount: -1000,
        discountValue: 0,
        netAmount: -1000,
      });
      expect(hasNegativeLineItem({ items: [{ qty: -2, unitPrice: 500 }] })).toBe(true);
    });
  });

  // ── ITEM 7: the regression that matters most ──────────────────────────────
  describe('computeQuoteTotals — quotations saved before per-line discounts', () => {
    it('computes an old quote with NO per-line keys at all to exactly its old numbers', () => {
      // Verbatim shape of a quotation blob saved before this feature: items
      // carry qty/unitPrice (plus unrelated display fields) and no discount
      // key whatsoever. The expected numbers below are the ones the previous
      // implementation produced: subtotal − document discount, then VAT 7%.
      const oldQuote = {
        items: [
          { name: 'เครื่องวัด pH', qty: 2, unitPrice: 12500 },
          { name: 'ชุดน้ำยาสอบเทียบ', qty: 5, unitPrice: 480 },
          { name: 'ค่าติดตั้ง', qty: 1, unitPrice: 3000 },
        ],
        discount: 1400,
        discountType: 'amount' as const,
        vatEnabled: true,
      };
      const result = computeQuoteTotals(oldQuote);

      expect(result.subtotal).toBe(30400);
      // Nothing was taken off any line …
      expect(result.lineDiscountTotal).toBe(0);
      expect(result.afterLineDiscounts).toBe(result.subtotal);
      // … so the document-level maths is untouched.
      expect(result.discountValue).toBe(1400);
      expect(result.afterDiscount).toBe(29000);
      expect(result.vat).toBeCloseTo(2030, 10);
      expect(result.grandTotal).toBeCloseTo(31030, 10);
    });

    it('passes an old line amount through untouched, without re-rounding it', () => {
      // A pre-existing quote whose qty × unitPrice has more than 2 decimals
      // must keep the exact float it has always had — introducing rounding
      // here would move saved totals by a satang.
      // 3 × 0.333 is 0.9990000000000001 as a float, NOT 0.999 — asserting the
      // raw float is the whole point: a round2() on this path would have
      // turned it into 1 and moved a saved quotation's total.
      const raw = 3 * 0.333;
      expect(raw).not.toBe(0.999);
      const result = computeQuoteTotals({ items: [{ qty: 3, unitPrice: 0.333 }] });
      expect(result.lines[0].amount).toBe(raw);
      expect(result.lines[0].netAmount).toBe(raw);
      expect(result.subtotal).toBe(raw);
      expect(result.afterLineDiscounts).toBe(raw);
      expect(result.grandTotal).toBe(raw);
    });

    it('treats an explicit per-line discount of 0 exactly like a missing one', () => {
      const missing = computeQuoteTotals({ items: [{ qty: 3, unitPrice: 0.333 }] });
      const explicitZero = computeQuoteTotals({
        items: [{ qty: 3, unitPrice: 0.333, discount: 0, discountType: 'percent' }],
      });
      expect(explicitZero).toEqual(missing);
    });

    it('matches the old maths for every document-level branch when no line is discounted', () => {
      const items = [
        { qty: 2, unitPrice: 100 },
        { qty: 3, unitPrice: 50 },
      ];
      const percent = computeQuoteTotals({
        items,
        discount: 10,
        discountType: 'percent',
        vatEnabled: true,
      });
      expect(percent.subtotal).toBe(350);
      expect(percent.discountValue).toBeCloseTo(35, 10);
      expect(percent.afterDiscount).toBeCloseTo(315, 10);
      expect(percent.grandTotal).toBeCloseTo(315 * 1.07, 10);

      const amount = computeQuoteTotals({ items, discount: 50, discountType: 'amount' });
      expect(amount.discountValue).toBe(50);
      expect(amount.grandTotal).toBe(300);
    });
  });

  describe('computeLineTotal', () => {
    it('treats a missing qty, unitPrice and discount as 0', () => {
      expect(computeLineTotal({})).toEqual({
        amount: 0,
        discountValue: 0,
        netAmount: 0,
      });
    });

    it('gives the UI the ราคาหลังลด for one row without recomputing the quote', () => {
      expect(computeLineTotal({ qty: 4, unitPrice: 250, discount: 15, discountType: 'percent' }))
        .toEqual({ amount: 1000, discountValue: 150, netAmount: 850 });
    });

    it('agrees line-for-line with computeQuoteTotals', () => {
      const items = [
        { qty: 1, unitPrice: 1000, discount: 12.5, discountType: 'percent' as const },
        { qty: 2, unitPrice: 333.33, discount: 66.66, discountType: 'amount' as const },
        { qty: 1, unitPrice: 99 },
      ];
      expect(computeQuoteTotals({ items }).lines).toEqual(items.map(computeLineTotal));
    });
  });

  // ── The setters that keep an old quote's blob keyless ─────────────────────
  // The builder's discount box is FormattedNumberInput, which fires onChange on
  // every BLUR. Writing the value straight onto the line would stamp
  // `discount: 0` onto a quotation saved before per-line discounts existed the
  // moment an admin clicked into the box and tabbed out.
  describe('setLineDiscountAmount', () => {
    it('does not add a discount key when the value is zero (the blur case)', () => {
      const oldLine = { name: 'เครื่องวัด pH', qty: 2, unitPrice: 12500 };
      const next = setLineDiscountAmount(oldLine, 0);
      expect(next).not.toHaveProperty('discount');
      expect(JSON.stringify(next)).toBe(JSON.stringify(oldLine));
    });

    it('returns the very same object when there is nothing to clear', () => {
      // Identity, not just equality — a new object would churn React state and
      // could flip the unsaved-changes fingerprint of a document nobody edited.
      const oldLine = { qty: 2, unitPrice: 12500 };
      expect(setLineDiscountAmount(oldLine, 0)).toBe(oldLine);
      expect(setLineDiscountAmount(oldLine, -5)).toBe(oldLine);
      expect(setLineDiscountAmount(oldLine, NaN)).toBe(oldLine);
    });

    it('writes a real discount', () => {
      expect(setLineDiscountAmount({ qty: 1, unitPrice: 100 }, 15)).toEqual({
        qty: 1,
        unitPrice: 100,
        discount: 15,
      });
    });

    it('REMOVES an existing discount when it is cleared back to empty', () => {
      const line = { qty: 1, unitPrice: 100, discount: 15, discountType: 'percent' as const };
      const cleared = setLineDiscountAmount(line, 0);
      expect(cleared).not.toHaveProperty('discount');
      // The type survives: an admin who picks % and only then types 10 must get
      // 10 percent off, not ฿10.
      expect(cleared.discountType).toBe('percent');
    });

    it('clamps a negative amount to "no discount" rather than storing it', () => {
      const line = { qty: 1, unitPrice: 100, discount: 15 };
      expect(setLineDiscountAmount(line, -20)).not.toHaveProperty('discount');
    });

    it('leaves the computed totals of an old line untouched after a blur', () => {
      const oldQuote = { items: [{ qty: 3, unitPrice: 0.333 }], vatEnabled: true };
      const blurred = { items: [setLineDiscountAmount(oldQuote.items[0], 0)], vatEnabled: true };
      expect(computeQuoteTotals(blurred)).toEqual(computeQuoteTotals(oldQuote));
    });
  });

  describe('setLineDiscountType', () => {
    it('stores "percent" because it changes the maths', () => {
      expect(setLineDiscountType({ qty: 1, unitPrice: 100 }, 'percent')).toEqual({
        qty: 1,
        unitPrice: 100,
        discountType: 'percent',
      });
    });

    it('does NOT store "amount" — a missing key already means baht', () => {
      const oldLine = { qty: 1, unitPrice: 100 };
      expect(setLineDiscountType(oldLine, 'amount')).toBe(oldLine);
    });

    it('clears a stored "percent" when the admin switches back to baht', () => {
      const line = { qty: 1, unitPrice: 100, discount: 10, discountType: 'percent' as const };
      const back = setLineDiscountType(line, 'amount');
      expect(back).not.toHaveProperty('discountType');
      expect(back.discount).toBe(10);
      // Absence and "amount" are the same value to the money math.
      expect(computeLineTotal(back)).toEqual(
        computeLineTotal({ qty: 1, unitPrice: 100, discount: 10, discountType: 'amount' })
      );
    });

    it('round-trips an old line back to a byte-identical blob', () => {
      // % then back to ฿, and a blur on the empty amount box, on a quotation
      // that predates the whole feature.
      const oldLine = { name: 'ค่าติดตั้ง', qty: 1, unitPrice: 3000 };
      let line: typeof oldLine & { discount?: number; discountType?: 'amount' | 'percent' } =
        oldLine;
      line = setLineDiscountType(line, 'percent');
      line = setLineDiscountType(line, 'amount');
      line = setLineDiscountAmount(line, 0);
      expect(JSON.stringify(line)).toBe(JSON.stringify(oldLine));
    });
  });

  describe('hasNegativeLineItem', () => {
    it('is false for no items', () => {
      expect(hasNegativeLineItem({})).toBe(false);
    });

    it('is false when every item has non-negative qty and unitPrice', () => {
      expect(hasNegativeLineItem({ items: [{ qty: 2, unitPrice: 500 }] })).toBe(false);
    });

    it('is true when any item has a negative qty', () => {
      expect(hasNegativeLineItem({ items: [{ qty: -1, unitPrice: 500 }] })).toBe(true);
    });

    it('is true when any item has a negative unitPrice', () => {
      expect(hasNegativeLineItem({ items: [{ qty: 1, unitPrice: -500 }] })).toBe(true);
    });

    it('is true when a later item in a multi-item list is negative', () => {
      expect(
        hasNegativeLineItem({
          items: [{ qty: 1, unitPrice: 500 }, { qty: -1, unitPrice: 100 }],
        })
      ).toBe(true);
    });
  });
});

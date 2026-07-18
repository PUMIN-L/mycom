// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { computeQuoteTotals, VAT_RATE } from '@/app/lib/quotationTotals';

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
        discountValue: 0,
        afterDiscount: 0,
        vat: 0,
        grandTotal: 0,
      });
    });

    it('returns all zeros when items is an empty array', () => {
      expect(computeQuoteTotals({ items: [] })).toEqual({
        subtotal: 0,
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
  });
});

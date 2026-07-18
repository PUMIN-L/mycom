// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DOCNO_START, pad2, nextDocNo } from '@/app/lib/quotationNumber';

const PREFIX = 'QT20260719-';

describe('quotationNumber', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('DOCNO_START', () => {
    it('is the business-convention starting number 22', () => {
      expect(DOCNO_START).toBe(22);
    });
  });

  describe('pad2', () => {
    it('pads a 1-digit number to two digits', () => {
      expect(pad2(1)).toBe('01');
    });

    it('leaves a 2-digit number unchanged', () => {
      expect(pad2(22)).toBe('22');
    });

    it('does not truncate a 3-digit number', () => {
      expect(pad2(123)).toBe('123');
    });
  });

  describe('nextDocNo', () => {
    it('returns prefix + "22" when nothing has been used', () => {
      expect(nextDocNo(PREFIX, [])).toBe('QT20260719-22');
    });

    it('still yields 22 when existing numbers are below the start', () => {
      expect(nextDocNo(PREFIX, ['QT20260719-05', 'QT20260719-21'])).toBe('QT20260719-22');
    });

    it('yields max+1 when the max existing number equals the start', () => {
      expect(nextDocNo(PREFIX, ['QT20260719-22'])).toBe('QT20260719-23');
    });

    it('yields max+1 (padded) when the max existing number is above the start', () => {
      expect(nextDocNo(PREFIX, ['QT20260719-22', 'QT20260719-25', 'QT20260719-23'])).toBe(
        'QT20260719-26'
      );
    });

    it('pads the result to two digits when max+1 crosses to a larger value', () => {
      expect(nextDocNo(PREFIX, ['QT20260719-99'])).toBe('QT20260719-100');
    });

    it('ignores numbers from other date prefixes', () => {
      expect(nextDocNo(PREFIX, ['QT20260718-99', 'QT20250101-50'])).toBe('QT20260719-22');
    });

    it('ignores non-numeric suffixes', () => {
      expect(nextDocNo(PREFIX, ['QT20260719-XX', 'QT20260719-'])).toBe('QT20260719-22');
    });

    it('ignores non-numeric suffixes but still honours valid ones alongside them', () => {
      expect(nextDocNo(PREFIX, ['QT20260719-XX', 'QT20260719-30'])).toBe('QT20260719-31');
    });
  });
});

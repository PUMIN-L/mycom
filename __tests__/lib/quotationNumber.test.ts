// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  DOCNO_START,
  pad2,
  nextDocNo,
  docNoDatePart,
  legacyDocNoDatePart,
  quotationDocNoPrefix,
  legacyQuotationDocNoPrefix,
  quotationDocNoPrefixes,
} from '@/app/lib/quotationNumber';

// The LEGACY shape: QT + YYMMDD + "-NN" (every number issued before task 5).
const LEGACY_PREFIX = 'QT20260719-';
// 19 Jul 2026 in the two shapes.
const ISO = '2026-07-19';
const CURRENT = 'QT190726-'; // DDMMYY
const LEGACY = 'QT260719-'; // YYMMDD

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

  // ── The date parts / prefixes (task 5) ───────────────────────────────────
  describe('date parts', () => {
    it('mints the CURRENT date part as DDMMYY', () => {
      expect(docNoDatePart('2026-09-05')).toBe('050926');
    });

    it('still recognises the LEGACY date part as YYMMDD', () => {
      expect(legacyDocNoDatePart('2026-09-05')).toBe('260905');
    });

    it('builds the current and legacy prefixes around "QT"', () => {
      expect(quotationDocNoPrefix('2026-09-05')).toBe('QT050926-');
      expect(legacyQuotationDocNoPrefix('2026-09-05')).toBe('QT260905-');
    });

    it('yields an empty date part (and a bare "QT-" prefix) for a non-ISO date', () => {
      expect(docNoDatePart('')).toBe('');
      expect(legacyDocNoDatePart('not-a-date')).toBe('');
      expect(quotationDocNoPrefix('')).toBe('QT-');
    });

    it('lists both prefixes for a date, current shape first', () => {
      expect(quotationDocNoPrefixes('2026-09-05')).toEqual(['QT050926-', 'QT260905-']);
    });

    it('de-duplicates the dates where the two shapes coincide (day === year)', () => {
      // 26 Sep 2026 → DDMMYY "260926" === YYMMDD "260926".
      expect(quotationDocNoPrefixes('2026-09-26')).toEqual(['QT260926-']);
    });
  });

  describe('nextDocNo (single prefix — the legacy call shape, still used by billing)', () => {
    it('returns prefix + "22" when nothing has been used', () => {
      expect(nextDocNo(LEGACY_PREFIX, [])).toBe('QT20260719-22');
    });

    it('still yields 22 when existing numbers are below the start', () => {
      expect(nextDocNo(LEGACY_PREFIX, ['QT20260719-05', 'QT20260719-21'])).toBe('QT20260719-22');
    });

    it('yields max+1 when the max existing number equals the start', () => {
      expect(nextDocNo(LEGACY_PREFIX, ['QT20260719-22'])).toBe('QT20260719-23');
    });

    it('yields max+1 (padded) when the max existing number is above the start', () => {
      expect(nextDocNo(LEGACY_PREFIX, ['QT20260719-22', 'QT20260719-25', 'QT20260719-23'])).toBe(
        'QT20260719-26'
      );
    });

    it('pads the result to two digits when max+1 crosses to a larger value', () => {
      expect(nextDocNo(LEGACY_PREFIX, ['QT20260719-99'])).toBe('QT20260719-100');
    });

    it('ignores numbers from other date prefixes', () => {
      expect(nextDocNo(LEGACY_PREFIX, ['QT20260718-99', 'QT20250101-50'])).toBe('QT20260719-22');
    });

    it('ignores non-numeric suffixes', () => {
      expect(nextDocNo(LEGACY_PREFIX, ['QT20260719-XX', 'QT20260719-'])).toBe('QT20260719-22');
    });

    it('ignores non-numeric suffixes but still honours valid ones alongside them', () => {
      expect(nextDocNo(LEGACY_PREFIX, ['QT20260719-XX', 'QT20260719-30'])).toBe('QT20260719-31');
    });
  });

  // ── The allocator across BOTH shapes (task 5a) ───────────────────────────
  describe('nextDocNo across both docNo formats', () => {
    const prefixes = quotationDocNoPrefixes(ISO);

    it('issues the new DDMMYY shape when the day is empty', () => {
      expect(nextDocNo(prefixes, [])).toBe(`${CURRENT}22`);
    });

    it('keeps climbing past numbers already issued in the LEGACY shape', () => {
      // The whole point: 23 is out with a customer as QT260719-23. The next
      // number must be 24 — not a second "-22" under the new prefix.
      expect(nextDocNo(prefixes, [`${LEGACY}22`, `${LEGACY}23`])).toBe(`${CURRENT}24`);
    });

    it('keeps climbing past numbers already issued in the CURRENT shape', () => {
      expect(nextDocNo(prefixes, [`${CURRENT}22`, `${CURRENT}23`])).toBe(`${CURRENT}24`);
    });

    it('takes the highest number no matter which shape carries it', () => {
      expect(nextDocNo(prefixes, [`${CURRENT}23`, `${LEGACY}41`, `${CURRENT}30`])).toBe(
        `${CURRENT}42`
      );
      expect(nextDocNo(prefixes, [`${LEGACY}23`, `${CURRENT}41`])).toBe(`${CURRENT}42`);
    });

    it('always mints under the CURRENT prefix even when only legacy numbers exist', () => {
      expect(nextDocNo(prefixes, [`${LEGACY}99`]).startsWith(CURRENT)).toBe(true);
    });

    it('ignores both shapes belonging to a DIFFERENT day', () => {
      // 18 Jul 2026 in both spellings, plus an unrelated old one.
      expect(
        nextDocNo(prefixes, ['QT180726-90', 'QT260718-91', 'QT20250101-50'])
      ).toBe(`${CURRENT}22`);
    });

    it('counts a version-bumped number (…-23v2) as its base running number', () => {
      // Unchanged behaviour: parseInt stops at the "v".
      expect(nextDocNo(prefixes, [`${LEGACY}23v2`])).toBe(`${CURRENT}24`);
    });

    it('handles the day where the two shapes are the same string, without double counting', () => {
      const same = quotationDocNoPrefixes('2026-09-26'); // ["QT260926-"]
      expect(nextDocNo(same, ['QT260926-30'])).toBe('QT260926-31');
    });

    it('is unfazed by a null/garbage entry in the used list', () => {
      expect(
        nextDocNo(prefixes, [null as unknown as string, `${LEGACY}25`, undefined as unknown as string])
      ).toBe(`${CURRENT}26`);
    });
  });
});

// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  BILLING_PREFIX,
  BILLING_LABELS,
  billingDatePrefix,
  legacyBillingDatePrefix,
  billingDocNoPrefixes,
  nextBillingDocNo,
  nextDocNo,
  pad2,
} from '@/app/lib/billingNumber';
import { DOCNO_START } from '@/app/lib/quotationNumber';

// 10 Aug 2026 in the two shapes.
const ISO = '2026-08-10';
const INV = 'INV100826-'; // CURRENT — DDMMYY
const INV_LEGACY = 'INV260810-'; // LEGACY — YYMMDD, already out with customers

describe('billingNumber', () => {
  describe('the three document types', () => {
    it('keeps the INV / BN / RC literals', () => {
      expect(BILLING_PREFIX).toEqual({ invoice: 'INV', billing_note: 'BN', receipt: 'RC' });
    });

    it('keeps the Thai labels the printed document carries', () => {
      expect(BILLING_LABELS.invoice.th).toBe('ใบแจ้งหนี้ / ใบกำกับภาษี');
      expect(BILLING_LABELS.billing_note.th).toBe('ใบวางบิล');
      expect(BILLING_LABELS.receipt.th).toBe('ใบเสร็จรับเงิน');
    });
  });

  // ── FIX 1: billing follows quotations to DDMMYY ──────────────────────────
  describe('billingDatePrefix (the shape minted today)', () => {
    it('mints DDMMYY, matching the quotation for the same deal', () => {
      expect(billingDatePrefix('invoice', ISO)).toBe('INV100826-');
      expect(billingDatePrefix('billing_note', ISO)).toBe('BN100826-');
      expect(billingDatePrefix('receipt', ISO)).toBe('RC100826-');
    });

    it('is no longer the YYMMDD shape it used to produce', () => {
      expect(billingDatePrefix('invoice', ISO)).not.toBe('INV260810-');
    });

    it('yields a bare "INV-" for a non-ISO date, as the old code did for an empty one', () => {
      expect(billingDatePrefix('invoice', '')).toBe('INV-');
      expect(billingDatePrefix('invoice', 'not-a-date')).toBe('INV-');
    });
  });

  describe('legacyBillingDatePrefix (numbers already issued)', () => {
    it('still spells the date YYMMDD', () => {
      expect(legacyBillingDatePrefix('invoice', ISO)).toBe('INV260810-');
      expect(legacyBillingDatePrefix('billing_note', ISO)).toBe('BN260810-');
      expect(legacyBillingDatePrefix('receipt', ISO)).toBe('RC260810-');
    });
  });

  describe('billingDocNoPrefixes', () => {
    it('lists both shapes for a date, the minted one first', () => {
      expect(billingDocNoPrefixes('invoice', ISO)).toEqual([INV, INV_LEGACY]);
    });

    it('de-duplicates the dates where the two shapes coincide (day === year)', () => {
      // 26 Sep 2026 → DDMMYY "260926" === YYMMDD "260926".
      expect(billingDocNoPrefixes('receipt', '2026-09-26')).toEqual(['RC260926-']);
    });

    it('never mixes document types', () => {
      expect(billingDocNoPrefixes('billing_note', ISO)).toEqual(['BN100826-', 'BN260810-']);
    });
  });

  describe('nextBillingDocNo across BOTH shapes', () => {
    it('issues the new DDMMYY shape when the day is empty', () => {
      expect(nextBillingDocNo('invoice', ISO, [])).toBe(`${INV}${DOCNO_START}`);
    });

    it('keeps climbing past invoices already issued in the LEGACY shape', () => {
      // INV260810-23 is with the customer and with the revenue department. The
      // next invoice must be 24 — not a second "-22" under the new prefix.
      expect(
        nextBillingDocNo('invoice', ISO, [`${INV_LEGACY}22`, `${INV_LEGACY}23`])
      ).toBe(`${INV}24`);
    });

    it('keeps climbing past invoices already issued in the CURRENT shape', () => {
      expect(nextBillingDocNo('invoice', ISO, [`${INV}22`, `${INV}23`])).toBe(`${INV}24`);
    });

    it('takes the highest number no matter which shape carries it', () => {
      expect(
        nextBillingDocNo('invoice', ISO, [`${INV}23`, `${INV_LEGACY}41`, `${INV}30`])
      ).toBe(`${INV}42`);
      expect(nextBillingDocNo('invoice', ISO, [`${INV_LEGACY}23`, `${INV}41`])).toBe(`${INV}42`);
    });

    it('always mints under the CURRENT prefix even when only legacy numbers exist', () => {
      expect(nextBillingDocNo('invoice', ISO, [`${INV_LEGACY}99`])).toBe(`${INV}100`);
    });

    it('runs each document type on its OWN sequence', () => {
      const used = [`${INV}30`, 'BN100826-40', 'RC100826-50'];
      expect(nextBillingDocNo('invoice', ISO, used)).toBe(`${INV}31`);
      expect(nextBillingDocNo('billing_note', ISO, used)).toBe('BN100826-41');
      expect(nextBillingDocNo('receipt', ISO, used)).toBe('RC100826-51');
    });

    it('ignores quotation numbers sharing the ledger', () => {
      expect(nextBillingDocNo('invoice', ISO, ['QT100826-99'])).toBe(`${INV}${DOCNO_START}`);
    });

    it('ignores both shapes belonging to a DIFFERENT day', () => {
      expect(
        nextBillingDocNo('invoice', ISO, ['INV090826-90', 'INV260809-91'])
      ).toBe(`${INV}${DOCNO_START}`);
    });

    it('counts a version-bumped number (…-23v2) as its base running number', () => {
      expect(nextBillingDocNo('invoice', ISO, [`${INV_LEGACY}23v2`])).toBe(`${INV}24`);
    });

    it('is unfazed by null/garbage entries in the used list', () => {
      expect(
        nextBillingDocNo('invoice', ISO, [
          null as unknown as string,
          `${INV_LEGACY}25`,
          undefined as unknown as string,
        ])
      ).toBe(`${INV}26`);
    });
  });

  // ── FIX 2: a minted number must be one the ledger does not already own ───
  describe('nextBillingDocNo across a year boundary', () => {
    // 25 Jun 2026 mints DDMMYY "250626"; 26 Jun 2025 was issued as YYMMDD
    // "250626". One prefix, two days a year apart, and used_docnos is never
    // purged — so 2026's mint has to step over 2025's numbers.
    const Y2026 = '2026-06-25';
    const Y2025 = '2025-06-26';
    const SHARED = 'INV250626-';

    it('proves the two days really do share one prefix', () => {
      expect(billingDocNoPrefixes('invoice', Y2026)).toEqual([SHARED, 'INV260625-']);
      expect(billingDocNoPrefixes('invoice', Y2025)).toEqual(['INV260625-', SHARED]);
    });

    it('continues past LAST YEAR\'s invoices instead of colliding with one', () => {
      const ledger = [`${SHARED}22`, `${SHARED}23`, `${SHARED}24`];
      expect(nextBillingDocNo('invoice', Y2026, ledger)).toBe(`${SHARED}25`);
    });

    it('is symmetric — the 2025 day steps past the 2026 day too', () => {
      expect(
        nextBillingDocNo('invoice', Y2025, ['INV260625-40', `${SHARED}22`])
      ).toBe('INV260625-41');
    });

    it('NEVER returns a number the ledger already holds', () => {
      const ledger = [
        `${SHARED}22`,
        `${SHARED}23`,
        'INV260625-24',
        `${SHARED}25v1`,
        'INV250626-nonsense',
      ];
      const minted = nextBillingDocNo('invoice', Y2026, ledger);
      expect(ledger).not.toContain(minted);
      expect(minted.startsWith(SHARED)).toBe(true);
    });
  });

  // ── The single-string signature every existing caller relies on ──────────
  describe('the re-exported nextDocNo / pad2', () => {
    it('still accepts ONE prefix string', () => {
      expect(nextDocNo(INV, [])).toBe(`${INV}${DOCNO_START}`);
      expect(nextDocNo(INV, [`${INV}30`])).toBe(`${INV}31`);
    });

    it('scans only that one prefix when given a string', () => {
      // The legacy shape is invisible to a single-prefix call — which is
      // exactly why nextBillingDocNo passes the pair instead.
      expect(nextDocNo(INV, [`${INV_LEGACY}99`])).toBe(`${INV}${DOCNO_START}`);
    });

    it('agrees with nextBillingDocNo when the date has only one shape', () => {
      const single = billingDocNoPrefixes('receipt', '2026-09-26');
      expect(single).toHaveLength(1);
      expect(nextDocNo(single[0], ['RC260926-30'])).toBe(
        nextBillingDocNo('receipt', '2026-09-26', ['RC260926-30'])
      );
    });

    it('re-exports pad2 unchanged', () => {
      expect(pad2(7)).toBe('07');
      expect(pad2(100)).toBe('100');
    });
  });
});

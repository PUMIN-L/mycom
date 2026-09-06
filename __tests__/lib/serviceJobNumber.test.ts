// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  SERVICE_JOB_DOCNO_PREFIX,
  serviceJobDocNoPrefix,
  legacyServiceJobDocNoPrefix,
  serviceJobDocNoPrefixes,
  nextServiceJobDocNo,
} from '@/app/lib/serviceJobNumber';
import { DOCNO_START, nextDocNo } from '@/app/lib/quotationNumber';

describe('serviceJobNumber — the shape', () => {
  it('mints JOB<DDMMYY>-NN, matching QT<DDMMYY>-NN rather than inventing a third shape', () => {
    expect(SERVICE_JOB_DOCNO_PREFIX).toBe('JOB');
    expect(serviceJobDocNoPrefix('2026-09-05')).toBe('JOB050926-');
    expect(nextServiceJobDocNo('2026-09-05', [])).toBe(`JOB050926-${DOCNO_START}`);
  });

  it('yields "JOB-" for a non-ISO date, exactly as the quotation/billing helpers do', () => {
    expect(serviceJobDocNoPrefix('')).toBe('JOB-');
    expect(serviceJobDocNoPrefix('05/09/2026')).toBe('JOB-');
  });

  it('lists the current shape FIRST — that is the one numbers are issued under', () => {
    expect(serviceJobDocNoPrefixes('2026-09-05')).toEqual(['JOB050926-', 'JOB260905-']);
    expect(legacyServiceJobDocNoPrefix('2026-09-05')).toBe('JOB260905-');
  });

  it('de-duplicates the prefix list on a date where both shapes coincide', () => {
    // 26 Sep 2026 is "260926" read either way round.
    expect(serviceJobDocNoPrefixes('2026-09-26')).toEqual(['JOB260926-']);
  });
});

describe('serviceJobNumber — the day’s running sequence', () => {
  it('continues from the highest number already issued that day (two sheets, same day)', () => {
    const used = ['JOB050926-22', 'JOB050926-23'];
    expect(nextServiceJobDocNo('2026-09-05', used)).toBe('JOB050926-24');
  });

  it('never restarts at 01 — the day begins at DOCNO_START', () => {
    expect(nextServiceJobDocNo('2026-09-05', [])).toBe('JOB050926-22');
    expect(DOCNO_START).toBe(22);
  });

  it('IS the shared allocator, not a copy of it', () => {
    // If this ever diverges, someone has written a second allocator — the one
    // thing serviceJobNumber.ts exists to prevent.
    const used = ['JOB050926-22'];
    expect(nextServiceJobDocNo('2026-09-05', used)).toBe(
      nextDocNo(serviceJobDocNoPrefixes('2026-09-05'), used)
    );
  });

  it('STEPS PAST a number the ledger already owns instead of proposing it', () => {
    // Not merely max+1: -23 is owned (hand-typed, imported, or parked under a
    // colliding date shape from another year), so the mint must move on rather
    // than hand back a number the used_docnos PRIMARY KEY will refuse.
    const used = ['JOB050926-22', 'JOB050926-23'];
    expect(nextServiceJobDocNo('2026-09-05', used)).not.toBe('JOB050926-23');
  });

  it('counts a legacy-shaped number for the SAME day, if one ever existed', () => {
    // No JOB number was ever issued in YYMMDD, but the prefix is scanned anyway
    // so JOB stays on the identical code path as QT/INV.
    expect(nextServiceJobDocNo('2026-09-05', ['JOB260905-30'])).toBe('JOB050926-31');
  });

  it('ignores another day’s numbers', () => {
    expect(nextServiceJobDocNo('2026-09-05', ['JOB060926-40', 'QT050926-40'])).toBe(
      'JOB050926-22'
    );
  });
});

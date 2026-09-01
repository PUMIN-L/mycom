import { describe, it, expect } from 'vitest';
import { toLocalDateString } from '@/app/lib/dateFormat';

describe('toLocalDateString', () => {
  it('formats using local calendar getters, not toISOString', () => {
    // Midnight LOCAL time on Aug 5th. toISOString() on this same Date shifts
    // to Aug 4th for any timezone ahead of UTC (e.g. Asia/Bangkok, UTC+7) —
    // exactly the react-datepicker failure mode this helper exists to avoid.
    const d = new Date(2026, 7, 5, 0, 0, 0); // month is 0-indexed: 7 = August
    expect(toLocalDateString(d)).toBe('2026-08-05');
  });

  it('pads single-digit month and day', () => {
    const d = new Date(2026, 0, 5, 0, 0, 0); // Jan 5
    expect(toLocalDateString(d)).toBe('2026-01-05');
  });

  it('is stable across any time-of-day on the same local calendar day', () => {
    const morning = new Date(2026, 7, 5, 0, 0, 1);
    const night = new Date(2026, 7, 5, 23, 59, 59);
    expect(toLocalDateString(morning)).toBe(toLocalDateString(night));
  });
});

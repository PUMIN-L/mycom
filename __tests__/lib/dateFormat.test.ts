import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  toLocalDateString,
  bangkokDateAtHour,
  bangkokDateAtHourFromNow,
  bangkokCurrentMonth,
} from '@/app/lib/dateFormat';

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

describe('bangkokDateAtHour', () => {
  it('computes the UTC instant for 6 AM Bangkok on a given date, independent of local timezone', () => {
    // 06:00 +07:00 == 23:00 UTC the previous day. The computation must not
    // read any local Date getter/setter, so this holds no matter what
    // timezone the test runner itself is in.
    const d = bangkokDateAtHour('2026-08-05', 6);
    expect(d.toISOString()).toBe('2026-08-04T23:00:00.000Z');
  });

  it('handles an hour that keeps the same UTC calendar day (e.g. noon Bangkok)', () => {
    const d = bangkokDateAtHour('2026-08-05', 12);
    expect(d.toISOString()).toBe('2026-08-05T05:00:00.000Z');
  });
});

describe('bangkokDateAtHourFromNow', () => {
  afterEach(() => vi.useRealTimers());

  it('lands on the Bangkok calendar date N days out, at the given Bangkok hour', () => {
    // UTC 2026-08-04T19:00:00Z == Bangkok 2026-08-05 02:00. 3 days later in
    // Bangkok terms is 2026-08-08; 6 AM there is 2026-08-07T23:00:00Z.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-04T19:00:00.000Z'));
    const d = bangkokDateAtHourFromNow(3, 6);
    expect(d.toISOString()).toBe('2026-08-07T23:00:00.000Z');
  });

  it('uses the Bangkok calendar date, not the server/runner UTC date, for "0 days from now"', () => {
    // Still Bangkok 2026-08-05 (02:00) even though UTC says Aug 4.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-04T19:00:00.000Z'));
    const d = bangkokDateAtHourFromNow(0, 6);
    expect(d.toISOString()).toBe('2026-08-04T23:00:00.000Z'); // Aug 5 06:00 +07
  });
});

describe('bangkokCurrentMonth', () => {
  afterEach(() => vi.useRealTimers());

  it('returns the Bangkok calendar month, not the server UTC month, during the lag window', () => {
    // UTC 2026-08-31T19:00:00Z == Bangkok 2026-09-01 02:00 — a naive
    // server-UTC month would still say "2026-08".
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-31T19:00:00.000Z'));
    expect(bangkokCurrentMonth()).toBe('2026-09');
  });

  it('pads a single-digit month', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T04:00:00.000Z')); // Bangkok: Jan 15, 11:00
    expect(bangkokCurrentMonth()).toBe('2026-01');
  });
});

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  toLocalDateString,
  bangkokDateAtHour,
  bangkokDateAtHourFromNow,
  bangkokCurrentMonth,
  isValidDateString,
  addMonthsToDateString,
  addDaysToDateString,
  daysBetweenDateStrings,
  formatDisplayDate,
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

describe('isValidDateString', () => {
  it('accepts a well-formed calendar date', () => {
    expect(isValidDateString('2026-02-14')).toBe(true);
  });

  it('rejects garbage text', () => {
    expect(isValidDateString('not-a-date')).toBe(false);
  });

  it('rejects a value with the wrong shape even if partially numeric', () => {
    expect(isValidDateString('2026/02/14')).toBe(false);
    expect(isValidDateString('26-02-14')).toBe(false);
    expect(isValidDateString('2026-02-14T00:00:00')).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(isValidDateString('')).toBe(false);
  });

  it('rejects a month/day out of any calendar\'s range', () => {
    expect(isValidDateString('2026-13-01')).toBe(false);
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

describe('addMonthsToDateString', () => {
  it('adds whole months within the same year', () => {
    expect(addMonthsToDateString('2026-01-15', 10)).toBe('2026-11-15');
  });

  it('rolls over into the next year', () => {
    expect(addMonthsToDateString('2026-06-01', 10)).toBe('2027-04-01');
  });

  // These pin the helper to MySQL's DATE_ADD(..., INTERVAL n MONTH), which the
  // alert queries filter with server-side while the alerts page displays this.
  // MySQL CLAMPS a day that does not exist in the target month to that month's
  // last day; plain Date.UTC(y, m + n, d) instead rolls the overflow into the
  // NEXT month, which is up to three days past what the SQL side computes for
  // the same row. These two must not drift apart.
  it('clamps to the last day when the target month is shorter (matches MySQL DATE_ADD)', () => {
    // MySQL: DATE_ADD('2026-01-31', INTERVAL 1 MONTH) = '2026-02-28'.
    // Date.UTC rollover would give '2026-03-03' — three days late.
    expect(addMonthsToDateString('2026-01-31', 1)).toBe('2026-02-28');
  });

  it('clamps the 10-month calibration offset the same way crmStore inverts it', () => {
    // crmStore.ts's CALIBRATION_WHERE documents exactly this case in the
    // comment explaining why its index-usable bound is widened by 3 days:
    // "31 Jan + 10 months = 30 Nov".
    expect(addMonthsToDateString('2026-01-31', 10)).toBe('2026-11-30');
  });

  it('clamps a leap day landing on a non-leap February', () => {
    // The one case that actually reached the alerts page: equipment calibrated
    // on 29 Feb, displayed with CALIBRATION_VALIDITY_MONTHS (12). MySQL gives
    // '2029-02-28'; rollover gave '2029-03-01', so the due date shown was a day
    // later than the date the SQL-driven search matched on.
    expect(addMonthsToDateString('2028-02-29', 12)).toBe('2029-02-28');
  });

  it('keeps a day that still exists in a leap-year February', () => {
    expect(addMonthsToDateString('2027-04-29', 10)).toBe('2028-02-29'); // 2028 is a leap year
  });

  it('leaves a day that exists in the target month untouched', () => {
    expect(addMonthsToDateString('2026-01-30', 1)).toBe('2026-02-28'); // clamped
    expect(addMonthsToDateString('2026-03-30', 1)).toBe('2026-04-30'); // not clamped
  });
});

describe('formatDisplayDate', () => {
  it('renders a stored date as day / short month / year', () => {
    expect(formatDisplayDate('2026-06-12')).toBe('12 Jun 2026');
  });

  it('drops the leading zero on single-digit days', () => {
    expect(formatDisplayDate('2026-01-05')).toBe('5 Jan 2026');
  });

  it('handles both ends of the year', () => {
    expect(formatDisplayDate('2026-01-31')).toBe('31 Jan 2026');
    expect(formatDisplayDate('2026-12-01')).toBe('1 Dec 2026');
  });

  it('accepts a full timestamp and reads only the calendar day', () => {
    expect(formatDisplayDate('2026-06-12T00:00:00.000Z')).toBe('12 Jun 2026');
  });

  it('returns an empty string for a missing value rather than "Invalid Date"', () => {
    expect(formatDisplayDate('')).toBe('');
    expect(formatDisplayDate(null)).toBe('');
    expect(formatDisplayDate(undefined)).toBe('');
  });

  it('passes an unparseable value straight through instead of mangling it', () => {
    // A stray value should look odd on screen, not erase the row's date.
    expect(formatDisplayDate('ไม่ระบุ')).toBe('ไม่ระบุ');
    expect(formatDisplayDate('2026-13-01')).toBe('2026-13-01');
  });
});

// ── Credit terms and ageing ────────────────────────────────────────────────
describe('addDaysToDateString', () => {
  it('adds a credit term and keeps the lexically-sortable shape', () => {
    expect(addDaysToDateString('2026-08-01', 30)).toBe('2026-08-31');
  });

  it('rolls over a month and a year boundary', () => {
    expect(addDaysToDateString('2026-08-15', 30)).toBe('2026-09-14');
    expect(addDaysToDateString('2026-12-20', 30)).toBe('2027-01-19');
  });

  it('handles a leap day without shifting a day', () => {
    expect(addDaysToDateString('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDaysToDateString('2028-02-28', 2)).toBe('2028-03-01');
  });

  it('a term of 0 (เงินสด) returns the same day', () => {
    expect(addDaysToDateString('2026-08-01', 0)).toBe('2026-08-01');
  });

  it('returns an unparseable input UNCHANGED rather than "NaN-NaN-NaN"', () => {
    // These values reach VARCHAR columns compared lexically — a malformed one
    // must look odd, never silently poison a range query.
    expect(addDaysToDateString('', 30)).toBe('');
    expect(addDaysToDateString('01/08/2026', 30)).toBe('01/08/2026');
  });
});

describe('daysBetweenDateStrings', () => {
  it('is positive when the second date is later, negative when earlier', () => {
    expect(daysBetweenDateStrings('2026-08-25', '2026-09-06')).toBe(12);
    expect(daysBetweenDateStrings('2026-09-09', '2026-09-06')).toBe(-3);
  });

  it('is 0 for the same day — money due today is not late today', () => {
    expect(daysBetweenDateStrings('2026-09-06', '2026-09-06')).toBe(0);
  });

  it('counts whole days across a year boundary', () => {
    expect(daysBetweenDateStrings('2026-12-31', '2027-01-01')).toBe(1);
  });

  it('returns null for a missing or malformed side, so a caller can render "-"', () => {
    expect(daysBetweenDateStrings(null, '2026-09-06')).toBeNull();
    expect(daysBetweenDateStrings('2026-09-06', undefined)).toBeNull();
    expect(daysBetweenDateStrings('not-a-date', '2026-09-06')).toBeNull();
  });
});

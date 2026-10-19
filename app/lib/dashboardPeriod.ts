// The sales dashboard's period — a month ("2026-10"), a quarter ("2026-Q4")
// or a year ("2026") — read, named, stepped and compared one way for both the
// server (salesDashboardStore.getPeriodDateRange) and the page. Pure.
//
// Values stay Gregorian (they are what the API and the dates in the database
// use); every NAME a person reads is in พ.ศ., like every other date in the
// system — the dashboard alone used to say "ปี 2026" beside "16 ต.ค. 2569".

export type PeriodType = "month" | "quarter" | "year";

/** "Now" as a calendar year and 0-based month — Bangkok's, from bangkokParts. */
export interface PeriodNow {
  year: number;
  month: number;
}

/** A period read out of its value: the year, and the quarter or month in it. */
export interface PeriodParts {
  year: number;
  /** 1–4 */
  quarter: number;
  /** 0–11 */
  month: number;
}

const MONTHS_TH = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];

/** A Gregorian year as Thai readers write it. */
export function buddhistYear(year: number): number {
  return year + 543;
}

function intIn(raw: string | undefined, min: number, max: number): number | null {
  if (raw === undefined || !/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return n >= min && n <= max ? n : null;
}

/**
 * `value` read as a period of `type`. A missing or malformed part falls back
 * to `now`'s — a quarter "Q9" or a month "13" never reaches date arithmetic.
 */
export function parsePeriod(type: PeriodType, value: string | undefined, now: PeriodNow): PeriodParts {
  const currentQuarter = Math.floor(now.month / 3) + 1;
  if (type === "year") {
    const year = intIn(value, 1900, 9999) ?? now.year;
    return { year, quarter: 1, month: 0 };
  }
  if (type === "quarter") {
    const [y, q] = (value ?? "").split("-Q");
    const year = intIn(y, 1900, 9999) ?? now.year;
    const quarter = intIn(q, 1, 4) ?? currentQuarter;
    return { year, quarter, month: (quarter - 1) * 3 };
  }
  const [y, m] = (value ?? "").split("-");
  const year = intIn(y, 1900, 9999) ?? now.year;
  const monthNo = intIn(m, 1, 12);
  const month = monthNo === null ? now.month : monthNo - 1;
  return { year, quarter: Math.floor(month / 3) + 1, month };
}

/** The value for `parts` as a period of `type`. */
export function formatPeriodValue(type: PeriodType, parts: PeriodParts): string {
  if (type === "year") return String(parts.year);
  if (type === "quarter") return `${parts.year}-Q${parts.quarter}`;
  return `${parts.year}-${String(parts.month + 1).padStart(2, "0")}`;
}

/** The period's name, in พ.ศ.: "ปี 2569", "ไตรมาส 4 ปี 2569", "เดือน ต.ค. 2569". */
export function periodLabel(type: PeriodType, value: string | undefined, now: PeriodNow): string {
  const { year, quarter, month } = parsePeriod(type, value, now);
  const be = buddhistYear(year);
  if (type === "year") return `ปี ${be}`;
  if (type === "quarter") return `ไตรมาส ${quarter} ปี ${be}`;
  return `เดือน ${MONTHS_TH[month]} ${be}`;
}

/** A running count of periods of `type`, so two can be compared or stepped. */
function ordinal(type: PeriodType, parts: PeriodParts): number {
  if (type === "year") return parts.year;
  if (type === "quarter") return parts.year * 4 + (parts.quarter - 1);
  return parts.year * 12 + parts.month;
}

function fromOrdinal(type: PeriodType, n: number): PeriodParts {
  if (type === "year") return { year: n, quarter: 1, month: 0 };
  if (type === "quarter") {
    const year = Math.floor(n / 4);
    const quarter = (n - year * 4) + 1;
    return { year, quarter, month: (quarter - 1) * 3 };
  }
  const year = Math.floor(n / 12);
  const month = n - year * 12;
  return { year, quarter: Math.floor(month / 3) + 1, month };
}

/** The period `delta` steps after (or, negative, before) `value`. */
export function shiftPeriod(type: PeriodType, value: string | undefined, delta: number, now: PeriodNow): string {
  return formatPeriodValue(type, fromOrdinal(type, ordinal(type, parsePeriod(type, value, now)) + delta));
}

/** The period of `type` that `now` falls in. */
export function currentPeriodValue(type: PeriodType, now: PeriodNow): string {
  return formatPeriodValue(type, parsePeriod(type, undefined, now));
}

/** Negative, zero or positive as `a` is before, the same as, or after `b`. */
export function comparePeriods(type: PeriodType, a: string | undefined, b: string | undefined, now: PeriodNow): number {
  return ordinal(type, parsePeriod(type, a, now)) - ordinal(type, parsePeriod(type, b, now));
}

/** What a period is compared against, for the overview cards. */
export function previousPeriodPhrase(type: PeriodType): string {
  if (type === "year") return "จากปีก่อน";
  if (type === "quarter") return "จากไตรมาสก่อน";
  return "จากเดือนก่อน";
}

/** "this month" etc., for the jump-to-now button and the chart's marker. */
export function currentPeriodName(type: PeriodType): string {
  if (type === "year") return "ปีนี้";
  if (type === "quarter") return "ไตรมาสนี้";
  return "เดือนนี้";
}

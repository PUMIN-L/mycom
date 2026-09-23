/**
 * Date -> "YYYY-MM-DD" using the LOCAL calendar day, not toISOString() (which
 * converts to UTC first). react-datepicker hands back "midnight local time"
 * for a freshly-picked date; toISOString() on that shifts it to the previous
 * day for any timezone ahead of UTC (e.g. Asia/Bangkok, UTC+7) between
 * midnight and the offset boundary. Client-side "today" markers have the same
 * failure mode. Use this wherever a Date needs to become a calendar-day
 * string on the client.
 */
export function toLocalDateString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

const DISPLAY_MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/**
 * "2026-06-12" -> "12 Jun 2026", for dates the user READS (appointments,
 * warranty dates). Stored values stay "YYYY-MM-DD" — that shape is what the
 * VARCHAR date columns sort lexically on, so this is display-only.
 *
 * Anything unparseable is returned unchanged rather than becoming
 * "Invalid Date": a stray value should look odd, not erase the row's date.
 */
export function formatDisplayDate(value?: string | null): string {
  if (!value) return "";
  const raw = String(value).trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (!m) return raw;
  const monthIndex = Number(m[2]) - 1;
  if (monthIndex < 0 || monthIndex > 11) return raw;
  return `${Number(m[3])} ${DISPLAY_MONTHS[monthIndex]} ${m[1]}`;
}

/**
 * True for a syntactically valid "YYYY-MM-DD" calendar date. Several date
 * columns (warranty/schedule dates) are plain VARCHAR compared and sorted
 * LEXICALLY in SQL — that only sorts chronologically if every stored value is
 * actually in this shape, so any input crossing into one of those columns
 * must be checked with this before being trusted.
 */
export function isValidDateString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return !isNaN(new Date(value + "T00:00:00").getTime());
}

// Bangkok is UTC+7 year-round (no DST), so a fixed offset is exact. Use these
// wherever a client-side feature (e.g. "snooze until 6 AM") must land on the
// same wall-clock Bangkok time regardless of what timezone the ADMIN'S OWN
// device happens to be set to — `d.setHours(6, 0, 0, 0)` uses the browser's
// local timezone, which silently produces the wrong instant (sometimes even
// the wrong calendar day) for anyone not physically in UTC+7.
const BANGKOK_OFFSET_HOURS = 7;

/** The Y/M/D that `date` falls on in Bangkok, independent of local timezone. */
export function bangkokParts(date: Date): { year: number; month: number; day: number } {
  const shifted = new Date(date.getTime() + BANGKOK_OFFSET_HOURS * 60 * 60 * 1000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(), // 0-indexed
    day: shifted.getUTCDate(),
  };
}

/**
 * `date` as a "YYYY-MM-DD" Bangkok calendar-day string — for server code
 * (Vercel's clock is UTC) comparing against VARCHAR date columns that are
 * stored/compared as plain Bangkok-local date strings (warranty/schedule
 * dates, dashboard "today" cutoffs). Using `date.toISOString()` or local
 * getters directly here would pick the wrong Bangkok day for up to 7 hours
 * around UTC midnight.
 */
export function bangkokDateString(date: Date): string {
  const { year, month, day } = bangkokParts(date);
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * UTC instant for `hour`:00 Bangkok time on the given "YYYY-MM-DD" calendar
 * date (e.g. from an `<input type="date">`) — independent of the caller's own
 * local timezone.
 */
export function bangkokDateAtHour(dateStr: string, hour: number): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, hour - BANGKOK_OFFSET_HOURS, 0, 0, 0));
}

/**
 * UTC instant for `hour`:00 Bangkok time, `daysFromNow` days after the
 * current Bangkok calendar date.
 */
export function bangkokDateAtHourFromNow(daysFromNow: number, hour: number): Date {
  const { year, month, day } = bangkokParts(new Date());
  return new Date(Date.UTC(year, month, day + daysFromNow, hour - BANGKOK_OFFSET_HOURS, 0, 0, 0));
}

/** The current calendar month ("YYYY-MM") in Bangkok — used server-side to
 * default "which month" for monthly-recurring generation without the
 * server's UTC clock potentially naming the wrong month in the last few
 * hours of the last day of a Bangkok month. */
export function bangkokCurrentMonth(): string {
  const { year, month } = bangkokParts(new Date());
  return `${year}-${String(month + 1).padStart(2, "0")}`;
}

/**
 * `dateStr` ("YYYY-MM-DD") shifted forward by `days` days — for credit terms
 * ("ครบกำหนด = วันที่เอกสาร + เครดิต N วัน"). UTC internally so the result never
 * shifts by a day from the caller's own timezone, and the output keeps the
 * "YYYY-MM-DD" shape those VARCHAR date columns are compared lexically on.
 *
 * An unparseable input is returned unchanged rather than becoming "NaN-NaN-NaN":
 * a stray value must look odd, not silently poison a range query.
 */
export function addDaysToDateString(dateStr: string, days: number): string {
  if (!isValidDateString(String(dateStr ?? "").trim())) return dateStr;
  const [y, m, d] = dateStr.split("-").map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d + Math.trunc(days)));
  const yyyy = shifted.getUTCFullYear();
  const mm = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(shifted.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Whole calendar days from `from` to `to`, both "YYYY-MM-DD" — positive when
 * `to` is later. Used for "เกินกำหนด N วัน" and for the ageing buckets, where
 * both ends are already Bangkok calendar dates, so plain UTC midnights give the
 * exact day difference with no DST or offset to reason about.
 *
 * Returns null when either side is not a valid date string, so a caller can
 * render "-" instead of a number computed from garbage.
 */
export function daysBetweenDateStrings(
  from: string | null | undefined,
  to: string | null | undefined
): number | null {
  const a = String(from ?? "").trim();
  const b = String(to ?? "").trim();
  if (!isValidDateString(a) || !isValidDateString(b)) return null;
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  const diff = Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad);
  return Math.round(diff / 86400000);
}

/**
 * `dateStr` ("YYYY-MM-DD") shifted forward by `months` calendar months — for
 * "N months after X" reminders (e.g. calibration due 10 months after the last
 * calibration date). Uses UTC internally so the result never shifts by a day
 * from the caller's own timezone.
 *
 * A day that does not exist in the target month is CLAMPED to that month's
 * last day (Jan 31 + 1 month = Feb 28), which is what MySQL's
 * DATE_ADD(..., INTERVAL n MONTH) does. The two must agree: the alert queries
 * filter with DATE_ADD server-side while callers display this.
 *
 * Plain `Date.UTC(y, m + months, d)` does NOT do this — it rolls the overflow
 * into the following month (Jan 31 + 1 = Mar 3), which is three days past what
 * the SQL side computes for the same input. crmStore.ts's calibration query
 * already documents the clamping behaviour it has to invert ("31 Jan + 10
 * months = 30 Nov"); this function is the display side of that same rule.
 */
export function addMonthsToDateString(dateStr: string, months: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  // Day 0 of the month AFTER the target month is the target month's last day.
  const lastDayOfTarget = new Date(Date.UTC(y, m - 1 + months + 1, 0)).getUTCDate();
  const shifted = new Date(Date.UTC(y, m - 1 + months, Math.min(d, lastDayOfTarget)));
  const yyyy = shifted.getUTCFullYear();
  const mm = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(shifted.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

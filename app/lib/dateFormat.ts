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

// Bangkok is UTC+7 year-round (no DST), so a fixed offset is exact. Use these
// wherever a client-side feature (e.g. "snooze until 6 AM") must land on the
// same wall-clock Bangkok time regardless of what timezone the ADMIN'S OWN
// device happens to be set to — `d.setHours(6, 0, 0, 0)` uses the browser's
// local timezone, which silently produces the wrong instant (sometimes even
// the wrong calendar day) for anyone not physically in UTC+7.
const BANGKOK_OFFSET_HOURS = 7;

/** The Y/M/D that `date` falls on in Bangkok, independent of local timezone. */
function bangkokParts(date: Date): { year: number; month: number; day: number } {
  const shifted = new Date(date.getTime() + BANGKOK_OFFSET_HOURS * 60 * 60 * 1000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(), // 0-indexed
    day: shifted.getUTCDate(),
  };
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

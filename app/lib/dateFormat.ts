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

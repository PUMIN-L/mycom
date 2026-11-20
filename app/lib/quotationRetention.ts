// How long a saved quotation is kept before the nightly cleanup purges it.
// One constant for both the purge (app/api/quotations/cleanup) and what the
// quotation page TELLS the admin: the page said "เก็บไว้ 30 วัน" for months
// after the window became two years, so an admin could delete a quotation he
// meant to keep, believing it would vanish anyway.

/** Days a saved quotation (and a purchase order) is kept. */
export const QUOTATION_RETENTION_DAYS = 730;

/** The window in words, as the page says it: whole years when it is whole
 *  years ("2 ปี"), otherwise days ("45 วัน"). */
export function retentionLabel(days: number = QUOTATION_RETENTION_DAYS): string {
  if (days >= 365 && days % 365 === 0) return `${days / 365} ปี`;
  return `${days} วัน`;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Whole days until the nightly cleanup purges a quotation last saved at
 * `createdAt` (it deletes those saved more than `days` ago — every save
 * restarts the clock), or null when the date cannot be read. The old saved
 * list counted down from 30 days, the window before it became two years, and
 * showed nearly every quotation in red.
 */
export function daysUntilPurge(
  createdAt: string | null | undefined,
  now: number = Date.now(),
  days: number = QUOTATION_RETENTION_DAYS
): number | null {
  if (!createdAt) return null;
  const saved = new Date(createdAt).getTime();
  if (!Number.isFinite(saved)) return null;
  return Math.max(0, Math.ceil(days - (now - saved) / DAY_MS));
}

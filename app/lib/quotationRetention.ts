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

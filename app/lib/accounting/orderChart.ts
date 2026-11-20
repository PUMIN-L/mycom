// The dashboard's "ยอดตาม PO ลูกค้า": customer POs counted the day they were
// received — by their own PO date, not when delivered or paid (the owner,
// 2026-11-20). This puts the per-day sums the route answers into the chart's
// buckets: by month for a year or a quarter, by day for a month. Pure and
// client-safe (no database).
import { MONTHS_TH, type PeriodType } from "../dashboardPeriod";
import { addDaysToDateString, isValidDateString } from "../dateFormat";

/** The longest range the chart's route answers, in days — a year and a bit. */
export const ORDER_CHART_MAX_DAYS = 400;

/** A day's open customer POs (`ordersByIssueDate`), ex VAT. */
export interface OrderDay {
  date: string;
  count: number;
  exVatSatang: number;
}

export interface OrderBucket {
  /** "YYYY-MM" by month, "YYYY-MM-DD" by day. */
  key: string;
  /** "พ.ย." by month, "14" by day. */
  name: string;
  count: number;
  exVatSatang: number;
}

export type OrderChartGrain = "month" | "day";

/** A month by day; a quarter or a year by month. */
export function orderChartGrain(periodType: PeriodType): OrderChartGrain {
  return periodType === "month" ? "day" : "month";
}

/**
 * Every bucket of [range.start, range.end) — empty ones at zero, so the chart
 * shows the whole period — with each day's POs added to its own. A day outside
 * the range finds no bucket and is left out. A range that is not two dates in
 * order has no buckets, and none ever runs past ORDER_CHART_MAX_DAYS days (or
 * 24 months).
 */
export function bucketOrders(days: readonly OrderDay[], range: { start: string; end: string }, grain: OrderChartGrain): OrderBucket[] {
  if (!isValidDateString(range.start) || !isValidDateString(range.end) || range.start >= range.end) return [];
  const buckets: OrderBucket[] = [];
  const byKey = new Map<string, OrderBucket>();
  const add = (bucket: OrderBucket) => {
    buckets.push(bucket);
    byKey.set(bucket.key, bucket);
  };

  if (grain === "day") {
    for (let day = range.start, n = 0; day < range.end && n < ORDER_CHART_MAX_DAYS; day = addDaysToDateString(day, 1), n++) {
      add({ key: day, name: String(Number(day.slice(8, 10))), count: 0, exVatSatang: 0 });
    }
  } else {
    let year = Number(range.start.slice(0, 4));
    let month = Number(range.start.slice(5, 7)) - 1;
    for (let n = 0; n < 24; n++) {
      const key = `${year}-${String(month + 1).padStart(2, "0")}`;
      if (`${key}-01` >= range.end) break;
      add({ key, name: MONTHS_TH[month], count: 0, exVatSatang: 0 });
      month += 1;
      if (month === 12) {
        month = 0;
        year += 1;
      }
    }
  }

  for (const day of days) {
    const bucket = byKey.get(grain === "day" ? day.date : day.date.slice(0, 7));
    if (!bucket) continue;
    bucket.count += day.count;
    bucket.exVatSatang += day.exVatSatang;
  }
  return buckets;
}

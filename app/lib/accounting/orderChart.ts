// The dashboard's "ยอดตาม PO ลูกค้า": customer POs counted the day they were
// received — by their own PO date, not when delivered or paid (the owner,
// 2026-11-20). This puts the per-day sums the route answers into the chart's
// bars, divided by day, week, month, quarter or year ("ทำให้ปรับดูรายปี
// รายไตรมาส รายอาทิตย์ได้ด้วย"). Pure and client-safe (no database).
import { MONTHS_TH, type PeriodType } from "../dashboardPeriod";
import { addDaysToDateString, isValidDateString } from "../dateFormat";

/** The yearly view's years: the five up to the period's. */
export const ORDER_CHART_YEARS = 5;

/** The longest range the chart's route answers, in days — the yearly view's
 *  five years, and no more. */
export const ORDER_CHART_MAX_DAYS = ORDER_CHART_YEARS * 366;

/** However a range is divided, never more bars than this. */
const MAX_BUCKETS = 400;

/** A day's open customer POs (`ordersByIssueDate`), ex VAT. */
export interface OrderDay {
  date: string;
  count: number;
  exVatSatang: number;
}

export interface OrderBucket {
  /** "YYYY-MM-DD" by day or week (the week's first day), "YYYY-MM" by month,
   *  "YYYY-Qn" by quarter, "YYYY" by year. */
  key: string;
  /** Under the bar: "14", "16 พ.ย.", "พ.ย.", "ไตรมาส 4", "2569". */
  name: string;
  /** In full, for the tooltip: "16–22 พ.ย. 2569", "ไตรมาส 4/2569", "ปี 2569". */
  title: string;
  count: number;
  exVatSatang: number;
}

export type OrderChartGrain = "day" | "week" | "month" | "quarter" | "year";

/** The buttons, after "แบ่งตาม": never the period picker's words (รายเดือน /
 *  รายไตรมาส / รายปี) nor the sales chart's (แยกตามเดือน / แยกตามไตรมาส) — a
 *  button of one must never read as a button of another. */
export const ORDER_CHART_GRAIN_LABEL: Record<OrderChartGrain, string> = {
  day: "วัน",
  week: "สัปดาห์",
  month: "เดือน",
  quarter: "ไตรมาส",
  year: "ปี",
};

/** The page's own way for its period: a month by day; a quarter or a year by month. */
export function orderChartGrain(periodType: PeriodType): OrderChartGrain {
  return periodType === "month" ? "day" : "month";
}

/**
 * The ways worth offering for the page's period — never one that would draw
 * a single bar (a month by month, a quarter by quarter). By year is always
 * there: it draws the five years up to the period's (`orderChartRange`).
 */
export function orderChartGrains(periodType: PeriodType): OrderChartGrain[] {
  if (periodType === "month") return ["day", "week", "year"];
  if (periodType === "quarter") return ["week", "month", "year"];
  return ["week", "month", "quarter", "year"];
}

/** What a grain is drawn over: the page's period — or, by year, the five years up to its year. */
export function orderChartRange(range: { start: string; end: string }, grain: OrderChartGrain): { start: string; end: string } {
  if (grain !== "year") return range;
  const year = Number(range.start.slice(0, 4));
  return { start: `${year - ORDER_CHART_YEARS + 1}-01-01`, end: `${year + 1}-01-01` };
}

const be = (date: string) => Number(date.slice(0, 4)) + 543;
const dayOf = (date: string) => Number(date.slice(8, 10));
const monthOf = (date: string) => MONTHS_TH[Number(date.slice(5, 7)) - 1];
/** Monday 0 … Sunday 6. */
const weekday = (date: string) => (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;

/** "16–22 พ.ย. 2569", "30 มี.ค. – 5 เม.ย. 2569", or one day: "1 ก.พ. 2569". */
function spanTitle(first: string, last: string): string {
  if (first === last) return `${dayOf(first)} ${monthOf(first)} ${be(first)}`;
  if (first.slice(0, 7) === last.slice(0, 7)) return `${dayOf(first)}–${dayOf(last)} ${monthOf(first)} ${be(first)}`;
  if (first.slice(0, 4) === last.slice(0, 4)) return `${dayOf(first)} ${monthOf(first)} – ${dayOf(last)} ${monthOf(last)} ${be(first)}`;
  return `${dayOf(first)} ${monthOf(first)} ${be(first)} – ${dayOf(last)} ${monthOf(last)} ${be(last)}`;
}

/**
 * Every bar of [range.start, range.end) — empty ones at zero, so the chart
 * shows the whole range — with each day's POs added to its own. Weeks run
 * Monday to Sunday; the first is cut at the range's start, the last at its
 * end. A day outside the range finds no bar and is left out. A range that is
 * not two dates in order has none, and none ever has more than 400 bars.
 */
export function bucketOrders(days: readonly OrderDay[], range: { start: string; end: string }, grain: OrderChartGrain): OrderBucket[] {
  const { start, end } = range;
  if (!isValidDateString(start) || !isValidDateString(end) || start >= end) return [];
  const buckets: OrderBucket[] = [];
  const byKey = new Map<string, OrderBucket>();
  const add = (key: string, name: string, title: string) => {
    const bucket = { key, name, title, count: 0, exVatSatang: 0 };
    buckets.push(bucket);
    byKey.set(key, bucket);
  };

  if (grain === "day") {
    for (let day = start; day < end && buckets.length < MAX_BUCKETS; day = addDaysToDateString(day, 1)) {
      add(day, String(dayOf(day)), spanTitle(day, day));
    }
  } else if (grain === "week") {
    for (let first = start; first < end && buckets.length < MAX_BUCKETS; ) {
      const next = addDaysToDateString(first, 7 - weekday(first));
      const last = addDaysToDateString(next < end ? next : end, -1);
      add(first, `${dayOf(first)} ${monthOf(first)}`, spanTitle(first, last));
      first = next;
    }
  } else if (grain === "month") {
    let year = Number(start.slice(0, 4));
    let month = Number(start.slice(5, 7)) - 1;
    while (buckets.length < MAX_BUCKETS) {
      const key = `${year}-${String(month + 1).padStart(2, "0")}`;
      if (`${key}-01` >= end) break;
      add(key, MONTHS_TH[month], `${MONTHS_TH[month]} ${year + 543}`);
      month += 1;
      if (month === 12) {
        month = 0;
        year += 1;
      }
    }
  } else if (grain === "quarter") {
    let year = Number(start.slice(0, 4));
    let quarter = Math.floor((Number(start.slice(5, 7)) - 1) / 3) + 1;
    const spansYears = start.slice(0, 4) !== addDaysToDateString(end, -1).slice(0, 4);
    while (buckets.length < MAX_BUCKETS) {
      if (`${year}-${String((quarter - 1) * 3 + 1).padStart(2, "0")}-01` >= end) break;
      add(`${year}-Q${quarter}`, spansYears ? `ไตรมาส ${quarter}/${String(year + 543).slice(2)}` : `ไตรมาส ${quarter}`, `ไตรมาส ${quarter}/${year + 543}`);
      quarter += 1;
      if (quarter === 5) {
        quarter = 1;
        year += 1;
      }
    }
  } else {
    for (let year = Number(start.slice(0, 4)); `${year}-01-01` < end && buckets.length < MAX_BUCKETS; year++) {
      add(String(year), String(year + 543), `ปี ${year + 543}`);
    }
  }

  /** The key of the bar a day belongs to. */
  const keyOf = (date: string): string => {
    if (grain === "day") return date;
    if (grain === "week") {
      const monday = addDaysToDateString(date, -weekday(date));
      return monday < start ? start : monday;
    }
    if (grain === "month") return date.slice(0, 7);
    if (grain === "quarter") return `${date.slice(0, 4)}-Q${Math.floor((Number(date.slice(5, 7)) - 1) / 3) + 1}`;
    return date.slice(0, 4);
  };

  for (const day of days) {
    if (day.date < start || day.date >= end) continue;
    const bucket = byKey.get(keyOf(day.date));
    if (!bucket) continue;
    bucket.count += day.count;
    bucket.exVatSatang += day.exVatSatang;
  }
  return buckets;
}

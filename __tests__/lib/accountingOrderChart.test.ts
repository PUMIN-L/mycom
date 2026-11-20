// @vitest-environment node
//
// The dashboard's "ยอดตาม PO ลูกค้า" chart: customer POs counted the day they
// were received (their own PO date), not when delivered or paid. Its bars can
// be divided by day, week, month, quarter or year (the owner, 2026-11-20:
// "ทำให้ปรับดูรายปี รายไตรมาส รายอาทิตย์ได้ด้วย").
import { describe, it, expect } from "vitest";
import {
  bucketOrders,
  orderChartGrain,
  orderChartGrains,
  orderChartRange,
  ORDER_CHART_GRAIN_LABEL,
  ORDER_CHART_MAX_DAYS,
  ORDER_CHART_YEARS,
} from "@/app/lib/accounting/orderChart";

const YEAR = { start: "2026-01-01", end: "2027-01-01" };

describe("which ways to divide the bars", () => {
  it("by default: a month by day; a quarter and a year by month", () => {
    expect(orderChartGrain("month")).toBe("day");
    expect(orderChartGrain("quarter")).toBe("month");
    expect(orderChartGrain("year")).toBe("month");
  });

  it("offers only what makes more than one bar — and by year always, over five years", () => {
    expect(orderChartGrains("month")).toEqual(["day", "week", "year"]);
    expect(orderChartGrains("quarter")).toEqual(["week", "month", "year"]);
    expect(orderChartGrains("year")).toEqual(["week", "month", "quarter", "year"]);
    for (const type of ["month", "quarter", "year"] as const) expect(orderChartGrains(type)).toContain(orderChartGrain(type));
  });

  it("names them after \"แบ่งตาม\" — never like the period picker (รายเดือน …) or the sales chart (แยกตามเดือน …)", () => {
    expect(ORDER_CHART_GRAIN_LABEL).toEqual({ day: "วัน", week: "สัปดาห์", month: "เดือน", quarter: "ไตรมาส", year: "ปี" });
    for (const label of Object.values(ORDER_CHART_GRAIN_LABEL)) {
      expect(label).not.toMatch(/^(ราย|แยกตาม)/);
    }
  });
});

describe("orderChartRange", () => {
  it("draws within the page's period — except by year, the five years up to it", () => {
    expect(orderChartRange(YEAR, "month")).toEqual(YEAR);
    expect(orderChartRange(YEAR, "week")).toEqual(YEAR);
    expect(orderChartRange(YEAR, "quarter")).toEqual(YEAR);
    expect(ORDER_CHART_YEARS).toBe(5);
    expect(orderChartRange(YEAR, "year")).toEqual({ start: "2022-01-01", end: "2027-01-01" });
    // A quarter or a month on the page: the five years up to ITS year.
    expect(orderChartRange({ start: "2026-10-01", end: "2027-01-01" }, "year")).toEqual({ start: "2022-01-01", end: "2027-01-01" });
  });

  it("the route answers every range the chart asks for, and no more", () => {
    const fiveYears = orderChartRange(YEAR, "year");
    const days = (Date.parse(fiveYears.end) - Date.parse(fiveYears.start)) / 86400000;
    expect(days).toBeLessThanOrEqual(ORDER_CHART_MAX_DAYS);
    expect(ORDER_CHART_MAX_DAYS).toBeLessThan(6 * 365);
  });
});

describe("bucketOrders — by month", () => {
  it("a year is twelve months, named the Thai way, empty ones at zero", () => {
    const buckets = bucketOrders([], YEAR, "month");
    expect(buckets.map((b) => b.name)).toEqual(["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."]);
    expect(buckets.map((b) => b.key)[10]).toBe("2026-11");
    expect(buckets.every((b) => b.count === 0 && b.exVatSatang === 0)).toBe(true);
  });

  it("adds up each month's POs by their PO date", () => {
    const buckets = bucketOrders(
      [
        { date: "2026-11-03", count: 1, exVatSatang: 10000000 },
        { date: "2026-11-20", count: 2, exVatSatang: 5050000 },
        { date: "2026-12-01", count: 1, exVatSatang: 100 },
      ],
      YEAR,
      "month"
    );
    expect(buckets[10]).toEqual({ key: "2026-11", name: "พ.ย.", title: "พ.ย. 2569", count: 3, exVatSatang: 15050000 });
    expect(buckets[11]).toMatchObject({ key: "2026-12", count: 1, exVatSatang: 100 });
  });

  it("a quarter is its three months", () => {
    const buckets = bucketOrders([{ date: "2026-08-15", count: 1, exVatSatang: 700 }], { start: "2026-07-01", end: "2026-10-01" }, "month");
    expect(buckets.map((b) => b.key)).toEqual(["2026-07", "2026-08", "2026-09"]);
    expect(buckets[1].exVatSatang).toBe(700);
  });

  it("ignores a day outside the range rather than inventing a bucket for it", () => {
    const buckets = bucketOrders([{ date: "2025-12-31", count: 1, exVatSatang: 999 }], YEAR, "month");
    expect(buckets).toHaveLength(12);
    expect(buckets.reduce((s, b) => s + b.exVatSatang, 0)).toBe(0);
  });
});

describe("bucketOrders — by day", () => {
  it("a month is each of its days, named by its number", () => {
    const buckets = bucketOrders(
      [
        { date: "2026-02-01", count: 1, exVatSatang: 100 },
        { date: "2026-02-28", count: 2, exVatSatang: 300 },
      ],
      { start: "2026-02-01", end: "2026-03-01" },
      "day"
    );
    expect(buckets).toHaveLength(28);
    expect(buckets[0]).toEqual({ key: "2026-02-01", name: "1", title: "1 ก.พ. 2569", count: 1, exVatSatang: 100 });
    expect(buckets[27]).toEqual({ key: "2026-02-28", name: "28", title: "28 ก.พ. 2569", count: 2, exVatSatang: 300 });
  });

  it("never runs away on a range it should not have been given", () => {
    expect(bucketOrders([], { start: "2026-02-01", end: "2026-01-01" }, "day")).toEqual([]);
    expect(bucketOrders([], { start: "nonsense", end: "2026-01-01" }, "month")).toEqual([]);
    expect(bucketOrders([], { start: "2020-01-01", end: "2030-01-01" }, "day").length).toBeLessThanOrEqual(400);
  });
});

describe("bucketOrders — by week (Monday to Sunday)", () => {
  const DAYS = [
    { date: "2026-11-03", count: 1, exVatSatang: 10000000 }, // a Tuesday
    { date: "2026-11-20", count: 2, exVatSatang: 5050000 }, // a Friday
    { date: "2026-11-22", count: 1, exVatSatang: 50 }, // that week's Sunday
    { date: "2026-11-23", count: 1, exVatSatang: 7 }, // the next Monday
  ];

  it("a year starts with the part-week up to its first Monday, then one bar a week", () => {
    const buckets = bucketOrders([], YEAR, "week");
    // 1 Jan 2026 is a Thursday; the Mondays run 5 Jan … 28 Dec (52 of them).
    expect(buckets).toHaveLength(53);
    expect(buckets[0]).toMatchObject({ key: "2026-01-01", name: "1 ม.ค.", title: "1–4 ม.ค. 2569" });
    expect(buckets[1]).toMatchObject({ key: "2026-01-05", name: "5 ม.ค.", title: "5–11 ม.ค. 2569" });
    // The last week is cut at the year's end.
    expect(buckets[52]).toMatchObject({ key: "2026-12-28", title: "28–31 ธ.ค. 2569" });
  });

  it("a week that runs into the next month says both", () => {
    const buckets = bucketOrders([], YEAR, "week");
    expect(buckets.find((b) => b.key === "2026-03-30")!.title).toBe("30 มี.ค. – 5 เม.ย. 2569");
  });

  it("puts each PO in the week of its PO date — Monday to Sunday", () => {
    const buckets = bucketOrders(DAYS, YEAR, "week");
    const at = (key: string) => buckets.find((b) => b.key === key)!;
    expect(at("2026-11-02")).toMatchObject({ count: 1, exVatSatang: 10000000 });
    expect(at("2026-11-16")).toMatchObject({ count: 3, exVatSatang: 5050050 });
    expect(at("2026-11-23")).toMatchObject({ count: 1, exVatSatang: 7 });
  });

  it("a month is its weeks, the first one cut at the month's start", () => {
    // 1 Feb 2026 is a Sunday: a one-day first bar, then Mondays 2, 9, 16, 23.
    const buckets = bucketOrders([{ date: "2026-02-01", count: 1, exVatSatang: 9 }], { start: "2026-02-01", end: "2026-03-01" }, "week");
    expect(buckets.map((b) => b.key)).toEqual(["2026-02-01", "2026-02-02", "2026-02-09", "2026-02-16", "2026-02-23"]);
    expect(buckets[0]).toMatchObject({ title: "1 ก.พ. 2569", count: 1, exVatSatang: 9 });
    expect(buckets[4].title).toBe("23–28 ก.พ. 2569");
  });
});

describe("bucketOrders — by quarter", () => {
  it("a year is its four quarters", () => {
    const buckets = bucketOrders(
      [
        { date: "2026-11-03", count: 1, exVatSatang: 10000000 },
        { date: "2026-03-31", count: 1, exVatSatang: 5 },
      ],
      YEAR,
      "quarter"
    );
    expect(buckets.map((b) => b.name)).toEqual(["ไตรมาส 1", "ไตรมาส 2", "ไตรมาส 3", "ไตรมาส 4"]);
    expect(buckets[0]).toEqual({ key: "2026-Q1", name: "ไตรมาส 1", title: "ไตรมาส 1/2569", count: 1, exVatSatang: 5 });
    expect(buckets[3]).toMatchObject({ key: "2026-Q4", count: 1, exVatSatang: 10000000 });
  });
});

describe("bucketOrders — by year", () => {
  it("five years, named in the Buddhist era, each PO in the year of its PO date", () => {
    const buckets = bucketOrders(
      [
        { date: "2026-11-03", count: 2, exVatSatang: 300 },
        { date: "2023-06-01", count: 1, exVatSatang: 40 },
        { date: "2021-12-31", count: 9, exVatSatang: 999 }, // before the five years
      ],
      orderChartRange(YEAR, "year"),
      "year"
    );
    expect(buckets.map((b) => b.name)).toEqual(["2565", "2566", "2567", "2568", "2569"]);
    expect(buckets[4]).toEqual({ key: "2026", name: "2569", title: "ปี 2569", count: 2, exVatSatang: 300 });
    expect(buckets[1]).toMatchObject({ key: "2023", count: 1, exVatSatang: 40 });
    expect(buckets.reduce((s, b) => s + b.count, 0)).toBe(3);
  });
});

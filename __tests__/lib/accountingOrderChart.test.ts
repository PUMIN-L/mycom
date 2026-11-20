// @vitest-environment node
//
// The dashboard's "ยอดตาม PO ลูกค้า" chart: customer POs counted the day they
// were received (their own PO date), not when delivered or paid — bucketed by
// month for a year or a quarter, by day for a month.
import { describe, it, expect } from "vitest";
import { bucketOrders, orderChartGrain, ORDER_CHART_MAX_DAYS } from "@/app/lib/accounting/orderChart";

describe("orderChartGrain", () => {
  it("a month by day; a quarter and a year by month", () => {
    expect(orderChartGrain("month")).toBe("day");
    expect(orderChartGrain("quarter")).toBe("month");
    expect(orderChartGrain("year")).toBe("month");
  });
});

describe("bucketOrders — by month", () => {
  const YEAR = { start: "2026-01-01", end: "2027-01-01" };

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
    expect(buckets[10]).toEqual({ key: "2026-11", name: "พ.ย.", count: 3, exVatSatang: 15050000 });
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
    expect(buckets[0]).toEqual({ key: "2026-02-01", name: "1", count: 1, exVatSatang: 100 });
    expect(buckets[27]).toEqual({ key: "2026-02-28", name: "28", count: 2, exVatSatang: 300 });
  });

  it("never runs away on a range it should not have been given", () => {
    expect(bucketOrders([], { start: "2026-02-01", end: "2026-01-01" }, "day")).toEqual([]);
    expect(bucketOrders([], { start: "nonsense", end: "2026-01-01" }, "month")).toEqual([]);
    expect(bucketOrders([], { start: "2020-01-01", end: "2030-01-01" }, "day").length).toBeLessThanOrEqual(ORDER_CHART_MAX_DAYS);
  });
});

// @vitest-environment node
/**
 * The dashboard's period — read, named in พ.ศ., stepped and compared one way
 * for the server and the page.
 */
import { describe, it, expect } from "vitest";
import {
  buddhistYear,
  comparePeriods,
  currentPeriodName,
  currentPeriodValue,
  parsePeriod,
  periodLabel,
  previousPeriodPhrase,
  shiftPeriod,
} from "@/app/lib/dashboardPeriod";

/** 19 Oct 2026 (Bangkok): month index 9, Q4. */
const NOW = { year: 2026, month: 9 };

describe("periodLabel — names in พ.ศ., like every other date in the system", () => {
  it("names a year, a quarter and a month", () => {
    expect(periodLabel("year", "2026", NOW)).toBe("ปี 2569");
    expect(periodLabel("quarter", "2026-Q4", NOW)).toBe("ไตรมาส 4 ปี 2569");
    expect(periodLabel("month", "2026-10", NOW)).toBe("เดือน ต.ค. 2569");
    expect(periodLabel("month", "2025-01", NOW)).toBe("เดือน ม.ค. 2568");
  });

  it("names the current period when no value is given", () => {
    expect(periodLabel("year", undefined, NOW)).toBe("ปี 2569");
    expect(periodLabel("quarter", undefined, NOW)).toBe("ไตรมาส 4 ปี 2569");
    expect(periodLabel("month", undefined, NOW)).toBe("เดือน ต.ค. 2569");
  });

  it("buddhistYear adds 543", () => {
    expect(buddhistYear(2026)).toBe(2569);
  });
});

describe("parsePeriod — a malformed part falls back to now's, never to a NaN date", () => {
  it("reads well-formed values", () => {
    expect(parsePeriod("quarter", "2025-Q2", NOW)).toEqual({ year: 2025, quarter: 2, month: 3 });
    expect(parsePeriod("month", "2025-12", NOW)).toEqual({ year: 2025, quarter: 4, month: 11 });
  });

  it("falls back part by part", () => {
    expect(parsePeriod("quarter", "2025-Q9", NOW)).toEqual({ year: 2025, quarter: 4, month: 9 });
    expect(parsePeriod("month", "2025-13", NOW)).toMatchObject({ year: 2025, month: 9 });
    expect(parsePeriod("month", "abc", NOW)).toMatchObject({ year: 2026, month: 9 });
    expect(parsePeriod("year", "20x6", NOW)).toMatchObject({ year: 2026 });
    expect(parsePeriod("month", "2025-1x", NOW)).toMatchObject({ year: 2025, month: 9 });
  });
});

describe("shiftPeriod — one step at a time, across year boundaries", () => {
  it("steps months", () => {
    expect(shiftPeriod("month", "2026-10", -1, NOW)).toBe("2026-09");
    expect(shiftPeriod("month", "2026-01", -1, NOW)).toBe("2025-12");
    expect(shiftPeriod("month", "2025-12", 1, NOW)).toBe("2026-01");
  });

  it("steps quarters", () => {
    expect(shiftPeriod("quarter", "2026-Q1", -1, NOW)).toBe("2025-Q4");
    expect(shiftPeriod("quarter", "2025-Q4", 1, NOW)).toBe("2026-Q1");
    expect(shiftPeriod("quarter", "2026-Q2", 2, NOW)).toBe("2026-Q4");
  });

  it("steps years", () => {
    expect(shiftPeriod("year", "2026", -1, NOW)).toBe("2025");
    expect(shiftPeriod("year", "2025", 1, NOW)).toBe("2026");
  });
});

describe("currentPeriodValue / comparePeriods", () => {
  it("gives the period now falls in", () => {
    expect(currentPeriodValue("year", NOW)).toBe("2026");
    expect(currentPeriodValue("quarter", NOW)).toBe("2026-Q4");
    expect(currentPeriodValue("month", NOW)).toBe("2026-10");
    expect(currentPeriodValue("month", { year: 2026, month: 0 })).toBe("2026-01");
  });

  it("orders periods of a type", () => {
    expect(comparePeriods("month", "2026-09", "2026-10", NOW)).toBeLessThan(0);
    expect(comparePeriods("month", "2026-10", "2026-10", NOW)).toBe(0);
    expect(comparePeriods("quarter", "2027-Q1", "2026-Q4", NOW)).toBeGreaterThan(0);
    expect(comparePeriods("year", "2022", "2026", NOW)).toBeLessThan(0);
  });
});

describe("phrases", () => {
  it("says what a change is measured against", () => {
    expect(previousPeriodPhrase("month")).toBe("จากเดือนก่อน");
    expect(previousPeriodPhrase("quarter")).toBe("จากไตรมาสก่อน");
    expect(previousPeriodPhrase("year")).toBe("จากปีก่อน");
  });

  it("names the current period for the jump-back button", () => {
    expect(currentPeriodName("month")).toBe("เดือนนี้");
    expect(currentPeriodName("quarter")).toBe("ไตรมาสนี้");
    expect(currentPeriodName("year")).toBe("ปีนี้");
  });
});

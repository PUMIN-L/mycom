// @vitest-environment node
/**
 * The overview cards' "↑12%" lines. Green is the direction the business wants
 * — for a cost that is DOWN; a loss shrinking is a rise; and a rate (margin,
 * conversion) moves in points, not in percent of itself.
 */
import { describe, it, expect } from "vitest";
import { pctChange, pointChange } from "@/app/dashboard/types";

const GREEN = "text-emerald-600";
const RED = "text-red-500";
const GREY = "text-gray-400";

describe("pctChange", () => {
  it("is green going up and red going down, for something the business wants more of", () => {
    expect(pctChange(150, 100)).toEqual({ value: 50, label: "↑50%", color: GREEN });
    expect(pctChange(50, 100)).toEqual({ value: -50, label: "↓50%", color: RED });
    expect(pctChange(100, 100)).toEqual({ value: 0, label: "→0%", color: GREY });
  });

  it("is red going UP for a cost, and green going down", () => {
    expect(pctChange(150, 100, { higherIsBetter: false })).toMatchObject({ label: "↑50%", color: RED });
    expect(pctChange(50, 100, { higherIsBetter: false })).toMatchObject({ label: "↓50%", color: GREEN });
  });

  it("reads a loss shrinking as a rise — measured against the size of the previous figure", () => {
    expect(pctChange(50, -100)).toEqual({ value: 150, label: "↑150%", color: GREEN });
    expect(pctChange(-200, -100)).toEqual({ value: -100, label: "↓100%", color: RED });
  });

  it("has nothing to compare with when the previous figure is zero", () => {
    expect(pctChange(100, 0)).toEqual({ value: 0, label: "—", color: GREY });
  });
});

describe("pointChange", () => {
  it("moves a rate in points: 10% → 12% is ↑2 จุด, not ↑20%", () => {
    expect(pointChange(12, 10)).toEqual({ value: 2, label: "↑2 จุด", color: GREEN });
    expect(pointChange(8, 10)).toEqual({ value: -2, label: "↓2 จุด", color: RED });
    expect(pointChange(10, 10)).toEqual({ value: 0, label: "→0 จุด", color: GREY });
  });

  it("has nothing to compare when either side has no rate", () => {
    expect(pointChange(12, null).label).toBe("—");
    expect(pointChange(null, 10).label).toBe("—");
  });
});

// @vitest-environment node
/**
 * The accounting module's money (lib/accounting/money.ts): whole satang,
 * parsed from text without floats, rounded half up at the satang once per
 * figure. The cases are worked by hand — and the six totals of the owner's
 * own sample list, which all come out of a VAT-exclusive price + 7%.
 */
import { describe, it, expect } from "vitest";
import {
  allocateProportionally,
  computeTotals,
  formatSatang,
  lineAmountSatang,
  lineGrossSatang,
  parseBahtToSatang,
  satangToBaht,
  withVatOverride,
} from "@/app/lib/accounting/money";

const line = (qty: number, baht: number, discountBaht = 0) => ({
  qty,
  unitPriceSatang: Math.round(baht * 100),
  discountSatang: Math.round(discountBaht * 100),
});
const exclusive = (lines: ReturnType<typeof line>[], discountBaht = 0) =>
  computeTotals({ lines, discountSatang: Math.round(discountBaht * 100), priceMode: "exclusive", vatRate: 7 });

describe("parseBahtToSatang / formatSatang", () => {
  it("reads typed amounts exactly — commas, a baht sign, up to two decimals", () => {
    expect(parseBahtToSatang("1,234.5")).toBe(123450);
    expect(parseBahtToSatang("฿ 58,000")).toBe(5800000);
    expect(parseBahtToSatang("0.1")).toBe(10);
    expect(parseBahtToSatang("0.29")).toBe(29); // 0.29 * 100 is 28.999… as a float
    expect(parseBahtToSatang(19000)).toBe(1900000);
  });

  it("refuses what is not an amount", () => {
    for (const bad of ["", "abc", "1.234", "-5", "1,2.3.4", null, undefined]) {
      expect(parseBahtToSatang(bad as never), String(bad)).toBeNull();
    }
  });

  it("prints with thousands and two decimals", () => {
    expect(formatSatang(6206000)).toBe("62,060.00");
    expect(formatSatang(5)).toBe("0.05");
    expect(formatSatang(-12345)).toBe("-123.45");
    expect(satangToBaht(2033000)).toBe(20330);
  });
});

describe("a line", () => {
  it("is qty × unit price less its discount, rounded half up at the satang", () => {
    expect(lineAmountSatang(line(2, 1000, 150))).toBe(185000);
    // 1.5 × 99.99 = 149.985 → 149.99
    expect(lineGrossSatang(line(1.5, 99.99))).toBe(14999);
    expect(lineGrossSatang(line(3, 33.33))).toBe(9999);
  });
});

describe("computeTotals — VAT added on top (exclusive)", () => {
  it("matches every total of the owner's sample list", () => {
    const sample: [number, string][] = [
      [19000, "20,330.00"],
      [20800, "22,256.00"],
      [3500, "3,745.00"],
      [8500, "9,095.00"],
      [290000, "310,300.00"],
      [58000, "62,060.00"],
    ];
    for (const [base, printed] of sample) {
      expect(formatSatang(exclusive([line(1, base)]).totalSatang), printed).toBe(printed);
    }
  });

  it("rounds the VAT once, half up: 99.99 → 7.00 (6.9993); 0.50 → 0.04 (3.5 satang)", () => {
    expect(exclusive([line(3, 33.33)])).toMatchObject({ vatBaseSatang: 9999, vatSatang: 700, totalSatang: 10699 });
    expect(exclusive([line(1, 0.5)]).vatSatang).toBe(4);
  });

  it("takes the bill discount off before VAT", () => {
    expect(exclusive([line(1, 10000)], 500)).toMatchObject({
      subtotalSatang: 1000000,
      discountSatang: 50000,
      vatBaseSatang: 950000,
      vatSatang: 66500,
      totalSatang: 1016500,
    });
  });
});

describe("computeTotals — prices that include VAT", () => {
  it("takes the VAT out of the amount, and the total stays the amount", () => {
    const t = computeTotals({ lines: [line(1, 107)], priceMode: "inclusive", vatRate: 7 });
    expect(t).toMatchObject({ vatBaseSatang: 10000, vatSatang: 700, totalSatang: 10700 });
    const k = computeTotals({ lines: [line(1, 1000)], priceMode: "inclusive", vatRate: 7 });
    expect(k).toMatchObject({ vatBaseSatang: 93458, vatSatang: 6542, totalSatang: 100000 });
  });
});

describe("allocateProportionally", () => {
  it("shares a total out in whole satang that add up exactly", () => {
    expect(allocateProportionally([100, 200, 300], 599)).toEqual([100, 200, 299]);
    const shares = allocateProportionally([333, 333, 334], 950000);
    expect(shares.reduce((s, x) => s + x, 0)).toBe(950000);
  });

  it("puts it all on the first line when the weights are all zero", () => {
    expect(allocateProportionally([0, 0], 500)).toEqual([500, 0]);
    expect(allocateProportionally([], 5)).toEqual([]);
  });
});

describe("withVatOverride — the VAT as printed on a paper issued elsewhere", () => {
  it("exclusive: the base stays, the total follows the VAT", () => {
    const t = exclusive([line(1, 19000)]);
    expect(withVatOverride(t, 133002, "exclusive")).toMatchObject({ vatBaseSatang: 1900000, vatSatang: 133002, totalSatang: 2033002 });
  });

  it("inclusive: what was charged stays, the base follows", () => {
    const t = computeTotals({ lines: [line(1, 1000)], priceMode: "inclusive", vatRate: 7 });
    expect(withVatOverride(t, 6540, "inclusive")).toMatchObject({ totalSatang: 100000, vatSatang: 6540, vatBaseSatang: 93460 });
  });

  it("is the system's own figures without one", () => {
    const t = exclusive([line(1, 100)]);
    expect(withVatOverride(t, null, "exclusive")).toBe(t);
  });
});

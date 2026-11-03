// @vitest-environment node
import { describe, it, expect } from "vitest";
import { bahtText } from "@/app/lib/bahtText";
import { QUOTATION_RETENTION_DAYS, retentionLabel } from "@/app/lib/quotationRetention";

describe("bahtText", () => {
  it.each([
    [0, "ศูนย์บาทถ้วน"],
    [1, "หนึ่งบาทถ้วน"],
    [10, "สิบบาทถ้วน"],
    [11, "สิบเอ็ดบาทถ้วน"],
    [20, "ยี่สิบบาทถ้วน"],
    [21, "ยี่สิบเอ็ดบาทถ้วน"],
    [101, "หนึ่งร้อยเอ็ดบาทถ้วน"],
    [111, "หนึ่งร้อยสิบเอ็ดบาทถ้วน"],
    [1001, "หนึ่งพันเอ็ดบาทถ้วน"],
    [1010, "หนึ่งพันสิบบาทถ้วน"],
    [100_000, "หนึ่งแสนบาทถ้วน"],
    [124_655, "หนึ่งแสนสองหมื่นสี่พันหกร้อยห้าสิบห้าบาทถ้วน"],
    [1_000_000, "หนึ่งล้านบาทถ้วน"],
    [1_000_001, "หนึ่งล้านหนึ่งบาทถ้วน"],
    [11_000_000, "สิบเอ็ดล้านบาทถ้วน"],
    [21_000_021, "ยี่สิบเอ็ดล้านยี่สิบเอ็ดบาทถ้วน"],
    [2_000_000_000_000, "สองล้านล้านบาทถ้วน"],
  ])("%s → %s", (amount, words) => {
    expect(bahtText(amount)).toBe(words);
  });

  it("reads satang, and drops the baht part below one baht", () => {
    expect(bahtText(1.5)).toBe("หนึ่งบาทห้าสิบสตางค์");
    expect(bahtText(100.01)).toBe("หนึ่งร้อยบาทหนึ่งสตางค์");
    expect(bahtText(100.11)).toBe("หนึ่งร้อยบาทสิบเอ็ดสตางค์");
    expect(bahtText(0.25)).toBe("ยี่สิบห้าสตางค์");
  });

  it("rounds to the satang as the document prints it", () => {
    expect(bahtText(0.1 + 0.2)).toBe("สามสิบสตางค์");
    // Printed 1.01 and 100.00 — the formatter rounds the decimal "1.005" up,
    // even though the binary value is 1.00499…; the words follow the print.
    expect(bahtText(1.005)).toBe("หนึ่งบาทหนึ่งสตางค์");
    expect(bahtText(99.995)).toBe("หนึ่งร้อยบาทถ้วน");
    expect(bahtText(8155.004)).toBe("แปดพันหนึ่งร้อยห้าสิบห้าบาทถ้วน");
    expect(bahtText(0.125)).toBe("สิบสามสตางค์");
  });

  it("never disagrees with the printed figure, over 5,000 amounts", () => {
    const printed = (n: number) => n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    // The printed figure, read back: "124,655.00" → 124655 baht, 0 satang.
    let seed = 7;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    for (let i = 0; i < 5000; i++) {
      const amount = Math.round(rand() * 10_000_000) / 1000 + (i % 3 === 0 ? 0.005 : 0);
      const [b, s] = printed(amount).replace(/,/g, "").split(".");
      expect(bahtText(amount)).toBe(bahtText(Number(b) + Number(s) / 100));
    }
  });

  it("says ลบ for a negative amount, and nothing for one that is not a number", () => {
    expect(bahtText(-5)).toBe("ลบห้าบาทถ้วน");
    expect(bahtText(-0.001)).toBe("ศูนย์บาทถ้วน");
    expect(bahtText(Number.NaN)).toBe("");
    expect(bahtText(Number.POSITIVE_INFINITY)).toBe("");
    expect(bahtText(1e15)).toBe("");
  });
});

describe("retentionLabel", () => {
  it("says the real window: two years", () => {
    expect(QUOTATION_RETENTION_DAYS).toBe(730);
    expect(retentionLabel()).toBe("2 ปี");
  });

  it("whole years in years, anything else in days", () => {
    expect(retentionLabel(365)).toBe("1 ปี");
    expect(retentionLabel(30)).toBe("30 วัน");
    expect(retentionLabel(400)).toBe("400 วัน");
  });
});

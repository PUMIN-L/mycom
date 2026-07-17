import { describe, it, expect } from "vitest";
import { bahtText } from "../../app/lib/bahtText";

// Expected strings cross-checked against Excel's BAHTTEXT().
describe("bahtText", () => {
  it("reads basic amounts", () => {
    expect(bahtText(0)).toBe("ศูนย์บาทถ้วน");
    expect(bahtText(1)).toBe("หนึ่งบาทถ้วน");
    expect(bahtText(5)).toBe("ห้าบาทถ้วน");
    expect(bahtText(10)).toBe("สิบบาทถ้วน");
  });

  it("applies เอ็ด for trailing 1 in numbers ≥ 11", () => {
    expect(bahtText(11)).toBe("สิบเอ็ดบาทถ้วน");
    expect(bahtText(21)).toBe("ยี่สิบเอ็ดบาทถ้วน");
    expect(bahtText(101)).toBe("หนึ่งร้อยเอ็ดบาทถ้วน");
    expect(bahtText(111)).toBe("หนึ่งร้อยสิบเอ็ดบาทถ้วน");
  });

  it("uses ยี่สิบ for 2 in the tens position", () => {
    expect(bahtText(20)).toBe("ยี่สิบบาทถ้วน");
    expect(bahtText(22)).toBe("ยี่สิบสองบาทถ้วน");
    expect(bahtText(220)).toBe("สองร้อยยี่สิบบาทถ้วน");
  });

  it("reads larger positions", () => {
    expect(bahtText(100)).toBe("หนึ่งร้อยบาทถ้วน");
    expect(bahtText(1000)).toBe("หนึ่งพันบาทถ้วน");
    expect(bahtText(10000)).toBe("หนึ่งหมื่นบาทถ้วน");
    expect(bahtText(100000)).toBe("หนึ่งแสนบาทถ้วน");
    expect(bahtText(123456)).toBe("หนึ่งแสนสองหมื่นสามพันสี่ร้อยห้าสิบหกบาทถ้วน");
  });

  it("handles ล้าน groups", () => {
    expect(bahtText(1_000_000)).toBe("หนึ่งล้านบาทถ้วน");
    expect(bahtText(2_000_000)).toBe("สองล้านบาทถ้วน");
    expect(bahtText(1_000_001)).toBe("หนึ่งล้านเอ็ดบาทถ้วน");
    expect(bahtText(1_234_567)).toBe("หนึ่งล้านสองแสนสามหมื่นสี่พันห้าร้อยหกสิบเจ็ดบาทถ้วน");
    expect(bahtText(1_000_000_000_000)).toBe("หนึ่งล้านล้านบาทถ้วน");
  });

  it("reads satang", () => {
    expect(bahtText(0.5)).toBe("ศูนย์บาทห้าสิบสตางค์");
    expect(bahtText(1.25)).toBe("หนึ่งบาทยี่สิบห้าสตางค์");
    expect(bahtText(1234.5)).toBe("หนึ่งพันสองร้อยสามสิบสี่บาทห้าสิบสตางค์");
    expect(bahtText(99.99)).toBe("เก้าสิบเก้าบาทเก้าสิบเก้าสตางค์");
  });

  it("rounds satang to 2 decimals like BAHTTEXT", () => {
    expect(bahtText(99.999)).toBe("หนึ่งร้อยบาทถ้วน");
    expect(bahtText(0.1 + 0.2)).toBe("ศูนย์บาทสามสิบสตางค์"); // float noise from qty*price sums
    expect(bahtText(1234.565)).toBe("หนึ่งพันสองร้อยสามสิบสี่บาทห้าสิบเจ็ดสตางค์"); // 1234.565 → 123456.5+ satang
    expect(bahtText(0.004)).toBe("ศูนย์บาทถ้วน");
  });

  it("handles negatives and junk", () => {
    expect(bahtText(-15)).toBe("ลบสิบห้าบาทถ้วน");
    expect(bahtText(NaN)).toBe("");
    expect(bahtText(Infinity)).toBe("");
  });
});

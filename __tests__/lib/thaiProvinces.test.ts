import { describe, it, expect } from "vitest";
import { THAI_PROVINCES, canonicalProvince, provinceName, provinceSearchText } from "@/app/lib/thaiProvinces";

describe("THAI_PROVINCES", () => {
  it("is the 77 provinces, each once", () => {
    expect(THAI_PROVINCES).toHaveLength(77);
    expect(new Set(THAI_PROVINCES).size).toBe(77);
    expect(THAI_PROVINCES).toContain("กรุงเทพมหานคร");
    expect(THAI_PROVINCES).toContain("บึงกาฬ");
  });
});

describe("canonicalProvince", () => {
  it("knows a province by its official name, with or without จังหวัด / จ. and stray spaces", () => {
    expect(canonicalProvince("ชลบุรี")).toBe("ชลบุรี");
    expect(canonicalProvince(" ชลบุรี ")).toBe("ชลบุรี");
    expect(canonicalProvince("จังหวัดชลบุรี")).toBe("ชลบุรี");
    expect(canonicalProvince("จ.ชลบุรี")).toBe("ชลบุรี");
    expect(canonicalProvince("จ. สมุทร ปราการ")).toBe("สมุทรปราการ");
  });

  it("knows Bangkok however it is typed", () => {
    for (const typed of ["กรุงเทพมหานคร", "กรุงเทพฯ", "กรุงเทพ", "กทม.", "กทม", "Bangkok", "BKK", "bkk"]) {
      expect(canonicalProvince(typed)).toBe("กรุงเทพมหานคร");
    }
  });

  it("knows the everyday names of a few others", () => {
    expect(canonicalProvince("อยุธยา")).toBe("พระนครศรีอยุธยา");
    expect(canonicalProvince("โคราช")).toBe("นครราชสีมา");
  });

  it("is null for what is not a province", () => {
    for (const typed of ["", "  ", "ชลบุรีี", "Osaka", "บางนา", null, undefined]) expect(canonicalProvince(typed)).toBeNull();
  });
});

describe("provinceName", () => {
  it("is the official name when known, else what was typed, trimmed", () => {
    expect(provinceName("กทม.")).toBe("กรุงเทพมหานคร");
    expect(provinceName(" Osaka ")).toBe("Osaka");
    expect(provinceName(null)).toBe("");
  });
});

describe("provinceSearchText", () => {
  it("holds every name the province goes by, and what was typed", () => {
    const text = provinceSearchText("กทม.");
    for (const name of ["กทม.", "กรุงเทพมหานคร", "กรุงเทพฯ", "bangkok", "bkk"]) expect(text).toContain(name);
    expect(provinceSearchText("ชลบุรี")).toBe("ชลบุรี ชลบุรี");
    expect(provinceSearchText("นครราชสีมา")).toContain("โคราช");
  });

  it("is just what was typed for an unknown place, and empty for none", () => {
    expect(provinceSearchText(" Osaka ")).toBe("Osaka");
    expect(provinceSearchText(undefined)).toBe("");
  });
});

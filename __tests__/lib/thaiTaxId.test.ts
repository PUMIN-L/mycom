// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  branchLabel,
  checkThaiTaxId,
  formatTaxId,
  isValidThaiTaxId,
  normalizeBranchCode,
  normalizeTaxId,
  taxIdWarning,
} from "@/app/lib/thaiTaxId";

describe("checkThaiTaxId", () => {
  it("accepts real company tax IDs, with or without dashes and spaces", () => {
    // The Siam Cement PCL and PTT PCL, as printed on their tax invoices.
    expect(checkThaiTaxId("0107537000114")).toEqual({ status: "ok" });
    expect(checkThaiTaxId("0-1075-44000-10-8")).toEqual({ status: "ok" });
    expect(checkThaiTaxId(" 0107 5440 0010 8 ")).toEqual({ status: "ok" });
  });

  it("catches a typo in any digit — the check digit no longer fits", () => {
    expect(checkThaiTaxId("0107537000115")).toEqual({ status: "checksum" }); // last digit
    expect(checkThaiTaxId("0107537000014")).toEqual({ status: "checksum" }); // a middle one
    expect(checkThaiTaxId("1107537000114")).toEqual({ status: "checksum" }); // the first
  });

  it("a check digit of 0 is the (11 − sum mod 11) mod 10 case, not 10", () => {
    // sum mod 11 = 1 → 11 − 1 = 10 → mod 10 = 0.
    const twelve = "000000000006"; // 6 × 2 = 12, 12 mod 11 = 1
    expect(checkThaiTaxId(`${twelve}0`)).toEqual({ status: "ok" });
    expect(checkThaiTaxId(`${twelve}1`)).toEqual({ status: "checksum" });
  });

  it("says how many digits there are when it is not 13", () => {
    expect(checkThaiTaxId("01075370001")).toEqual({ status: "length", digits: 11 });
    expect(checkThaiTaxId("01075370001140")).toEqual({ status: "length", digits: 14 });
  });

  it("tells letters apart from a wrong length — and '-' typed for 'none' is empty", () => {
    expect(checkThaiTaxId("TW-12345678")).toEqual({ status: "format" });
    expect(checkThaiTaxId("-")).toEqual({ status: "empty" });
    expect(checkThaiTaxId(" - - ")).toEqual({ status: "empty" });
    expect(checkThaiTaxId("")).toEqual({ status: "empty" });
    expect(checkThaiTaxId("   ")).toEqual({ status: "empty" });
    expect(checkThaiTaxId(undefined)).toEqual({ status: "empty" });
  });
});

describe("taxIdWarning", () => {
  it("says nothing for a good or an empty one", () => {
    expect(taxIdWarning("0107537000114")).toBeNull();
    expect(taxIdWarning("")).toBeNull();
  });

  it("names the digits it counted, and leaves a foreign number to the admin", () => {
    expect(taxIdWarning("12345678")).toBe("เลขผู้เสียภาษีของไทยมี 13 หลัก (ตอนนี้ 8 หลัก) — ถ้าเป็นเลขของต่างประเทศ ปล่อยไว้ได้");
    expect(taxIdWarning("TW 12345678")).toContain("ถ้าเป็นเลขของต่างประเทศ ปล่อยไว้ได้");
    expect(taxIdWarning("0107537000115")).toBe("เลขนี้อาจพิมพ์ผิด: หลักสุดท้ายไม่ตรงกับเลขตรวจสอบ ลองเทียบกับเอกสารอีกครั้ง");
  });
});

// ── As a tax invoice prints it (the accounting module) ──────────────────────

describe("normalizeTaxId / isValidThaiTaxId / formatTaxId", () => {
  it("keep the digits, check them, and group them as the card does", () => {
    expect(normalizeTaxId(" 0-1075-37000-11-4 ")).toBe("0107537000114");
    expect(isValidThaiTaxId("0-1075-37000-11-4")).toBe(true);
    expect(isValidThaiTaxId("0107537000115")).toBe(false);
    expect(isValidThaiTaxId("")).toBe(false);
    expect(formatTaxId("0107537000114")).toBe("0-1075-37000-11-4");
  });

  it("leaves anything that is not 13 digits as typed (a number from abroad)", () => {
    expect(formatTaxId(" TW-12345678 ")).toBe("TW-12345678");
    expect(formatTaxId(null)).toBe("");
  });
});

describe("normalizeBranchCode / branchLabel", () => {
  it("reads the head office in words or as 0", () => {
    expect(normalizeBranchCode("สำนักงานใหญ่")).toBe("00000");
    expect(normalizeBranchCode("0")).toBe("00000");
    expect(normalizeBranchCode(0)).toBe("00000");
    expect(branchLabel("00000")).toBe("สำนักงานใหญ่");
  });

  it("reads a branch however it was written, as five digits", () => {
    for (const typed of ["1", "00001", "สาขา 1", "สาขาที่ 00001", "branch 1"]) {
      expect(normalizeBranchCode(typed), typed).toBe("00001");
    }
    expect(branchLabel("12")).toBe("สาขาที่ 00012");
  });

  it("is empty for nothing given, and null for what is not a branch", () => {
    expect(normalizeBranchCode("")).toBe("");
    expect(normalizeBranchCode(null)).toBe("");
    expect(normalizeBranchCode("สาขา")).toBeNull();
    expect(normalizeBranchCode("123456")).toBeNull();
    expect(normalizeBranchCode("กรุงเทพ")).toBeNull();
    expect(branchLabel("")).toBe("");
    expect(branchLabel("x")).toBe("");
  });
});

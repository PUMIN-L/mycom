import { describe, it, expect } from "vitest";
import { companyAddressLines, companyAddressText, isBangkok } from "@/app/customers/companyAddress";

describe("isBangkok", () => {
  it("knows กรุงเทพมหานคร however it was typed", () => {
    for (const typed of ["กรุงเทพมหานคร", "กรุงเทพฯ", "กทม.", "กทม", "Bangkok", "BKK"]) expect(isBangkok(typed)).toBe(true);
    for (const typed of ["ชลบุรี", "สมุทรปราการ", "", null, undefined]) expect(isBangkok(typed)).toBe(false);
  });
});

describe("companyAddressLines", () => {
  it("a province: ตำบล / อำเภอ / จังหวัด, each word in front of its part", () => {
    expect(
      companyAddressLines({
        addressNo: "99/9",
        moo: "3",
        soi: "สุขุมวิท 5",
        road: "สุขุมวิท",
        subDistrict: "บางพลีใหญ่",
        district: "บางพลี",
        province: "สมุทรปราการ",
        postalCode: "10540",
      })
    ).toEqual(["เลขที่ 99/9 หมู่ 3 ซอยสุขุมวิท 5 ถนนสุขุมวิท", "ตำบลบางพลีใหญ่ อำเภอบางพลี", "จังหวัดสมุทรปราการ 10540"]);
  });

  it("Bangkok: แขวง / เขต, and no จังหวัด in front", () => {
    expect(
      companyAddressLines({ addressNo: "1", road: "บางนา-ตราด", subDistrict: "บางนาเหนือ", district: "บางนา", province: "กรุงเทพมหานคร", postalCode: "10260" })
    ).toEqual(["เลขที่ 1 ถนนบางนา-ตราด", "แขวงบางนาเหนือ เขตบางนา", "กรุงเทพมหานคร 10260"]);
    // …by its official name, however it was stored.
    expect(companyAddressLines({ district: "ลาดพร้าว", province: "กทม." })).toEqual(["เขตลาดพร้าว", "กรุงเทพมหานคร"]);
  });

  it("does not say a word twice when the admin already typed it", () => {
    expect(
      companyAddressLines({
        addressNo: "เลขที่ 12 อาคารเอ",
        moo: "ม.4",
        soi: "ซ.ลาดพร้าว 101",
        road: "ถ.ลาดพร้าว",
        subDistrict: "ต.บางพลีใหญ่",
        district: "อ.บางพลี",
        province: "จ.สมุทรปราการ",
      })
    ).toEqual(["เลขที่ 12 อาคารเอ ม.4 ซ.ลาดพร้าว 101 ถ.ลาดพร้าว", "ต.บางพลีใหญ่ อ.บางพลี", "จังหวัดสมุทรปราการ"]);
    // A province that is not one of the 77 stays exactly as typed.
    expect(companyAddressLines({ province: "จ.ไม่มีจริง" })).toEqual(["จ.ไม่มีจริง"]);
  });

  it("an address abroad is joined as typed — no ตำบล / อำเภอ / จังหวัด", () => {
    expect(companyAddressLines({ province: "Osaka" })).toEqual(["Osaka"]);
    expect(
      companyAddressLines({ addressNo: "1-6-5 Nishi-nakajima", district: "Yodogawa-ku", province: "Osaka, Japan", postalCode: "532-0011" })
    ).toEqual(["1-6-5 Nishi-nakajima", "Yodogawa-ku", "Osaka, Japan 532-0011"]);
    // Bangkok in English is still Bangkok.
    expect(companyAddressLines({ district: "Bang Na", province: "Bangkok" })).toEqual(["เขตBang Na", "กรุงเทพมหานคร"]);
    expect(companyAddressLines({ addressNo: "อาคารซี ชั้น 5", subDistrict: "แขวงคลองจั่น", district: "เขตบางกะปิ", province: "จังหวัดชลบุรี" })).toEqual([
      "อาคารซี ชั้น 5",
      "แขวงคลองจั่น เขตบางกะปิ",
      "จังหวัดชลบุรี",
    ]);
  });

  it("leaves out what is missing — no empty lines, and nothing at all for no address", () => {
    expect(companyAddressLines({ district: "ศรีราชา" })).toEqual(["อำเภอศรีราชา"]);
    expect(companyAddressLines({ province: "ชลบุรี" })).toEqual(["จังหวัดชลบุรี"]);
    expect(companyAddressLines({ postalCode: "20110" })).toEqual(["20110"]);
    expect(companyAddressLines({ road: "  สุขุมวิท  " })).toEqual(["ถนนสุขุมวิท"]);
    expect(companyAddressLines({})).toEqual([]);
    expect(companyAddressLines({ addressNo: " ", moo: null, province: "" })).toEqual([]);
  });
});

describe("companyAddressText", () => {
  it("is the address on one line", () => {
    expect(companyAddressText({ addressNo: "1", district: "เมือง", province: "ระยอง", postalCode: "21000" })).toBe("เลขที่ 1 อำเภอเมือง จังหวัดระยอง 21000");
    expect(companyAddressText({})).toBe("");
  });
});

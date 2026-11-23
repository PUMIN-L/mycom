// @vitest-environment node
//
// spaceAddressLabels — the addresses on the accounting papers with a space
// after each label word, as the owner asked (2026-11-23): "อำเภอเมือง" →
// "อำเภอ เมือง". Only after the label; the name itself is never split.
import { describe, it, expect } from "vitest";
import { spaceAddressLabels } from "@/app/lib/thaiAddressSpacing";

describe("spaceAddressLabels", () => {
  it("our address, from the owner's own invoice", () => {
    expect(spaceAddressLabels("93 ถนนงามวงศ์วาน ตำบลบางเขน อำเภอเมืองนนทบุรี จ.นนทบุรี 11000")).toBe(
      "93 ถนน งามวงศ์วาน ตำบล บางเขน อำเภอ เมืองนนทบุรี จ. นนทบุรี 11000"
    );
  });

  it("a customer's address, as /customers puts it together", () => {
    expect(spaceAddressLabels("เลขที่ 88 หมู่ 8 ซอย8 ถนนวงเวียนกลาง ตำบลบนบก อำเภอมีไก่ จังหวัดนอนมา 88888")).toBe(
      "เลขที่ 88 หมู่ 8 ซอย 8 ถนน วงเวียนกลาง ตำบล บนบก อำเภอ มีไก่ จังหวัด นอนมา 88888"
    );
  });

  it("Bangkok's แขวง and เขต", () => {
    expect(spaceAddressLabels("แขวงลาดยาว เขตจตุจักร กรุงเทพมหานคร 10900")).toBe("แขวง ลาดยาว เขต จตุจักร กรุงเทพมหานคร 10900");
  });

  it("the short forms: ต. อ. จ. ถ. ซ. ม.", () => {
    expect(spaceAddressLabels("12 ม.3 ซ.สุขุมวิท 23 ถ.สุขุมวิท ต.บางพลี อ.บางพลี จ.สมุทรปราการ")).toBe(
      "12 ม. 3 ซ. สุขุมวิท 23 ถ. สุขุมวิท ต. บางพลี อ. บางพลี จ. สมุทรปราการ"
    );
  });

  it("หมู่ and เลขที่ only before a number — หมู่บ้าน and หมู่ที่ stay as they are", () => {
    expect(spaceAddressLabels("เลขที่12 หมู่5 หมู่บ้านสุขใจ")).toBe("เลขที่ 12 หมู่ 5 หมู่บ้านสุขใจ");
    expect(spaceAddressLabels("หมู่ที่ 3")).toBe("หมู่ที่ 3");
  });

  it("never splits a word that only contains a label, or one already spaced", () => {
    expect(spaceAddressLabels("ถนน งามวงศ์วาน ตำบล บางเขน")).toBe("ถนน งามวงศ์วาน ตำบล บางเขน");
    // "เขต" inside a name, not at its start.
    expect(spaceAddressLabels("ตำบลบ้านเขตร")).toBe("ตำบล บ้านเขตร");
    expect(spaceAddressLabels("อาคารเอบีซี")).toBe("อาคารเอบีซี");
  });

  it("keeps the lines of a multi-line address, spacing each", () => {
    expect(spaceAddressLabels("93 ถนนงามวงศ์วาน\nตำบลบางเขน อำเภอเมือง")).toBe("93 ถนน งามวงศ์วาน\nตำบล บางเขน อำเภอ เมือง");
  });

  it("leaves an address abroad, and nothing at all, alone", () => {
    expect(spaceAddressLabels("1-2-3 Umeda, Kita-ku, Osaka 530-0001")).toBe("1-2-3 Umeda, Kita-ku, Osaka 530-0001");
    expect(spaceAddressLabels("")).toBe("");
  });

  it("a label after a comma or a bracket counts as a word's start", () => {
    expect(spaceAddressLabels("93,ถนนงามวงศ์วาน (ตำบลบางเขน)")).toBe("93,ถนน งามวงศ์วาน (ตำบล บางเขน)");
  });
});

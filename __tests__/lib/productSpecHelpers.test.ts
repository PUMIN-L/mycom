/**
 * Grouping, searching, naming and checking for /product-specs
 * (app/product-specs/specHelpers.ts).
 */
import { describe, it, expect } from "vitest";
import {
  SPEC_DETAIL_MAX,
  SPEC_NAME_MAX,
  copyName,
  detailNeedsClamp,
  groupSpecs,
  isSpecDirty,
  productName,
  productsWithoutSpecs,
  specErrors,
  type ProductSpec,
  type SpecProduct,
} from "@/app/product-specs/specHelpers";

const product = (id: string, title_th: string, title_en = ""): SpecProduct => ({ id, title_th, title_en });
let seq = 0;
const spec = (productId: string, name: string, detail = "x", createdAt?: string): ProductSpec => ({
  id: `s${++seq}`,
  productId,
  name,
  detail,
  createdAt: createdAt ?? `2025-01-${String(seq).padStart(2, "0")}`,
});

const PRODUCTS = [
  product("utm", "<p>เครื่องทดสอบแรงดึง UTM</p>"),
  product("px", "<p>เครื่องชั่ง PX-3000</p>"),
  product("oven", "", "Hot Air Oven"),
];

describe("productName", () => {
  it("is the Thai title as plain text, else the English, without 🐧", () => {
    expect(productName(PRODUCTS[0])).toBe("เครื่องทดสอบแรงดึง UTM");
    expect(productName(PRODUCTS[2])).toBe("Hot Air Oven");
    expect(productName(product("p", "<b>🐧 ตู้อบ</b> &amp; ชั้นวาง 🐧"))).toBe("ตู้อบ & ชั้นวาง");
    expect(productName(undefined)).toBe("");
  });
});

describe("groupSpecs", () => {
  const all = [
    spec("utm", "สเปค 50kN"),
    spec("px", "ชั่งได้ 3 กก."),
    spec("utm", "สเปค 5kN"),
    spec("gone", "สเปคเก่า"),
    spec("utm", "สเปค 10kN", "Capacity 10 kN\nAccuracy ±0.5%"),
    spec("oven", "100 ลิตร", "Temperature 250 °C"),
  ];
  const none = { query: "", productId: "" };

  it("puts each product's specs together, products A→Z, a missing product last", () => {
    const groups = groupSpecs(all, PRODUCTS, none);
    expect(groups.map((g) => g.productName)).toEqual(["เครื่องชั่ง PX-3000", "เครื่องทดสอบแรงดึง UTM", "Hot Air Oven", ""]);
    expect(groups[3].productId).toBe("gone");
  });

  it("orders a product's specs by number, not by text: 5, 10, 50", () => {
    const utm = groupSpecs(all, PRODUCTS, none).find((g) => g.productId === "utm")!;
    expect(utm.specs.map((s) => s.name)).toEqual(["สเปค 5kN", "สเปค 10kN", "สเปค 50kN"]);
  });

  it("breaks a tie in heading by age, oldest first", () => {
    const twins = [spec("px", "A", "new", "2025-03-01"), spec("px", "A", "old", "2025-01-01")];
    expect(groupSpecs(twins, PRODUCTS, none)[0].specs.map((s) => s.detail)).toEqual(["old", "new"]);
  });

  it("searches the product name, the heading and the detail, ignoring case and outer spaces", () => {
    const names = (query: string) => groupSpecs(all, PRODUCTS, { query, productId: "" }).flatMap((g) => g.specs.map((s) => s.name));
    expect(names(" px-3000 ")).toEqual(["ชั่งได้ 3 กก."]);
    expect(names("10kn")).toEqual(["สเปค 10kN"]);
    expect(names("±0.5")).toEqual(["สเปค 10kN"]);
    expect(names("HOT AIR")).toEqual(["100 ลิตร"]);
    expect(names("ไม่มีคำนี้")).toEqual([]);
  });

  it("narrows to one product, together with the search", () => {
    const groups = groupSpecs(all, PRODUCTS, { query: "", productId: "utm" });
    expect(groups).toHaveLength(1);
    expect(groups[0].specs).toHaveLength(3);
    expect(groupSpecs(all, PRODUCTS, { query: "50", productId: "utm" })[0].specs.map((s) => s.name)).toEqual(["สเปค 50kN"]);
    expect(groupSpecs(all, PRODUCTS, { query: "ชั่ง", productId: "utm" })).toEqual([]);
  });

  it("keeps two missing products apart, and leaves the input alone", () => {
    const input = [spec("x2", "b"), spec("x1", "a")];
    const groups = groupSpecs(input, [], none);
    expect(groups.map((g) => g.productId)).toEqual(["x1", "x2"]);
    expect(input.map((s) => s.name)).toEqual(["b", "a"]);
  });
});

describe("productsWithoutSpecs", () => {
  it("lists products with no spec, A→Z, narrowed by the search box", () => {
    const specs = [spec("utm", "a")];
    expect(productsWithoutSpecs(PRODUCTS, specs, "").map((p) => p.id)).toEqual(["px", "oven"]);
    expect(productsWithoutSpecs(PRODUCTS, specs, " oven ").map((p) => p.id)).toEqual(["oven"]);
    expect(productsWithoutSpecs(PRODUCTS, [...specs, spec("px", "b"), spec("oven", "c")], "")).toEqual([]);
  });
});

describe("copyName", () => {
  it("adds (สำเนา), then counts up past headings already taken", () => {
    expect(copyName("สเปค 5kN", ["สเปค 5kN"])).toBe("สเปค 5kN (สำเนา)");
    expect(copyName("สเปค 5kN", ["สเปค 5kN", "สเปค 5kN (สำเนา)"])).toBe("สเปค 5kN (สำเนา 2)");
    expect(copyName("สเปค 5kN", ["สเปค 5kN (สำเนา)", " สเปค 5kN (สำเนา 2) "])).toBe("สเปค 5kN (สำเนา 3)");
  });

  it("counts on from the original when copying a copy", () => {
    expect(copyName("สเปค 5kN (สำเนา)", ["สเปค 5kN", "สเปค 5kN (สำเนา)"])).toBe("สเปค 5kN (สำเนา 2)");
    expect(copyName("สเปค 5kN (สำเนา 2)", ["สเปค 5kN (สำเนา)", "สเปค 5kN (สำเนา 2)"])).toBe("สเปค 5kN (สำเนา 3)");
  });

  it("stays within the API's limit by shortening the original part", () => {
    const long = "ก".repeat(SPEC_NAME_MAX);
    const copy = copyName(long, [long]);
    expect(copy.length).toBeLessThanOrEqual(SPEC_NAME_MAX);
    expect(copy.endsWith(" (สำเนา)")).toBe(true);
    const second = copyName(long, [long, copy]);
    expect(second.length).toBeLessThanOrEqual(SPEC_NAME_MAX);
    expect(second.endsWith(" (สำเนา 2)")).toBe(true);
  });
});

describe("specErrors", () => {
  it("names each missing field", () => {
    expect(specErrors({})).toEqual({
      productId: "กรุณาเลือกสินค้า",
      name: "กรุณากรอกหัวข้อสเปค",
      detail: "กรุณากรอกรายละเอียด",
    });
  });

  it("treats spaces as empty, as the API does", () => {
    expect(specErrors({ productId: "p", name: "   ", detail: " \n " })).toEqual({
      name: "กรุณากรอกหัวข้อสเปค",
      detail: "กรุณากรอกรายละเอียด",
    });
  });

  it("is happy with a complete draft", () => {
    expect(specErrors({ productId: "p", name: "สเปค", detail: "รายละเอียด" })).toEqual({});
  });

  it("refuses what the API would cut short", () => {
    const e = specErrors({ productId: "p", name: "ก".repeat(SPEC_NAME_MAX + 1), detail: "ข".repeat(SPEC_DETAIL_MAX + 1) });
    expect(e.name).toBe("หัวข้อสเปคยาวเกิน 255 ตัวอักษร");
    expect(e.detail).toBe("รายละเอียดยาวเกิน 5,000 ตัวอักษร");
    expect(specErrors({ productId: "p", name: "ก".repeat(SPEC_NAME_MAX), detail: "ข".repeat(SPEC_DETAIL_MAX) })).toEqual({});
  });
});

describe("isSpecDirty", () => {
  it("is true only when a field changed", () => {
    const original = { productId: "p", name: "a", detail: "b" };
    expect(isSpecDirty(original, { ...original })).toBe(false);
    expect(isSpecDirty(original, { ...original, detail: "b2" })).toBe(true);
    expect(isSpecDirty(original, { ...original, productId: "q" })).toBe(true);
    expect(isSpecDirty({ productId: "", name: "", detail: "" }, {})).toBe(false);
    expect(isSpecDirty({}, { name: "x" })).toBe(true);
  });
});

describe("detailNeedsClamp", () => {
  it("is false for three short lines or fewer", () => {
    expect(detailNeedsClamp("")).toBe(false);
    expect(detailNeedsClamp("a\nb\nc")).toBe(false);
    expect(detailNeedsClamp("x".repeat(240))).toBe(false);
  });

  it("is true for a fourth line, or a line long enough to wrap past three", () => {
    expect(detailNeedsClamp("a\nb\nc\nd")).toBe(true);
    expect(detailNeedsClamp("x".repeat(241))).toBe(true);
    expect(detailNeedsClamp("a\n" + "x".repeat(161))).toBe(true);
  });

  it("takes the line count and width it is given", () => {
    expect(detailNeedsClamp("a\nb", 1)).toBe(true);
    expect(detailNeedsClamp("x".repeat(30), 3, 10)).toBe(false);
    expect(detailNeedsClamp("x".repeat(31), 3, 10)).toBe(true);
  });
});

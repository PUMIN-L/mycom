// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  catalogSections,
  categoryDescription,
  categoryTitle,
  toCatalogProduct,
} from "@/app/lib/catalogPages";
import type { ProductCategory, ProductData } from "@/app/lib/types";

const cat = (id: number, name_th: string, name_en: string, sortOrder = id): ProductCategory => ({
  id,
  name_th,
  name_en,
  name_zh: "",
  sortOrder,
});

const prod = (id: string, categoryId: number, over: Partial<ProductData> = {}): ProductData => ({
  id,
  categoryId,
  image: `/${id}.png`,
  title_th: `<p>สินค้า ${id}</p>`,
  title_en: `<p>Product ${id}</p>`,
  title_zh: "",
  desc_th: "<p>รายละเอียด</p>",
  desc_en: "",
  desc_zh: "",
  createdAt: "2026-01-01",
  ...over,
});

describe("toCatalogProduct", () => {
  it("ships names and a clipped blurb as plain text — no markup, no entities", () => {
    const p = toCatalogProduct(
      prod("a", 1, {
        title_th: "<p>ตู้อบ &amp; เตา</p>",
        desc_th: `<p>${"คำ ".repeat(100)}</p>`,
        desc_en: "<p>Line one</p><p>Line two</p>",
      })
    );
    expect(p.title_th).toBe("ตู้อบ & เตา");
    expect([...p.desc_th].length).toBeLessThanOrEqual(140);
    expect(p.desc_th.endsWith("…")).toBe(true);
    // The lines the editor showed stay lines (the cards are pre-wrap).
    expect(p.desc_en).toBe("Line one\nLine two");
    expect(Object.keys(p).sort()).toEqual(
      ["desc_en", "desc_th", "desc_zh", "id", "image", "title_en", "title_th", "title_zh"]
    );
  });
});

describe("catalogSections", () => {
  const categories = [cat(1, "เครื่องชั่ง", "Balances"), cat(2, "ว่าง", "Empty"), cat(3, "<p>ตู้อบ</p>", "Ovens")];
  const products = [prod("b1", 1), prod("o1", 3), prod("b2", 1)];

  it("keeps category order, groups products, and drops categories with no products", () => {
    const sections = catalogSections(categories, products);
    expect(sections.map((s) => s.id)).toEqual([1, 3]);
    expect(sections[0].products.map((p) => p.id)).toEqual(["b1", "b2"]);
    expect(sections[1]).toMatchObject({ path: "/products/3-ovens", name_th: "ตู้อบ", name_en: "Ovens" });
  });

  it("is empty for an empty catalog", () => {
    expect(catalogSections(categories, [])).toEqual([]);
  });
});

describe("categoryTitle / categoryDescription", () => {
  it("pairs the Thai name with the English one, once", () => {
    expect(categoryTitle({ name_th: "เครื่องชั่ง", name_en: "Balances" })).toBe("เครื่องชั่ง (Balances)");
    expect(categoryTitle({ name_th: "Ovens", name_en: "ovens" })).toBe("Ovens");
    expect(categoryTitle({ name_th: "", name_en: "Ovens" })).toBe("Ovens");
  });

  it("describes the category with a few models, within 160 characters", () => {
    const [section] = catalogSections(
      [cat(1, "เครื่องชั่ง", "Balances")],
      Array.from({ length: 20 }, (_, i) => prod(`รุ่นที่มีชื่อยาวมากสำหรับทดสอบ-${i}`, 1))
    );
    const description = categoryDescription(section);
    expect(description.startsWith("เครื่องชั่ง (Balances) 20 รายการ เช่น")).toBe(true);
    expect([...description].length).toBeLessThanOrEqual(160);
  });

  // The cards keep a title's line breaks; a meta description is one line.
  it("puts a two-line product title into the description on one line", () => {
    const [section] = catalogSections(
      [cat(1, "เครื่องชั่ง", "Balances")],
      [prod("a", 1, { title_th: "<p>รุ่น A</p><p>ความละเอียด 0.1 g</p>" })]
    );
    expect(section.products[0].title_th).toBe("รุ่น A\nความละเอียด 0.1 g");
    expect(categoryDescription(section)).toContain("เช่น รุ่น A ความละเอียด 0.1 g —");
    expect(categoryDescription(section)).not.toContain("\n");
  });
});

// @vitest-environment node
import { describe, it, expect } from "vitest";
import { showcasePageTitle, relatedShowcaseItems } from "@/app/lib/showcaseSeo";

describe("showcasePageTitle", () => {
  const gloss = { title_th: "<p>เครื่องวัดความเงา</p>", title_en: "<p>Gloss Meter</p>" };

  it("adds the product's Thai and English names to a bare model number", () => {
    expect(showcasePageTitle("<p>GM-4</p>", gloss)).toBe("GM-4 – เครื่องวัดความเงา (Gloss Meter)");
  });

  it("does not repeat a name the title already contains (any case)", () => {
    expect(showcasePageTitle("เครื่องวัดความเงา GM-4", gloss)).toBe("เครื่องวัดความเงา GM-4 – Gloss Meter");
    expect(showcasePageTitle("GLOSS METER GM-4", gloss)).toBe("GLOSS METER GM-4 – เครื่องวัดความเงา");
    expect(showcasePageTitle("เครื่องวัดความเงา Gloss Meter GM-4", gloss)).toBe(
      "เครื่องวัดความเงา Gloss Meter GM-4"
    );
  });

  it("uses whichever name exists, and one name once when both are equal", () => {
    expect(showcasePageTitle("GM-4", { title_th: "", title_en: "Gloss Meter" })).toBe("GM-4 – Gloss Meter");
    expect(showcasePageTitle("GM-4", { title_th: "Gloss Meter", title_en: "gloss meter" })).toBe(
      "GM-4 – Gloss Meter"
    );
  });

  it("is the content title alone with no product, as text", () => {
    expect(showcasePageTitle("<p>A &amp; B</p>", null)).toBe("A & B");
  });

  it("falls back to the product names when the content title is empty", () => {
    expect(showcasePageTitle("<p></p>", gloss)).toBe("เครื่องวัดความเงา Gloss Meter");
  });
});

describe("relatedShowcaseItems", () => {
  const p = (id: string, categoryId: number) => ({
    id,
    categoryId,
    image: `/${id}.png`,
    title_th: id,
    title_en: id,
    title_zh: id,
  });
  const products = [p("a1", 1), p("a2", 1), p("a3", 1), p("b1", 2), p("b2", 2), p("c1", 3)];
  const contents = [
    { id: "c-a1", productId: "a1" },
    { id: "c-a2", productId: "a2" },
    // a3 has no content page
    { id: "c-b1", productId: "b1" },
    { id: "c-b2", productId: "b2" },
    { id: "c-c1", productId: "c1" },
    { id: "c-free", productId: null },
  ];

  it("lists same-category products first, then the rest, each with its content page", () => {
    const items = relatedShowcaseItems({ currentContentId: "c-a1", currentProductId: "a1", products, contents });
    expect(items.map((i) => i.contentId)).toEqual(["c-a2", "c-b1", "c-b2", "c-c1"]);
    expect(items.map((i) => i.sameCategory)).toEqual([true, false, false, false]);
  });

  it("never lists the page itself, or a product without a content page", () => {
    const items = relatedShowcaseItems({ currentContentId: "c-a1", currentProductId: "a1", products, contents });
    expect(items.map((i) => i.product.id)).not.toContain("a1");
    expect(items.map((i) => i.product.id)).not.toContain("a3");
  });

  it("caps the list", () => {
    const items = relatedShowcaseItems({
      currentContentId: "c-a1",
      currentProductId: "a1",
      products,
      contents,
      limit: 2,
    });
    expect(items.map((i) => i.contentId)).toEqual(["c-a2", "c-b1"]);
  });

  it("still links the catalog from a content page with no product", () => {
    const items = relatedShowcaseItems({ currentContentId: "c-free", currentProductId: null, products, contents });
    expect(items.map((i) => i.contentId)).toEqual(["c-a1", "c-a2", "c-b1", "c-b2", "c-c1"]);
    expect(items.every((i) => !i.sameCategory)).toBe(true);
  });

  it("only knows the products it is given — hidden ones are filtered by the caller", () => {
    const items = relatedShowcaseItems({
      currentContentId: "c-a1",
      currentProductId: "a1",
      products: products.filter((x) => x.id !== "b1"),
      contents,
    });
    expect(items.map((i) => i.contentId)).not.toContain("c-b1");
  });
});

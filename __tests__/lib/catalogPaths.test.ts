// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  slugify,
  categorySlug,
  categoryPath,
  categoryIdFromSlug,
  PRODUCTS_PATH,
} from "@/app/lib/catalogPaths";

describe("slugify", () => {
  it("turns an English name into lower-case words joined by '-'", () => {
    expect(slugify("Tensile Testers")).toBe("tensile-testers");
    expect(slugify("  Film / Packaging  Testing ")).toBe("film-packaging-testing");
  });

  it("reads rich text as text: tags stripped, '&amp;' decoded to 'and'", () => {
    expect(slugify("<p>Hardness &amp; Durometer</p>")).toBe("hardness-and-durometer");
  });

  it("drops accents rather than whole letters", () => {
    expect(slugify("Crème Brûlée")).toBe("creme-brulee");
  });

  it("is empty when nothing ASCII is left (a Thai-only name)", () => {
    expect(slugify("เครื่องชั่ง")).toBe("");
  });

  it("caps the length without leaving a trailing '-'", () => {
    const slug = slugify("word ".repeat(30));
    expect(slug.length).toBeLessThanOrEqual(60);
    expect(slug.endsWith("-")).toBe(false);
  });
});

describe("category paths", () => {
  it("puts the id first, then the English slug", () => {
    expect(categorySlug({ id: 3, name_en: "Tensile Testers" })).toBe("3-tensile-testers");
    expect(categoryPath({ id: 3, name_en: "Tensile Testers" })).toBe(`${PRODUCTS_PATH}/3-tensile-testers`);
  });

  it("is just the id when there is no English name", () => {
    expect(categorySlug({ id: 7, name_en: "" })).toBe("7");
    expect(categorySlug({ id: 0, name_en: "<p></p>" })).toBe("0");
  });

  it("reads the id back from a slug — including 0 and a stale slug", () => {
    expect(categoryIdFromSlug("3-tensile-testers")).toBe(3);
    expect(categoryIdFromSlug("3-old-name")).toBe(3);
    expect(categoryIdFromSlug("0")).toBe(0);
    expect(categoryIdFromSlug("12")).toBe(12);
  });

  it("rejects a slug that does not start with an id", () => {
    expect(categoryIdFromSlug("tensile")).toBeNull();
    expect(categoryIdFromSlug("3abc")).toBeNull();
    expect(categoryIdFromSlug("")).toBeNull();
    expect(categoryIdFromSlug("1234567890")).toBeNull(); // not a real id, and not a huge number
  });
});

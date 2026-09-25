// Data for the public catalog pages: /products (every category) and
// /products/{id}-{slug} (one category). Pure — the pages call these on the
// server and pass the result to the client view.
//
// Everything is converted to PLAIN TEXT here (htmlToText): product and
// category names are rich text in the database, but these pages render them
// as text nodes, and descriptions are clipped to a blurb. Shipping full
// three-language rich descriptions for the whole catalog would put the
// /showcase page-weight problem (ARCHITECTURE "Page weight") on every page.

import { categoryPath } from "./catalogPaths";
import { clipText, htmlToText } from "./stripHtml";
import type { ProductCategory, ProductData } from "./types";

export interface CatalogProduct {
  id: string;
  image: string;
  title_th: string;
  title_en: string;
  title_zh: string;
  desc_th: string;
  desc_en: string;
  desc_zh: string;
}

export interface CatalogCategory {
  id: number;
  path: string;
  name_th: string;
  name_en: string;
  name_zh: string;
}

export interface CatalogSection extends CatalogCategory {
  products: CatalogProduct[];
}

const BLURB_LENGTH = 140;

export function toCatalogProduct(p: ProductData): CatalogProduct {
  return {
    id: p.id,
    image: p.image,
    title_th: htmlToText(p.title_th),
    title_en: htmlToText(p.title_en),
    title_zh: htmlToText(p.title_zh),
    desc_th: clipText(htmlToText(p.desc_th), BLURB_LENGTH),
    desc_en: clipText(htmlToText(p.desc_en), BLURB_LENGTH),
    desc_zh: clipText(htmlToText(p.desc_zh), BLURB_LENGTH),
  };
}

export function toCatalogCategory(c: ProductCategory): CatalogCategory {
  return {
    id: c.id,
    path: categoryPath(c),
    name_th: htmlToText(c.name_th),
    name_en: htmlToText(c.name_en),
    name_zh: htmlToText(c.name_zh),
  };
}

/**
 * One section per category that has products, in category order, each with
 * its products in catalog order. A category with no products gets no section
 * — and no page (the category page 404s): an empty page is not worth
 * indexing.
 *
 * `products` must already be the PUBLIC products (getProductsData).
 */
export function catalogSections(
  categories: readonly ProductCategory[],
  products: readonly ProductData[]
): CatalogSection[] {
  return categories.flatMap((category) => {
    const inCategory = products.filter((p) => p.categoryId === category.id);
    return inCategory.length
      ? [{ ...toCatalogCategory(category), products: inCategory.map(toCatalogProduct) }]
      : [];
  });
}

/** "เครื่องวัดความเงา (Gloss Meters)" — the Thai name with the English one
 *  people also search for, or whichever exists. Takes plain-text names. */
export function categoryTitle(category: Pick<CatalogCategory, "name_th" | "name_en">): string {
  const th = category.name_th.trim();
  const en = category.name_en.trim();
  if (th && en && th.toLowerCase() !== en.toLowerCase()) return `${th} (${en})`;
  return th || en;
}

/** The meta description of a category page: what it is, and a few models. */
export function categoryDescription(section: CatalogSection): string {
  const names = section.products
    .map((p) => p.title_th || p.title_en)
    .filter(Boolean)
    .slice(0, 3);
  const examples = names.length ? ` เช่น ${names.join(", ")}` : "";
  return clipText(
    `${categoryTitle(section)} ${section.products.length} รายการ${examples} — ` +
      "จำหน่าย ติดตั้ง และสอบเทียบโดย Profin Lab Scale"
  );
}

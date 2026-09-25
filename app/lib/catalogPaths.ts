// URLs of the public catalog pages — /products (every category) and
// /products/{id}-{slug} (one category). Pure: used by server pages, the
// sitemap and client components alike.
//
// The category id is the part that identifies the page; the slug after it is
// the English name, there for people and search results to read. A renamed
// category keeps its id, so an old link still resolves — the page redirects
// it to the current slug.

import { htmlToText } from "./stripHtml";
import type { ProductCategory } from "./types";

export const PRODUCTS_PATH = "/products";

/** Lower-case ASCII words joined by "-"; "" when nothing ASCII is left. */
export function slugify(text: string): string {
  return htmlToText(text)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // accents, once NFKD has split them off
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
}

/** "3-tensile-testers", or just "3" for a category with no English name. */
export function categorySlug(category: Pick<ProductCategory, "id" | "name_en">): string {
  const words = slugify(category.name_en ?? "");
  return words ? `${category.id}-${words}` : String(category.id);
}

export function categoryPath(category: Pick<ProductCategory, "id" | "name_en">): string {
  return `${PRODUCTS_PATH}/${categorySlug(category)}`;
}

/** The category id at the front of a slug; null when there is none. */
export function categoryIdFromSlug(slug: string): number | null {
  const match = /^(\d{1,9})(?:-|$)/.exec(slug);
  return match ? Number(match[1]) : null;
}

// What a /showcase/{id} content page tells search engines and visitors beyond
// its own blocks: a title that names the product, and links to other product
// pages. Pure — used by the server page and by ShowcaseClient.

import { htmlToText } from "./stripHtml";
import { mapContentIdByProduct } from "./productLinks";
import type { ContentMeta, ProductData } from "./types";

type ProductNames = Pick<ProductData, "title_th" | "title_en">;

/**
 * The page title: the content's own title, plus the linked product's Thai and
 * English names when the title does not already contain them.
 *
 * Content titles are often just a model number ("GM-4"), which is not what
 * anyone searches for; "GM-4 – เครื่องวัดความเงา (Gloss Meter)" is. A name the
 * title already contains is not repeated.
 */
export function showcasePageTitle(contentTitle: string, product?: ProductNames | null): string {
  const title = htmlToText(contentTitle).trim();
  if (!product) return title;

  const th = htmlToText(product.title_th ?? "").trim();
  const en = htmlToText(product.title_en ?? "").trim();
  const has = (name: string) => title.toLowerCase().includes(name.toLowerCase());
  const addTh = th !== "" && !has(th);
  const addEn = en !== "" && !has(en) && en.toLowerCase() !== th.toLowerCase();

  if (!title) return [th, en].filter(Boolean).join(" ");
  if (addTh && addEn) return `${title} – ${th} (${en})`;
  if (addTh) return `${title} – ${th}`;
  if (addEn) return `${title} – ${en}`;
  return title;
}

export type RelatedProduct = Pick<
  ProductData,
  "id" | "categoryId" | "image" | "title_th" | "title_en" | "title_zh"
>;

/**
 * Other products to link from a content page, each to its own content page.
 *
 * Products in the same category come first, then the rest of the catalog, in
 * catalog order, up to `limit`. Only products that HAVE a content page are
 * listed: the point is a link to a page that can rank, and a product without
 * one has only the noindex gateway.
 *
 * `products` must already be the PUBLIC products (isProductPublic): whatever
 * this returns is rendered for anonymous visitors.
 */
export function relatedShowcaseItems<P extends RelatedProduct>({
  currentContentId,
  currentProductId,
  products,
  contents,
  limit = 8,
}: {
  currentContentId: string;
  currentProductId: string | null | undefined;
  products: readonly P[];
  contents: ReadonlyArray<Pick<ContentMeta, "id" | "productId">>;
  limit?: number;
}): Array<{ contentId: string; product: P; sameCategory: boolean }> {
  const contentIdByProduct = mapContentIdByProduct(
    products.map((p) => p.id),
    contents
  );
  const current = products.find((p) => p.id === currentProductId);

  const linkable = products.flatMap((product) => {
    if (product.id === currentProductId) return [];
    const contentId = Object.hasOwn(contentIdByProduct, product.id)
      ? contentIdByProduct[product.id]
      : undefined;
    if (!contentId || contentId === currentContentId) return [];
    return [{ contentId, product, sameCategory: !!current && product.categoryId === current.categoryId }];
  });

  return [
    ...linkable.filter((item) => item.sameCategory),
    ...linkable.filter((item) => !item.sameCategory),
  ].slice(0, limit);
}

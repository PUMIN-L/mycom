// Where a product links to. Pure — imported by client components (the home
// grid) as well as server ones.
//
// A product's real page is its /showcase/{contentId} content page — the one in
// the sitemap, with Article JSON-LD. /showcase/product/{productId} is only a
// gateway: it looks the content up and REDIRECTS there (307), and it is
// noindex for products with no content yet. Linking the gateway made every
// product link on the site a redirect hop, which passes less weight to the page
// that ranks than a direct link, so links go straight to the content page and
// the gateway is left for products that have none.

import type { ContentMeta } from "./types";

/**
 * productId → the id of its content page, for the given products only.
 *
 * Built with Object.fromEntries so a product id can never write to the
 * object's prototype; read it with productHref / contentIdFor, which check
 * own properties. The first content per product wins — one content per
 * product is an invariant the write paths enforce, so there is only one.
 */
export function mapContentIdByProduct(
  productIds: Iterable<string>,
  contents: ReadonlyArray<Pick<ContentMeta, "id" | "productId">>
): Record<string, string> {
  const wanted = new Set(productIds);
  const found = new Map<string, string>();
  for (const c of contents) {
    if (c.productId && wanted.has(c.productId) && !found.has(c.productId)) {
      found.set(c.productId, c.id);
    }
  }
  return Object.fromEntries(found);
}

export function contentIdFor(
  productId: string,
  contentIdByProduct: Record<string, string> | undefined
): string | undefined {
  return contentIdByProduct && Object.hasOwn(contentIdByProduct, productId)
    ? contentIdByProduct[productId]
    : undefined;
}

/** The URL a product card links to: its content page, or the gateway. */
export function productHref(
  productId: string,
  contentIdByProduct: Record<string, string> | undefined
): string {
  const contentId = contentIdFor(productId, contentIdByProduct);
  return contentId
    ? `/showcase/${encodeURIComponent(contentId)}`
    : `/showcase/product/${encodeURIComponent(productId)}`;
}

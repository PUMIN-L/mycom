import { cache } from "react";
import { unstable_cache } from "next/cache";
import {
  getAllCategories,
  getAllProducts,
  isProductPublic,
  ProductCategory,
  ProductData,
} from "./productStore";
import { getAllContentsMeta } from "./contentStore";
import { mapContentIdByProduct } from "./productLinks";

export interface ProductsData {
  categories: ProductCategory[];
  products: ProductData[];
  /** Public product id → id of its /showcase content page (productLinks.ts).
   *  Products with no content page have no entry. */
  contentIdByProduct: Record<string, string>;
}

// The public catalog, cached across requests (Next.js Data Cache). This result
// is served to the PUBLIC (home grid SSR, JSON-LD, sitemap, /products).
// Unpublished products must never leak here — the admin UI re-fetches the full
// list from the authenticated /api/products instead.
//
// It THROWS when a read fails, and that is what keeps a failure out of the
// cache: unstable_cache stores only what resolves, and this entry has no
// revalidate window — only the "products" tag — so a stored fallback would pin
// an empty catalog on the site until someone happened to edit a product (the
// same reason getCompanyInfo catches outside its cache).
const loadCatalog = unstable_cache(
  async (): Promise<Omit<ProductsData, "contentIdByProduct">> => {
    const [categories, products] = await Promise.all([getAllCategories(), getAllProducts()]);
    return { categories, products: products.filter(isProductPublic) };
  },
  ["products_data"],
  { tags: ["products"] }
);

// React.cache deduplicates within one request. Failures degrade here, outside
// every cache, so the next request retries the database:
//  - the catalog read failing → an empty catalog for this request;
//  - only the content read failing → the catalog as usual, every product
//    linking through the gateway (which still works).
// The content map is built per request from getAllContentsMeta (itself cached,
// under the same "products" tag every content write busts), and from the
// PUBLIC products only — it would otherwise name hidden products' pages.
export const getProductsData = cache(async (): Promise<ProductsData> => {
  const [catalog, contents] = await Promise.all([
    loadCatalog().catch((error) => {
      console.error("Error fetching products data:", error);
      return { categories: [], products: [] };
    }),
    getAllContentsMeta().catch((error) => {
      console.error("Error fetching content links for products:", error);
      return [];
    }),
  ]);
  return {
    ...catalog,
    contentIdByProduct: mapContentIdByProduct(
      catalog.products.map((p) => p.id),
      contents
    ),
  };
});

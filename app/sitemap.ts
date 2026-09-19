import type { MetadataRoute } from "next";
import { SITE_URL } from "./lib/site";
import { getAllContentsMeta } from "./lib/contentStore";
import { getAllDocuments } from "./lib/documentStore";
import { getAllProducts, isProductPublic } from "./lib/productStore";

// Generated at request time so newly-added content/documents appear without a rebuild.
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: SITE_URL, lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: `${SITE_URL}/about`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE_URL}/contact`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE_URL}/catalog`, lastModified: now, changeFrequency: "weekly", priority: 0.7 },
  ];

  // PUBLIC content pages /showcase/{id} — the ones with Article JSON-LD that
  // actually rank. (The admin hub now lives at /adminpanel — robots-blocked and
  // never in the sitemap; only the individual content pages belong here.) Each DB read
  // is best-effort: a hiccup falls back to the static routes rather than 500-ing
  // the sitemap (which Google reports as "couldn't fetch").
  let contentRoutes: MetadataRoute.Sitemap = [];
  try {
    const [contents, products] = await Promise.all([
      getAllContentsMeta(),
      getAllProducts(),
    ]);
    // Content linked to a hidden (unpublished / pending-delete) product is a
    // 404 for anonymous callers — see isHiddenFromAnonymous in
    // app/showcase/[id]/page.tsx — and Googlebot is always anonymous. Listing
    // it here asks Google to crawl a URL we then refuse to serve, which lands
    // in Search Console as "Submitted URL not found (404)".
    //
    // Matches that helper exactly: hidden only when the product EXISTS and is
    // not public. A productId pointing at a deleted product leaves the page
    // reachable, so it belongs in the sitemap.
    const hiddenProductIds = new Set(
      products.filter((p) => !isProductPublic(p)).map((p) => p.id)
    );
    contentRoutes = contents
      .filter((c) => !c.productId || !hiddenProductIds.has(c.productId))
      .map((c) => ({
        url: `${SITE_URL}/showcase/${c.id}`,
        lastModified: c.createdAt ? new Date(c.createdAt) : now,
        changeFrequency: "monthly",
        priority: 0.7,
      }));
  } catch (err) {
    // Either read failing skips content routes entirely rather than emitting an
    // unfiltered list: a products read that failed cannot vouch for visibility.
    console.error("sitemap: failed to load contents:", err);
  }

  // Public document preview pages (downloadable catalogs shown on /catalog).
  let documentRoutes: MetadataRoute.Sitemap = [];
  try {
    const documents = await getAllDocuments();
    documentRoutes = documents.map((d) => ({
      url: `${SITE_URL}/document/${d.id}`,
      lastModified: d.createdAt ? new Date(d.createdAt) : now,
      changeFrequency: "monthly",
      priority: 0.5,
    }));
  } catch (err) {
    console.error("sitemap: failed to load documents:", err);
  }

  return [...staticRoutes, ...contentRoutes, ...documentRoutes];
}

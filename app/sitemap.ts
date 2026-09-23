import type { MetadataRoute } from "next";
import { SITE_URL } from "./lib/site";
import { getAllContentsMeta } from "./lib/contentStore";
import { getAllDocuments } from "./lib/documentStore";
import { getAllProducts, isProductPublic } from "./lib/productStore";
import { isMaintenanceMode } from "./lib/settingsStore";

// Generated at request time so newly-added content/documents appear without a rebuild.
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();

  // /catalog is covered by the maintenance overlay (MAINTENANCE_BLOCKED_PATHS),
  // so while that is on there is nothing for a crawler to index there — asking
  // Google to come back weekly for a page that only shows "กำลังปรับปรุง" is
  // what turns a maintenance window into a ranking problem.
  //
  // `/` and `/contact` are blocked by the same overlay but stay listed on
  // purpose — the overlay itself carries the business name and services for
  // exactly this case (see MaintenanceOverlay.tsx), so those URLs still return
  // something worth indexing. /catalog has no such copy.
  //
  // Deliberately NOT wrapped in a try/catch, unlike the reads below:
  // isMaintenanceMode() cannot reject — it catches a failed read itself and
  // returns false, with that catch kept OUTSIDE its cache so a failure is
  // never stored (see settingsStore.ts). A settings-table blip therefore
  // leaves /catalog listed rather than quietly shrinking the sitemap on an
  // ordinary day, which is the behaviour we want here anyway.
  const maintenanceOn = await isMaintenanceMode();

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: SITE_URL, lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: `${SITE_URL}/about`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE_URL}/contact`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    ...(maintenanceOn
      ? []
      : [
          {
            url: `${SITE_URL}/catalog`,
            lastModified: now,
            changeFrequency: "weekly" as const,
            priority: 0.7,
          },
        ]),
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

import type { MetadataRoute } from "next";
import { SITE_URL } from "./lib/site";
import { getAllDocuments } from "./lib/documentStore";

// Generated at request time so newly-added documents appear without a rebuild.
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: SITE_URL, lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: `${SITE_URL}/about`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE_URL}/contact`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE_URL}/catalog`, lastModified: now, changeFrequency: "weekly", priority: 0.7 },
  ];

  // IMPORTANT: /showcase and /showcase/{id} are ADMIN-only (blocked in robots.ts),
  // so they must NOT be listed here — a sitemap that points to robots-blocked URLs
  // is exactly what Google Search Console rejects.

  // Public document preview pages (downloadable catalogs shown on /catalog).
  // Best-effort: a DB hiccup must never 500 the sitemap — fall back to the static
  // routes so Google always gets a valid document.
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
    console.error("sitemap: failed to load documents, serving static routes only:", err);
  }

  return [...staticRoutes, ...documentRoutes];
}

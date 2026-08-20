import type { MetadataRoute } from "next";
import { SITE_URL } from "./lib/site";
import { getAllContentsMeta } from "./lib/contentStore";
import { getAllDocuments } from "./lib/documentStore";

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
  // actually rank. (The /showcase LIST itself is blocked in robots and stays out
  // of the sitemap; only the individual content pages belong here.) Each DB read
  // is best-effort: a hiccup falls back to the static routes rather than 500-ing
  // the sitemap (which Google reports as "couldn't fetch").
  let contentRoutes: MetadataRoute.Sitemap = [];
  try {
    const contents = await getAllContentsMeta();
    contentRoutes = contents.map((c) => ({
      url: `${SITE_URL}/showcase/${c.id}`,
      lastModified: c.createdAt ? new Date(c.createdAt) : now,
      changeFrequency: "monthly",
      priority: 0.7,
    }));
  } catch (err) {
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

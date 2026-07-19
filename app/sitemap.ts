import type { MetadataRoute } from "next";
import { SITE_URL } from "./lib/site";
import { getAllContentsMeta } from "./lib/contentStore";

// Generated at request time so newly-added content appears without a rebuild.
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: SITE_URL, lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: `${SITE_URL}/about`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE_URL}/contact`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE_URL}/catalog`, lastModified: now, changeFrequency: "weekly", priority: 0.7 },
    { url: `${SITE_URL}/showcase`, lastModified: now, changeFrequency: "weekly", priority: 0.8 },
  ];

  // Emit the CANONICAL content pages (/showcase/{id}) — the ones that actually
  // rank (full generateMetadata + Article JSON-LD). The old /showcase/product/{id}
  // entries were noindex gateways that 307-redirect, so Search Console flagged
  // every one as "noindex" / "has redirect"; they don't belong in the sitemap.
  const contents = await getAllContentsMeta();
  const contentRoutes: MetadataRoute.Sitemap = contents.map((c) => ({
    url: `${SITE_URL}/showcase/${c.id}`,
    lastModified: c.createdAt ? new Date(c.createdAt) : now,
    changeFrequency: "monthly",
    priority: 0.7,
  }));

  return [...staticRoutes, ...contentRoutes];
}

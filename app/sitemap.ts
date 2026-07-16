import type { MetadataRoute } from "next";
import { SITE_URL } from "./lib/site";
import { getProductsData } from "./lib/getProductsData";

// Generated at request time so newly-added products appear without a rebuild.
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: SITE_URL, lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: `${SITE_URL}/about`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE_URL}/contact`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE_URL}/showcase`, lastModified: now, changeFrequency: "weekly", priority: 0.8 },
  ];

  const { products } = await getProductsData();
  const productRoutes: MetadataRoute.Sitemap = products.map((p) => ({
    url: `${SITE_URL}/showcase/product/${p.id}`,
    lastModified: p.createdAt ? new Date(p.createdAt) : now,
    changeFrequency: "monthly",
    priority: 0.6,
  }));

  return [...staticRoutes, ...productRoutes];
}

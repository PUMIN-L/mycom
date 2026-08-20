import type { MetadataRoute } from "next";
import { SITE_URL } from "./lib/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Keep admin/auth, internal tools, and API endpoints out of the index.
      disallow: [
        "/api/",
        "/login",
        "/create-product",
        "/create-content",
        "/edit-product",
        // /showcase and everything under it (incl. /showcase/{id}) is admin-only —
        // block the whole subtree from crawlers. (This is why it must NOT appear
        // in the sitemap; listing robots-blocked URLs is what Search Console
        // rejected.)
        "/showcase",
        "/customers",
        "/suppliers",
        "/product-specs",
        "/quotation",
        "/billing",
        "/settings",
        "/documents",
      ],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}

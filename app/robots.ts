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
        // Admin Panel hub (moved from /showcase). /showcase/{id} content pages
        // are PUBLIC (in the sitemap, Article JSON-LD) and stay fully crawlable —
        // never add a /showcase rule back here.
        "/adminpanel",
        "/customers",
        "/suppliers",
        "/product-specs",
        "/quotation",
        "/billing",
        "/settings",
        "/documents",
        "/dashboard",
        "/crm",
        "/expenses",
        "/tools",
      ],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}

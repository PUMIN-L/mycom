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

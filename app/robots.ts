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
        // Block ONLY the /showcase content-list page (the `$` anchors to exact) —
        // the /showcase/{id} pages under it are PUBLIC content (viewable by
        // everyone, with Article JSON-LD) and SHOULD be crawled + indexed, so
        // they stay allowed and are listed in the sitemap.
        "/showcase$",
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

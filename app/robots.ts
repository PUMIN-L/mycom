import type { MetadataRoute } from "next";
import { SITE_URL } from "./lib/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      // The one API path crawlers may read: the PDF catalogs, served inline by
      // the proxy (/document/[id] shows them). Their text — product names and
      // specs — is worth indexing, and "/api/" below would block it. The
      // longer, more specific rule wins over "Disallow: /api/" in robots.txt.
      allow: ["/", "/api/documents/proxy"],
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
        "/purchase-order",
        "/billing",
        // ใบ Job (service job sheets). Every path middleware gates must also be
        // listed here — __tests__/robots.test.ts compares the two lists.
        "/service-job",
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

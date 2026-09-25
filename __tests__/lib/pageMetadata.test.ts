// @vitest-environment node
/**
 * Metadata for public pages. Next merges metadata shallowly, so a page without
 * its own `openGraph` shared the HOME page's og:url and og:title — sharing
 * /about on LINE showed the home page — and a page with its own `openGraph`
 * lost the site-wide image. pageMetadata() sets the whole set per page.
 */
import { describe, it, expect, vi } from "vitest";
import { pageMetadata, DEFAULT_OG_IMAGE } from "@/app/lib/pageMetadata";
import { SITE_NAME, SITE_URL } from "@/app/lib/site";

vi.mock("@/app/lib/documentStore", () => ({ getAllDocuments: vi.fn(), getDocument: vi.fn() }));
vi.mock("@/app/lib/companyInfo", () => ({ getCompanyInfo: vi.fn() }));
vi.mock("@/app/lib/settingsStore", () => ({ isMaintenanceMode: vi.fn(async () => false) }));

describe("pageMetadata", () => {
  const meta = pageMetadata({ title: "เกี่ยวกับเรา", description: "รายละเอียด", path: "/about" });

  it("points canonical, og:url and the titles at this page", () => {
    expect(meta.title).toBe("เกี่ยวกับเรา"); // the root template adds the brand to <title>
    expect(meta.description).toBe("รายละเอียด");
    expect(meta.alternates).toEqual({ canonical: "/about" });
    expect(meta.openGraph).toMatchObject({
      url: `${SITE_URL}/about`,
      title: `เกี่ยวกับเรา | ${SITE_NAME}`,
      description: "รายละเอียด",
      siteName: SITE_NAME,
      locale: "th_TH",
      type: "website",
    });
    expect(meta.twitter).toMatchObject({
      card: "summary_large_image",
      title: `เกี่ยวกับเรา | ${SITE_NAME}`,
      description: "รายละเอียด",
    });
  });

  it("carries the site-wide image explicitly, since a page openGraph drops the file-based one", () => {
    expect(meta.openGraph?.images).toEqual([DEFAULT_OG_IMAGE]);
    expect(meta.twitter?.images).toEqual([DEFAULT_OG_IMAGE]);
    expect(DEFAULT_OG_IMAGE).toMatchObject({ url: "/opengraph-image", width: 1200, height: 630 });
  });

  it("uses the page's own image and type when given", () => {
    const article = pageMetadata({
      title: "GM-4",
      description: "d",
      path: "/showcase/abc",
      image: "https://res.cloudinary.com/demo/x.jpg",
      type: "article",
    });
    expect(article.openGraph).toMatchObject({
      type: "article",
      images: [{ url: "https://res.cloudinary.com/demo/x.jpg" }],
    });
  });
});

describe("public pages set their own share metadata", () => {
  it.each([
    ["/about", () => import("@/app/about/page")],
    ["/contact", () => import("@/app/contact/page")],
    ["/catalog", () => import("@/app/catalog/page")],
  ])("%s", async (path, load) => {
    const { metadata } = await load();
    expect(metadata.alternates).toEqual({ canonical: path });
    expect(metadata.openGraph).toMatchObject({ url: `${SITE_URL}${path}` });
    // ≤ 160 characters: Google drops the rest.
    expect([...String(metadata.description)].length).toBeLessThanOrEqual(160);
    // The root template appends the brand; a title that carries it too shows
    // "| Profin Lab Scale | Profin Lab Scale".
    expect(String(metadata.title)).not.toContain(SITE_NAME);
  });
});

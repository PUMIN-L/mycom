/**
 * Bug found via a live Google search result: `/showcase/[id]`'s
 * `generateMetadata` used `content.title` verbatim in `<title>`/OG/Twitter
 * tags. `content.title` is RICH TEXT (`sanitizeRichText`, not plain text —
 * see contentStore.ts) because the on-page heading in ShowcaseClient.tsx
 * renders it with `dangerouslySetInnerHTML` (its rich-text editor always
 * wraps even a plain title in `<p>...</p>`). That's fine for the page's own
 * HTML, but `<title>`/OG/Twitter are plain-text contexts — Google indexed
 * the page as literally `<p>GM-4</p> - Profin Lab Scale`.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@/app/lib/contentStore", () => ({
  getContent: vi.fn(),
  getAllContentsMeta: vi.fn(),
}));
vi.mock("@/app/lib/session", () => ({ getSession: vi.fn() }));
vi.mock("@/app/lib/productStore", () => ({
  getAllProducts: vi.fn(),
  getAllCategories: vi.fn(),
  isProductPublic: vi.fn(),
}));
vi.mock("@/app/lib/companyInfo", () => ({ getCompanyInfo: vi.fn() }));
vi.mock("@/app/showcase/[id]/ShowcaseClient", () => ({ default: () => null }));

import { render } from "@testing-library/react";
import { getContent, getAllContentsMeta } from "@/app/lib/contentStore";
import { getSession } from "@/app/lib/session";
import { getAllProducts, getAllCategories } from "@/app/lib/productStore";
import { getCompanyInfo } from "@/app/lib/companyInfo";
import ShowcaseContentPage, { generateMetadata } from "@/app/showcase/[id]/page";

function contentFixture(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: "c1",
    title: "<p>GM-4</p>",
    blocks: [{ id: "b1", type: "text", content: "GM-4 is strictly based on ASTM D1894." }],
    createdAt: "2026-01-01T00:00:00.000Z",
    productId: null,
    ...over,
  };
}

describe("/showcase/[id] generateMetadata — strips HTML from the rich-text title", () => {
  it("<title>/OG/Twitter never contain raw tags, even though the on-page title is rich text", async () => {
    vi.mocked(getContent).mockResolvedValue(contentFixture() as never);
    vi.mocked(getSession).mockResolvedValue(null as never);

    const metadata = await generateMetadata({ params: Promise.resolve({ id: "c1" }) });

    expect(metadata.title).toBe("GM-4");
    expect(String(metadata.title)).not.toMatch(/[<>]/);
    expect(metadata.openGraph?.title).toBe("GM-4");
    expect(metadata.twitter?.title).toBe("GM-4");
  });

  it("a title that is HTML-only after stripping (e.g. an empty <p></p>) falls back to the site name, never an empty <title>", async () => {
    vi.mocked(getContent).mockResolvedValue(contentFixture({ title: "<p></p>" }) as never);
    vi.mocked(getSession).mockResolvedValue(null as never);

    const metadata = await generateMetadata({ params: Promise.resolve({ id: "c1" }) });

    expect(metadata.title).toBeTruthy();
    expect(String(metadata.title)).not.toMatch(/[<>]/);
  });
});

describe("/showcase/[id] page — JSON-LD structured data also uses the plain-text title", () => {
  it("Article headline and breadcrumb name never contain raw tags", async () => {
    vi.mocked(getContent).mockResolvedValue(contentFixture() as never);
    vi.mocked(getSession).mockResolvedValue(null as never);
    vi.mocked(getAllContentsMeta).mockResolvedValue([] as never);
    vi.mocked(getAllProducts).mockResolvedValue([] as never);
    vi.mocked(getAllCategories).mockResolvedValue([] as never);
    vi.mocked(getCompanyInfo).mockResolvedValue({ email: "", phone: "", address: "" } as never);

    const jsx = await ShowcaseContentPage({ params: Promise.resolve({ id: "c1" }) });
    render(jsx);

    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    expect(scripts.length).toBe(2);
    const [articleLd, breadcrumbLd] = Array.from(scripts).map((s) => JSON.parse(s.innerHTML));
    expect(articleLd.headline).toBe("GM-4");
    expect(breadcrumbLd.itemListElement[1].name).toBe("GM-4");
  });
});

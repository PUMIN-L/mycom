/**
 * What /showcase/[id] adds for search engines beyond its own blocks:
 *  - "สินค้าที่เกี่ยวข้อง" — links to other products' content pages, so a
 *    content page is not reachable through the sitemap alone;
 *  - a link to its product's category page, and that category in the
 *    breadcrumb;
 *  - a <title> that names the product when the content title is only a model
 *    number, and a description read as text.
 * Hidden products must stay out of all of it — this is served to anonymous
 * visitors (and crawlers).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactElement, ReactNode } from "react";
import { Children } from "react";

vi.mock("@/app/lib/contentStore", () => ({
  getContent: vi.fn(),
  getAllContentsMeta: vi.fn(),
}));
vi.mock("@/app/lib/session", () => ({ getSession: vi.fn() }));
vi.mock("@/app/lib/productStore", () => ({
  getAllProducts: vi.fn(),
  getAllCategories: vi.fn(),
  isProductPublic: (p: { isPublished?: boolean; pendingDeleteAt?: string | null }) =>
    p.isPublished !== false && !p.pendingDeleteAt,
}));
vi.mock("@/app/lib/companyInfo", () => ({ getCompanyInfo: vi.fn() }));
vi.mock("@/app/lib/settingsStore", () => ({ isMaintenanceMode: vi.fn(async () => false) }));
vi.mock("@/app/showcase/[id]/ShowcaseClient", () => ({ default: () => null }));

import { getContent, getAllContentsMeta } from "@/app/lib/contentStore";
import { getSession } from "@/app/lib/session";
import { getAllProducts, getAllCategories } from "@/app/lib/productStore";
import { getCompanyInfo } from "@/app/lib/companyInfo";
import ShowcaseContentPage, { generateMetadata } from "@/app/showcase/[id]/page";
import { SITE_URL } from "@/app/lib/site";

function product(id: string, categoryId: number, over: Record<string, unknown> = {}) {
  return {
    id,
    categoryId,
    image: `https://res.cloudinary.com/demo/${id}.jpg`,
    title_th: `<p>สินค้า ${id}</p>`,
    title_en: `<p>Product ${id}</p>`,
    title_zh: "",
    desc_th: `<p>รายละเอียด ${id} &amp; อื่นๆ</p>`,
    desc_en: "",
    desc_zh: "",
    createdAt: "2026-01-01",
    isPublished: true,
    pendingDeleteAt: null,
    ...over,
  };
}

const params = { params: Promise.resolve({ id: "c-self" }) };

async function rendered() {
  const jsx = (await ShowcaseContentPage(params)) as ReactElement<{ children: ReactNode }>;
  const children = Children.toArray(jsx.props.children) as ReactElement<Record<string, unknown>>[];
  const client = children.find((c) => "initialProducts" in c.props)!;
  const jsonLd = children
    .filter((c) => c.type === "script")
    .map((c) => JSON.parse((c.props.dangerouslySetInnerHTML as { __html: string }).__html));
  return { props: client.props, jsonLd };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSession).mockResolvedValue(null as never);
  vi.mocked(getContent).mockResolvedValue({
    id: "c-self",
    title: "<p>GM-4</p>",
    blocks: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    productId: "self",
  } as never);
  vi.mocked(getAllProducts).mockResolvedValue([
    product("self", 1),
    product("same", 1),
    product("hidden", 1, { isPublished: false }),
    product("doomed", 1, { pendingDeleteAt: "2026-02-01" }),
    product("other", 2),
    product("no-page", 2),
  ] as never);
  vi.mocked(getAllContentsMeta).mockResolvedValue([
    { id: "c-self", title: "", createdAt: "", productId: "self" },
    { id: "c-same", title: "", createdAt: "", productId: "same" },
    { id: "c-hidden", title: "", createdAt: "", productId: "hidden" },
    { id: "c-doomed", title: "", createdAt: "", productId: "doomed" },
    { id: "c-other", title: "", createdAt: "", productId: "other" },
  ] as never);
  vi.mocked(getAllCategories).mockResolvedValue([
    { id: 1, name_th: "<p>เครื่องวัดความเงา</p>", name_en: "<p>Gloss Meters</p>", name_zh: "", sortOrder: 0 },
    { id: 2, name_th: "อื่นๆ", name_en: "Others", name_zh: "", sortOrder: 1 },
  ] as never);
  vi.mocked(getCompanyInfo).mockResolvedValue({ email: "", phone: "", address: "" } as never);
});

describe("/showcase/[id] — related products", () => {
  it("links other public products' content pages, same category first", async () => {
    const { props } = await rendered();
    const items = props.relatedItems as { contentId: string }[];
    expect(items.map((i) => i.contentId)).toEqual(["c-same", "c-other"]);
  });

  it("never lists a hidden or pending-delete product — not even for an admin", async () => {
    vi.mocked(getSession).mockResolvedValue({ userId: "1" } as never);
    const { props } = await rendered();
    const serialized = JSON.stringify(props.relatedItems);
    expect(serialized).not.toContain("c-hidden");
    expect(serialized).not.toContain("c-doomed");
  });

  it("ships only the fields a card shows", async () => {
    const { props } = await rendered();
    for (const item of props.relatedItems as Record<string, unknown>[]) {
      expect(Object.keys(item).sort()).toEqual(["contentId", "image", "title_en", "title_th", "title_zh"]);
    }
  });

  it("links the product's category page, and puts it in the breadcrumb", async () => {
    const { props, jsonLd } = await rendered();
    expect(props.relatedCategory).toEqual({
      path: "/products/1-gloss-meters",
      name_th: "<p>เครื่องวัดความเงา</p>",
      name_en: "<p>Gloss Meters</p>",
      name_zh: "",
    });
    const breadcrumb = jsonLd.find((j) => j["@type"] === "BreadcrumbList");
    expect(breadcrumb.itemListElement.map((c: { name: string }) => c.name)).toEqual([
      "Home",
      "เครื่องวัดความเงา",
      "GM-4",
    ]);
    expect(breadcrumb.itemListElement[1].item).toBe(`${SITE_URL}/products/1-gloss-meters`);
  });

  it("has no category link when the content's product is hidden (an admin viewing it)", async () => {
    vi.mocked(getSession).mockResolvedValue({ userId: "1" } as never);
    vi.mocked(getContent).mockResolvedValue({
      id: "c-hidden",
      title: "<p>X</p>",
      blocks: [],
      createdAt: "2026-01-01",
      productId: "hidden",
    } as never);
    const { props } = await rendered();
    expect(props.relatedCategory).toBeNull();
  });
});

describe("/showcase/[id] — metadata", () => {
  it("names the product in the title when the content title is a model number", async () => {
    const metadata = await generateMetadata(params);
    expect(metadata.title).toBe("GM-4 – สินค้า self (Product self)");
  });

  it("falls back to the product's description as text when the blocks have none", async () => {
    const metadata = await generateMetadata(params);
    expect(metadata.description).toBe("รายละเอียด self & อื่นๆ");
  });

  it("reads block HTML as text in the description — no tags or entities", async () => {
    vi.mocked(getContent).mockResolvedValue({
      id: "c-self",
      title: "<p>GM-4</p>",
      blocks: [{ id: "b", type: "text", content: "<p>Gloss &amp; <strong>haze</strong></p><p>ASTM D523</p>" }],
      createdAt: "2026-01-01",
      productId: "self",
    } as never);
    const metadata = await generateMetadata(params);
    expect(metadata.description).toBe("Gloss & haze ASTM D523");
  });

  it("keeps a long description within 160 characters, cut at a word", async () => {
    vi.mocked(getContent).mockResolvedValue({
      id: "c-self",
      title: "<p>GM-4</p>",
      blocks: [{ id: "b", type: "text", content: `<p>${"word ".repeat(80)}</p>` }],
      createdAt: "2026-01-01",
      productId: "self",
    } as never);
    const description = String((await generateMetadata(params)).description);
    expect([...description].length).toBeLessThanOrEqual(160);
    expect(description.endsWith("word…")).toBe(true);
  });

  it("carries the site-wide share image when the content has none", async () => {
    const metadata = await generateMetadata(params);
    expect(metadata.openGraph?.images).toEqual([expect.objectContaining({ url: "/opengraph-image" })]);
  });

  it("does not read products for a content with no product", async () => {
    vi.mocked(getContent).mockResolvedValue({
      id: "c-free",
      title: "<p>Guide</p>",
      blocks: [],
      createdAt: "2026-01-01",
      productId: null,
    } as never);
    const metadata = await generateMetadata(params);
    expect(metadata.title).toBe("Guide");
    expect(getAllProducts).not.toHaveBeenCalled();
  });
});

describe("/showcase/[id] — Article dates", () => {
  it("reports when the content last changed as dateModified", async () => {
    vi.mocked(getContent).mockResolvedValue({
      id: "c-self",
      title: "<p>GM-4</p>",
      blocks: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-06-15T08:00:00.000Z",
      productId: "self",
    } as never);
    const { jsonLd } = await rendered();
    const article = jsonLd.find((j) => j["@type"] === "Article");
    expect(article.datePublished).toBe("2026-01-01T00:00:00.000Z");
    expect(article.dateModified).toBe("2026-06-15T08:00:00.000Z");
  });

  it("falls back to the publish date for a content not edited since updatedAt existed", async () => {
    const { jsonLd } = await rendered();
    const article = jsonLd.find((j) => j["@type"] === "Article");
    expect(article.dateModified).toBe("2026-01-01T00:00:00.000Z");
  });
});

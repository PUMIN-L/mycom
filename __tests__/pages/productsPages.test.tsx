/**
 * /products and /products/[slug] — the crawlable catalog. Every public
 * product one link from the site's navigation, and one page per category
 * aimed at what people search for. Hidden products must never appear: these
 * pages are for anonymous visitors and crawlers.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactElement, ReactNode } from "react";
import { Children } from "react";

class NotFound extends Error {}
class Redirect extends Error {
  constructor(public to: string) {
    super(to);
  }
}
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new NotFound();
  },
  permanentRedirect: (to: string) => {
    throw new Redirect(to);
  },
}));
vi.mock("@/app/lib/getProductsData", () => ({ getProductsData: vi.fn() }));
vi.mock("@/app/lib/companyInfo", () => ({ getCompanyInfo: vi.fn(async () => ({ email: "", phone: "", address: "" })) }));
vi.mock("@/app/lib/settingsStore", () => ({ isMaintenanceMode: vi.fn(async () => false) }));
vi.mock("@/app/components/ProductCatalogView", () => ({ default: () => null }));
vi.mock("@/app/components/Navbar", () => ({ default: () => null }));
vi.mock("@/app/components/Footer", () => ({ default: () => null }));

import { getProductsData } from "@/app/lib/getProductsData";
import ProductsPage, { metadata as productsMetadata } from "@/app/products/page";
import CategoryPage, {
  generateMetadata as categoryMetadata,
  generateStaticParams,
} from "@/app/products/[slug]/page";
import { SITE_URL } from "@/app/lib/site";

const product = (id: string, categoryId: number) => ({
  id,
  categoryId,
  image: `/${id}.png`,
  title_th: `<p>สินค้า ${id}</p>`,
  title_en: `<p>Product ${id}</p>`,
  title_zh: "",
  desc_th: "<p>รายละเอียด</p>",
  desc_en: "",
  desc_zh: "",
  createdAt: "2026-01-01",
});

beforeEach(() => {
  vi.clearAllMocks();
  // getProductsData already returns PUBLIC products only.
  vi.mocked(getProductsData).mockResolvedValue({
    categories: [
      { id: 1, name_th: "<p>เครื่องวัดความเงา</p>", name_en: "<p>Gloss Meters</p>", name_zh: "", sortOrder: 0 },
      { id: 2, name_th: "เครื่องชั่ง", name_en: "Balances", name_zh: "", sortOrder: 1 },
      { id: 3, name_th: "ว่าง", name_en: "Empty", name_zh: "", sortOrder: 2 },
    ],
    products: [product("g1", 1), product("b1", 2), product("g2", 1)],
    contentIdByProduct: { g1: "c-g1" },
  } as never);
});

type Props = Record<string, unknown>;
function parts(jsx: unknown) {
  const children = Children.toArray((jsx as ReactElement<{ children: ReactNode }>).props.children) as ReactElement<Props>[];
  const main = children.find((c) => c.type === "main")!;
  const view = (main.props.children as ReactElement<Props>).props;
  const jsonLd = children
    .filter((c) => c.type === "script")
    .map((c) => JSON.parse((c.props.dangerouslySetInnerHTML as { __html: string }).__html));
  return { view, jsonLd };
}

const slugParams = (slug: string) => ({ params: Promise.resolve({ slug }) });

describe("/products", () => {
  it("lists every category that has products, with its products and the content map", async () => {
    const { view } = parts(await ProductsPage());
    const sections = view.sections as { id: number; path: string; products: { id: string }[] }[];
    expect(view.mode).toBe("all");
    expect(sections.map((s) => [s.path, s.products.map((p) => p.id)])).toEqual([
      ["/products/1-gloss-meters", ["g1", "g2"]],
      ["/products/2-balances", ["b1"]],
    ]);
    expect(view.contentIdByProduct).toEqual({ g1: "c-g1" });
  });

  it("has its own canonical, share tags and a short description", () => {
    expect(productsMetadata.alternates).toEqual({ canonical: "/products" });
    expect(productsMetadata.openGraph).toMatchObject({ url: `${SITE_URL}/products` });
    expect([...String(productsMetadata.description)].length).toBeLessThanOrEqual(160);
  });
});

describe("/products/[slug]", () => {
  it("renders one category, and links the others", async () => {
    const { view, jsonLd } = parts(await CategoryPage(slugParams("1-gloss-meters")));
    const [section] = view.sections as { name_th: string; products: { id: string; title_th: string }[] }[];
    expect(view.mode).toBe("category");
    expect(section.name_th).toBe("เครื่องวัดความเงา");
    expect(section.products.map((p) => p.id)).toEqual(["g1", "g2"]);
    expect(section.products[0].title_th).toBe("สินค้า g1"); // plain text, not rich
    expect((view.otherCategories as { path: string }[]).map((c) => c.path)).toEqual(["/products/2-balances"]);
    const crumbs = jsonLd[0].itemListElement.map((c: { name: string }) => c.name);
    expect(crumbs).toEqual(["Home", "สินค้าทั้งหมด", "เครื่องวัดความเงา (Gloss Meters)"]);
  });

  it("moves an old slug or a bare id to the current slug, permanently", async () => {
    await expect(CategoryPage(slugParams("1-old-name"))).rejects.toMatchObject({ to: "/products/1-gloss-meters" });
    await expect(CategoryPage(slugParams("1"))).rejects.toMatchObject({ to: "/products/1-gloss-meters" });
  });

  it.each([
    ["an unknown id", "99-nothing"],
    ["a category with no public products", "3-empty"],
    ["a slug with no id", "gloss-meters"],
  ])("404s for %s", async (_label, slug) => {
    await expect(CategoryPage(slugParams(slug))).rejects.toBeInstanceOf(NotFound);
  });

  it("titles the page with both names and describes it within 160 characters", async () => {
    const metadata = await categoryMetadata(slugParams("1-gloss-meters"));
    expect(metadata.title).toBe("เครื่องวัดความเงา (Gloss Meters)");
    expect(metadata.alternates).toEqual({ canonical: "/products/1-gloss-meters" });
    expect(String(metadata.description)).toContain("2 รายการ");
    expect([...String(metadata.description)].length).toBeLessThanOrEqual(160);
  });

  it("marks a missing category noindex in its metadata", async () => {
    const metadata = await categoryMetadata(slugParams("3-empty"));
    expect(metadata.robots).toMatchObject({ index: false });
  });

  it("builds nothing at deploy time (no database needed for the build)", async () => {
    expect(await generateStaticParams()).toEqual([]);
  });
});

/**
 * What /showcase/[id] ships to the browser. ShowcaseClient reads only a
 * product's id, category and three titles (the product badge, and the
 * edit-mode picker) — but the page used to pass full product rows, so every
 * product's three-language description, image and flags were serialized into
 * every one of these pages: ~55 KB of JSON per view at 85 products, measured
 * on the live site, the bulk of the page.
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
  // The real rule, so this file tracks a change to it.
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
import ShowcaseContentPage from "@/app/showcase/[id]/page";

function productRow(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    categoryId: 1,
    image: `https://res.cloudinary.com/demo/${id}.jpg`,
    title_th: `<p>สินค้า ${id}</p>`,
    title_en: `<p>Product ${id}</p>`,
    title_zh: `<p>产品 ${id}</p>`,
    desc_th: "<p>รายละเอียดยาวมาก</p>".repeat(20),
    desc_en: "<p>A long description</p>".repeat(20),
    desc_zh: "<p>很长的描述</p>".repeat(20),
    createdAt: "2026-01-01T00:00:00.000Z",
    isPublished: true,
    sortOrder: 0,
    bestSellerRank: null,
    showBestSellerBadge: true,
    pendingDeleteAt: null,
    ...over,
  };
}

const LINKED = productRow("p-linked");
const OTHER = productRow("p-other");
const HIDDEN = productRow("p-hidden", { isPublished: false });

/** The props page.tsx hands to ShowcaseClient. */
async function clientProps(): Promise<Record<string, unknown>> {
  const jsx = (await ShowcaseContentPage({ params: Promise.resolve({ id: "c1" }) })) as ReactElement<{
    children: ReactNode;
  }>;
  const child = Children.toArray(jsx.props.children).find(
    (c) => typeof c === "object" && c !== null && "props" in c && "initialProducts" in (c as ReactElement<object>).props
  ) as ReactElement<Record<string, unknown>>;
  return child.props;
}

beforeEach(() => {
  vi.mocked(getContent).mockResolvedValue({
    id: "c1",
    title: "<p>GM-4</p>",
    blocks: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    productId: "p-linked",
  } as never);
  vi.mocked(getAllContentsMeta).mockResolvedValue([] as never);
  vi.mocked(getAllProducts).mockResolvedValue([LINKED, OTHER, HIDDEN] as never);
  vi.mocked(getAllCategories).mockResolvedValue([
    { id: 1, name_th: "หมวด", name_en: "Cat", name_zh: "类", sortOrder: 0 },
  ] as never);
  vi.mocked(getCompanyInfo).mockResolvedValue({ email: "", phone: "", address: "" } as never);
});

const PRODUCT_FIELDS = ["categoryId", "id", "title_en", "title_th", "title_zh"];

describe("/showcase/[id] — product data shipped to the page", () => {
  it("a visitor gets only id, category and titles — no descriptions, images or flags", async () => {
    vi.mocked(getSession).mockResolvedValue(null as never);
    const props = await clientProps();
    const products = props.initialProducts as Record<string, unknown>[];

    for (const p of products) expect(Object.keys(p).sort()).toEqual(PRODUCT_FIELDS);
    expect(products.find((p) => p.id === "p-linked")).toEqual({
      id: "p-linked",
      categoryId: 1,
      title_th: "<p>สินค้า p-linked</p>",
      title_en: "<p>Product p-linked</p>",
      title_zh: "<p>产品 p-linked</p>",
    });
    const serialized = JSON.stringify(props.initialProducts);
    expect(serialized).not.toContain("desc_");
    expect(serialized).not.toContain("cloudinary");
  });

  it("still hides unpublished products from a visitor", async () => {
    vi.mocked(getSession).mockResolvedValue(null as never);
    const ids = (await clientProps()).initialProducts as { id: string }[];
    expect(ids.map((p) => p.id)).toEqual(["p-linked", "p-other"]);
  });

  it("an admin still gets every product for the edit-mode picker, trimmed the same way", async () => {
    vi.mocked(getSession).mockResolvedValue({ userId: "1" } as never);
    const products = (await clientProps()).initialProducts as Record<string, unknown>[];
    expect(products.map((p) => p.id)).toEqual(["p-linked", "p-other", "p-hidden"]);
    for (const p of products) expect(Object.keys(p).sort()).toEqual(PRODUCT_FIELDS);
  });

  it("categories carry only what the picker reads", async () => {
    vi.mocked(getSession).mockResolvedValue(null as never);
    const cats = (await clientProps()).initialCategories as Record<string, unknown>[];
    expect(cats).toEqual([{ id: 1, name_th: "หมวด", name_en: "Cat", name_zh: "类" }]);
  });
});

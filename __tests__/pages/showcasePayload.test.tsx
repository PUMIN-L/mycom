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
import { draftMode } from "next/headers";
import { notFound } from "next/navigation";
import ShowcaseContentPage, { generateMetadata, revalidate } from "@/app/showcase/[id]/page";
import fs from "fs";
import path from "path";

/** The browser asking: Draft Mode on (a logged-in admin, see session.ts) or off. */
function asked({ draft }: { draft: boolean }) {
  vi.mocked(draftMode).mockResolvedValue({ isEnabled: draft, enable: vi.fn(), disable: vi.fn() } as never);
}

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
  asked({ draft: false });
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

  it("an admin (in Draft Mode) still gets every product for the edit-mode picker, trimmed the same way", async () => {
    asked({ draft: true });
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

// The page is CACHED (ISR) for visitors — it used to be force-dynamic, a
// server render on every view that no CDN could hold. What only an admin may
// see is rendered in Draft Mode alone, so the cached copy can never depend on
// who asked: outside Draft Mode the session is not even read.
describe("/showcase/[id] — cached for visitors, fresh for an admin", () => {
  it("is ISR (revalidated), not force-dynamic", () => {
    expect(revalidate).toBe(60);
    const src = fs.readFileSync(path.resolve(__dirname, "../../app/showcase/[id]/page.tsx"), "utf8");
    expect(src).not.toMatch(/export const dynamic\s*=/);
  });

  it("outside Draft Mode it never reads the session — even a logged-in admin gets the visitor's copy", async () => {
    asked({ draft: false });
    vi.mocked(getSession).mockClear().mockResolvedValue({ userId: "1" } as never);
    const ids = ((await clientProps()).initialProducts as { id: string }[]).map((p) => p.id);
    expect(ids).toEqual(["p-linked", "p-other"]);
    await generateMetadata({ params: Promise.resolve({ id: "c1" }) });
    expect(getSession).not.toHaveBeenCalled();
  });

  it("a hidden product's page is a 404 for the cached copy, and renders for an admin in Draft Mode", async () => {
    vi.mocked(getContent).mockResolvedValue({
      id: "c-hidden", title: "<p>X</p>", blocks: [], createdAt: "2026-01-01T00:00:00.000Z", productId: "p-hidden",
    } as never);
    // notFound() is a bare spy in the test setup (it throws in Next).
    vi.mocked(notFound).mockClear();
    asked({ draft: false });
    vi.mocked(getSession).mockResolvedValue({ userId: "1" } as never); // a session, but not asked in Draft Mode
    await ShowcaseContentPage({ params: Promise.resolve({ id: "c-hidden" }) });
    expect(notFound).toHaveBeenCalled();
    const meta = await generateMetadata({ params: Promise.resolve({ id: "c-hidden" }) });
    expect(meta.robots).toMatchObject({ index: false });

    vi.mocked(notFound).mockClear();
    asked({ draft: true });
    await ShowcaseContentPage({ params: Promise.resolve({ id: "c-hidden" }) });
    expect(notFound).not.toHaveBeenCalled();
    const adminMeta = await generateMetadata({ params: Promise.resolve({ id: "c-hidden" }) });
    expect(adminMeta.robots).not.toMatchObject({ index: false, follow: false });
  });

  it("Draft Mode without a live session is still the visitor's view", async () => {
    asked({ draft: true });
    vi.mocked(getSession).mockResolvedValue(null as never);
    const ids = ((await clientProps()).initialProducts as { id: string }[]).map((p) => p.id);
    expect(ids).toEqual(["p-linked", "p-other"]);
  });
});

// ShowcaseClient seeds its state from these props once: the re-render that
// swaps the visitor's copy for the admin's must give it a new component.
describe("/showcase/[id] — which copy ShowcaseClient was given", () => {
  async function clientElement() {
    const jsx = (await ShowcaseContentPage({ params: Promise.resolve({ id: "c1" }) })) as ReactElement<{
      children: ReactNode;
    }>;
    return Children.toArray(jsx.props.children).find(
      (c) => typeof c === "object" && c !== null && "props" in c && "adminView" in (c as ReactElement<object>).props
    ) as ReactElement<{ adminView: boolean }>;
  }

  it("is keyed on the copy, and told which one it is", async () => {
    asked({ draft: false });
    const visitor = await clientElement();
    expect(visitor.props.adminView).toBe(false);

    asked({ draft: true });
    vi.mocked(getSession).mockResolvedValue({ userId: "1" } as never);
    const admin = await clientElement();
    expect(admin.props.adminView).toBe(true);

    expect(String(admin.key)).not.toBe(String(visitor.key));
  });
});

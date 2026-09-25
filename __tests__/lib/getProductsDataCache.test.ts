// @vitest-environment node
/**
 * A failed catalog read must never be CACHED. The catalog's cache entry has no
 * revalidate window (only the "products" tag), so a stored fallback would pin
 * an empty catalog — and with it the home grid, /products and the sitemap's
 * category pages — until someone happened to edit a product.
 *
 * unstable_cache stores only what resolves; this fake does the same, so a
 * cached-failure regression shows up as a second call that never retries.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const store = new Map<string, unknown>();
vi.mock("next/cache", () => ({
  unstable_cache:
    (fn: () => Promise<unknown>, keys: string[]) =>
    async () => {
      const key = keys.join("|");
      if (store.has(key)) return store.get(key);
      const value = await fn(); // a rejection propagates and stores nothing
      store.set(key, value);
      return value;
    },
}));
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual, cache: (fn: unknown) => fn };
});
vi.mock("@/app/lib/productStore", () => ({
  getAllCategories: vi.fn(),
  getAllProducts: vi.fn(),
  isProductPublic: (p: { isPublished?: boolean; pendingDeleteAt?: string | null }) =>
    p.isPublished !== false && !p.pendingDeleteAt,
}));
vi.mock("@/app/lib/contentStore", () => ({ getAllContentsMeta: vi.fn() }));

import { getAllCategories, getAllProducts } from "@/app/lib/productStore";
import { getAllContentsMeta } from "@/app/lib/contentStore";
import { getProductsData } from "@/app/lib/getProductsData";

beforeEach(() => {
  vi.clearAllMocks();
  store.clear();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(getAllContentsMeta).mockResolvedValue([]);
});

describe("getProductsData — failures are not cached", () => {
  it("retries the database on the next request after a failed read", async () => {
    vi.mocked(getAllCategories).mockRejectedValueOnce(new Error("ECONNRESET"));
    vi.mocked(getAllProducts).mockResolvedValue([{ id: "p1", categoryId: 1 }] as never);

    expect((await getProductsData()).products).toEqual([]); // degraded, this request only

    vi.mocked(getAllCategories).mockResolvedValue([{ id: 1, name_th: "", name_en: "", name_zh: "", sortOrder: 0 }]);
    const second = await getProductsData();
    expect(second.products.map((p) => p.id)).toEqual(["p1"]);
    expect(getAllCategories).toHaveBeenCalledTimes(2);
  });

  it("serves a successful read from the cache", async () => {
    vi.mocked(getAllCategories).mockResolvedValue([]);
    vi.mocked(getAllProducts).mockResolvedValue([]);

    await getProductsData();
    await getProductsData();
    expect(getAllProducts).toHaveBeenCalledTimes(1);
  });

  it("keeps the catalog when only the content read fails, and picks the links up next time", async () => {
    vi.mocked(getAllCategories).mockResolvedValue([]);
    vi.mocked(getAllProducts).mockResolvedValue([{ id: "p1", categoryId: 1 }] as never);
    vi.mocked(getAllContentsMeta).mockRejectedValueOnce(new Error("ECONNRESET"));

    const first = await getProductsData();
    expect(first.products).toHaveLength(1);
    expect(first.contentIdByProduct).toEqual({});

    vi.mocked(getAllContentsMeta).mockResolvedValue([
      { id: "c1", title: "", createdAt: "", productId: "p1" },
    ]);
    expect((await getProductsData()).contentIdByProduct).toEqual({ p1: "c1" });
  });
});

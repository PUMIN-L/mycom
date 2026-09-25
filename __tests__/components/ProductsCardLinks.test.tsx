/**
 * Where a homepage product card links. It used to always be the gateway
 * /showcase/product/{id}, which 307-redirects to the content page — so every
 * product link on the site was a redirect hop. Now a card links straight to
 * /showcase/{contentId} when the product has a content page, and to the
 * gateway (its "no information yet" page) only when it has none.
 */
import { render, cleanup, waitFor, act } from "@testing-library/react";
import { Suspense } from "react";
import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/app/context/AuthContext", () => ({
  useAuth: () => ({ isLoggedIn: false }),
}));

import Products from "@/app/components/Products";
import type { ProductData, ProductCategory } from "@/app/lib/types";

afterEach(() => {
  cleanup();
});

function product(id: string): ProductData {
  return {
    id,
    categoryId: 1,
    image: "/img.png",
    title_th: `<p>สินค้า ${id}</p>`,
    title_en: "",
    title_zh: "",
    desc_th: "<p>รายละเอียด</p>",
    desc_en: "",
    desc_zh: "",
    createdAt: "2026-01-01",
    isPublished: true,
  };
}

const categories: ProductCategory[] = [
  { id: 1, name_th: "เครื่องชั่ง", name_en: "Scales", name_zh: "秤", sortOrder: 0 },
];

async function renderGrid(contentIdByProduct?: Record<string, string>) {
  const dataPromise = Promise.resolve({
    categories,
    products: [product("p-with"), product("p-without")],
    contentIdByProduct,
  });
  let container!: HTMLElement;
  await act(async () => {
    ({ container } = render(
      <Suspense fallback={null}>
        <Products dataPromise={dataPromise} />
      </Suspense>
    ));
    await dataPromise;
  });
  await waitFor(() => expect(container.textContent).toContain("View Details"));
  return container;
}

const cardHrefs = (container: HTMLElement) =>
  Array.from(container.querySelectorAll("a[href^='/showcase']")).map((a) => a.getAttribute("href"));

describe("Products grid card — link target", () => {
  it("links a product with a content page straight to it, the rest to the gateway", async () => {
    const container = await renderGrid({ "p-with": "c-1" });
    expect(cardHrefs(container)).toEqual(["/showcase/c-1", "/showcase/product/p-without"]);
  });

  it("falls back to the gateway for every card when there is no map", async () => {
    const container = await renderGrid(undefined);
    expect(cardHrefs(container)).toEqual(["/showcase/product/p-with", "/showcase/product/p-without"]);
  });
});

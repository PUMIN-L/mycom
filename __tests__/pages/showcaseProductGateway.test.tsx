/**
 * /showcase/product/[productId] for a product with no content yet. Its title
 * is rich text and used to be printed as a string — "<p>…</p>", tags and all.
 * The productId fallback (a hidden product) comes from the URL, so it must stay
 * a text node, never HTML.
 */
import { render, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/app/lib/contentStore", () => ({ getContentByProductId: vi.fn(async () => null) }));
const getProduct = vi.fn();
vi.mock("@/app/lib/productStore", () => ({
  getProduct: (...args: unknown[]) => getProduct(...args),
  isProductPublic: (p: { isPublished?: boolean }) => p.isPublished !== false,
}));
const getSession = vi.fn();
vi.mock("@/app/lib/session", () => ({ getSession: () => getSession() }));

import ProductContentGateway from "@/app/showcase/product/[productId]/page";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function renderGateway(productId: string) {
  return render(await ProductContentGateway({ params: Promise.resolve({ productId }) }));
}

describe("product gateway — the product's title", () => {
  it("shows a visible product's rich title as text, not as its tags", async () => {
    getSession.mockResolvedValue(null);
    getProduct.mockResolvedValue({ id: "p1", title_th: "<p>ตู้อบ &amp; เตา</p><p>รุ่น X</p>", isPublished: true });
    const { container } = await renderGateway("p1");
    const title = container.querySelector(".rich-text") as HTMLElement;
    expect(title.innerHTML).toBe("ตู้อบ &amp; เตา<br>รุ่น X");
    expect(container.textContent).not.toContain("<p>");
  });

  it("prints the productId from the URL as text — markup in it never becomes HTML", async () => {
    getSession.mockResolvedValue(null);
    getProduct.mockResolvedValue(undefined);
    const evil = '<img src=x onerror="alert(1)">';
    const { container } = await renderGateway(evil);
    expect(container.querySelector("img[src='x']")).toBeNull();
    expect(container.textContent).toContain(evil);
  });
});

/**
 * The catalog pages' body: every product a crawlable link — straight to its
 * content page when it has one — and every category a link to its page.
 */
import { render, cleanup, screen } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/app/i18n/LanguageContext", () => ({
  useLanguage: () => ({ lang: "th", setLang: vi.fn() }),
  useT: () => (o: { th: string } | undefined) => o?.th ?? "",
}));

import ProductCatalogView from "@/app/components/ProductCatalogView";
import type { CatalogSection } from "@/app/lib/catalogPages";

afterEach(cleanup);

const section = (id: number, path: string, name_th: string, name_en: string, ids: string[]): CatalogSection => ({
  id,
  path,
  name_th,
  name_en,
  name_zh: "",
  products: ids.map((pid) => ({
    id: pid,
    image: `/${pid}.png`,
    title_th: `สินค้า ${pid}`,
    title_en: `Product ${pid}`,
    title_zh: "",
    desc_th: `รายละเอียด ${pid}`,
    desc_en: "",
    desc_zh: "",
  })),
});

const gloss = section(1, "/products/1-gloss-meters", "เครื่องวัดความเงา", "Gloss Meters", ["g1", "g2"]);
const balances = section(2, "/products/2-balances", "เครื่องชั่ง", "Balances", ["b1"]);

describe("ProductCatalogView — /products", () => {
  it("heads each category with a link to its page, and links every product", () => {
    render(<ProductCatalogView mode="all" sections={[gloss, balances]} contentIdByProduct={{ g1: "c-g1" }} />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("เครื่องมือวัดและเครื่องทดสอบทั้งหมด");
    const h2 = screen.getAllByRole("heading", { level: 2 }).map((h) => [h.textContent, h.querySelector("a")?.getAttribute("href")]);
    expect(h2).toEqual([
      ["เครื่องวัดความเงา", "/products/1-gloss-meters"],
      ["เครื่องชั่ง", "/products/2-balances"],
    ]);
    const productLinks = screen.getAllByRole("heading", { level: 3 }).map((h) => h.closest("a")?.getAttribute("href"));
    expect(productLinks).toEqual(["/showcase/c-g1", "/showcase/product/g2", "/showcase/product/b1"]);
  });

  it("shows each product's English name under the Thai one", () => {
    render(<ProductCatalogView mode="all" sections={[balances]} contentIdByProduct={{}} />);
    expect(screen.getByText("สินค้า b1")).toBeDefined();
    expect(screen.getByText("Product b1")).toBeDefined();
  });
});

describe("ProductCatalogView — a category page", () => {
  it("heads the page with the category, English name below, and links the other categories", () => {
    render(
      <ProductCatalogView
        mode="category"
        sections={[gloss]}
        otherCategories={[{ id: 2, path: "/products/2-balances", name_th: "เครื่องชั่ง", name_en: "Balances", name_zh: "" }]}
        contentIdByProduct={{}}
      />
    );
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("เครื่องวัดความเงา");
    expect(screen.getByText("Gloss Meters")).toBeDefined();
    // Product titles are the next level down under the page's h1.
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toContain("สินค้า g1");
    expect(screen.getByRole("link", { name: "เครื่องชั่ง" }).getAttribute("href")).toBe("/products/2-balances");
    const crumbs = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(crumbs.querySelector("a[href='/products']")).not.toBeNull();
  });
});

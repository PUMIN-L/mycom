/**
 * The public view of a /showcase content page, beyond its blocks:
 *  - "สินค้าที่เกี่ยวข้อง": crawlable links to other products' content pages,
 *    and to the product's category page;
 *  - the product's English name beside the Thai one in the badge;
 *  - image alt text that says what the page is about, not "Content".
 */
import { render, cleanup, screen } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";

let isLoggedIn = false;
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
  usePathname: () => "/showcase/c1",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/app/context/AuthContext", () => ({
  useAuth: () => ({ isLoggedIn }),
}));
vi.mock("@/app/i18n/LanguageContext", () => ({
  useLanguage: () => ({ lang: "th", setLang: vi.fn() }),
  useT: () => (o: { th: string } | undefined) => o?.th ?? "",
}));
vi.mock("@/app/components/Navbar", () => ({ default: () => null }));
vi.mock("@/app/components/Footer", () => ({ default: () => null }));

import ShowcaseClient, { type RelatedItem } from "@/app/showcase/[id]/ShowcaseClient";
import type { ContentBlock } from "@/app/lib/types";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  isLoggedIn = false;
});

const related: RelatedItem[] = [
  {
    contentId: "c-2",
    image: "/images/a.png",
    title_th: "<p>เครื่องวัดสี</p>",
    title_en: "<p>Colorimeter</p>",
    title_zh: "",
  },
  { contentId: "c-3", image: "", title_th: "<p>ตู้อบ &amp; เตา</p>", title_en: "", title_zh: "" },
];

function renderPage({
  blocks = [] as ContentBlock[],
  relatedItems = related,
  withCategory = true,
} = {}) {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }) as unknown as Response));
  return render(
    <ShowcaseClient
      initialContent={{ id: "c1", title: "<p>GM-4</p>", blocks, createdAt: "2026-09-01", productId: "p1" }}
      initialAllContents={[]}
      initialProducts={[
        { id: "p1", categoryId: 1, title_th: "<p>เครื่องวัดความเงา</p>", title_en: "<p>Gloss Meter</p>", title_zh: "" },
      ]}
      initialCategories={[]}
      relatedItems={relatedItems}
      relatedCategory={
        withCategory
          ? { path: "/products/1-gloss-meters", name_th: "<p>เครื่องวัดความเงา</p>", name_en: "Gloss Meters", name_zh: "" }
          : null
      }
      companyInfo={{ email: "x@y.z", phone: "0", address: "ที่อยู่" }}
      maintenanceOn={false}
    />
  );
}

describe("ShowcaseClient — related products", () => {
  it("links each related product to its content page, with its names as text", () => {
    renderPage();
    const section = screen.getByRole("region", { name: "สินค้าที่เกี่ยวข้อง" });
    const links = Array.from(section.querySelectorAll("a")).map((a) => [a.getAttribute("href"), a.textContent]);
    expect(links).toEqual([
      ["/showcase/c-2", "เครื่องวัดสีColorimeter"],
      ["/showcase/c-3", "ตู้อบ & เตา"],
      ["/products/1-gloss-meters", "ดูสินค้าทั้งหมดในหมวด เครื่องวัดความเงา →"],
    ]);
  });

  it("renders no section when there is nothing to link", () => {
    renderPage({ relatedItems: [] });
    expect(screen.queryByRole("region", { name: "สินค้าที่เกี่ยวข้อง" })).toBeNull();
  });

  it("omits the category link when there is no category page", () => {
    renderPage({ withCategory: false });
    const section = screen.getByRole("region", { name: "สินค้าที่เกี่ยวข้อง" });
    expect(section.querySelector("a[href^='/products/']")).toBeNull();
  });
});

describe("ShowcaseClient — product badge", () => {
  it("shows the English name beside the Thai one", () => {
    const { container } = renderPage();
    expect(container.textContent).toContain("เครื่องวัดความเงา");
    expect(container.textContent).toContain("Gloss Meter");
  });
});

describe("ShowcaseClient — image alt text", () => {
  it("describes the page (title + product) instead of 'Content'", () => {
    const { container } = renderPage({
      blocks: [{ id: "b1", type: "image", imageUrl: "https://res.cloudinary.com/demo/image/upload/v1/x.jpg" } as ContentBlock],
    });
    const img = container.querySelector("img[src*='x.jpg']");
    expect(img?.getAttribute("alt")).toBe("GM-4 – เครื่องวัดความเงา (Gloss Meter)");
    expect(container.querySelector("img[alt='Content']")).toBeNull();
  });
});

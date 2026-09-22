/**
 * The homepage product grid renders each card's description with
 * dangerouslySetInnerHTML straight from the saved HTML. Content saved before
 * normalizeNbsp existed (see stripHtml.test.ts / sanitizeHtml.test.ts) can
 * still hold a literal U+00A0 between two words. A browser never breaks a
 * line at U+00A0, so when that nbsp-joined run doesn't fit, wrapping falls
 * back to the nearest earlier break point instead — for Thai text (which has
 * no spaces between words to begin with) that's often a dictionary word
 * boundary INSIDE an unrelated compound word, producing a visually wrong
 * split (e.g. "เครื่องชั่ง" / "ไฟฟ้า ละเอียด…" instead of keeping
 * "เครื่องชั่งไฟฟ้า" together).
 *
 * ShowcaseClientTextRendering.test.tsx already covers this fix for the
 * showcase content page; this covers the product grid card
 * (app/components/Products.tsx), which was still missing the same
 * render-time normalizeNbsp() call.
 */
import { render, cleanup, waitFor, act } from "@testing-library/react";
import { Suspense } from "react";
import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/app/context/AuthContext", () => ({
  useAuth: () => ({ isLoggedIn: false }),
}));

import Products from "@/app/components/Products";
import type { ProductData, ProductCategory } from "@/app/lib/types";

const NBSP = " ";

afterEach(() => {
  cleanup();
});

function makeProduct(desc_th: string): ProductData {
  return {
    id: "p1",
    categoryId: 1,
    image: "/img.png",
    title_th: "OHUAS เครื่องชั่งวิเคราะห์",
    title_en: "",
    title_zh: "",
    desc_th,
    desc_en: "",
    desc_zh: "",
    createdAt: "2026-01-01",
    isPublished: true,
  };
}

const categories: ProductCategory[] = [
  { id: 1, name_th: "เครื่องชั่ง", name_en: "Scales", name_zh: "秤", sortOrder: 0 },
];

describe("Products grid card — description text", () => {
  it("strips non-breaking spaces from the saved description before it reaches the DOM", async () => {
    const desc_th = `<p>เครื่องชั่งไฟฟ้า${NBSP}ละเอียด 0.1 ถึง 0.0001 กรัม</p>`;
    const dataPromise = Promise.resolve({ categories, products: [makeProduct(desc_th)] });

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

    expect(container.textContent).not.toContain(NBSP);
    expect(container.textContent).toContain("เครื่องชั่งไฟฟ้า ละเอียด 0.1 ถึง 0.0001 กรัม");
  });
});

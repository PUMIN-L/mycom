/**
 * Renaming a category from the product sidebar. The sidebar renders category
 * names as HTML, so after saving it must show the names the SERVER stored
 * (sanitized), never the editor's own output — editor HTML can carry markup
 * (e.g. from pasted content; quill 2.0.3 has an open advisory on its HTML
 * export) that the stored copy does not.
 */
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { Suspense } from "react";
import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/app/context/AuthContext", () => ({
  useAuth: () => ({ isLoggedIn: true }),
}));
// The Quill editor, reduced to a textarea that reports raw HTML like Quill does.
vi.mock("@/app/components/RichTextEditor", () => ({
  default: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <textarea data-testid="cat-editor" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));

import Products from "@/app/components/Products";
import type { ProductCategory, ProductData } from "@/app/lib/types";

const CATEGORY: ProductCategory = { id: 1, name_th: "<p>เครื่องชั่ง</p>", name_en: "<p>Scales</p>", name_zh: "<p>秤</p>", sortOrder: 0 };
const PRODUCT = {
  id: "p1", categoryId: 1, image: "/img.png",
  title_th: "<p>สินค้า</p>", title_en: "", title_zh: "", desc_th: "", desc_en: "", desc_zh: "",
  createdAt: "2026-01-01", isPublished: true,
} as ProductData;

const PASTED = '<p>ใหม่<img src="x" onerror="window.__pwned=1"></p>';

function mockFetch(putReply: unknown) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/products/categories/1" && init?.method === "PUT") {
      return { ok: true, status: 200, json: async () => putReply };
    }
    if (url === "/api/products") return { ok: true, status: 200, json: async () => [PRODUCT] };
    return { ok: true, status: 200, json: async () => ({}) };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function renameTo(html: string) {
  const dataPromise = Promise.resolve({ categories: [CATEGORY], products: [PRODUCT] });
  let container!: HTMLElement;
  await act(async () => {
    ({ container } = render(
      <Suspense fallback={null}>
        <Products dataPromise={dataPromise} />
      </Suspense>
    ));
    await dataPromise;
  });
  fireEvent.click(await screen.findByRole("button", { name: "แก้ไขหมวดหมู่" }));
  const editor = await screen.findByTestId("cat-editor");
  fireEvent.change(editor, { target: { value: html } });
  // The ✓ button beside the editor.
  const saveButton = editor.closest("div.flex-col")!.querySelectorAll("button")[0];
  fireEvent.click(saveButton);
  return container;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  delete (window as unknown as { __pwned?: number }).__pwned;
});

describe("Products — category rename shows what the server stored", () => {
  it("renders the server's sanitized names, not the editor's HTML", async () => {
    mockFetch({ category: { id: 1, name_th: "<p>ใหม่</p>", name_en: "<p>Scales</p>", name_zh: "<p>秤</p>" } });
    const container = await renameTo(PASTED);

    await waitFor(() => expect(container.textContent).toContain("ใหม่"));
    expect(container.querySelector('img[src="x"]')).toBeNull();
    expect(container.innerHTML).not.toContain("onerror");
  });

  it("keeps the old name rather than render unsanitized HTML when the reply has no stored names", async () => {
    mockFetch({ message: "Category updated successfully" }); // e.g. an older server mid-deploy
    const container = await renameTo(PASTED);

    await waitFor(() => expect(screen.queryByTestId("cat-editor")).toBeNull());
    expect(container.querySelector('img[src="x"]')).toBeNull();
    expect(container.textContent).toContain("เครื่องชั่ง");
  });
});

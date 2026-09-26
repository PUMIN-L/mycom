/**
 * Two related display bugs on the public showcase page, both only visible
 * once real (often pasted-from-Word) content is long enough to wrap or
 * multi-paragraph:
 *
 * 1. Content saved before normalizeNbsp existed can still hold literal
 *    U+00A0 characters. A browser never breaks a line at U+00A0, so a run of
 *    "words" joined only by nbsp reads as one unbreakable token and
 *    overflow-wrap:break-word (the only wrapping rule applied here) chops it
 *    mid-letter to avoid overflowing its column. Fixing this at save time
 *    (sanitizeHtml.test.ts) does nothing for rows saved before that landed —
 *    this file's block also normalizes at render time so already-published
 *    content is corrected immediately, without a data migration.
 *
 *    NOTE on how these tests check it: `container.innerHTML` re-serializes a
 *    U+00A0 text node back into the literal 6-character entity `&nbsp;` — so
 *    a regex for the raw codepoint against `.innerHTML` would pass whether or
 *    not the fix ran, catching nothing. `.textContent` returns the actual
 *    underlying characters, which is what these assertions check instead.
 *
 * 2. Quill emits one <p> per paragraph, and Tailwind's preflight resets EVERY
 *    element's margin to 0 — including <p> — the same reset that made
 *    "<ul>"/"<li>" need their own `[&_ul]:my-2`/`[&_li]:mb-1` rules in this
 *    same className. Paragraphs never got the equivalent rule, so distinct
 *    paragraphs rendered back to back with no visual gap between them, even
 *    though the admin's edit view (Quill's own CSS) showed one.
 */

import { render, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
  usePathname: () => "/showcase/c1",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/app/context/AuthContext", () => ({
  useAuth: () => ({ isLoggedIn: false }),
}));
vi.mock("@/app/i18n/LanguageContext", () => ({
  useLanguage: () => ({ lang: "th", setLang: vi.fn() }),
  useT: () => (o: { th: string } | undefined) => o?.th ?? "",
}));
vi.mock("@/app/components/Navbar", () => ({ default: () => null }));
vi.mock("@/app/components/Footer", () => ({ default: () => null }));

import ShowcaseClient from "@/app/showcase/[id]/ShowcaseClient";
import type { ContentBlock } from "@/app/lib/types";

const NBSP = " ";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderView(blocks: ContentBlock[], title = "หัวข้อทดสอบ", productId: string | null = null) {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }) as unknown as Response));
  return render(
    <ShowcaseClient
      initialContent={{
        id: "c1",
        title,
        blocks,
        createdAt: "2026-09-01",
        productId,
      }}
      initialAllContents={[]}
      initialProducts={[]}
      initialCategories={[]}
      companyInfo={{ email: "x@y.z", phone: "0", address: "ที่อยู่" }}
      maintenanceOn={false}
    />
  );
}

describe("ShowcaseClient — public view rendering of text blocks", () => {
  it("strips non-breaking spaces from already-saved content before it reaches the DOM", () => {
    const blocks: ContentBlock[] = [
      {
        id: "b1",
        type: "text",
        content: `<p>Your${NBSP}Workplace${NBSP}uses${NBSP}RS232</p>`,
        fontSize: "16",
      } as ContentBlock,
    ];
    const { container } = renderView(blocks);
    expect(container.textContent).not.toContain(NBSP);
    expect(container.textContent).toContain("Your Workplace uses RS232");
  });

  it("strips non-breaking spaces in a text-image block too", () => {
    const blocks: ContentBlock[] = [
      {
        id: "b1",
        type: "text-image",
        content: `<p>competitive${NBSP}performance</p>`,
        fontSize: "16",
        imageUrl: "",
      } as ContentBlock,
    ];
    const { container } = renderView(blocks);
    expect(container.textContent).not.toContain(NBSP);
    expect(container.textContent).toContain("competitive performance");
  });

  // Shown as the editor showed it (the `rich-text` class, globals.css): each
  // paragraph its own line with no gap the editor never had — it used to get
  // a 12px bottom margin — and runs of spaces kept.
  it("renders each paragraph as its own line, the way the editor laid it out", () => {
    const blocks: ContentBlock[] = [
      {
        id: "b1",
        type: "text",
        content: "<p>Paragraph one.</p><p><br></p><p>Paragraph   two.</p>",
        fontSize: "16",
      } as ContentBlock,
    ];
    const { container } = renderView(blocks);
    // The block, not the title (which is rich text too).
    const html = Array.from(container.querySelectorAll(".rich-text")).find((el) =>
      el.textContent?.includes("Paragraph one.")
    );
    expect(html).toBeDefined();
    expect(html!.className).not.toContain("[&_p]:mb-3");
    const paragraphs = html!.querySelectorAll("p");
    expect(paragraphs).toHaveLength(3); // the empty line too
    expect(paragraphs[2].textContent).toBe("Paragraph   two.");
  });
});

describe("ShowcaseClient — the content title", () => {
  // It used to be one truncated line, its paragraphs run together.
  it("shows every line of the title, centring and spaces as typed", () => {
    const { container } = renderView(
      [],
      '<p class="ql-align-center">เครื่องชั่ง&nbsp;&nbsp;รุ่นใหม่</p><p class="ql-align-center">ปี 2026</p>'
    );
    const h1 = container.querySelector("h1") as HTMLElement;
    expect(h1.className).toContain("rich-text");
    expect(h1.className).not.toContain("truncate");
    const lines = h1.querySelectorAll("p");
    expect(lines).toHaveLength(2);
    expect(lines[0].textContent).toBe("เครื่องชั่ง  รุ่นใหม่");
    expect(lines[0].className).toBe("ql-align-center");
  });
});

describe("ShowcaseClient — the linked product's badge", () => {
  // No product behind the id (deleted): the id is shown as text, never markup.
  it("shows an id with no product as text", () => {
    const id = '<img src=x onerror="alert(1)">';
    const { container } = renderView([], "หัวข้อ", id);
    expect(container.querySelector("img[src='x']")).toBeNull();
    expect(container.textContent).toContain(id);
  });
});

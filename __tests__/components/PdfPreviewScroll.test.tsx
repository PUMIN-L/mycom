/**
 * The PDF editor's page view scrolls left and right over a page wider than the
 * view (zoomed in, or a landscape spread).
 *
 * The pages sat in a view-wide `flex flex-col items-center` box: a wider page
 * overflowed BOTH sides of it, and the left half could never be scrolled to —
 * scrollLeft does not go negative — so both edges were simply cut off. The box
 * now grows to the widest page (`w-max`) and is never narrower than the view
 * (`min-w-full`), inside a view that scrolls both ways.
 *
 * jsdom cannot lay anything out, so this pins the structure that makes it
 * work; the arithmetic is the browser's.
 */
import { render } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import type { DocPage } from "@/app/lib/pdfTypes";

vi.mock("react-pdf", () => ({
  Document: () => null,
  Page: () => null,
  pdfjs: { GlobalWorkerOptions: {} },
}));

import PdfPreviewClient from "@/app/tools/pdf-editor/PdfPreviewClient";

const PAGE: DocPage = {
  id: "pg_1",
  src: "src_1",
  srcIndex: 0,
  addedRotation: 0,
  baseRotation: 0,
  widthPt: 842,
  heightPt: 595,
};

function renderPreview() {
  return render(
    <PdfPreviewClient
      sources={[{ sourceId: "src_1", bytes: new Uint8Array([1]) } as never]}
      pages={[PAGE]}
      annotations={[]}
      assetUrls={{}}
      previewEpoch={0}
      tool="select"
      zoom={2}
      activePageId="pg_1"
      selectedAnnotationId={null}
      onSelectPage={() => {}}
      onSelectAnnotation={() => {}}
      onCreateRect={() => {}}
      onCommitRect={() => {}}
      onMovePage={() => {}}
      onRotatePage={() => {}}
      onDeletePage={() => {}}
    />
  );
}

describe("PDF editor page view — horizontal scrolling", () => {
  it("lays the pages in a box as wide as the widest page, never narrower than the view", () => {
    const { container } = renderPreview();
    const pages = container.querySelector("[data-pdf-pages]") as HTMLElement;
    expect(pages).toBeTruthy();
    const classes = pages.className.split(/\s+/);
    expect(classes).toEqual(expect.arrayContaining(["w-max", "min-w-full", "items-center"]));
  });

  it("inside a view that scrolls both ways", () => {
    const { container } = renderPreview();
    const view = (container.querySelector("[data-pdf-pages]") as HTMLElement).parentElement!;
    expect(view.className.split(/\s+/)).toEqual(expect.arrayContaining(["overflow-auto", "min-w-0"]));
  });

  /**
   * The site-wide scrollbars (globals.css) are white on white, so the
   * sideways bar under a wide page was there but invisible — "it can't scroll
   * left or right". This view paints its own, grey on grey, in both
   * directions and in both scrollbar dialects.
   */
  it("shows its scrollbars — grey, not the site's invisible white", () => {
    const { container } = renderPreview();
    const view = (container.querySelector("[data-pdf-pages]") as HTMLElement).parentElement!;
    expect(view.hasAttribute("data-pdf-scroll")).toBe(true);
    const css = Array.from(container.querySelectorAll("style")).map((s) => s.textContent ?? "").join("\n");
    expect(css).toMatch(/\[data-pdf-scroll\]\s*\{\s*scrollbar-color:\s*#9ca3af #d1d5db;/);
    expect(css).toMatch(/\[data-pdf-scroll\]::-webkit-scrollbar\s*\{\s*width:\s*12px;\s*height:\s*12px;/);
    expect(css).toMatch(/\[data-pdf-scroll\]::-webkit-scrollbar-thumb\s*\{\s*background:\s*#9ca3af;/);
  });
});

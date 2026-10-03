/**
 * The public PDF viewer (/document/[id]) on a phone. It used to draw every
 * page at scale 1.5 and shrink it with CSS — canvases several times the
 * screen, for every page of a catalog at once. Now each page is drawn as wide
 * as the viewer, and only pages near the screen are drawn at all.
 *
 * react-pdf is a stand-in that records what each <Page> was asked for; the
 * browser's ResizeObserver / IntersectionObserver are driven by hand.
 */
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { pages } = vi.hoisted(() => ({ pages: new Map<number, { width?: number; scale?: number; devicePixelRatio?: number }>() }));

vi.mock("react-pdf", async () => {
  const React = await import("react");
  return {
    pdfjs: { GlobalWorkerOptions: {} },
    Document: ({ children, onLoadSuccess, className }: { children: React.ReactNode; onLoadSuccess: (pdf: unknown) => void; className?: string }) => {
      // Loads once per file, as the real Document does.
      const loaded = React.useRef(false);
      React.useEffect(() => {
        if (loaded.current) return;
        loaded.current = true;
        onLoadSuccess({
          numPages: 30,
          getPage: async () => ({ getViewport: () => ({ width: 210, height: 297 }) }),
        });
      });
      return <div className={className}>{children}</div>;
    },
    Page: (props: {
      pageNumber: number;
      width?: number;
      scale?: number;
      devicePixelRatio?: number;
      onLoadSuccess?: (page: { originalWidth: number; originalHeight: number }) => void;
    }) => {
      pages.set(props.pageNumber, props);
      const loaded = React.useRef(false);
      React.useEffect(() => {
        if (loaded.current) return;
        loaded.current = true;
        // Page 5 is a landscape page in a portrait (A4) catalog.
        props.onLoadSuccess?.(props.pageNumber === 5 ? { originalWidth: 297, originalHeight: 210 } : { originalWidth: 210, originalHeight: 297 });
      });
      return <canvas data-testid={`canvas-${props.pageNumber}`} />;
    },
  };
});
vi.mock("react-pdf/dist/Page/AnnotationLayer.css", () => ({}));
vi.mock("react-pdf/dist/Page/TextLayer.css", () => ({}));

import PdfViewerClient from "@/app/document/[id]/PdfViewerClient";

// ── hand-driven observers ──
let viewerWidth = 360;
const resizeCallbacks: Array<() => void> = [];
const intersection = new Map<Element, (entries: Array<{ isIntersecting: boolean }>) => void>();

beforeEach(() => {
  pages.clear();
  intersection.clear();
  resizeCallbacks.length = 0;
  viewerWidth = 360;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private cb: () => void) {}
      observe() {
        resizeCallbacks.push(this.cb);
      }
      disconnect() {}
    }
  );
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(private cb: (entries: Array<{ isIntersecting: boolean }>) => void) {}
      observe(el: Element) {
        intersection.set(el, this.cb);
      }
      disconnect() {}
    }
  );
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => viewerWidth });
  Object.defineProperty(window, "devicePixelRatio", { configurable: true, value: 3 });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth;
});

/** Mark pages as near the screen (or not), as scrolling would. */
function scrollNear(pageNumbers: number[], near = true) {
  act(() => {
    for (const [el, cb] of intersection) {
      const n = Number((el as HTMLElement).dataset.page);
      if (pageNumbers.includes(n)) cb([{ isIntersecting: near }]);
    }
  });
}

async function renderViewer() {
  render(<PdfViewerClient url="/api/documents/proxy?url=x" />);
  await screen.findByText("ทั้งหมด 30 หน้า");
}

describe("PdfViewerClient on a phone", () => {
  it("draws nothing until a page comes near the screen — 30 boxes, no canvases", async () => {
    await renderViewer();
    expect(document.querySelectorAll("[data-page]")).toHaveLength(30);
    expect(screen.queryAllByTestId(/^canvas-/)).toHaveLength(0);
  });

  it("draws a page as wide as the screen (360 − 2×8), not at a fixed scale, and at 2× not 3×", async () => {
    await renderViewer();
    scrollNear([1, 2]);
    expect(screen.getAllByTestId(/^canvas-/)).toHaveLength(2);
    const first = pages.get(1)!;
    expect(first.width).toBe(344);
    expect(first.scale).toBeUndefined();
    expect(first.devicePixelRatio).toBe(2);
  });

  it("keeps each box the page's size before it is drawn, so scrolling stays true", async () => {
    await renderViewer();
    const box = document.querySelector('[data-page="20"]') as HTMLElement;
    expect(box.style.width).toBe("344px");
    expect(box.style.minHeight).toBe(`${Math.round(344 * (297 / 210))}px`);
  });

  // Sized by page 1 alone, a landscape page sat in a box far too tall — and a
  // page that shrank back when dropped above the screen jerked the view.
  it("once a page has loaded, its box keeps THAT page's proportions, even after its canvas is dropped", async () => {
    await renderViewer();
    const box = () => document.querySelector('[data-page="5"]') as HTMLElement;
    expect(box().style.minHeight).toBe(`${Math.round(344 * (297 / 210))}px`); // page 1's guess
    scrollNear([5]);
    expect(box().style.minHeight).toBe(`${Math.round(344 * (210 / 297))}px`); // its own: landscape
    expect(pages.get(5)!.devicePixelRatio).toBe(2);
    scrollNear([5], false);
    expect(screen.queryByTestId("canvas-5")).toBeNull();
    expect(box().style.minHeight).toBe(`${Math.round(344 * (210 / 297))}px`); // kept
  });

  it("drops a page's canvas again once it is scrolled far away", async () => {
    await renderViewer();
    scrollNear([1]);
    expect(screen.getByTestId("canvas-1")).toBeInTheDocument();
    scrollNear([1], false);
    expect(screen.queryByTestId("canvas-1")).toBeNull();
  });

  it("zoom is from the fitted width, and the percentage goes back to it", async () => {
    await renderViewer();
    scrollNear([1]);
    expect(screen.getByRole("button", { name: /ขนาด 100%/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "ซูมเข้า" }));
    expect(pages.get(1)!.width).toBe(Math.round(344 * 1.25));
    fireEvent.click(screen.getByRole("button", { name: /ขนาด 125%/ }));
    expect(pages.get(1)!.width).toBe(344);
  });

  it("redraws at the new width when the phone is turned sideways", async () => {
    await renderViewer();
    scrollNear([1]);
    viewerWidth = 740;
    act(() => resizeCallbacks.forEach((cb) => cb()));
    expect(pages.get(1)!.width).toBe(740 - 2 * 16);
  });
});

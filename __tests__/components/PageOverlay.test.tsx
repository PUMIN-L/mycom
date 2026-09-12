import { render, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import PageOverlay from "@/app/tools/pdf-editor/PageOverlay";
import type { Annotation, Rect } from "@/app/lib/pdfTypes";

/**
 * PageOverlay imports `pdfCoords` and nothing else — no react-pdf, no pdfjs —
 * which is the whole reason it can be driven in jsdom at all. These stubs keep
 * it that way: if a future edit drags the canvas into its import graph they
 * absorb it, instead of the suite dying on `DOMMatrix is not defined`.
 */
vi.mock("react-pdf", () => ({
  Document: () => null,
  Page: () => null,
  pdfjs: { GlobalWorkerOptions: {} },
}));

/**
 * The overlay is a SQUARE 600pt page at zoom 1, so the CSS box is 600x600 and
 * the arithmetic stays readable: css.x === pdf.x, and css.y === 600 - (pdf.y +
 * pdf.height). Every number below is checked against that by hand.
 */
const PAGE_PT = 600;

/** jsdom reports zeroes for every rect, and a zero-size box makes the overlay
 *  refuse every gesture (`ready` is false). This is the measurement it needs. */
function stubBox() {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
    left: 0,
    top: 0,
    right: PAGE_PT,
    bottom: PAGE_PT,
    width: PAGE_PT,
    height: PAGE_PT,
    x: 0,
    y: 0,
    toJSON: () => {},
  } as DOMRect);
}

beforeEach(stubBox);
afterEach(() => vi.restoreAllMocks());

/** jsdom has no PointerEvent constructor, so a MouseEvent carrying a
 *  `pointerId` is what React's pointer handlers receive. */
function pointer(type: string, x: number, y: number): MouseEvent {
  const e = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y });
  Object.defineProperty(e, "pointerId", { value: 1 });
  return e;
}

/** css.y for a PDF rect on this page. */
const cssTop = (rect: Rect) => PAGE_PT - (rect.y + rect.height);

type Harness = {
  commits: Array<{ id: string; rect: Rect }>;
  target: HTMLElement;
};

function mount(annotation: Annotation): Harness {
  const commits: Harness["commits"] = [];
  const { container } = render(
    <PageOverlay
      pageId="pg_1"
      widthPt={PAGE_PT}
      heightPt={PAGE_PT}
      rotation={0}
      annotations={[annotation]}
      assetUrls={{ sig: "blob:sig" }}
      tool="select"
      selectedAnnotationId={annotation.id}
      pageProxy={null}
      onSelectAnnotation={() => {}}
      onCreateRect={() => {}}
      onCommitRect={(id, rect) => commits.push({ id, rect })}
    />,
  );
  const root = container.querySelector("[data-page-overlay]") as HTMLElement;
  // With `pageProxy` null there are no snap buttons, so the overlay's only
  // element child is the annotation itself.
  const target = root.firstElementChild as HTMLElement;
  expect(target).toBeTruthy();
  return { commits, target };
}

/** Press on the annotation, drag by (dx, dy), release. */
function dragBy(target: HTMLElement, from: { x: number; y: number }, dx: number, dy: number) {
  act(() => {
    target.dispatchEvent(pointer("pointerdown", from.x, from.y));
  });
  act(() => {
    window.dispatchEvent(pointer("pointermove", from.x + dx, from.y + dy));
  });
  act(() => {
    window.dispatchEvent(pointer("pointerup", from.x + dx, from.y + dy));
  });
}

/* -------------------------------------------------------------------------- */

describe("PageOverlay — moving an annotation never resizes it", () => {
  /** 200x100 in CSS pixels, sitting well inside the page. */
  const SIG_RECT: Rect = { x: 380, y: 400, width: 200, height: 100 };
  const signature: Annotation = {
    kind: "signature",
    id: "sig_1",
    pageId: "pg_1",
    rect: SIG_RECT,
    assetId: "sig",
  };

  it("stops a signature at the RIGHT edge with its size intact", () => {
    const { commits, target } = mount(signature);

    // css x is 380, so 100px to the right would put the right edge at 680 on a
    // 600-wide page. It has to stop at 400, not shrink to 120 wide.
    dragBy(target, { x: 400, y: cssTop(SIG_RECT) + 20 }, 100, 0);

    expect(commits).toHaveLength(1);
    expect(commits[0].id).toBe("sig_1");
    expect(commits[0].rect.width).toBeCloseTo(SIG_RECT.width, 3);
    expect(commits[0].rect.height).toBeCloseTo(SIG_RECT.height, 3);
    // Flush with the right edge of the page, in PDF user space.
    expect(commits[0].rect.x).toBeCloseTo(PAGE_PT - SIG_RECT.width, 3);
    expect(commits[0].rect.y).toBeCloseTo(SIG_RECT.y, 3);
  });

  it("stops a signature at the BOTTOM edge with its size intact", () => {
    const low: Rect = { x: 100, y: 40, width: 200, height: 100 };
    const { commits, target } = mount({ ...signature, rect: low });

    // css top is 460; dragging down 100 would put the bottom at 660.
    dragBy(target, { x: 150, y: cssTop(low) + 20 }, 0, 100);

    expect(commits).toHaveLength(1);
    expect(commits[0].rect.width).toBeCloseTo(low.width, 3);
    expect(commits[0].rect.height).toBeCloseTo(low.height, 3);
    expect(commits[0].rect.x).toBeCloseTo(low.x, 3);
    // Flush with the bottom of the page: css bottom 600 -> pdf y 0.
    expect(commits[0].rect.y).toBeCloseTo(0, 3);
  });

  it("behaves the same way at the LEFT and TOP edges — the rule is symmetric", () => {
    const high: Rect = { x: 40, y: 480, width: 200, height: 100 };
    const { commits, target } = mount({ ...signature, rect: high });

    dragBy(target, { x: 60, y: cssTop(high) + 10 }, -200, -200);

    expect(commits).toHaveLength(1);
    expect(commits[0].rect.width).toBeCloseTo(high.width, 3);
    expect(commits[0].rect.height).toBeCloseTo(high.height, 3);
    expect(commits[0].rect.x).toBeCloseTo(0, 3);
    expect(commits[0].rect.y).toBeCloseTo(PAGE_PT - high.height, 3);
  });

  it("still CLIPS a resize at the page edge — a handle drag really is a size", () => {
    const { commits, target } = mount(signature);
    // The south-east handle is the fifth in HANDLES order: nw n ne e se …
    const handles = Array.from(target.querySelectorAll('[role="presentation"]'));
    expect(handles).toHaveLength(8);
    const se = handles[4] as HTMLElement;

    // css right edge is 580; pulling it 100px further would reach 680.
    dragBy(se, { x: 580, y: cssTop(SIG_RECT) + SIG_RECT.height }, 100, 0);

    expect(commits).toHaveLength(1);
    // Clipped to the page, NOT extended past it — and not left at 200 either.
    expect(commits[0].rect.width).toBeCloseTo(PAGE_PT - SIG_RECT.x, 3);
    expect(commits[0].rect.x).toBeCloseTo(SIG_RECT.x, 3);
  });
});

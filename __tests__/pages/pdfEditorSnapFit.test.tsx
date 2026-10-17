/**
 * PDF editor — text typed over a SNAPPED line keeps to one line.
 *
 * A snap's box is the old text's own tight box. Correcting a date's "1" to
 * "11" wrapped the new text inside it: the download showed a "1" with another
 * "1" under it. The page now widens a snapped box to the width of what was
 * typed, measured in Sarabun (the face the download embeds), keeping the edge
 * the alignment hangs on. A box the admin DRAGGED keeps his width — wrapping
 * inside it is what he drew it for.
 *
 * Same harness as pdfEditorTextStyle.test.tsx: the canvas is a stub that hands
 * the page's own callbacks to the test. jsdom has no canvas text metrics and
 * no FontFaceSet, so both are stubbed: every character measures 10 units, and
 * the measurement records the font it was asked for.
 */
import { render, screen, fireEvent, waitFor, within, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import type { Annotation, Rect, TextAnnotation } from "@/app/lib/pdfTypes";

type PreviewProps = {
  pages: Array<{ id: string }>;
  annotations: Annotation[];
  onCreateRect: (pageId: string, rect: Rect, tool: string, origin: string, snap?: unknown) => void;
};
let preview: PreviewProps | null = null;

vi.mock("react-pdf", () => ({ Document: () => null, Page: () => null, pdfjs: { GlobalWorkerOptions: {} } }));
vi.mock("@/app/tools/pdf-editor/PdfPreviewWrapper", () => ({
  default: (props: PreviewProps) => {
    preview = props;
    return <div data-testid="pdf-canvas" />;
  },
}));
vi.mock("@/app/tools/pdf-editor/SignaturePad", () => ({ default: () => null }));
let pageRotation = 0;
vi.mock("@/app/lib/pdfFormFill", () => ({
  openPdfDocument: vi.fn(async () => ({
    getPages: () => [
      { getCropBox: () => ({ x: 0, y: 0, width: 595, height: 842 }), getRotation: () => ({ angle: pageRotation }) },
    ],
  })),
  hasXfaEntry: vi.fn(async () => false),
  listFormFields: vi.fn(async () => []),
}));
vi.mock("@/app/lib/pdfApplyEdits", () => ({ applyEdits: vi.fn(async () => new Uint8Array()) }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => "/tools/pdf-editor",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/app/context/AuthContext", () => ({ useAuth: () => ({ isLoggedIn: true, isLoading: false }) }));

import PdfEditorPage from "@/app/tools/pdf-editor/page";

/** The tight box pdfjs reports around a single "1". */
const SNAP_BOX: Rect = { x: 300, y: 100, width: 7, height: 14 };
/** What `sarabunLineWidthPt` returns for `n` characters under the stub. */
const fitted = (n: number) => n * 10 * 1.02 + 1;

const fontsAsked: string[] = [];
/** What each measurement set `fontKerning` to — "none" matches pdf-lib. */
const kerningAsked: string[] = [];

beforeAll(() => {
  if (!URL.createObjectURL) {
    Object.assign(URL, { createObjectURL: () => "blob:test", revokeObjectURL: () => {} });
  }
});

beforeEach(() => {
  pageRotation = 0;
  fontsAsked.length = 0;
  kerningAsked.length = 0;
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: { load: vi.fn(async () => []), check: () => true },
  });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function () {
    let font = "";
    let kerning = "auto";
    return {
      get font() { return font; },
      set font(v: string) { font = v; fontsAsked.push(v); },
      get fontKerning() { return kerning; },
      set fontKerning(v: string) { kerning = v; kerningAsked.push(v); },
      measureText: (s: string) => ({ width: s.length * 10 }),
    } as unknown as CanvasRenderingContext2D;
  } as never);
});

afterEach(() => {
  vi.restoreAllMocks();
  delete (document as { fonts?: unknown }).fonts;
});

const texts = () => (preview?.annotations ?? []).filter((a): a is TextAnnotation => a.kind === "text");

async function openDocument() {
  render(<PdfEditorPage />);
  const pdf = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34])], "a.pdf", {
    type: "application/pdf",
  });
  const bytes = new TextEncoder().encode("%PDF-1.4\n%test\n");
  Object.defineProperty(pdf, "arrayBuffer", { value: async () => bytes.buffer });
  const input = document.querySelector('input[type="file"][accept=".pdf,application/pdf"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [pdf] } });
  await waitFor(() => expect(preview?.pages.length).toBe(1));
}

/** Arm the text tool and hand the page a rectangle, as the overlay would. */
async function place(rect: Rect, origin: "snap" | "drag", typed: string, opts: { align?: string; bold?: boolean; angleDeg?: number } = {}) {
  fireEvent.click(screen.getByRole("button", { name: "ข้อความ" }));
  act(() =>
    preview!.onCreateRect(preview!.pages[0].id, rect, "text", origin,
      origin === "snap" ? { text: "1", sizePt: 12, angleDeg: opts.angleDeg ?? 0 } : undefined)
  );
  const box = within(await screen.findByRole("dialog"));
  fireEvent.change(box.getByLabelText("ข้อความ (ฟอนต์ Sarabun)"), { target: { value: typed } });
  if (opts.bold) fireEvent.click(box.getByRole("button", { name: "B" }));
  if (opts.align) {
    // The alignment picker is a SearchableDropdown: open it on its current
    // value, then pick from the panel it portals to <body>.
    fireEvent.click(box.getByRole("button", { name: "ชิดซ้าย" }));
    fireEvent.click(screen.getByRole("button", { name: opts.align }));
  }
  fireEvent.click(box.getByRole("button", { name: "วางข้อความ" }));
  await waitFor(() => expect(texts().length).toBeGreaterThan(0));
  return texts()[texts().length - 1];
}

describe("PDF editor — a snapped box widens to the text typed into it", () => {
  it("a date's 1 corrected to 11 stays on one line: the box grows rightward to fit it", async () => {
    await openDocument();
    const t = await place(SNAP_BOX, "snap", "11");
    expect(t.text).toBe("11");
    expect(t.rect).toEqual({ x: 300, y: 100, width: fitted(2), height: 14 });
    // Measured in Sarabun, at the snapped line's size, without kerning.
    expect(fontsAsked).toContain("400 12px Sarabun");
    expect(kerningAsked).toEqual(["none"]);
  });

  it("measures bold text in bold Sarabun", async () => {
    await openDocument();
    await place(SNAP_BOX, "snap", "11", { bold: true });
    expect(fontsAsked).toContain("700 12px Sarabun");
  });

  it("right-aligned text keeps its right edge", async () => {
    await openDocument();
    const t = await place(SNAP_BOX, "snap", "11", { align: "ชิดขวา" });
    expect(t.rect.width).toBeCloseTo(fitted(2));
    expect(t.rect.x + t.rect.width).toBeCloseTo(SNAP_BOX.x + SNAP_BOX.width);
  });

  it("the widest line decides when the text has several", async () => {
    await openDocument();
    const t = await place(SNAP_BOX, "snap", "1\n1234\n12");
    expect(t.rect.width).toBeCloseTo(fitted(4));
  });

  it("leaves a box the text already fits in alone", async () => {
    await openDocument();
    const wide = { ...SNAP_BOX, width: 80 };
    const t = await place(wide, "snap", "11");
    expect(t.rect).toEqual(wide);
  });

  it("leaves a DRAGGED box at the width the admin drew", async () => {
    await openDocument();
    const t = await place(SNAP_BOX, "drag", "11");
    expect(t.rect).toEqual(SNAP_BOX);
  });

  it("leaves a turned line alone — its box's width is not the line's direction", async () => {
    await openDocument();
    const t = await place(SNAP_BOX, "snap", "11", { angleDeg: 90 });
    expect(t.rect).toEqual(SNAP_BOX);
  });

  it("leaves a line on a rotated page alone, for the same reason", async () => {
    pageRotation = 90;
    await openDocument();
    const t = await place(SNAP_BOX, "snap", "11");
    expect(t.rect).toEqual(SNAP_BOX);
  });
});

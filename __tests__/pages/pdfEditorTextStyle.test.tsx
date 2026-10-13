/**
 * PDF editor — the text dialog styles THIS text, wired through the real page.
 *
 *  • Placing: bold / italic / colour / alignment chosen in the dialog land on
 *    the annotation, and the toolbar remembers that look for the next text.
 *  • Editing: the dialog starts from the text's OWN style, and saving keeps it.
 *    It used to take colour, bold and alignment from the toolbar, so fixing a
 *    typo in a red bold line turned it black and regular.
 *
 * The canvas (react-pdf) is replaced by a stub that hands the page's own
 * callbacks to the test, so the test draws and selects exactly as the overlay
 * would.
 */
import { render, screen, fireEvent, waitFor, within, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeAll } from "vitest";
import type { Annotation, Rect, TextAnnotation } from "@/app/lib/pdfTypes";

type PreviewProps = {
  pages: Array<{ id: string }>;
  annotations: Annotation[];
  onCreateRect: (pageId: string, rect: Rect, tool: string, origin: string) => void;
  onSelectAnnotation: (id: string | null) => void;
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
vi.mock("@/app/lib/pdfFormFill", () => ({
  // One A4 page, upright.
  openPdfDocument: vi.fn(async () => ({
    getPages: () => [
      { getCropBox: () => ({ x: 0, y: 0, width: 595, height: 842 }), getRotation: () => ({ angle: 0 }) },
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

beforeAll(() => {
  // jsdom has no object URLs; the store makes one per source.
  if (!URL.createObjectURL) {
    Object.assign(URL, { createObjectURL: () => "blob:test", revokeObjectURL: () => {} });
  }
});

const RECT: Rect = { x: 50, y: 700, width: 200, height: 30 };
const texts = () => (preview?.annotations ?? []).filter((a): a is TextAnnotation => a.kind === "text");
const dialog = () => screen.getByRole("dialog");

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

/** Draw a text box with the text tool armed, as the overlay would. */
async function drawText() {
  fireEvent.click(screen.getByRole("button", { name: "ข้อความ" }));
  act(() => preview!.onCreateRect(preview!.pages[0].id, RECT, "text", "drag"));
  await screen.findByRole("dialog");
}

describe("PDF editor — styling text in the dialog", () => {
  it("places the look chosen in the dialog, and edits keep the text's own look", async () => {
    await openDocument();

    // ── place: red, bold, italic, centred — all chosen in the dialog ──────
    await drawText();
    const box = within(dialog());
    fireEvent.change(box.getByLabelText("ข้อความ (ฟอนต์ Sarabun)"), { target: { value: "ราคา 1,000 บาท" } });
    fireEvent.click(box.getByRole("button", { name: "B" }));
    fireEvent.click(box.getByRole("button", { name: "I" }));
    fireEvent.click(box.getByTitle("Choose color"));
    fireEvent.click(box.getByTitle("#EF4444"));
    fireEvent.click(box.getByRole("button", { name: "ชิดซ้าย" }));
    fireEvent.click(screen.getByRole("button", { name: "กึ่งกลาง" }));
    fireEvent.click(box.getByRole("button", { name: "วางข้อความ" }));

    await waitFor(() => expect(texts()).toHaveLength(1));
    expect(texts()[0]).toMatchObject({
      text: "ราคา 1,000 บาท",
      bold: true,
      italic: true,
      align: "center",
      color: { r: 0xef / 255, g: 0x44 / 255, b: 0x44 / 255 },
    });

    // ── the toolbar remembered that look for the next text ───────────────
    fireEvent.click(screen.getByRole("button", { name: "ข้อความ" }));
    const toolbar = within(screen.getByRole("group", { name: "แถบเครื่องมือแก้ไข PDF" }));
    expect(toolbar.getByRole("button", { name: "B" })).toHaveAttribute("aria-pressed", "true");
    expect(toolbar.getByRole("button", { name: "I" })).toHaveAttribute("aria-pressed", "true");

    // Now set the toolbar to plain text…
    fireEvent.click(toolbar.getByRole("button", { name: "B" }));
    fireEvent.click(toolbar.getByRole("button", { name: "I" }));
    expect(toolbar.getByRole("button", { name: "B" })).toHaveAttribute("aria-pressed", "false");

    // ── …and edit the red bold text: it must STAY red, bold, italic, centred
    fireEvent.click(screen.getByRole("button", { name: "เลือก/ย้าย" }));
    // Placing left it selected; click away and back, as the admin would.
    act(() => preview!.onSelectAnnotation(null));
    act(() => preview!.onSelectAnnotation(texts()[0].id));
    fireEvent.click(await screen.findByRole("button", { name: /แก้ไขข้อความ/ }));
    const edit = within(dialog());
    expect(edit.getByRole("button", { name: "B" })).toHaveAttribute("aria-pressed", "true");
    expect(edit.getByRole("button", { name: "I" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.change(edit.getByLabelText("ข้อความ (ฟอนต์ Sarabun)"), { target: { value: "ราคา 1,200 บาท" } });
    fireEvent.click(edit.getByRole("button", { name: "บันทึกข้อความ" }));

    await waitFor(() => expect(texts()[0].text).toBe("ราคา 1,200 บาท"));
    expect(texts()[0]).toMatchObject({
      bold: true,
      italic: true,
      align: "center",
      color: { r: 0xef / 255, g: 0x44 / 255, b: 0x44 / 255 },
    });
  });
});

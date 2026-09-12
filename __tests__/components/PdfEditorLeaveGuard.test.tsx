import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PDFDocument } from "pdf-lib";

/**
 * NOTHING IN THIS EDITOR IS STORED SERVER-SIDE. "บันทึกแล้วออก" on the leave
 * guard IS the download, so navigating away after an export that never produced
 * a file throws the whole session — an hour of annotations — into the bin with
 * nothing to show for it. These tests drive the real page and watch
 * `router.push`.
 */

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => "/tools/pdf-editor",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/app/context/AuthContext", () => ({
  useAuth: () => ({ isLoggedIn: true, isLoading: false }),
}));

/** react-pdf inside jsdom is `ReferenceError: DOMMatrix is not defined`. The
 *  preview is reachable only through this wrapper, which is why it exists. */
vi.mock("@/app/tools/pdf-editor/PdfPreviewWrapper", () => ({ default: () => null }));
vi.mock("@/app/tools/pdf-editor/SignaturePad", () => ({ default: () => null }));

const applyEdits = vi.fn();
vi.mock("@/app/lib/pdfApplyEdits", () => ({
  applyEdits: (...args: unknown[]) => applyEdits(...args),
}));

import PdfEditorPage from "@/app/tools/pdf-editor/page";

/** A real two-page PDF — the page reads it with pdf-lib, not pdfjs, so this
 *  whole upload path runs for real in jsdom. Two pages so "ลบหน้านี้" is live. */
async function twoPagePdf(): Promise<File> {
  const doc = await PDFDocument.create();
  doc.addPage([400, 600]);
  doc.addPage([400, 600]);
  const bytes = await doc.save();
  return new File([bytes.slice().buffer as ArrayBuffer], "งานบริการ.pdf", {
    type: "application/pdf",
  });
}

beforeEach(() => {
  push.mockReset();
  applyEdits.mockReset();
  // jsdom implements neither, and the store mints a tracked URL per download.
  vi.stubGlobal("URL", Object.assign(URL, {
    createObjectURL: vi.fn(() => "blob:download"),
    revokeObjectURL: vi.fn(),
  }));
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Open a file, then make one real edit so the leave guard arms itself. */
async function openAndDirty(container: HTMLElement) {
  const pdfInput = container.querySelectorAll('input[type="file"]')[0] as HTMLInputElement;
  const file = await twoPagePdf();
  await act(async () => {
    fireEvent.change(pdfInput, { target: { files: [file] } });
  });
  await screen.findByText("หน้า 1");

  // Swapping the two pages changes `dirtyKey`'s page order, which is what
  // "unsaved" means for a tool that has no save button at all.
  await act(async () => {
    fireEvent.click(screen.getAllByTitle("เลื่อนลงหนึ่งตำแหน่ง")[0]);
  });
}

/** Click through to the leave guard's save option. */
async function chooseSaveAndLeave() {
  fireEvent.click(screen.getByText("กลับไป Admin Panel"));
  const save = await screen.findByRole("button", { name: /บันทึกแล้วออก/ });
  await act(async () => {
    fireEvent.click(save);
  });
}

describe("PDF editor — “บันทึกแล้วออก” only leaves once a file really came out", () => {
  it("STAYS on the page when the export fails, so the work is not thrown away", async () => {
    // The real failure: Sarabun is unreachable, or a placed picture is not a
    // PNG/JPG. `applyEdits` rejects, the error modal goes up, and there is no
    // file — leaving now would destroy everything with nothing to show for it.
    applyEdits.mockRejectedValue(
      new Error("โหลดฟอนต์ภาษาไทย (Sarabun) ไม่สำเร็จ จึงใส่ข้อความลงใน PDF ไม่ได้")
    );

    const { container } = render(<PdfEditorPage />);
    await openAndDirty(container);
    await chooseSaveAndLeave();

    await waitFor(() => expect(applyEdits).toHaveBeenCalledTimes(1));
    expect(push).not.toHaveBeenCalled();
    // The Thai reason is on screen and the editor is still there behind it.
    expect(await screen.findByText(/Sarabun/)).toBeInTheDocument();
    expect(screen.getByText("เครื่องมือแก้ไข PDF")).toBeInTheDocument();
  });

  it("leaves for /adminpanel once the download has actually been produced", async () => {
    applyEdits.mockResolvedValue(new Uint8Array([0x25, 0x50, 0x44, 0x46]));

    const { container } = render(<PdfEditorPage />);
    await openAndDirty(container);
    await chooseSaveAndLeave();

    await waitFor(() => expect(push).toHaveBeenCalledWith("/adminpanel"));
    expect(applyEdits).toHaveBeenCalledTimes(1);
  });
});

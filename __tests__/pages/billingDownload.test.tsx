/**
 * ⬇️ ดาวน์โหลด PDF on an invoice / billing note / receipt saves the document
 * first. The PDF goes to a customer, so it must NOT be made when that save
 * does not land — a failed save, or a number the ledger refused and no free
 * one could be found — or the customer holds a tax document the system does
 * not have, whose number can then be issued to someone else. The save used to
 * be "best-effort" and the PDF was rasterised regardless.
 */
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => "/billing",
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
vi.mock("@/app/context/AuthContext", () => ({
  useAuth: () => ({ isLoggedIn: true, isLoading: false }),
}));

const html2canvas = vi.fn(async () => ({ toDataURL: () => "data:image/jpeg;base64,AA==" }));
const pdfSave = vi.fn();
vi.mock("html2canvas-pro", () => ({ default: html2canvas }));
vi.mock("jspdf", () => ({
  jsPDF: class {
    internal = { pageSize: { getWidth: () => 210, getHeight: () => 297 } };
    addImage() {}
    save = pdfSave;
  },
}));

import BillingPage from "@/app/billing/page";

const DOC = {
  id: "b1",
  docNo: "INV2609250001",
  docType: "invoice",
  linkedQuotationId: null,
  data: { customerCompany: "ลูกค้า", items: [] },
};

/** `post` answers every POST /api/billing, in order (the last one repeats). */
function mockFetch(post: Array<{ status: number; body?: unknown } | "network-error">) {
  let n = 0;
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/billing" && init?.method === "POST") {
      const r = post[Math.min(n++, post.length - 1)];
      if (r === "network-error") throw new TypeError("Failed to fetch");
      return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body ?? {} };
    }
    if (url === "/api/billing/b1") return { ok: true, status: 200, json: async () => DOC };
    return { ok: true, status: 200, json: async () => [] };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function clickDownload() {
  render(<BillingPage />);
  const button = await screen.findByRole("button", { name: /ดาวน์โหลด PDF/ });
  // Wait for the document to load (its number is on the sheet) before clicking.
  await waitFor(() => expect(document.body.textContent).toContain(DOC.docNo));
  fireEvent.click(button);
}

beforeEach(() => {
  window.history.replaceState(null, "", "/billing?id=b1&view=1");
  html2canvas.mockClear();
  pdfSave.mockClear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("billing ⬇️ ดาวน์โหลด PDF — saves first, and never makes a PDF of an unsaved document", () => {
  it("makes the PDF when the save lands", async () => {
    mockFetch([{ status: 200 }]);
    await clickDownload();
    await waitFor(() => expect(pdfSave).toHaveBeenCalledTimes(1));
    expect(pdfSave.mock.calls[0][0]).toContain("INV2609250001");
  });

  it("makes NO PDF when the save fails (e.g. a 500, an expired session)", async () => {
    mockFetch([{ status: 500 }]);
    await clickDownload();
    expect(await screen.findByText(/บันทึกเอกสารไม่สำเร็จ จึงยังไม่ได้สร้าง PDF/)).toBeDefined();
    expect(html2canvas).not.toHaveBeenCalled();
    expect(pdfSave).not.toHaveBeenCalled();
    // The button is usable again, so the admin can retry.
    await waitFor(() =>
      expect((screen.getByRole("button", { name: /ดาวน์โหลด PDF/ }) as HTMLButtonElement).disabled).toBe(false)
    );
  });

  it("makes NO PDF when the save never reaches the server", async () => {
    mockFetch(["network-error"]);
    await clickDownload();
    expect(await screen.findByText(/บันทึกเอกสารไม่สำเร็จ/)).toBeDefined();
    expect(pdfSave).not.toHaveBeenCalled();
  });

  it("makes NO PDF under a number the ledger refused, when no free one is found", async () => {
    // Every POST is refused; the ledger read (fetchLedgerByBases) returns
    // nothing, so there is no free number to advance to.
    mockFetch([{ status: 409, body: { error: "เลขที่เอกสารซ้ำ" } }]);
    await clickDownload();
    expect(await screen.findByText(/ยังไม่ได้สร้าง PDF/)).toBeDefined();
    expect(html2canvas).not.toHaveBeenCalled();
    expect(pdfSave).not.toHaveBeenCalled();
  });

  it("makes NO PDF when the retry under the next free number fails too", async () => {
    // The first POST is refused, the ledger has a free number, and the POST
    // under it fails for another reason.
    mockFetch([{ status: 409 }, { status: 500 }]);
    await clickDownload();
    expect(await screen.findByText(/ยังไม่ได้สร้าง PDF/)).toBeDefined();
    expect(pdfSave).not.toHaveBeenCalled();
  });

  it("makes the PDF under the advanced number when the retry lands", async () => {
    mockFetch([{ status: 409 }, { status: 200 }]);
    await clickDownload();
    await waitFor(() => expect(pdfSave).toHaveBeenCalledTimes(1));
    expect(pdfSave.mock.calls[0][0]).not.toContain("INV2609250001");
  });
});

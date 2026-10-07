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

// Which arithmetic a document is saved under (lib/quotationTotals.ts,
// `totalsVersion`): a document saved before keeps the original for good — its
// printed numbers never move — a FRESH one gets version 2, a new version keeps
// its source's, and a receipt takes the version of the invoice it settles.
describe("billing — the arithmetic a document is saved under", () => {
  const savedData = (fetchMock: ReturnType<typeof mockFetch>) => {
    const call = fetchMock.mock.calls.find(([u, i]) => String(u) === "/api/billing" && i?.method === "POST");
    return JSON.parse(String(call![1]!.body)).data;
  };

  it("a document saved before the change writes back NO version — it keeps the original", async () => {
    const fetchMock = mockFetch([{ status: 200 }]);
    await clickDownload();
    await waitFor(() => expect(pdfSave).toHaveBeenCalledTimes(1));
    expect(savedData(fetchMock)).not.toHaveProperty("totalsVersion");
  });

  it("a NEW document is issued under version 2", async () => {
    window.history.replaceState(null, "", "/billing");
    const fetchMock = mockFetch([{ status: 200 }]);
    render(<BillingPage />);
    fireEvent.click(await screen.findByRole("button", { name: /💾 บันทึก/ }));
    await waitFor(() => expect(savedData(fetchMock).totalsVersion).toBe(2));
  });

  it("a new version of an old document keeps the original arithmetic", async () => {
    window.history.replaceState(null, "", "/billing?id=b1&action=clone");
    const fetchMock = mockFetch([{ status: 200 }]);
    render(<BillingPage />);
    await screen.findByDisplayValue(`${DOC.docNo}v1`);
    fireEvent.click(await screen.findByRole("button", { name: /💾 บันทึก/ }));
    await waitFor(() => expect(savedData(fetchMock).docNo).toBe(`${DOC.docNo}v1`));
    expect(savedData(fetchMock)).not.toHaveProperty("totalsVersion");
  });

  // The payment a receipt records is its own total. Computed in another
  // arithmetic than the invoice it settles, one receipt in four for a % bill
  // discount would be a satang off and leave "ค้าง ฿0.01" for good.
  describe("a receipt settles its invoice in the invoice's arithmetic", () => {
    const INVOICES = [
      { id: "inv-old", docNo: "INV010926-22", customerName: "ลูกค้าเก่า", outstanding: 104.17, totalsVersion: null },
      { id: "inv-new", docNo: "INV071026-22", customerName: "ลูกค้าใหม่", outstanding: 104.18, totalsVersion: 2 },
    ];
    function stubReceiptFetch() {
      const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === "/api/billing" && init?.method === "POST") return { ok: true, status: 200, json: async () => ({}) };
        if (url === "/api/billing/open-invoices") return { ok: true, status: 200, json: async () => INVOICES };
        return { ok: true, status: 200, json: async () => [] };
      });
      vi.stubGlobal("fetch", fetchMock);
      return fetchMock as unknown as ReturnType<typeof mockFetch>;
    }
    async function issueReceiptFor(docNo: string) {
      window.history.replaceState(null, "", "/billing?type=receipt");
      const fetchMock = stubReceiptFetch();
      render(<BillingPage />);
      fireEvent.click(await screen.findByRole("button", { name: /ยังไม่ผูกกับใบแจ้งหนี้/ }));
      fireEvent.click(await screen.findByRole("button", { name: new RegExp(docNo) }));
      fireEvent.click(screen.getByRole("button", { name: /💾 บันทึก/ }));
      await waitFor(() => expect(savedData(fetchMock).settlesDocId).toBeTruthy());
      return savedData(fetchMock);
    }

    it("an invoice issued before the change: the receipt keeps the original arithmetic", async () => {
      const data = await issueReceiptFor("INV010926-22");
      expect(data.settlesDocId).toBe("inv-old");
      expect(data).not.toHaveProperty("totalsVersion");
    });

    it("an invoice issued under version 2: the receipt is version 2", async () => {
      const data = await issueReceiptFor("INV071026-22");
      expect(data.settlesDocId).toBe("inv-new");
      expect(data.totalsVersion).toBe(2);
    });
  });
});

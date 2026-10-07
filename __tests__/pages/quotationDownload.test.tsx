/**
 * ⬇️ ดาวน์โหลด PDF on a saved quotation saves it first. The PDF is the copy
 * the customer keeps, so — as for billing, PO and service-job documents — it
 * must NOT be made when that save does not land: the customer would hold a
 * number the system does not know, free to be issued again to someone else.
 * The save used to be best-effort ("ดาวน์โหลดแล้ว (แต่บันทึกประวัติไม่สำเร็จ)")
 * and the PDF was made regardless.
 */
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => "/quotation",
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
    addPage() {}
    save = pdfSave;
  },
}));

import QuotationPage from "@/app/quotation/page";

const DOC_NO = "QT250926-7";
const RECORD = {
  id: "q1",
  docNo: DOC_NO,
  data: { docNo: DOC_NO, docDate: "2026-09-25", customerCompany: "ลูกค้าทดสอบ", items: [] },
};

/** `post` answers the POST /api/quotations the download makes. */
function mockFetch(post: { status: number; body?: unknown } | "network-error") {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/quotations" && init?.method === "POST") {
      if (post === "network-error") throw new TypeError("Failed to fetch");
      return { ok: post.status >= 200 && post.status < 300, status: post.status, json: async () => post.body ?? {} };
    }
    if (url === "/api/quotations/q1") return { ok: true, status: 200, json: async () => RECORD };
    return { ok: true, status: 200, json: async () => [] };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function clickDownload() {
  render(<QuotationPage />);
  // Wait for the saved quotation (its number is on the sheet) before clicking.
  await waitFor(() => expect(document.body.textContent).toContain(DOC_NO));
  fireEvent.click(screen.getByRole("button", { name: /ดาวน์โหลด PDF/ }));
}

const downloadButton = () => screen.getByRole("button", { name: /ดาวน์โหลด PDF/ }) as HTMLButtonElement;

beforeEach(() => {
  window.history.replaceState(null, "", "/quotation?id=q1&view=1");
  html2canvas.mockClear();
  pdfSave.mockClear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

describe("quotation ⬇️ ดาวน์โหลด PDF — saves first, and never makes a PDF of an unsaved quotation", () => {
  it("makes the PDF when the save lands, then asks whether to keep the record", async () => {
    mockFetch({ status: 200 });
    await clickDownload();
    await waitFor(() => expect(pdfSave).toHaveBeenCalledTimes(1));
    expect(pdfSave.mock.calls[0][0]).toBe(`Quotation-${DOC_NO}.pdf`);
    expect(await screen.findByText("ดาวน์โหลดเรียบร้อย ✅")).toBeDefined();
  });

  it("makes NO PDF when the save fails (e.g. a 500, an expired session)", async () => {
    mockFetch({ status: 500, body: { error: "boom" } });
    await clickDownload();
    expect(await screen.findByText(/บันทึกใบเสนอราคาไม่สำเร็จ จึงยังไม่ได้สร้าง PDF/)).toBeDefined();
    expect(html2canvas).not.toHaveBeenCalled();
    expect(pdfSave).not.toHaveBeenCalled();
    expect(screen.queryByText("ดาวน์โหลดเรียบร้อย ✅")).toBeNull();
  });

  it("makes NO PDF when the save never reaches the server", async () => {
    mockFetch("network-error");
    await clickDownload();
    expect(await screen.findByText(/บันทึกใบเสนอราคาไม่สำเร็จ/)).toBeDefined();
    expect(pdfSave).not.toHaveBeenCalled();
  });

  it("lets the admin try again after a failed save", async () => {
    const fetchMock = mockFetch({ status: 503 });
    await clickDownload();
    await screen.findByText(/บันทึกใบเสนอราคาไม่สำเร็จ/);

    // A second press really posts again (nothing is stuck "generating").
    fireEvent.click(downloadButton());
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.filter(([u, init]) => u === "/api/quotations" && init?.method === "POST")
      ).toHaveLength(2)
    );
    expect(pdfSave).not.toHaveBeenCalled();
  });
});

// Which arithmetic a quotation is saved under (lib/quotationTotals.ts,
// `totalsVersion`): one saved before keeps the original for good — what the
// customer was sent never moves — a FRESH one gets 2, and a new version keeps
// the arithmetic of the quotation it continues.
describe("quotation — the arithmetic a document is saved under", () => {
  const savedData = (fetchMock: ReturnType<typeof mockFetch>) => {
    const calls = fetchMock.mock.calls.filter(([u, i]) => String(u) === "/api/quotations" && i?.method === "POST");
    return JSON.parse(String(calls.at(-1)![1]!.body)).data;
  };

  it("a quotation saved before the change writes back NO version — it keeps the original", async () => {
    const fetchMock = mockFetch({ status: 200 });
    await clickDownload();
    await waitFor(() => expect(pdfSave).toHaveBeenCalledTimes(1));
    expect(savedData(fetchMock)).not.toHaveProperty("totalsVersion");
  });

  it("a NEW quotation is issued under version 2", async () => {
    window.history.replaceState(null, "", "/quotation");
    const fetchMock = mockFetch({ status: 200 });
    render(<QuotationPage />);
    fireEvent.click(await screen.findByRole("button", { name: /💾 เซฟ/ }));
    await waitFor(() => expect(savedData(fetchMock).totalsVersion).toBe(2));
  });

  /** Run `body` with the saved quotation carrying `totalsVersion` (or not). */
  async function withSourceVersion(version: number | undefined, body: () => Promise<void>) {
    const data = RECORD.data as Record<string, unknown>;
    if (version === undefined) delete data.totalsVersion;
    else data.totalsVersion = version;
    try {
      await body();
    } finally {
      delete data.totalsVersion;
    }
  }

  it.each([[undefined], [2]])(
    "แก้ไข (New Ver.) keeps the arithmetic of the quotation it continues (source: %s)",
    async (version) => {
      await withSourceVersion(version, async () => {
        const fetchMock = mockFetch({ status: 200 });
        render(<QuotationPage />);
        await waitFor(() => expect(document.body.textContent).toContain(DOC_NO));
        fireEvent.click(screen.getByRole("button", { name: /แก้ไข \(New Ver\.\)/ }));
        fireEvent.click(await screen.findByRole("button", { name: /💾 เซฟ/ }));
        await waitFor(() => expect(savedData(fetchMock).docNo).toBe(`${DOC_NO}v1`));
        expect(savedData(fetchMock).totalsVersion).toBe(version);
      });
    }
  );

  it.each([[undefined], [2]])(
    "a new version opened by link (?action=clone) keeps its source's arithmetic too (source: %s)",
    async (version) => {
      await withSourceVersion(version, async () => {
        window.history.replaceState(null, "", "/quotation?id=q1&action=clone");
        const fetchMock = mockFetch({ status: 200 });
        render(<QuotationPage />);
        await screen.findByText(/เวอร์ชันใหม่ QT250926-7v1/);
        fireEvent.click(await screen.findByRole("button", { name: /💾 เซฟ/ }));
        await waitFor(() => expect(savedData(fetchMock).docNo).toBe(`${DOC_NO}v1`));
        expect(savedData(fetchMock).totalsVersion).toBe(version);
      });
    }
  );
});

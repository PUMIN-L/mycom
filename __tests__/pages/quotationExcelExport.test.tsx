import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/app/context/AuthContext", () => ({
  useAuth: () => ({ isLoggedIn: true, isLoading: false }),
}));

const downloadDocumentFormExcelMock = vi.fn(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async (_filename: string, _sheetName: string, _opts: any) => {}
);
vi.mock("@/app/lib/documentFormExcel", () => ({
  downloadDocumentFormExcel: downloadDocumentFormExcelMock,
}));

import QuotationPage from "@/app/quotation/page";

const REC = {
  id: "q1",
  docNo: "QT150926-22",
  data: {
    id: "q1",
    docNo: "QT150926-22",
    docDate: "2026-09-15",
    validDays: 30,
    customerContact: "คุณสมชาย",
    customerCompany: "บริษัท ก จำกัด",
    customerAddress: "123 ถนนสุขุมวิท",
    customerPhone: "020000000",
    customerEmail: "somchai@example.com",
    sellerName: "คุณสมหญิง",
    items: [
      { id: "i1", name: "เครื่องชั่ง A", description: "รุ่น A1", qty: 2, unit: "เครื่อง", unitPrice: 1000, imageUrl: "", imageUploaded: false },
    ],
    discount: 0,
    discountType: "amount",
    vatEnabled: true,
    conditions: [{ id: "c1", label: "เงื่อนไขชำระเงิน", value: "ชำระเงิน 100% ก่อนส่งมอบ" }],
    note: "",
  },
};

function stubFetch() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/quotations/q1") {
      return { ok: true, status: 200, json: async () => REC } as unknown as Response;
    }
    return { ok: true, status: 200, json: async () => [] } as unknown as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.clearAllMocks();
  window.history.pushState({}, "", "/quotation?id=q1&view=1");
});

describe("/quotation — ดาวน์โหลด Excel", () => {
  it("shows the Excel button alongside PDF once the quotation is reopened in view mode", async () => {
    stubFetch();
    render(<QuotationPage />);
    expect(await screen.findByRole("button", { name: /ดาวน์โหลด Excel/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /ดาวน์โหลด PDF/ })).toBeInTheDocument();
  });

  it("builds a single styled form sheet from the loaded quotation, without calling the save endpoint", async () => {
    const fetchMock = stubFetch();
    render(<QuotationPage />);

    fireEvent.click(await screen.findByRole("button", { name: /ดาวน์โหลด Excel/ }));

    await waitFor(() => expect(downloadDocumentFormExcelMock).toHaveBeenCalledTimes(1));
    const [filename, sheetName, opts] = downloadDocumentFormExcelMock.mock.calls[0];
    expect(filename).toBe("Quotation-QT150926-22.xlsx");
    expect(sheetName).toBe("ใบเสนอราคา");
    expect(opts.titleTh).toBe("ใบเสนอราคา");
    expect(opts.secondaryParty.name).toBe("บริษัท ก จำกัด");

    expect(opts.items).toHaveLength(1);
    expect(opts.items[0]).toMatchObject({ qty: 2, unitPrice: 1000 });
    expect(String(opts.items[0].name)).toContain("เครื่องชั่ง A");

    // Excel export must never save the document — that stays the PDF/save
    // buttons' own job (spec: add-excel-export-to-documents).
    expect(
      fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === "POST")
    ).toBe(false);
  });

  it("includes the quotation's conditions and totals in the form's notes/totals blocks", async () => {
    stubFetch();
    render(<QuotationPage />);
    fireEvent.click(await screen.findByRole("button", { name: /ดาวน์โหลด Excel/ }));

    await waitFor(() => expect(downloadDocumentFormExcelMock).toHaveBeenCalledTimes(1));
    const [, , opts] = downloadDocumentFormExcelMock.mock.calls[0];

    expect(
      opts.notes.some(
        (n: { label: string; text: string }) =>
          n.label === "เงื่อนไขชำระเงิน" && n.text === "ชำระเงิน 100% ก่อนส่งมอบ"
      )
    ).toBe(true);

    const grandTotal = opts.totals.find((t: { emphasize?: boolean }) => t.emphasize);
    expect(grandTotal).toBeDefined();
  });
});

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

import BillingPage from "@/app/billing/page";

function invoiceRecord() {
  return {
    id: "b1",
    docType: "invoice",
    docNo: "INV150926-05",
    dueDate: "2026-10-15",
    paymentMethod: "",
    paymentDate: "",
    paymentRef: "",
    data: {
      id: "b1",
      docType: "invoice",
      docNo: "INV150926-05",
      docDate: "2026-09-15",
      customerContact: "คุณสมชาย",
      customerCompany: "บริษัท ก จำกัด",
      customerAddress: "123 ถนนสุขุมวิท",
      customerPhone: "020000000",
      companyTaxId: "0-0000-00000-00-0",
      items: [
        { id: "i1", name: "เครื่องชั่ง A", description: "รุ่น A1", qty: 2, unit: "เครื่อง", unitPrice: 1000 },
      ],
      discount: 0,
      discountType: "amount",
      vatEnabled: true,
      note: "",
    },
  };
}

function receiptRecord() {
  const base = invoiceRecord();
  return {
    ...base,
    docType: "receipt",
    docNo: "RC150926-05",
    paymentMethod: "โอนเงิน",
    paymentDate: "2026-09-15",
    paymentRef: "REF-001",
    data: { ...base.data, docType: "receipt", docNo: "RC150926-05" },
  };
}

function stubFetch(record: ReturnType<typeof invoiceRecord>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = String(input);
    if (url === `/api/billing/${record.id}`) {
      return { ok: true, status: 200, json: async () => record } as unknown as Response;
    }
    return { ok: true, status: 200, json: async () => [] } as unknown as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("/billing — ดาวน์โหลด Excel", () => {
  it("shows the Excel button alongside PDF once an invoice is reopened in view mode", async () => {
    const record = invoiceRecord();
    stubFetch(record);
    window.history.pushState({}, "", `/billing?id=${record.id}&view=1`);
    render(<BillingPage />);
    expect(await screen.findByRole("button", { name: /ดาวน์โหลด Excel/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /ดาวน์โหลด PDF/ })).toBeInTheDocument();
  });

  it("builds a single styled form sheet for an invoice, with no receipt-only payment notes and without saving", async () => {
    const record = invoiceRecord();
    const fetchMock = stubFetch(record);
    window.history.pushState({}, "", `/billing?id=${record.id}&view=1`);
    render(<BillingPage />);

    fireEvent.click(await screen.findByRole("button", { name: /ดาวน์โหลด Excel/ }));

    await waitFor(() => expect(downloadDocumentFormExcelMock).toHaveBeenCalledTimes(1));
    const [filename, sheetName, opts] = downloadDocumentFormExcelMock.mock.calls[0];
    expect(filename).toBe("INV-INV150926-05.xlsx");
    expect(sheetName).toBe("ใบแจ้งหนี้ / ใบกำกับภาษี");
    expect(opts.secondaryParty.name).toBe("บริษัท ก จำกัด");
    expect(opts.items).toHaveLength(1);
    expect(opts.items[0]).toMatchObject({ qty: 2, unitPrice: 1000 });

    const noteLabels = opts.notes.map((n: { label: string }) => n.label);
    expect(noteLabels).not.toContain("ช่องทางการชำระเงิน");

    expect(
      fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === "POST")
    ).toBe(false);
  });

  it("includes the receipt-only payment fields as notes for a receipt", async () => {
    const record = receiptRecord();
    stubFetch(record);
    window.history.pushState({}, "", `/billing?id=${record.id}&view=1`);
    render(<BillingPage />);

    fireEvent.click(await screen.findByRole("button", { name: /ดาวน์โหลด Excel/ }));

    await waitFor(() => expect(downloadDocumentFormExcelMock).toHaveBeenCalledTimes(1));
    const [, , opts] = downloadDocumentFormExcelMock.mock.calls[0];
    const paymentNote = opts.notes.find((n: { label: string }) => n.label === "ช่องทางการชำระเงิน");
    expect(paymentNote?.text).toBe("โอนเงิน");
  });
});

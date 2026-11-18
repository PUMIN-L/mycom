/**
 * Recording an invoice issued elsewhere, through the real pages:
 *  • the form asks for the number as printed and where the paper is kept
 *    (no file), refuses a number shaped like the system's own, and records
 *    it at once — no draft, no number of ours;
 *  • the document's page says where the original is, prints nothing, and
 *    fixes a typo in the number with a reason;
 *  • the list tags it ภายนอก.
 */
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const router = { push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() };
let params: Record<string, string> = {};
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/accounting/invoices",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => params,
}));

import RecordExternalInvoicePage from "@/app/accounting/invoices/record-external/page";
import InvoiceDocumentPage from "@/app/accounting/invoices/[id]/page";
import InvoiceListPage from "@/app/accounting/invoices/page";

const SELLER = { name: "บริษัท โปรฟิน แล็บ จำกัด", address: "93 นนทบุรี", taxId: "0107537000114", branchCode: "00000", phone: "", email: "" };
const SETTINGS = { seller: SELLER, sellerVersionId: "v1", vatRate: 7, creditDays: 30, bankAccounts: [] };
const EXTERNAL_DOC = {
  id: "x1", docType: "INV", docNo: "IV-2569/0042", status: "issued", source: "external", externalNote: "แฟ้มใบกำกับ 2569 ตู้ 2",
  isTaxInvoice: true, issueDate: "2026-11-10", dueDate: "2026-12-10", creditDays: 30, companyId: "", customerId: "", salespersonId: "",
  buyerName: "บริษัท บี จำกัด", buyerAddress: "2 ถนนพหลโยธิน", buyerTaxId: "", buyerBranch: "", priceMode: "exclusive", vatRate: 7,
  subtotalSatang: 1900000, discountSatang: 0, depositSatang: 0, vatBaseSatang: 1900000, vatSatang: 133000, totalSatang: 2033000, paidSatang: 0,
  customerPoNo: "", projectName: "", note: "", salesRecordId: "sale-7", issuedAt: "2026-11-10T03:00:00.000Z", issuedBy: "admin", createdBy: "admin", updatedAt: "t1",
  lines: [{ lineType: "service", productId: "", name: "สอบเทียบ", qty: 1, unit: "งาน", unitPriceSatang: 1900000, discountSatang: 0, amountSatang: 1900000, isMachine: false, serials: "", warrantyMonths: null }],
};

const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });
let override: ((path: string, init?: RequestInit) => unknown) | null;
let fetchMock: ReturnType<typeof vi.fn>;
const calls = (path: string, method = "GET") =>
  fetchMock.mock.calls.filter(([u, i]) => new URL(String(u), "http://localhost").pathname === path && ((i as RequestInit | undefined)?.method ?? "GET") === method);

beforeEach(() => {
  override = null;
  params = {};
  router.replace.mockClear();
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const custom = override?.(url.pathname, init);
    if (custom !== undefined) return custom;
    switch (url.pathname) {
      case "/api/accounting/status": return json({ twoFactorEnabled: true, username: "admin" });
      case "/api/accounting/settings": return json(SETTINGS);
      case "/api/accounting/documents/external": return json({ notes: ["แฟ้มใบกำกับ 2569 ตู้ 2"] });
      case "/api/accounting/audit": return json([]);
      default: return json([]);
    }
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("recording an outside invoice", () => {
  async function loaded() {
    render(<RecordExternalInvoicePage />);
    await screen.findByLabelText(/เลขที่ตามเอกสารจริง/);
  }
  const fillValid = () => {
    fireEvent.change(screen.getByLabelText(/เลขที่ตามเอกสารจริง/), { target: { value: "IV-2569/0042" } });
    fireEvent.change(screen.getByLabelText(/เก็บต้นฉบับไว้ที่/), { target: { value: "แฟ้มใบกำกับ 2569 ตู้ 2" } });
    fireEvent.change(screen.getByLabelText(/ชื่อลูกค้าที่พิมพ์ในเอกสาร/), { target: { value: "บริษัท บี จำกัด" } });
    fireEvent.change(screen.getByLabelText("ชื่อรายการที่ 1"), { target: { value: "สอบเทียบ" } });
    fireEvent.change(screen.getByLabelText("ราคา/หน่วย (บาท)"), { target: { value: "19000" } });
  };

  it("offers where papers were kept lately, and has one button — no draft", async () => {
    await loaded();
    await waitFor(() => expect(document.querySelectorAll("#inv-externalNote-options option")).toHaveLength(1));
    expect(screen.getByRole("button", { name: "บันทึกเอกสาร" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "บันทึกร่าง" })).toBeNull();
    expect(screen.queryByRole("button", { name: "ออกเอกสาร ▸" })).toBeNull();
  });

  it("refuses a number shaped like the system's own, under the field, sending nothing", async () => {
    await loaded();
    fillValid();
    fireEvent.change(screen.getByLabelText(/เลขที่ตามเอกสารจริง/), { target: { value: "INV2026110001" } });
    fireEvent.click(screen.getByRole("button", { name: "บันทึกเอกสาร" }));
    expect(await screen.findByText(/รูปแบบเดียวกับเลขที่ระบบออกเอง/, { selector: "[data-field-error]" })).toBeInTheDocument();
    expect(calls("/api/accounting/documents/external", "POST")).toHaveLength(0);
  });

  it("records it with the VAT as printed, and opens it", async () => {
    override = (path, init) => (path === "/api/accounting/documents/external" && init?.method === "POST" ? json(EXTERNAL_DOC, 201) : undefined);
    await loaded();
    fillValid();
    fireEvent.change(screen.getByLabelText(/ภาษีมูลค่าเพิ่ม 7% \(ตามเอกสาร\)/), { target: { value: "1,330.02" } });
    expect(within(screen.getByTestId("invoice-totals")).getByText("20,330.02")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "บันทึกเอกสาร" }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/accounting/invoices/x1"));
    const body = JSON.parse(String((calls("/api/accounting/documents/external", "POST")[0][1] as RequestInit).body));
    expect(body).toMatchObject({ docNo: "IV-2569/0042", externalNote: "แฟ้มใบกำกับ 2569 ตู้ 2", vatSatangOverride: 133002, buyerName: "บริษัท บี จำกัด" });
  });
});

describe("an outside invoice's page", () => {
  beforeEach(() => {
    params = { id: "x1" };
    override = (path, init) => {
      if (path === "/api/accounting/documents/x1" && !init?.method) {
        return json({ document: EXTERNAL_DOC, seller: SELLER, impact: { status: "issued", docNo: "IV-2569/0042", isLatestNumber: false, livePayments: 0, dependentDocs: 0, sale: null, machines: { total: 0, withHistory: 0 } } });
      }
      if (path === "/api/accounting/documents/x1/external" && init?.method === "PATCH") return json({ ...EXTERNAL_DOC, docNo: "IV-2569/0043" });
      return undefined;
    };
  });

  it("says where the original is kept, and prints nothing", async () => {
    render(<InvoiceDocumentPage />);
    expect(await screen.findByTestId("external-banner")).toHaveTextContent("ต้นฉบับเก็บไว้ที่: แฟ้มใบกำกับ 2569 ตู้ 2");
    expect(screen.queryByRole("button", { name: "พิมพ์ต้นฉบับ" })).toBeNull();
  });

  it("fixes a typo in the number — only with a reason", async () => {
    render(<InvoiceDocumentPage />);
    fireEvent.click(await screen.findByRole("button", { name: "แก้เลขที่ / ที่เก็บต้นฉบับ" }));
    const dialog = screen.getByRole("dialog", { name: "แก้เลขที่ / ที่เก็บต้นฉบับ" });
    fireEvent.change(within(dialog).getByLabelText("เลขที่ตามเอกสารจริง"), { target: { value: "IV-2569/0043" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "บันทึก" }));
    expect(within(dialog).getByText("กรุณาบอกเหตุผลที่แก้")).toBeInTheDocument();
    expect(calls("/api/accounting/documents/x1/external", "PATCH")).toHaveLength(0);

    fireEvent.change(within(dialog).getByLabelText(/เหตุผลที่แก้/), { target: { value: "พิมพ์เลขผิด" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "บันทึก" }));
    await waitFor(() => expect(calls("/api/accounting/documents/x1/external", "PATCH")).toHaveLength(1));
    expect(JSON.parse(String((calls("/api/accounting/documents/x1/external", "PATCH")[0][1] as RequestInit).body))).toEqual({
      docNo: "IV-2569/0043",
      externalNote: "แฟ้มใบกำกับ 2569 ตู้ 2",
      reason: "พิมพ์เลขผิด",
    });
  });
});

describe("the list", () => {
  it("tags an outside invoice ภายนอก, and offers to record one", async () => {
    override = (path) =>
      path === "/api/accounting/documents"
        ? json([{ id: "x1", docNo: "IV-2569/0042", status: "issued", source: "external", isTaxInvoice: true, issueDate: "2026-11-10", dueDate: "2026-12-10", buyerName: "บริษัท บี จำกัด", projectName: "", customerPoNo: "", totalSatang: 2033000, paidSatang: 0 }])
        : path === "/api/accounting/documents/summary"
          ? json({ outstandingSatang: 0, outstandingCount: 0, overdueSatang: 0, overdueCount: 0, issuedInMonthSatang: 0 })
          : undefined;
    render(<InvoiceListPage />);
    const table = await screen.findByTestId("invoice-table");
    expect(within(table).getByText("ภายนอก")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "บันทึกเอกสารจากที่อื่น" })).toHaveAttribute("href", "/accounting/invoices/record-external");
  });
});

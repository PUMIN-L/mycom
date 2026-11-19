/**
 * Credit notes, voiding and refunds (step 8), through the real pages:
 *  • writing one: the invoice's own lines picked and cut back, why, the values
 *    the paper prints, and the number it will get — nothing sent while
 *    something is wrong;
 *  • one credit note: the paper (§86/10), voided with a reason and the password;
 *  • the invoice: what credit notes took off, what is due back to the
 *    customer and recording that refund, voiding the invoice itself;
 *  • the list, receivables' money due back, a refund in the payments panel.
 */
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const router = { push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() };
let params: Record<string, string> = {};
let search = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/accounting/credit-notes",
  useSearchParams: () => search,
  useParams: () => params,
}));

import NewCreditNotePage from "@/app/accounting/credit-notes/new/page";
import CreditNotePage from "@/app/accounting/credit-notes/[id]/page";
import CreditNoteListPage from "@/app/accounting/credit-notes/page";
import InvoiceDocumentPage from "@/app/accounting/invoices/[id]/page";
import ReceivablesPage from "@/app/accounting/receivables/page";

const SELLER = { name: "บริษัท โปรฟิน แล็บ จำกัด", address: "93 นนทบุรี", taxId: "0107537000114", branchCode: "00000", phone: "", email: "" };
const BANK = { id: "b1", bankName: "กสิกรไทย", accountNo: "123-4-56789-0", accountName: "บจก. โปรฟิน แล็บ", isActive: true, sortOrder: 0 };
const SETTINGS = { seller: SELLER, sellerVersionId: "v1", vatRate: 7, creditDays: 30, bankAccounts: [BANK] };
const LINE = { lineType: "goods", productId: "p1", name: "เครื่องวัดความดัน", qty: 2, unit: "เครื่อง", unitPriceSatang: 100000, discountSatang: 0, amountSatang: 200000, isMachine: false, serials: "", warrantyMonths: null };
/** 2 machines at 1,000.00 + VAT 7% = 2,140.00 — the tax invoice, paid in full. */
const INVOICE = {
  id: "inv1", docType: "INV", docNo: "INV2026110001", status: "issued", source: "internal", externalNote: "", isTaxInvoice: true,
  issueDate: "2026-11-01", dueDate: "2026-12-01", creditDays: 30, companyId: "co1", customerId: "c1", salespersonId: "",
  buyerName: "บริษัท เอ จำกัด", buyerAddress: "1 ถนนงามวงศ์วาน", buyerTaxId: "0105555000001", buyerBranch: "00000",
  priceMode: "exclusive", vatRate: 7, subtotalSatang: 200000, discountSatang: 0, depositSatang: 0, vatBaseSatang: 200000,
  vatSatang: 14000, totalSatang: 214000, paidSatang: 214000, creditedSatang: 0, customerPoNo: "", projectName: "", note: "", salesRecordId: "sale-1",
  relatedDocId: null, issuedAt: "2026-11-01T03:00:00.000Z", issuedBy: "admin", createdBy: "admin", updatedAt: "t1", voidReason: null,
  lines: [LINE],
};
const CREDIT = { issueDate: "2026-11-01", isTaxInvoice: true, priceMode: "exclusive", vatRate: 7, totalSatang: 214000, vatSatang: 14000, vatBaseSatang: 200000, creditedSatang: 0, creditedBaseSatang: 0, paidSatang: 214000 };
const IMPACT = { status: "issued", docNo: "INV2026110001", isLatestNumber: true, livePayments: 0, dependentDocs: 0, sale: null, machines: { total: 0, withHistory: 0 }, blockedReason: null };
const CN = {
  id: "cn1", docType: "CN", docNo: "CN2026110001", status: "issued", isTaxInvoice: true, issueDate: "2026-11-19", buyerName: "บริษัท เอ จำกัด",
  buyerAddress: "1 ถนนงามวงศ์วาน", buyerTaxId: "0105555000001", buyerBranch: "00000", priceMode: "exclusive", vatRate: 7, refValueSatang: 200000,
  vatBaseSatang: 100000, vatSatang: 7000, totalSatang: 107000, note: "รับคืนสินค้า เนื่องจากชำรุดเสียหาย / ไม่ตรงตามตัวอย่างหรือคำพรรณนา — เครื่อง 1 เครื่อง",
  relatedDocId: "inv1", voidReason: null, voidedAt: null, lines: [{ ...LINE, qty: 1, amountSatang: 100000 }],
};
const CN_IMPACT = { ...IMPACT, docNo: "CN2026110001", sale: { id: "credit-sale-1", costSatang: 0, sharedWithOtherDocs: false } };
const CONTEXT = { outstandingSatang: 0, serviceBaseSatang: 0, defaultWhtPercent: 0, receiptIsTaxInvoice: false };

const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });
let override: ((path: string, init?: RequestInit) => unknown) | null;
let fetchMock: ReturnType<typeof vi.fn>;
const calls = (path: string, method = "GET") =>
  fetchMock.mock.calls.filter(([u, i]) => new URL(String(u), "http://localhost").pathname === path && ((i as RequestInit | undefined)?.method ?? "GET") === method);
const bodyOf = (path: string, method: string) => JSON.parse(String((calls(path, method)[0][1] as RequestInit).body));
const choose = (id: string, label: string) => {
  fireEvent.click(document.getElementById(id)!);
  fireEvent.click(within(document.querySelector("[data-dropdown-panel]") as HTMLElement).getByText(label));
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-19T03:00:00Z"));
  override = null;
  params = {};
  search = new URLSearchParams();
  router.push.mockClear();
  router.replace.mockClear();
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const custom = override?.(url.pathname, init);
    if (custom !== undefined) return custom;
    switch (url.pathname) {
      case "/api/accounting/status": return json({ twoFactorEnabled: true, username: "admin" });
      case "/api/accounting/settings": return json(SETTINGS);
      case "/api/accounting/credit-notes/context": return json({ invoice: INVOICE, credit: CREDIT, creditNotes: [], refundDueSatang: 0 });
      case "/api/accounting/documents/next-number": return json({ docNo: "CN2026110001" });
      case "/api/accounting/credit-notes": return init?.method === "POST" ? json({ id: "cn1" }, 201) : json([]);
      case "/api/accounting/documents/cn1": return json({ document: CN, seller: SELLER, impact: CN_IMPACT, creditOf: { id: "inv1", docNo: "INV2026110001", issueDate: "2026-11-01", isTaxInvoice: true } });
      case "/api/accounting/documents/inv1": return json({ document: INVOICE, seller: SELLER, impact: IMPACT });
      case "/api/accounting/documents/inv1/payments": return json({ payments: [], ...CONTEXT });
      default: return json([]);
    }
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("writing a credit note", () => {
  beforeEach(() => {
    search = new URLSearchParams("invoice=inv1");
  });
  async function loaded() {
    render(<NewCreditNotePage />);
    return screen.findByRole("button", { name: "+ เครื่องวัดความดัน (2 เครื่อง)" });
  }

  it("takes a line from the invoice, cut back to what came back, and shows the values the paper prints", async () => {
    fireEvent.click(await loaded());
    expect(calls("/api/accounting/credit-notes/context")[0][0]).toContain("invoice=inv1");
    fireEvent.change(screen.getByLabelText("จำนวนรายการที่ 1"), { target: { value: "1" } });
    const values = screen.getByTestId("credit-values");
    expect(values).toHaveTextContent("มูลค่าตามใบกำกับภาษีเดิม2,000.00");
    expect(values).toHaveTextContent("มูลค่าที่ถูกต้อง1,000.00");
    expect(values).toHaveTextContent("ผลต่าง1,000.00");
    expect(values).toHaveTextContent("ภาษีมูลค่าเพิ่ม 7%70.00");
    expect(values).toHaveTextContent("รวมลดหนี้ทั้งสิ้น1,070.00");
    // Paid in full already: the customer will be owed this back.
    expect(screen.getByText(/ลูกค้าจ่ายเกิน 1,070.00 บาท/)).toBeInTheDocument();
  });

  it("issues it after saying the number it will get — then opens it", async () => {
    fireEvent.click(await loaded());
    fireEvent.change(screen.getByLabelText("จำนวนรายการที่ 1"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText(/รายละเอียดเพิ่ม/), { target: { value: "เครื่อง 1 เครื่อง" } });
    fireEvent.click(screen.getByRole("button", { name: "ออกใบลดหนี้" }));
    const dialog = screen.getByRole("dialog", { name: "ออกใบลดหนี้?" });
    expect(await within(dialog).findByText("CN2026110001")).toBeInTheDocument();
    expect(calls("/api/accounting/documents/next-number")[0][0]).toContain("type=CN");
    fireEvent.click(within(dialog).getByRole("button", { name: "ยืนยันออกใบลดหนี้" }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/accounting/credit-notes/cn1"));
    expect(bodyOf("/api/accounting/credit-notes", "POST")).toEqual({
      invoiceId: "inv1",
      issueDate: "2026-11-19",
      reason: "รับคืนสินค้า เนื่องจากชำรุดเสียหาย / ไม่ตรงตามตัวอย่างหรือคำพรรณนา — เครื่อง 1 เครื่อง",
      lines: [{ lineType: "goods", productId: "p1", name: "เครื่องวัดความดัน", qty: 1, unit: "เครื่อง", unitPriceSatang: 100000, discountSatang: 0, isMachine: false, serials: "", warrantyMonths: null }],
    });
  });

  it("sends nothing with no line, no reason, or more than the invoice has left", async () => {
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "ออกใบลดหนี้" }));
    expect(screen.getByText("กรุณาเพิ่มรายการที่ลดหนี้อย่างน้อย 1 รายการ")).toBeInTheDocument();
    choose("credit-reasonCase", "อื่น ๆ (ระบุเอง)");
    expect(screen.getByText("กรุณาระบุเหตุที่ลดหนี้")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("ระบุเหตุที่ลดหนี้"), { target: { value: "คิดราคาผิด" } });
    fireEvent.click(screen.getByRole("button", { name: "+ เครื่องวัดความดัน (2 เครื่อง)" }));
    fireEvent.click(screen.getByRole("button", { name: "+ เครื่องวัดความดัน (2 เครื่อง)" }));
    expect(screen.getByText("ลดหนี้เกินมูลค่าที่เหลือของใบแจ้งหนี้ — เหลือ 2,140.00 บาท")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "ออกใบลดหนี้" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "ลบรายการที่ 2" }));
    expect(screen.queryByText(/ลดหนี้เกินมูลค่าที่เหลือ/)).not.toBeInTheDocument();
    expect(calls("/api/accounting/credit-notes", "POST")).toHaveLength(0);
  });

  it("says what the server refused, and stays on the form", async () => {
    override = (path, init) => (path === "/api/accounting/credit-notes" && init?.method === "POST" ? json({ error: "ใบแจ้งหนี้นี้เปลี่ยนไปแล้ว — กรุณาเปิดหน้านี้ใหม่" }, 409) : undefined);
    fireEvent.click(await loaded());
    fireEvent.click(screen.getByRole("button", { name: "ออกใบลดหนี้" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "ออกใบลดหนี้?" })).getByRole("button", { name: "ยืนยันออกใบลดหนี้" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("ใบแจ้งหนี้นี้เปลี่ยนไปแล้ว — กรุณาเปิดหน้านี้ใหม่");
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("asks for an invoice when none was named, loading nothing", async () => {
    search = new URLSearchParams();
    render(<NewCreditNotePage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("ไม่ได้ระบุใบแจ้งหนี้");
    expect(calls("/api/accounting/credit-notes/context")).toHaveLength(0);
  });
});

describe("one credit note", () => {
  beforeEach(() => {
    params = { id: "cn1" };
  });

  it("prints what §86/10 asks: the invoice it lowers, the original, correct and difference values, and why", async () => {
    render(<CreditNotePage />);
    const values = await screen.findByTestId("credit-paper-values");
    expect(values).toHaveTextContent("มูลค่าตามใบกำกับภาษีเดิม2,000.00");
    expect(values).toHaveTextContent("มูลค่าที่ถูกต้อง1,000.00");
    expect(values).toHaveTextContent("ผลต่าง1,000.00");
    expect(values).toHaveTextContent("รวมลดหนี้ทั้งสิ้น1,070.00");
    expect(screen.getByTestId("credit-paper-reason")).toHaveTextContent("รับคืนสินค้า");
    expect(screen.getByText("อ้างถึงใบกำกับภาษี")).toBeInTheDocument();
    expect(screen.getByText(/เอกสารทางภาษี ตามมาตรา 86\/10/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "INV2026110001" })).toHaveAttribute("href", "/accounting/invoices/inv1");
  });

  it("is voided with a reason and the password", async () => {
    render(<CreditNotePage />);
    fireEvent.click(await screen.findByRole("button", { name: "ยกเลิกใบลดหนี้" }));
    const dialog = screen.getByRole("dialog", { name: "ยกเลิกใบลดหนี้ CN2026110001?" });
    expect(within(dialog).getByText(/ยอด 1,070.00 บาท กลับเป็นยอดของใบแจ้งหนี้ INV2026110001/)).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText(/รหัสผ่าน/), { target: { value: "pw" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "ยกเลิกเอกสาร" }));
    expect(await within(dialog).findByText("กรุณาบอกเหตุผลที่ยกเลิก")).toBeInTheDocument();
    expect(calls("/api/accounting/credit-notes/cn1/void", "POST")).toHaveLength(0);
    fireEvent.change(within(dialog).getByLabelText(/เหตุผลที่ยกเลิก/), { target: { value: "ออกผิดใบ" } });
    fireEvent.change(within(dialog).getByLabelText(/รหัสผ่าน/), { target: { value: "pw" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "ยกเลิกเอกสาร" }));
    await waitFor(() => expect(calls("/api/accounting/credit-notes/cn1/void", "POST")).toHaveLength(1));
    expect(bodyOf("/api/accounting/credit-notes/cn1/void", "POST")).toEqual({ reason: "ออกผิดใบ", password: "pw" });
  });

  it("a voided one says so, with its reason, and cannot be voided again", async () => {
    override = (path) => (path === "/api/accounting/documents/cn1" ? json({ document: { ...CN, status: "void", voidReason: "ออกผิดใบ", voidedAt: "2026-11-19T05:00:00.000Z" }, seller: SELLER, impact: CN_IMPACT }) : undefined);
    render(<CreditNotePage />);
    expect(await screen.findByText("เหตุผล: ออกผิดใบ")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ยกเลิกใบลดหนี้" })).not.toBeInTheDocument();
  });

  it("deleting it says the invoice gets its value back — and that voiding is the way once the customer has it", async () => {
    render(<CreditNotePage />);
    fireEvent.click(await screen.findByRole("button", { name: "ลบเอกสาร" }));
    const dialog = screen.getByRole("dialog", { name: "ลบ CN2026110001?" });
    expect(within(dialog).getByText("ยอดที่ใบนี้ลดหนี้ไว้จะกลับเป็นยอดของใบแจ้งหนี้")).toBeInTheDocument();
    expect(within(dialog).getByText(/ให้กด ยกเลิกใบลดหนี้ แทน/)).toBeInTheDocument();
  });

  it("says so, instead of breaking, on a document that is not a credit note", async () => {
    override = (path) => (path === "/api/accounting/documents/cn1" ? json({ document: { ...CN, docType: "RE" }, seller: SELLER, impact: CN_IMPACT }) : undefined);
    render(<CreditNotePage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("เอกสารนี้ไม่ใช่ใบลดหนี้");
  });
});

describe("the credit-note list", () => {
  it("shows each with the invoice it lowers and why — a voided one marked", async () => {
    override = (path, init) =>
      path === "/api/accounting/credit-notes" && !init?.method
        ? json([
            { id: "cn1", docNo: "CN2026110001", status: "issued", issueDate: "2026-11-19", buyerName: "บริษัท เอ จำกัด", totalSatang: 107000, invoiceId: "inv1", invoiceNo: "INV2026110001", reason: "รับคืนสินค้า" },
            { id: "cn2", docNo: "CN2026110002", status: "void", issueDate: "2026-11-18", buyerName: "ร้าน บี", totalSatang: 5000, invoiceId: "inv2", invoiceNo: "INV2026110002", reason: "คิดราคาผิด" },
          ])
        : undefined;
    render(<CreditNoteListPage />);
    const table = await screen.findByTestId("credit-table");
    const rows = within(table).getAllByRole("row");
    expect(rows[1]).toHaveTextContent("CN2026110001");
    expect(within(rows[1]).getByRole("link", { name: "INV2026110001" })).toHaveAttribute("href", "/accounting/invoices/inv1");
    expect(rows[1]).toHaveTextContent("1,070.00");
    expect(rows[2]).toHaveTextContent("ยกเลิก");
    expect(calls("/api/accounting/credit-notes")[0][0]).toContain("from=2026-01-01");
  });
});

describe("an invoice a credit note lowered", () => {
  beforeEach(() => {
    params = { id: "inv1" };
    override = (path, init) => {
      if (path === "/api/accounting/documents/inv1" && !init?.method) {
        return json({
          document: { ...INVOICE, creditedSatang: 107000 },
          seller: SELLER,
          impact: { ...IMPACT, livePayments: 1, dependentDocs: 1 },
          credit: { creditNotes: [{ id: "cn1", docNo: "CN2026110001", status: "issued", issueDate: "2026-11-19", totalSatang: 107000 }], refundDueSatang: 107000 },
        });
      }
      return undefined;
    };
  });

  it("shows what was credited, nothing owed, the money due back — and its credit notes", async () => {
    render(<InvoiceDocumentPage />);
    expect(await screen.findByTestId("invoice-owed")).toHaveTextContent("0.00");
    expect(screen.getByText("ลดหนี้แล้ว")).toBeInTheDocument();
    expect(screen.getByTestId("invoice-refund-due")).toHaveTextContent("1,070.00");
    expect(screen.getByRole("link", { name: "ใบลดหนี้ CN2026110001" })).toHaveAttribute("href", "/accounting/credit-notes/cn1");
    expect(screen.getByRole("link", { name: "ออกใบลดหนี้" })).toHaveAttribute("href", "/accounting/credit-notes/new?invoice=inv1");
    expect(screen.queryByRole("button", { name: "รับชำระเงิน" })).not.toBeInTheDocument();
    // A credit note hangs off it: voiding is not offered — it says why instead.
    expect(screen.queryByRole("button", { name: "ยกเลิกใบแจ้งหนี้" })).not.toBeInTheDocument();
    expect(screen.getByTestId("invoice-void-blocked")).toBeInTheDocument();
  });

  it("offers no further credit note once nothing is left to take off", async () => {
    override = (path, init) =>
      path === "/api/accounting/documents/inv1" && !init?.method
        ? json({ document: { ...INVOICE, creditedSatang: 214000 }, seller: SELLER, impact: IMPACT, credit: { creditNotes: [], refundDueSatang: 214000 } })
        : undefined;
    render(<InvoiceDocumentPage />);
    await screen.findByTestId("invoice-refund-due");
    expect(screen.queryByRole("link", { name: "ออกใบลดหนี้" })).not.toBeInTheDocument();
  });

  it("records the refund — never more than is due back", async () => {
    override = ((base) => (path: string, init?: RequestInit) =>
      path === "/api/accounting/documents/inv1/refunds" && init?.method === "POST" ? json({ ok: true }, 201) : base!(path, init))(override);
    render(<InvoiceDocumentPage />);
    fireEvent.click(await screen.findByRole("button", { name: "บันทึกคืนเงินลูกค้า" }));
    const dialog = screen.getByRole("dialog", { name: "บันทึกคืนเงินลูกค้า" });
    expect(within(dialog).getByLabelText("ยอดที่คืน (บาท)")).toHaveValue("1,070.00");
    fireEvent.change(within(dialog).getByLabelText("ยอดที่คืน (บาท)"), { target: { value: "2000" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "บันทึกคืนเงิน" }));
    expect(within(dialog).getByText("คืนได้ไม่เกิน 1,070.00 บาท")).toBeInTheDocument();
    expect(calls("/api/accounting/documents/inv1/refunds", "POST")).toHaveLength(0);
    fireEvent.change(within(dialog).getByLabelText("ยอดที่คืน (บาท)"), { target: { value: "1070" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "บันทึกคืนเงิน" }));
    await waitFor(() => expect(calls("/api/accounting/documents/inv1/refunds", "POST")).toHaveLength(1));
    expect(bodyOf("/api/accounting/documents/inv1/refunds", "POST")).toEqual({ paidDate: "2026-11-19", amountSatang: 107000, method: "transfer", bankAccountId: "b1", note: "" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "บันทึกคืนเงินลูกค้า" })).not.toBeInTheDocument());
  });

  it("shows a refund among the payments as money handed back", async () => {
    override = ((base) => (path: string, init?: RequestInit) =>
      path === "/api/accounting/documents/inv1/payments"
        ? json({
            payments: [{ id: "p9", receiptId: null, receiptNo: null, receiptStatus: null, paidDate: "2026-11-19", method: "transfer", bankLabel: "", amountSatang: -107000, whtPercent: 0, whtSatang: 0, feeSatang: 0, netSatang: -107000, cert50Received: false, cert50Note: "", externalReceiptNo: "", note: "คืนเงินลูกค้า", voidedAt: null, voidReason: null }],
            ...CONTEXT,
          })
        : base!(path, init))(override);
    render(<InvoiceDocumentPage />);
    const row = await screen.findByTestId("payment-row");
    expect(row).toHaveTextContent("คืนเงินลูกค้า");
    expect(row).toHaveTextContent("-1,070.00");
    fireEvent.click(within(row).getByRole("button", { name: "ยกเลิกรายการ" }));
    expect(screen.getByText(/คืนเงิน 1,070.00 บาท .* จะกลับเป็นยอดที่ต้องคืนลูกค้า/)).toBeInTheDocument();
  });
});

describe("voiding an invoice", () => {
  beforeEach(() => {
    params = { id: "inv1" };
  });

  it("is not offered while a payment is recorded against it", async () => {
    override = (path) =>
      path === "/api/accounting/documents/inv1/payments"
        ? json({ payments: [{ id: "p1", receiptId: "re1", receiptNo: "RE2026110001", receiptStatus: "issued", paidDate: "2026-11-18", method: "transfer", bankLabel: "", amountSatang: 214000, whtPercent: 0, whtSatang: 0, feeSatang: 0, netSatang: 214000, cert50Received: false, cert50Note: "", externalReceiptNo: "", note: "", voidedAt: null, voidReason: null }], ...CONTEXT })
        : undefined;
    render(<InvoiceDocumentPage />);
    expect(await screen.findByTestId("invoice-void-blocked")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ยกเลิกใบแจ้งหนี้" })).not.toBeInTheDocument();
  });

  it("says what goes with it, then asks a reason and the password", async () => {
    render(<InvoiceDocumentPage />);
    fireEvent.click(await screen.findByRole("button", { name: "ยกเลิกใบแจ้งหนี้" }));
    const dialog = screen.getByRole("dialog", { name: "ยกเลิกใบแจ้งหนี้ INV2026110001?" });
    expect(within(dialog).getByText(/รายการขายใน dashboard ที่สร้างจากใบนี้จะถูกลบ/)).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText(/เหตุผลที่ยกเลิก/), { target: { value: "ลูกค้ายกเลิกคำสั่งซื้อ" } });
    fireEvent.change(within(dialog).getByLabelText(/รหัสผ่าน/), { target: { value: "pw" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "ยกเลิกเอกสาร" }));
    await waitFor(() => expect(calls("/api/accounting/documents/inv1/void", "POST")).toHaveLength(1));
    expect(bodyOf("/api/accounting/documents/inv1/void", "POST")).toEqual({ reason: "ลูกค้ายกเลิกคำสั่งซื้อ", password: "pw" });
  });

  it("a voided invoice says so, with its reason — nothing more to do on it", async () => {
    override = (path) => (path === "/api/accounting/documents/inv1" ? json({ document: { ...INVOICE, status: "void", voidReason: "ออกผิดลูกค้า" }, seller: SELLER, impact: IMPACT }) : undefined);
    render(<InvoiceDocumentPage />);
    expect(await screen.findByText("ใบแจ้งหนี้นี้ถูกยกเลิกแล้ว")).toBeInTheDocument();
    // Printed, it says so across it.
    expect(screen.getByTestId("invoice-void-mark")).toHaveTextContent("ยกเลิก");
    expect(screen.getByText("เหตุผล: ออกผิดลูกค้า")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ยกเลิกใบแจ้งหนี้" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "ออกใบลดหนี้" })).not.toBeInTheDocument();
  });

  it("a credit note's link opened as an invoice goes to the credit note's own page", async () => {
    params = { id: "cn1" };
    render(<InvoiceDocumentPage />);
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/accounting/credit-notes/cn1"));
  });
});

describe("receivables", () => {
  it("lists the money due back to customers, each leading to its invoice", async () => {
    override = (path) =>
      path === "/api/accounting/receivables"
        ? json({
            today: "2026-11-19",
            groups: [],
            totals: { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90plus: 0, all: 0 },
            missingCert50: [],
            missingCert50Satang: 0,
            refundsDue: [{ invoiceId: "inv1", invoiceNo: "INV2026110001", buyerName: "บริษัท เอ จำกัด", refundDueSatang: 107000 }],
          })
        : undefined;
    render(<ReceivablesPage />);
    const section = await screen.findByTestId("refunds-due");
    expect(section).toHaveTextContent("ต้องคืนเงินลูกค้า");
    expect(section).toHaveTextContent("1,070.00");
    expect(within(section).getByRole("link", { name: "INV2026110001" })).toHaveAttribute("href", "/accounting/invoices/inv1");
  });
});

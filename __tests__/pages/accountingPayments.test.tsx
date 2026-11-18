/**
 * Receiving money, through the real pages:
 *  • the invoice's รับชำระเงิน opens with what is owed, the customer's usual
 *    3% worked out on the services before VAT, what actually arrives, and the
 *    receipt it will issue (with its number) — then sends exactly that;
 *  • an amount over what is owed, or an outside receipt with no number, is
 *    refused under its field, sending nothing;
 *  • a payment voids with a reason and the password;
 *  • the receipt prints as ใบเสร็จรับเงิน/ใบกำกับภาษี with the invoice it pays;
 *  • receivables by age; a 50 ทวิ ticked off when it arrives; the receipts list.
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

import InvoiceDocumentPage from "@/app/accounting/invoices/[id]/page";
import ReceiptDocumentPage from "@/app/accounting/receipts/[id]/page";
import ReceiptListPage from "@/app/accounting/receipts/page";
import ReceivablesPage from "@/app/accounting/receivables/page";
import { bangkokDateString } from "@/app/lib/dateFormat";

const SELLER = { name: "บริษัท โปรฟิน แล็บ จำกัด", address: "93 นนทบุรี", taxId: "0107537000114", branchCode: "00000", phone: "", email: "" };
const BANK = { id: "b1", bankName: "กสิกรไทย", accountNo: "123-4-56789-0", accountName: "บจก. โปรฟิน แล็บ", isActive: true, sortOrder: 0 };
const SETTINGS = { seller: SELLER, sellerVersionId: "v1", vatRate: 7, creditDays: 30, bankAccounts: [BANK] };
/** Services 19,000 + VAT 1,330 = 20,330 — not the tax invoice; its receipt will be. */
const INVOICE = {
  id: "inv1", docType: "INV", docNo: "INV2026110001", status: "issued", source: "internal", externalNote: "", isTaxInvoice: false,
  issueDate: "2026-11-10", dueDate: "2026-12-10", creditDays: 30, companyId: "co1", customerId: "c1", salespersonId: "",
  buyerName: "บริษัท เอ จำกัด", buyerAddress: "1 ถนนงามวงศ์วาน", buyerTaxId: "0105555000001", buyerBranch: "00000",
  priceMode: "exclusive", vatRate: 7, subtotalSatang: 1900000, discountSatang: 0, depositSatang: 0, vatBaseSatang: 1900000,
  vatSatang: 133000, totalSatang: 2033000, paidSatang: 0, customerPoNo: "", projectName: "", note: "", salesRecordId: "sale-1",
  relatedDocId: null, issuedAt: "2026-11-10T03:00:00.000Z", issuedBy: "admin", createdBy: "admin", updatedAt: "t1",
  lines: [{ lineType: "service", productId: "", name: "สอบเทียบเครื่องชั่ง", qty: 1, unit: "งาน", unitPriceSatang: 1900000, discountSatang: 0, amountSatang: 1900000, isMachine: false, serials: "", warrantyMonths: null }],
};
const IMPACT = { status: "issued", docNo: "INV2026110001", isLatestNumber: true, livePayments: 0, dependentDocs: 0, sale: null, machines: { total: 0, withHistory: 0 } };
const CONTEXT = { outstandingSatang: 2033000, serviceBaseSatang: 1900000, defaultWhtPercent: 3, receiptIsTaxInvoice: true };
const PAYMENT = {
  id: "p1", receiptId: "re1", receiptNo: "RE2026110001", receiptStatus: "issued", paidDate: "2026-11-18", method: "transfer",
  bankLabel: "กสิกรไทย 123-4-56789-0", amountSatang: 2033000, whtPercent: 3, whtSatang: 57000, feeSatang: 0, netSatang: 1976000,
  cert50Received: false, cert50Note: "", externalReceiptNo: "", note: "", voidedAt: null, voidReason: null,
};

const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });
let override: ((path: string, init?: RequestInit) => unknown) | null;
let fetchMock: ReturnType<typeof vi.fn>;
const calls = (path: string, method = "GET") =>
  fetchMock.mock.calls.filter(([u, i]) => new URL(String(u), "http://localhost").pathname === path && ((i as RequestInit | undefined)?.method ?? "GET") === method);
const bodyOf = (path: string, method: string) => JSON.parse(String((calls(path, method)[0][1] as RequestInit).body));

/** Picks `label` in the SearchableDropdown whose trigger is `#id`. */
const choose = (id: string, label: string) => {
  fireEvent.click(document.getElementById(id)!);
  fireEvent.click(within(document.querySelector("[data-dropdown-panel]") as HTMLElement).getByText(label));
};

beforeEach(() => {
  override = null;
  params = {};
  router.replace.mockClear();
  router.push.mockClear();
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const custom = override?.(url.pathname, init);
    if (custom !== undefined) return custom;
    switch (url.pathname) {
      case "/api/accounting/status": return json({ twoFactorEnabled: true, username: "admin" });
      case "/api/accounting/settings": return json(SETTINGS);
      case "/api/accounting/documents/inv1": return json({ document: INVOICE, seller: SELLER, impact: IMPACT });
      case "/api/accounting/documents/inv1/payments": return json({ payments: [], ...CONTEXT });
      case "/api/accounting/documents/next-number": return json({ docNo: "RE2026110001" });
      default: return json([]);
    }
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("รับชำระเงิน on an invoice", () => {
  beforeEach(() => {
    params = { id: "inv1" };
  });
  async function openDialog() {
    render(<InvoiceDocumentPage />);
    const button = await screen.findByRole("button", { name: "รับชำระเงิน" });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    return screen.getByRole("dialog", { name: "รับชำระเงิน" });
  }

  it("opens with what is owed, 3% of the services withheld, what arrives, and the receipt it will issue", async () => {
    const dialog = await openDialog();
    expect(within(dialog).getByLabelText("ยอดที่ลูกค้าชำระ (บาท)")).toHaveValue("20,330.00");
    expect(within(dialog).getByLabelText("ยอดที่ถูกหัก (บาท)")).toHaveValue("570.00");
    expect(within(dialog).getByTestId("payment-net")).toHaveTextContent("19,760.00");
    expect(within(dialog).getByText(/ลูกค้ารายนี้หักประจำ 3%/)).toBeInTheDocument();
    expect(within(dialog).getByText(/ออกใบเสร็จรับเงิน\/ใบกำกับภาษีจากระบบ/)).toBeInTheDocument();
    expect(await within(dialog).findByText(/จะได้เลขที่ RE2026110001/)).toBeInTheDocument();
  });

  it("works the withholding out again for a part payment, keeps one typed by hand, and gives it back on request", async () => {
    const dialog = await openDialog();
    fireEvent.change(within(dialog).getByLabelText("ยอดที่ลูกค้าชำระ (บาท)"), { target: { value: "10165" } });
    expect(within(dialog).getByLabelText("ยอดที่ถูกหัก (บาท)")).toHaveValue("285.00");
    fireEvent.change(within(dialog).getByLabelText("ยอดที่ถูกหัก (บาท)"), { target: { value: "300" } });
    fireEvent.change(within(dialog).getByLabelText("ยอดที่ลูกค้าชำระ (บาท)"), { target: { value: "20330" } });
    expect(within(dialog).getByLabelText("ยอดที่ถูกหัก (บาท)")).toHaveValue("300");
    fireEvent.click(within(dialog).getByRole("button", { name: "คำนวณใหม่จากอัตรา" }));
    expect(within(dialog).getByLabelText("ยอดที่ถูกหัก (บาท)")).toHaveValue("570.00");
    choose("pay-whtRate", "ไม่หัก");
    expect(within(dialog).getByLabelText("ยอดที่ถูกหัก (บาท)")).toHaveValue("0.00");
    expect(within(dialog).getByTestId("payment-net")).toHaveTextContent("20,330.00");
  });

  it("sends exactly what it showed, then says which receipt it issued and links to it", async () => {
    override = (path, init) =>
      path === "/api/accounting/documents/inv1/payments" && init?.method === "POST"
        ? json({ payment: PAYMENT, receipt: { id: "re1", docNo: "RE2026110001", title: "ใบเสร็จรับเงิน/ใบกำกับภาษี" }, paidSatang: 2033000 }, 201)
        : undefined;
    const dialog = await openDialog();
    fireEvent.click(within(dialog).getByLabelText(/ได้รับหนังสือรับรองการหักภาษี/));
    fireEvent.change(within(dialog).getByLabelText("เก็บ 50 ทวิ ไว้ที่"), { target: { value: "แฟ้ม 50 ทวิ 2569" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "บันทึกรับชำระ" }));

    expect(await screen.findByRole("status")).toHaveTextContent("บันทึกรับชำระแล้ว — ออกใบเสร็จรับเงิน/ใบกำกับภาษี RE2026110001");
    expect(screen.getByRole("link", { name: "เปิด / พิมพ์ใบเสร็จ" })).toHaveAttribute("href", "/accounting/receipts/re1");
    expect(screen.queryByRole("dialog", { name: "รับชำระเงิน" })).toBeNull();
    expect(bodyOf("/api/accounting/documents/inv1/payments", "POST")).toEqual({
      paidDate: bangkokDateString(new Date()),
      method: "transfer",
      bankAccountId: "b1",
      amountSatang: 2033000,
      whtPercent: 3,
      whtSatang: 57000,
      feeSatang: 0,
      cert50Received: true,
      cert50Note: "แฟ้ม 50 ทวิ 2569",
      externalReceiptNo: "",
      note: "",
    });
  });

  it("never shows the number for a date other than the one picked", async () => {
    const dialog = await openDialog();
    expect(await within(dialog).findByText(/จะได้เลขที่ RE2026110001/)).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText("วันที่รับเงิน"), { target: { value: "" } });
    expect(within(dialog).queryByText(/จะได้เลขที่/)).toBeNull();
  });

  it("a void after recording takes the 'recorded' note away", async () => {
    let recordedOnce = false;
    override = (path, init) => {
      if (path === "/api/accounting/documents/inv1/payments" && init?.method === "POST") {
        recordedOnce = true;
        return json({ payment: PAYMENT, receipt: { id: "re1", docNo: "RE2026110001", title: "ใบเสร็จรับเงิน/ใบกำกับภาษี" }, paidSatang: 2033000 }, 201);
      }
      if (path === "/api/accounting/documents/inv1/payments") return json(recordedOnce ? { payments: [PAYMENT], ...CONTEXT, outstandingSatang: 0 } : { payments: [], ...CONTEXT });
      if (path === "/api/accounting/payments/p1/void") return json({ ...PAYMENT, voidedAt: "x" });
      return undefined;
    };
    const dialog = await openDialog();
    fireEvent.click(within(dialog).getByRole("button", { name: "บันทึกรับชำระ" }));
    expect(await screen.findByRole("status")).toHaveTextContent("บันทึกรับชำระแล้ว");

    fireEvent.click(within(await screen.findByTestId("payment-row")).getByRole("button", { name: "ยกเลิกรายการ" }));
    const voidDialog = screen.getByRole("dialog", { name: "ยกเลิกรายการรับชำระ?" });
    fireEvent.change(within(voidDialog).getByLabelText(/เหตุผลที่ยกเลิก/), { target: { value: "ผิด" } });
    fireEvent.change(within(voidDialog).getByLabelText(/รหัสผ่าน/), { target: { value: "pw" } });
    fireEvent.click(within(voidDialog).getByRole("button", { name: "ยกเลิกรายการ" }));
    await waitFor(() => expect(screen.queryByText(/บันทึกรับชำระแล้ว/)).toBeNull());
  });

  it("refuses more than is owed under the field, sending nothing", async () => {
    const dialog = await openDialog();
    fireEvent.change(within(dialog).getByLabelText("ยอดที่ลูกค้าชำระ (บาท)"), { target: { value: "20330.01" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "บันทึกรับชำระ" }));
    expect(within(dialog).getByText("ยอดเกินยอดค้างชำระของใบนี้", { selector: "[data-field-error]" })).toBeInTheDocument();
    expect(calls("/api/accounting/documents/inv1/payments", "POST")).toHaveLength(0);
  });

  it("takes the number of a receipt issued elsewhere — and wants one", async () => {
    override = (path, init) =>
      path === "/api/accounting/documents/inv1/payments" && init?.method === "POST" ? json({ payment: PAYMENT, receipt: null, paidSatang: 2033000 }, 201) : undefined;
    const dialog = await openDialog();
    fireEvent.click(within(dialog).getByLabelText(/ออกใบเสร็จจากที่อื่นแล้ว/));
    fireEvent.click(within(dialog).getByRole("button", { name: "บันทึกรับชำระ" }));
    expect(within(dialog).getByText("กรุณากรอกเลขที่ใบเสร็จที่ออกจากที่อื่น", { selector: "[data-field-error]" })).toBeInTheDocument();
    expect(calls("/api/accounting/documents/inv1/payments", "POST")).toHaveLength(0);

    fireEvent.change(within(dialog).getByLabelText("เลขที่ใบเสร็จตามเอกสารจริง"), { target: { value: "เล่ม 3/45" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "บันทึกรับชำระ" }));
    await waitFor(() => expect(calls("/api/accounting/documents/inv1/payments", "POST")).toHaveLength(1));
    expect(bodyOf("/api/accounting/documents/inv1/payments", "POST")).toMatchObject({ externalReceiptNo: "เล่ม 3/45" });
    expect(await screen.findByRole("status")).toHaveTextContent("บันทึกรับชำระแล้ว");
  });

  it("a payments answer it cannot read shows in the panel — the invoice stays on screen", async () => {
    override = (path) => (path === "/api/accounting/documents/inv1/payments" ? json([]) : undefined);
    render(<InvoiceDocumentPage />);
    expect(await within(await screen.findByTestId("payments-panel")).findByText("โหลดรายการรับชำระไม่สำเร็จ")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "พิมพ์ต้นฉบับ" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "รับชำระเงิน" })).toBeDisabled();
  });

  it("cash goes into no account", async () => {
    override = (path, init) =>
      path === "/api/accounting/documents/inv1/payments" && init?.method === "POST" ? json({ payment: PAYMENT, receipt: null, paidSatang: 2033000 }, 201) : undefined;
    const dialog = await openDialog();
    choose("pay-method", "เงินสด");
    expect(within(dialog).queryByText("เข้าบัญชี")).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "บันทึกรับชำระ" }));
    await waitFor(() => expect(calls("/api/accounting/documents/inv1/payments", "POST")).toHaveLength(1));
    expect(bodyOf("/api/accounting/documents/inv1/payments", "POST")).toMatchObject({ method: "cash", bankAccountId: "" });
  });
});

describe("the invoice's payments", () => {
  beforeEach(() => {
    params = { id: "inv1" };
    override = (path, init) => {
      if (path === "/api/accounting/documents/inv1" && !init?.method) return json({ document: { ...INVOICE, paidSatang: 2033000 }, seller: SELLER, impact: { ...IMPACT, livePayments: 1 } });
      if (path === "/api/accounting/documents/inv1/payments") return json({ payments: [PAYMENT], ...CONTEXT, outstandingSatang: 0 });
      if (path === "/api/accounting/payments/p1/void") return json({ ...PAYMENT, voidedAt: "x" });
      return undefined;
    };
  });

  it("lists each payment with its receipt and the 50 ทวิ still to come — and nothing left to receive", async () => {
    render(<InvoiceDocumentPage />);
    const row = await screen.findByTestId("payment-row");
    expect(within(row).getByRole("link", { name: "ใบเสร็จ RE2026110001" })).toHaveAttribute("href", "/accounting/receipts/re1");
    expect(within(row).getByText("หัก ณ ที่จ่าย 3% 570.00")).toBeInTheDocument();
    expect(within(row).getByText("ยังไม่ได้รับ 50 ทวิ")).toBeInTheDocument();
    expect(within(row).getByText(/เงินเข้า 19,760.00/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "รับชำระเงิน" })).toBeNull();
  });

  it("voids one with a reason and the password", async () => {
    render(<InvoiceDocumentPage />);
    const row = await screen.findByTestId("payment-row");
    fireEvent.click(within(row).getByRole("button", { name: "ยกเลิกรายการ" }));
    const dialog = screen.getByRole("dialog", { name: "ยกเลิกรายการรับชำระ?" });
    expect(within(dialog).getByText(/ใบเสร็จ RE2026110001 จะถูกยกเลิก/)).toBeInTheDocument();

    fireEvent.change(within(dialog).getByLabelText(/รหัสผ่าน/), { target: { value: "pw" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "ยกเลิกรายการ" }));
    expect(await within(dialog).findByText("กรุณาบอกเหตุผลที่ยกเลิก")).toBeInTheDocument();
    expect(calls("/api/accounting/payments/p1/void", "POST")).toHaveLength(0);

    fireEvent.change(within(dialog).getByLabelText(/เหตุผลที่ยกเลิก/), { target: { value: "บันทึกยอดผิด" } });
    fireEvent.change(within(dialog).getByLabelText(/รหัสผ่าน/), { target: { value: "pw" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "ยกเลิกรายการ" }));
    await waitFor(() => expect(calls("/api/accounting/payments/p1/void", "POST")).toHaveLength(1));
    expect(bodyOf("/api/accounting/payments/p1/void", "POST")).toEqual({ reason: "บันทึกยอดผิด", password: "pw" });
  });
});

describe("the receipt's page", () => {
  const RECEIPT = {
    id: "re1", docType: "RE", docNo: "RE2026110001", status: "issued", isTaxInvoice: true, issueDate: "2026-11-18",
    buyerName: "บริษัท เอ จำกัด", buyerAddress: "1 ถนนงามวงศ์วาน", buyerTaxId: "0105555000001", buyerBranch: "00000",
    customerPoNo: "", projectName: "", vatRate: 7, vatBaseSatang: 1900000, vatSatang: 133000, totalSatang: 2033000,
    relatedDocId: "inv1", voidReason: null,
  };
  beforeEach(() => {
    params = { id: "re1" };
    override = (path) =>
      path === "/api/accounting/documents/re1"
        ? json({
            document: RECEIPT,
            seller: SELLER,
            impact: { ...IMPACT, docNo: "RE2026110001", receiptPayment: { amountSatang: 2033000, voided: false, invoiceId: "inv1", invoiceNo: "INV2026110001" } },
            receipt: { payment: PAYMENT, invoice: { id: "inv1", docNo: "INV2026110001", issueDate: "2026-11-10", totalSatang: 2033000, paidSatang: 2033000, lines: [{ name: "สอบเทียบเครื่องชั่ง", qty: 1, unit: "งาน", lineType: "service" }] } },
          })
        : undefined;
  });

  it("prints as the tax invoice, naming the invoice it pays and its items, with the VAT and the withholding", async () => {
    render(<ReceiptDocumentPage />);
    expect((await screen.findAllByText("ใบเสร็จรับเงิน/ใบกำกับภาษี")).length).toBeGreaterThan(0);
    expect(screen.getByText(/ชำระตามใบแจ้งหนี้ เลขที่ INV2026110001/)).toBeInTheDocument();
    expect(screen.getByText(/สอบเทียบเครื่องชั่ง 1 งาน/)).toBeInTheDocument();
    expect(screen.getByText("ภาษีมูลค่าเพิ่ม 7%")).toBeInTheDocument();
    expect(screen.getByTestId("receipt-payment")).toHaveTextContent("ภาษีหัก ณ ที่จ่าย 3% 570.00 บาท");
    expect(screen.getByTestId("receipt-payment")).toHaveTextContent("เข้าบัญชี กสิกรไทย 123-4-56789-0");
    expect(screen.getByRole("link", { name: /ใบแจ้งหนี้ INV2026110001/ })).toHaveAttribute("href", "/accounting/invoices/inv1");
  });

  it("deleting it says the payment goes with it — and to void it instead if the customer has it", async () => {
    render(<ReceiptDocumentPage />);
    fireEvent.click(await screen.findByRole("button", { name: "ลบเอกสาร" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("รายการรับชำระ 20,330.00 บาท ของ INV2026110001 จะถูกลบด้วย");
    expect(dialog).toHaveTextContent("ให้กด ยกเลิกใบเสร็จ แทน");
  });

  it("a voided one says so, offers no second void, and deleting it takes no payment", async () => {
    override = (path) =>
      path === "/api/accounting/documents/re1"
        ? json({
            document: { ...RECEIPT, status: "void", voidReason: "บันทึกยอดผิด" },
            seller: SELLER,
            impact: { ...IMPACT, status: "void", docNo: "RE2026110001", receiptPayment: { amountSatang: 2033000, voided: true, invoiceId: "inv1", invoiceNo: "INV2026110001" } },
            receipt: { payment: { ...PAYMENT, voidedAt: "x", voidReason: "บันทึกยอดผิด" }, invoice: null },
          })
        : undefined;
    render(<ReceiptDocumentPage />);
    expect(await screen.findByText("ใบเสร็จนี้ถูกยกเลิกแล้ว")).toBeInTheDocument();
    expect(screen.getByText("เหตุผล: บันทึกยอดผิด")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ยกเลิกใบเสร็จ" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "ลบเอกสาร" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).not.toHaveTextContent("จะถูกลบด้วย");
    expect(dialog).toHaveTextContent("ใบเสร็จนี้ยกเลิกแล้ว");
  });

  it("voiding it is voiding its payment", async () => {
    render(<ReceiptDocumentPage />);
    fireEvent.click(await screen.findByRole("button", { name: "ยกเลิกใบเสร็จ" }));
    expect(screen.getByRole("dialog", { name: "ยกเลิกรายการรับชำระ?" })).toBeInTheDocument();
  });
});

describe("receivables", () => {
  const DATA = {
    today: "2026-11-18",
    groups: [
      {
        key: "co:co1", name: "บริษัท เอ จำกัด", outstandingSatang: 2033000, maxDaysOverdue: 48,
        buckets: { current: 0, d1_30: 0, d31_60: 2033000, d61_90: 0, d90plus: 0 },
        invoices: [{ id: "inv1", docNo: "INV2026110001", issueDate: "2026-09-01", dueDate: "2026-10-01", totalSatang: 2033000, paidSatang: 0, outstandingSatang: 2033000, daysOverdue: 48, bucket: "d31_60" }],
      },
    ],
    totals: { current: 0, d1_30: 0, d31_60: 2033000, d61_90: 0, d90plus: 0, all: 2033000 },
    missingCert50: [{ paymentId: "p9", invoiceId: "inv0", invoiceNo: "INV2026100004", buyerName: "บริษัท บี จำกัด", paidDate: "2026-10-20", receiptNo: "RE2026100002", whtPercent: 3, whtSatang: 30000 }],
    missingCert50Satang: 30000,
  };
  beforeEach(() => {
    override = (path) => (path === "/api/accounting/receivables" ? json(DATA) : path === "/api/accounting/payments/p9" ? json({ id: "p9" }) : undefined);
  });

  it("shows what is owed by customer and age, and the invoices behind it", async () => {
    render(<ReceivablesPage />);
    expect(await screen.findByTestId("receivables-summary")).toHaveTextContent("เกินกำหนดแล้ว฿20,330.00");
    const table = screen.getByTestId("ageing-table");
    fireEvent.click(within(table).getByRole("button", { name: /บริษัท เอ จำกัด/ }));
    expect(within(table).getByRole("link", { name: "INV2026110001" })).toHaveAttribute("href", "/accounting/invoices/inv1");
    expect(within(table).getByText("เกิน 48 วัน")).toBeInTheDocument();
  });

  it("ticks off a 50 ทวิ when the paper arrives", async () => {
    render(<ReceivablesPage />);
    const table = await screen.findByTestId("cert50-table");
    fireEvent.click(within(table).getByRole("button", { name: "ได้รับแล้ว" }));
    const dialog = screen.getByRole("dialog", { name: "หนังสือรับรองการหักภาษี (50 ทวิ)" });
    fireEvent.change(within(dialog).getByLabelText("เก็บไว้ที่"), { target: { value: "แฟ้ม 50 ทวิ 2569" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "บันทึก" }));
    await waitFor(() => expect(calls("/api/accounting/payments/p9", "PATCH")).toHaveLength(1));
    expect(bodyOf("/api/accounting/payments/p9", "PATCH")).toEqual({ cert50Received: true, cert50Note: "แฟ้ม 50 ทวิ 2569" });
  });
});

describe("the receipts list", () => {
  it("names each receipt's invoice, and totals the live ones", async () => {
    override = (path) =>
      path === "/api/accounting/documents"
        ? json([
            { id: "re2", docNo: "RE2026110002", status: "void", isTaxInvoice: true, issueDate: "2026-11-18", buyerName: "บริษัท บี", projectName: "", totalSatang: 50000, relatedDocId: "inv2", relatedDocNo: "INV2026110002" },
            { id: "re1", docNo: "RE2026110001", status: "issued", isTaxInvoice: true, issueDate: "2026-11-18", buyerName: "บริษัท เอ จำกัด", projectName: "", totalSatang: 2033000, relatedDocId: "inv1", relatedDocNo: "INV2026110001" },
          ])
        : undefined;
    render(<ReceiptListPage />);
    const table = await screen.findByTestId("receipt-table");
    expect(within(table).getByRole("link", { name: "INV2026110001" })).toHaveAttribute("href", "/accounting/invoices/inv1");
    expect(within(table).getByText("รวม (ไม่นับที่ยกเลิก)").closest("tr")).toHaveTextContent("20,330.00");
    expect(new URL(String(calls("/api/accounting/documents")[0][0]), "http://localhost").searchParams.get("type")).toBe("RE");
  });
});

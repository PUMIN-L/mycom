/**
 * Billing notes, through the real pages:
 *  • making one: the customer's invoices still owing, all ticked, the total
 *    following the ticks — nothing sent until one is picked;
 *  • one note: the paper, its invoices as they stand now, money received
 *    against it — one dialog, one combined receipt (two when goods and
 *    services mix), the withholding worked out on each invoice's services;
 *  • cancelling it with a reason; the list; its receipt printed as one.
 */
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const router = { push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() };
let params: Record<string, string> = {};
let search = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/accounting/billing-notes",
  useSearchParams: () => search,
  useParams: () => params,
}));

import BillingNoteListPage from "@/app/accounting/billing-notes/page";
import NewBillingNotePage from "@/app/accounting/billing-notes/new/page";
import BillingNotePage from "@/app/accounting/billing-notes/[id]/page";
import ReceiptDocumentPage from "@/app/accounting/receipts/[id]/page";

const SELLER = { name: "บริษัท โปรฟิน แล็บ จำกัด", address: "93 นนทบุรี", taxId: "0107537000114", branchCode: "00000", phone: "", email: "" };
const SETTINGS = { seller: SELLER, sellerVersionId: "v1", vatRate: 7, creditDays: 30, bankAccounts: [] };
const OPEN = [
  { id: "A", docNo: "INV2026110001", issueDate: "2026-11-01", dueDate: "2026-12-01", totalSatang: 107000, paidSatang: 0, outstandingSatang: 107000, billedOn: [] },
  { id: "B", docNo: "INV2026110002", issueDate: "2026-11-05", dueDate: "2026-12-05", totalSatang: 53500, paidSatang: 0, outstandingSatang: 53500, billedOn: [{ id: "bn0", docNo: "BN2026100003" }] },
];
/** A: goods 1,070.00 (the tax invoice already) · B: services 535.00 (500.00 before VAT). */
const NOTE = {
  note: {
    id: "bn1", docNo: "BN2026110001", status: "issued", issueDate: "2026-11-19", dueDate: "2026-11-30", buyerName: "บริษัท เอ จำกัด",
    buyerAddress: "1 ถนนงามวงศ์วาน", buyerTaxId: "0107537000114", buyerBranch: "00000", totalSatang: 160500, note: "", voidReason: null,
  },
  billingStatus: "open",
  invoices: [
    { id: "A", docNo: "INV2026110001", status: "issued", issueDate: "2026-11-01", dueDate: "2026-12-01", billedSatang: 107000, totalSatang: 107000, vatSatang: 7000, paidSatang: 0, vatPaidSatang: 0, outstandingSatang: 107000, serviceBaseSatang: 0, receiptIsTaxInvoice: false },
    { id: "B", docNo: "INV2026110002", status: "issued", issueDate: "2026-11-05", dueDate: "2026-12-05", billedSatang: 53500, totalSatang: 53500, vatSatang: 3500, paidSatang: 0, vatPaidSatang: 0, outstandingSatang: 53500, serviceBaseSatang: 50000, receiptIsTaxInvoice: true },
  ],
  outstandingSatang: 160500,
  receivedSatang: 0,
  payments: [],
  defaultWhtPercent: 3,
  seller: SELLER,
  impact: { status: "issued", docNo: "BN2026110001", isLatestNumber: true, livePayments: 0, dependentDocs: 0, sale: null, machines: { total: 0, withHistory: 0 }, blockedReason: null },
};

const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });
let override: ((path: string, init?: RequestInit) => unknown) | null;
let fetchMock: ReturnType<typeof vi.fn>;
const calls = (path: string, method = "GET") =>
  fetchMock.mock.calls.filter(([u, i]) => new URL(String(u), "http://localhost").pathname === path && ((i as RequestInit | undefined)?.method ?? "GET") === method);
const bodyOf = (path: string, method: string) => JSON.parse(String((calls(path, method)[0][1] as RequestInit).body));

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
      case "/api/accounting/billing-notes/open-invoices": return json(OPEN);
      case "/api/accounting/billing-notes/bn1": return json(NOTE);
      case "/api/accounting/documents/next-number": return json({ docNo: "RE2026110007" });
      case "/api/companies": return json([{ id: "co1", name: "บริษัท เอ จำกัด", taxId: "0107537000114", branchCode: "00000" }]);
      case "/api/customers": return json([]);
      case "/api/salespeople": return json([]);
      case "/api/products": return json([]);
      default: return json([]);
    }
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("making a billing note", () => {
  beforeEach(() => {
    search = new URLSearchParams("companyId=co1");
  });
  async function loaded() {
    render(<NewBillingNotePage />);
    await screen.findByTestId("billing-candidates");
  }

  it("lists the customer's invoices still owing, all ticked — says one is on another note — the total following the ticks", async () => {
    await loaded();
    expect(calls("/api/accounting/billing-notes/open-invoices")[0][0]).toContain("companyId=co1");
    expect(screen.getByTestId("billing-total")).toHaveTextContent("รวม 2 ใบ · 1,605.00 บาท");
    expect(screen.getByText(/อยู่ในใบวางบิล BN2026100003 แล้ว/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "วางบิล INV2026110002" }));
    expect(screen.getByTestId("billing-total")).toHaveTextContent("รวม 1 ใบ · 1,070.00 บาท");
  });

  it("asks for an invoice before sending anything, then makes it and opens it", async () => {
    override = (path, init) => (path === "/api/accounting/billing-notes" && init?.method === "POST" ? json({ id: "bn1" }, 201) : undefined);
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "ไม่เลือกทั้งหมด" }));
    fireEvent.click(screen.getByRole("button", { name: "ออกใบวางบิล" }));
    expect(await screen.findByText("กรุณาเลือกใบแจ้งหนี้อย่างน้อย 1 ใบ")).toBeInTheDocument();
    expect(calls("/api/accounting/billing-notes", "POST")).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "เลือกทั้งหมด" }));
    fireEvent.change(screen.getByLabelText("หมายเหตุ (พิมพ์ในใบวางบิล)"), { target: { value: "นัดรับเช็ควันศุกร์" } });
    fireEvent.click(screen.getByRole("button", { name: "ออกใบวางบิล" }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/accounting/billing-notes/bn1"));
    expect(bodyOf("/api/accounting/billing-notes", "POST")).toEqual({
      companyId: "co1", buyerName: "", invoiceIds: ["A", "B"], issueDate: "2026-11-19", dueDate: "", note: "นัดรับเช็ควันศุกร์",
    });
  });
});

describe("one billing note", () => {
  beforeEach(() => {
    params = { id: "bn1" };
  });
  async function loaded() {
    render(<BillingNotePage />);
    await screen.findByTestId("billing-paper-invoices");
  }

  it("prints its invoices with what each owed when billed, and says what they owe now", async () => {
    await loaded();
    const paper = within(screen.getByTestId("billing-paper-invoices"));
    expect(paper.getByText("INV2026110001")).toBeInTheDocument();
    expect(paper.getByText("1,605.00")).toBeInTheDocument();
    expect(screen.getByTestId("billing-outstanding")).toHaveTextContent("1,605.00");
    expect(screen.getByText("รอชำระ")).toBeInTheDocument();
  });

  it("receives against it: one dialog, the withholding on the services, one receipt per kind — then links them", async () => {
    override = (path, init) =>
      path === "/api/accounting/billing-notes/bn1/payments" && init?.method === "POST"
        ? json({ receipts: [{ id: "re7", docNo: "RE2026110007", title: "ใบเสร็จรับเงิน" }, { id: "re8", docNo: "RE2026110008", title: "ใบเสร็จรับเงิน/ใบกำกับภาษี" }], groupId: "g1" }, 201)
        : undefined;
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "รับชำระตามใบวางบิล" }));
    const dialog = screen.getByRole("dialog", { name: "รับชำระตามใบวางบิล" });
    expect(within(dialog).getByLabelText("ยอดที่ลูกค้าชำระ (บาท)")).toHaveValue("1,605.00");
    // 3% (the customer's usual) of B's 500.00 of services — A is goods.
    expect(within(dialog).getByLabelText("ยอดที่ถูกหัก (บาท)")).toHaveValue("15.00");
    expect(within(dialog).getByText(/ออกใบเสร็จรวมจากระบบ 2 ใบ/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "บันทึกรับชำระ" }));
    expect(await screen.findByRole("link", { name: "ใบเสร็จรับเงิน RE2026110007" })).toHaveAttribute("href", "/accounting/receipts/re7");
    expect(screen.getByRole("link", { name: "ใบเสร็จรับเงิน/ใบกำกับภาษี RE2026110008" })).toBeInTheDocument();
    expect(bodyOf("/api/accounting/billing-notes/bn1/payments", "POST")).toMatchObject({ amountSatang: 160500, whtSatang: 1500, whtPercent: 3 });
  });

  it("shows money received as one payment over its invoices, voided whole", async () => {
    const share = (id: string, documentId: string, amountSatang: number, receiptId: string, receiptNo: string) => ({
      id, documentId, documentNo: null, groupId: "g1", receiptId, receiptNo, receiptStatus: "issued", paidDate: "2026-11-19", method: "cheque", bankLabel: "",
      amountSatang, whtPercent: 0, whtSatang: 0, feeSatang: 0, netSatang: amountSatang, cert50Received: false, cert50Note: "", externalReceiptNo: "", note: "", voidedAt: null, voidReason: null,
    });
    override = (path) =>
      path === "/api/accounting/billing-notes/bn1"
        ? json({ ...NOTE, receivedSatang: 160500, outstandingSatang: 0, billingStatus: "paid", payments: [share("p1", "A", 107000, "re7", "RE2026110007"), share("p2", "B", 53500, "re8", "RE2026110008")] })
        : undefined;
    await loaded();
    const groups = within(screen.getByTestId("billing-payment-groups"));
    expect(groups.getAllByRole("listitem")).toHaveLength(1);
    expect(groups.getByText(/2 ใบแจ้งหนี้/)).toBeInTheDocument();
    expect(groups.getByRole("link", { name: "ใบเสร็จ RE2026110007" })).toBeInTheDocument();
    expect(groups.getByRole("link", { name: "ใบเสร็จ RE2026110008" })).toBeInTheDocument();
    expect(groups.getByRole("button", { name: "ยกเลิกรายการ (ทุกใบแจ้งหนี้)" })).toBeInTheDocument();
    // Money came in: no cancelling the note, nothing more to receive.
    expect(screen.queryByRole("button", { name: "ยกเลิกใบวางบิล" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "รับชำระตามใบวางบิล" })).not.toBeInTheDocument();
  });

  it("is cancelled with a reason", async () => {
    override = (path, init) => (path === "/api/accounting/billing-notes/bn1/void" && init?.method === "POST" ? json({ id: "bn1", status: "void" }) : undefined);
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "ยกเลิกใบวางบิล" }));
    const dialog = screen.getByRole("dialog", { name: "ยกเลิกใบวางบิลนี้?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "ยืนยันยกเลิก" }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent("กรุณาบอกเหตุผลที่ยกเลิก");
    fireEvent.change(within(dialog).getByLabelText(/เหตุผล/), { target: { value: "ลูกค้าขอวางบิลใหม่" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "ยืนยันยกเลิก" }));
    await waitFor(() => expect(calls("/api/accounting/billing-notes/bn1/void", "POST")).toHaveLength(1));
    expect(bodyOf("/api/accounting/billing-notes/bn1/void", "POST")).toEqual({ reason: "ลูกค้าขอวางบิลใหม่" });
  });

  it("says it could not load, instead of breaking, on an answer that is not a billing note", async () => {
    override = (path) => (path === "/api/accounting/billing-notes/bn1" ? json({ note: { id: "bn1" } }) : undefined);
    render(<BillingNotePage />);
    expect(await screen.findByText("โหลดใบวางบิลไม่สำเร็จ")).toBeInTheDocument();
  });
});

describe("the billing-note list", () => {
  it("shows each note with where it stands and what is still owed", async () => {
    override = (path) =>
      path === "/api/accounting/billing-notes"
        ? json([{ id: "bn1", docNo: "BN2026110001", billingStatus: "partial", issueDate: "2026-11-19", dueDate: "2026-11-30", buyerName: "บริษัท เอ จำกัด", totalSatang: 160500, outstandingSatang: 53500, invoiceCount: 2 }])
        : undefined;
    render(<BillingNoteListPage />);
    const table = within(await screen.findByTestId("billing-table"));
    expect(table.getByRole("link", { name: "BN2026110001" })).toHaveAttribute("href", "/accounting/billing-notes/bn1");
    expect(table.getByText("ชำระบางส่วน")).toBeInTheDocument();
    expect(table.getByText("535.00")).toBeInTheDocument();
  });
});

describe("a billing note's receipt", () => {
  it("prints every invoice it pays, and leads back to the note", async () => {
    params = { id: "re7" };
    override = (path) =>
      path === "/api/accounting/documents/re7"
        ? json({
            document: {
              id: "re7", docType: "RE", docNo: "RE2026110007", status: "issued", isTaxInvoice: false, issueDate: "2026-11-19", relatedDocId: "bn1", voidReason: null,
              buyerName: "บริษัท เอ จำกัด", buyerAddress: "", buyerTaxId: "", buyerBranch: "", customerPoNo: "", projectName: "", vatRate: 7, vatBaseSatang: 100000, vatSatang: 7000, totalSatang: 107000,
            },
            seller: SELLER,
            impact: { status: "issued", docNo: "RE2026110007", isLatestNumber: true, livePayments: 0, dependentDocs: 0, sale: null, machines: { total: 0, withHistory: 0 } },
            receipt: {
              payment: { id: "p1", paidDate: "2026-11-19", method: "cheque", bankLabel: "", amountSatang: 107000, whtPercent: 0, whtSatang: 0, feeSatang: 0, netSatang: 107000, note: "" },
              invoice: null,
              billing: { id: "bn1", docNo: "BN2026110001", issueDate: "2026-11-19", invoices: [{ id: "A", docNo: "INV2026110001", issueDate: "2026-11-01", amountSatang: 107000 }] },
            },
          })
        : undefined;
    render(<ReceiptDocumentPage />);
    expect(await screen.findByText(/ชำระใบแจ้งหนี้ เลขที่ INV2026110001/)).toBeInTheDocument();
    expect(screen.getByText(/ตามใบวางบิล เลขที่ BN2026110001/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /ใบวางบิล BN2026110001/ })).toHaveAttribute("href", "/accounting/billing-notes/bn1");
  });
});

describe("a billing note's payment, on one of its invoices", () => {
  it("says it came through the note — and that voiding it voids the whole of it", async () => {
    const { default: PaymentsPanel } = await import("@/app/accounting/payments/PaymentsPanel");
    const row = {
      id: "p1", receiptId: "re7", receiptNo: "RE2026110007", receiptStatus: "issued", paidDate: "2026-11-19", method: "cheque", bankLabel: "",
      amountSatang: 107000, whtPercent: 0, whtSatang: 0, feeSatang: 0, netSatang: 107000, cert50Received: false, cert50Note: "", externalReceiptNo: "", note: "",
      voidedAt: null, voidReason: null, billingNoteId: "bn1", groupId: "g1",
    };
    render(<PaymentsPanel state={{ status: "ok", payments: [row], context: { outstandingSatang: 0, serviceBaseSatang: 0, defaultWhtPercent: 0, receiptIsTaxInvoice: false } }} onChanged={() => {}} onRetry={() => {}} />);
    expect(screen.getByRole("link", { name: "ดูใบวางบิล" })).toHaveAttribute("href", "/accounting/billing-notes/bn1");
    expect(screen.getByText(/ยกเลิกการรับชำระทั้งใบวางบิล/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "ยกเลิกรายการ" }));
    expect(await screen.findByText(/ทุกใบแจ้งหนี้ที่รับชำระครั้งนี้ และใบเสร็จรวม จะถูกยกเลิกด้วยกัน/)).toBeInTheDocument();
  });
});

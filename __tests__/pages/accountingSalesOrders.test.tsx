/**
 * Customer POs, through the real pages:
 *  • the list: what is still to deliver (ex VAT), late ones in red, ส่งของ ▸
 *    only while something is left, status tabs;
 *  • a new PO: filled from the quotation the customer accepted, the
 *    customer's PO number asked for before anything is sent;
 *  • one PO: ordered / delivered / left per line, its deliveries, and what can
 *    still be done — edit (before any invoice), reschedule, cancel the rest
 *    with a reason (not once everything went), delete (blocked by deliveries);
 *  • a delivery: the invoice opens with what is left, each line's discount and
 *    the bill's following the quantity sent, nothing beyond what is left;
 *  • the dashboard's ยอดรอส่งของ: hidden when the module is off, never taking
 *    the dashboard down with a bad answer.
 */
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const router = { push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() };
let params: Record<string, string> = {};
let search = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/accounting/sales-orders",
  useSearchParams: () => search,
  useParams: () => params,
}));

import SalesOrderListPage from "@/app/accounting/sales-orders/page";
import NewSalesOrderPage from "@/app/accounting/sales-orders/new/page";
import SalesOrderPage from "@/app/accounting/sales-orders/[id]/page";
import NewInvoicePage from "@/app/accounting/invoices/new/page";
import RecordExternalInvoicePage from "@/app/accounting/invoices/record-external/page";
import BacklogSection from "@/app/dashboard/BacklogSection";

const SELLER = { name: "บริษัท โปรฟิน แล็บ จำกัด", address: "93 นนทบุรี", taxId: "0107537000114", branchCode: "00000", phone: "", email: "" };
const SETTINGS = { seller: SELLER, sellerVersionId: "v1", vatRate: 7, creditDays: 30, bankAccounts: [] };

/**
 * PO-6611: ปั๊มน้ำ 3 × 1,000.00 less 300.00 (one delivered, with 100.00 of it)
 * and ติดตั้ง 1 × 500.00; bill discount 320.00 (90.00 of it delivered).
 * Still to deliver: 2,700 × 2/3 + 500 = 2,300 of 3,200 → 2,880 × 23/32 = 2,070.00.
 */
const ORDER = {
  id: "so1", docType: "SO", status: "issued", customerPoNo: "PO-6611", issueDate: "2026-11-10", expectedDeliveryDate: "2026-11-30",
  creditDays: 30, companyId: "co1", customerId: "c1", salespersonId: "", buyerName: "บริษัท เอ จำกัด", buyerAddress: "1 ถนนงามวงศ์วาน",
  buyerTaxId: "0107537000114", buyerBranch: "00000", priceMode: "exclusive", vatRate: 7, subtotalSatang: 320000, discountSatang: 32000,
  depositSatang: 0, vatBaseSatang: 288000, vatSatang: 20160, totalSatang: 308160, paidSatang: 0, projectName: "โรงงานบางนา", note: "",
  externalNote: "อีเมลลูกค้า 10 พ.ย.", voidReason: null, updatedAt: "t1", isTaxInvoice: false, docNo: null, salesOrderId: null, source: "internal",
  lines: [
    { id: "a", sortOrder: 0, lineType: "goods", productId: "", name: "ปั๊มน้ำ", qty: 3, unit: "ชิ้น", unitPriceSatang: 100000, discountSatang: 30000, amountSatang: 270000, isMachine: false, serials: "", warrantyMonths: null, deliveredQty: 1, sourceLineId: "" },
    { id: "b", sortOrder: 1, lineType: "service", productId: "", name: "ติดตั้ง", qty: 1, unit: "งาน", unitPriceSatang: 50000, discountSatang: 0, amountSatang: 50000, isMachine: false, serials: "", warrantyMonths: null, deliveredQty: 0, sourceLineId: "" },
  ],
};
const BLOCKED = "มีใบแจ้งหนี้ที่ส่งของจาก PO นี้แล้ว — ลบใบแจ้งหนี้นั้นก่อน หรือกด ยกเลิก PO แทน";
const DETAIL = {
  order: ORDER,
  orderStatus: "partial",
  backlogSatang: 207000,
  deliveries: [{ id: "inv1", docNo: "INV2026110001", status: "issued", source: "internal", issueDate: "2026-11-12", totalSatang: 86670 }],
  invoicedLineDiscounts: { a: 10000 },
  invoicedBillDiscountSatang: 9000,
  impact: { status: "issued", docNo: null, isLatestNumber: false, livePayments: 0, dependentDocs: 1, blockedReason: BLOCKED, sale: null, machines: { total: 0, withHistory: 0 }, receiptPayment: null },
};
/** The same PO before anything was delivered from it. */
const UNTOUCHED = {
  ...DETAIL,
  order: { ...ORDER, lines: ORDER.lines.map((l) => ({ ...l, deliveredQty: 0 })) },
  orderStatus: "open",
  backlogSatang: 288000,
  deliveries: [],
  invoicedLineDiscounts: {},
  invoicedBillDiscountSatang: 0,
  impact: { ...DETAIL.impact, dependentDocs: 0, blockedReason: null },
};
const ROWS = [
  { id: "so1", customerPoNo: "PO-6611", issueDate: "2026-11-10", expectedDeliveryDate: "2026-11-15", companyId: "co1", buyerName: "บริษัท เอ จำกัด", projectName: "โรงงานบางนา", status: "issued", orderStatus: "partial", totalSatang: 308160, vatBaseSatang: 288000, backlogSatang: 207000, late: true },
  { id: "so2", customerPoNo: "PO-7000", issueDate: "2026-10-01", expectedDeliveryDate: null, companyId: "", buyerName: "ร้าน บี", projectName: "", status: "issued", orderStatus: "complete", totalSatang: 107000, vatBaseSatang: 100000, backlogSatang: 0, late: false },
];
const BACKLOG = { today: "2026-11-19", rows: [ROWS[0]], totals: { backlogSatang: 207000, count: 1, lateSatang: 207000, lateCount: 1 } };

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
      case "/api/accounting/sales-orders": return json(ROWS);
      case "/api/accounting/sales-orders/backlog": return json(BACKLOG);
      case "/api/accounting/sales-orders/so1": return json(DETAIL);
      case "/api/accounting/audit": return json([]);
      case "/api/companies":
        return json([{ id: "co1", name: "บริษัท เอ จำกัด", addressNo: "1", road: "งามวงศ์วาน", province: "นนทบุรี", taxId: "0107537000114", branchCode: "00000" }]);
      case "/api/customers": return json([{ id: "c1", name: "คุณเอ", companyId: "co1" }]);
      case "/api/salespeople": return json([]);
      case "/api/products": return json([{ id: "p1", title_th: "เครื่องชั่ง AND GR-200" }]);
      default: return json({});
    }
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the customer-PO list", () => {
  async function loaded() {
    render(<SalesOrderListPage />);
    await screen.findByTestId("order-table");
  }
  const table = () => within(screen.getByTestId("order-table"));

  it("shows what is still to deliver, ex VAT, late in red — and ส่งของ ▸ only while something is left", async () => {
    await loaded();
    const cards = within(screen.getByTestId("order-summary"));
    expect(cards.getAllByText("฿2,070.00")).toHaveLength(2); // all of it is late
    expect(table().getByText("PO-6611")).toBeInTheDocument();
    expect(table().getByText("เกินกำหนดส่ง")).toBeInTheDocument();
    expect(table().getByText("ส่งครบ")).toBeInTheDocument();
    const deliver = table().getAllByRole("link", { name: "ส่งของ ▸" });
    expect(deliver).toHaveLength(1);
    expect(deliver[0]).toHaveAttribute("href", "/accounting/invoices/new?fromOrder=so1");
  });

  it("narrows to a status", async () => {
    await loaded();
    fireEvent.click(screen.getByRole("tab", { name: "ส่งครบ 1" }));
    expect(table().queryByText("PO-6611")).not.toBeInTheDocument();
    expect(table().getByText("PO-7000")).toBeInTheDocument();
  });

  it("says it could not load, instead of breaking, on an answer that is not a list", async () => {
    override = (path) => (path === "/api/accounting/sales-orders" ? json({ error: "x" }) : undefined);
    render(<SalesOrderListPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("โหลดรายการ PO ลูกค้าไม่สำเร็จ");
  });
});

describe("a new customer PO", () => {
  const QUOTATION = {
    id: "q1",
    docNo: "QT-2611-001",
    data: {
      companyId: "co1",
      customerId: "c1",
      customerCompany: "บริษัท เอ จำกัด",
      items: [
        { id: "i1", productId: "p1", name: "เครื่องชั่ง AND GR-200", qty: 2, unit: "เครื่อง", unitPrice: 1500 },
        { id: "i2", name: "ติดตั้ง", qty: 1, unit: "งาน", unitPrice: 200 },
      ],
    },
  };
  beforeEach(() => {
    override = (path, init) => {
      if (path === "/api/quotations") return json([{ id: "q1", docNo: "QT-2611-001", createdAt: "2026-11-05T03:00:00.000Z", customer: "บริษัท เอ จำกัด", total: 3424 }]);
      if (path === "/api/quotations/q1") return json(QUOTATION);
      if (path === "/api/accounting/sales-orders" && init?.method === "POST") return json({ ...ORDER, id: "so9" }, 201);
      return undefined;
    };
  });

  async function fromQuotation() {
    render(<NewSalesOrderPage />);
    // The picker waits for the catalog: a product's line is goods only when the product is known.
    await waitFor(() => expect(document.getElementById("order-quotation")).toBeEnabled());
    await waitFor(() => expect(calls("/api/quotations")).toHaveLength(1));
    choose("order-quotation", "QT-2611-001 · บริษัท เอ จำกัด");
    await screen.findByText(/เติมจากใบเสนอราคาแล้ว/);
  }

  it("fills the customer and the lines in from the quotation — a catalog product as a machine, the rest as a service", async () => {
    await fromQuotation();
    expect(screen.getByLabelText(/ชื่อลูกค้าที่พิมพ์ในเอกสาร/)).toHaveValue("บริษัท เอ จำกัด");
    expect(screen.getByLabelText("ชื่อรายการที่ 1")).toHaveValue("เครื่องชั่ง AND GR-200");
    expect(screen.getByLabelText("ชื่อรายการที่ 2")).toHaveValue("ติดตั้ง");
    expect(screen.getAllByRole("checkbox", { name: /ลงทะเบียนเป็นเครื่องของลูกค้า/ })).toHaveLength(1);
    expect(screen.getByRole("checkbox", { name: /ลงทะเบียนเป็นเครื่องของลูกค้า/ })).toBeChecked();
    expect(screen.getByLabelText("หมายเหตุ (พิมพ์ในเอกสาร)")).toHaveValue("อ้างอิงใบเสนอราคา QT-2611-001");
    expect(within(screen.getByTestId("invoice-totals")).getByText("3,424.00")).toBeInTheDocument();
    expect(screen.getByTestId("order-banner")).toHaveTextContent("ยังไม่นับเป็นยอดขาย");
  });

  it("asks for the customer's PO number before sending anything, then records it and opens it", async () => {
    await fromQuotation();
    fireEvent.click(screen.getByRole("button", { name: "บันทึก PO ลูกค้า" }));
    expect(await screen.findByText("ยังบันทึกไม่ได้: กรุณากรอกเลขที่ PO ของลูกค้า")).toBeInTheDocument();
    expect(calls("/api/accounting/sales-orders", "POST")).toHaveLength(0);

    fireEvent.change(screen.getByLabelText(/เลขที่ PO ลูกค้า/), { target: { value: "PO-6611" } });
    fireEvent.change(screen.getByLabelText(/เก็บ PO ตัวจริงไว้ที่/), { target: { value: "อีเมลลูกค้า 18 พ.ย." } });
    fireEvent.click(screen.getByRole("button", { name: "บันทึก PO ลูกค้า" }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/accounting/sales-orders/so9"));
    const sent = bodyOf("/api/accounting/sales-orders", "POST");
    expect(sent).toMatchObject({ customerPoNo: "PO-6611", storageNote: "อีเมลลูกค้า 18 พ.ย.", isTaxInvoice: false, salesOrderId: "", companyId: "co1" });
    expect(sent.lines[0]).toMatchObject({ productId: "p1", isMachine: true, qty: 2, unitPriceSatang: 150000 });
    expect(sent.lines[1]).toMatchObject({ lineType: "service", isMachine: false });
  });
});

describe("one customer PO", () => {
  beforeEach(() => {
    params = { id: "so1" };
  });
  async function loaded() {
    render(<SalesOrderPage />);
    await screen.findByTestId("order-lines");
  }

  it("shows each line as ordered, delivered and left, what is still to deliver, and its invoices", async () => {
    await loaded();
    const pump = within(screen.getByTestId("order-lines")).getByText("ปั๊มน้ำ").closest("tr")!;
    expect(within(pump).getByText("3 ชิ้น")).toBeInTheDocument();
    expect(within(pump).getByText("1")).toBeInTheDocument();
    expect(within(pump).getByText("2")).toBeInTheDocument();
    expect(screen.getByTestId("order-backlog")).toHaveTextContent("2,070.00");
    expect(screen.getAllByText("ส่งบางส่วน").length).toBeGreaterThan(0);
    expect(within(screen.getByTestId("order-deliveries")).getByRole("link", { name: "INV2026110001" })).toHaveAttribute("href", "/accounting/invoices/inv1");
    expect(screen.getByRole("link", { name: "ส่งของ / ออกใบแจ้งหนี้ ▸" })).toHaveAttribute("href", "/accounting/invoices/new?fromOrder=so1");
    expect(screen.getByRole("link", { name: /ออกใบแจ้งหนี้จากที่อื่นแล้ว/ })).toHaveAttribute("href", "/accounting/invoices/record-external?fromOrder=so1");
    // Its lines are pointed at by an invoice: no editing them any more.
    expect(screen.queryByRole("button", { name: "แก้ไข PO" })).not.toBeInTheDocument();
  });

  it("cancels what is left — only with a reason", async () => {
    override = (path, init) => (path === "/api/accounting/sales-orders/so1/cancel" && init?.method === "POST" ? json({ ...ORDER, status: "void" }) : undefined);
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "ยกเลิกส่วนที่เหลือ" }));
    const dialog = screen.getByRole("dialog", { name: "ยกเลิกส่วนที่ยังไม่ได้ส่ง?" });
    expect(within(dialog).getByText(/2,070.00 บาท \(ก่อน VAT\) จะออกจากยอดรอส่งของ/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "ยืนยันยกเลิก" }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent("กรุณาบอกเหตุผลที่ยกเลิก");
    expect(calls("/api/accounting/sales-orders/so1/cancel", "POST")).toHaveLength(0);

    fireEvent.change(within(dialog).getByLabelText(/เหตุผล/), { target: { value: "ลูกค้าไม่เอาส่วนที่เหลือ" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "ยืนยันยกเลิก" }));
    await waitFor(() => expect(calls("/api/accounting/sales-orders/so1")).toHaveLength(2)); // reloaded
    expect(bodyOf("/api/accounting/sales-orders/so1/cancel", "POST")).toEqual({ reason: "ลูกค้าไม่เอาส่วนที่เหลือ" });
  });

  it("moves the delivery date and the notes", async () => {
    override = (path, init) => (path === "/api/accounting/sales-orders/so1" && init?.method === "PATCH" ? json(ORDER) : undefined);
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "แก้กำหนดส่ง / หมายเหตุ" }));
    const dialog = screen.getByRole("dialog", { name: "แก้กำหนดส่ง / หมายเหตุ" });
    fireEvent.change(within(dialog).getByLabelText("เก็บ PO ตัวจริงไว้ที่"), { target: { value: "แฟ้ม PO 2569" } });
    fireEvent.change(within(dialog).getByLabelText("หมายเหตุ"), { target: { value: "ลูกค้าขอเลื่อน" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "บันทึก" }));
    await waitFor(() => expect(calls("/api/accounting/sales-orders/so1", "PATCH")).toHaveLength(1));
    expect(bodyOf("/api/accounting/sales-orders/so1", "PATCH")).toEqual({ expectedDeliveryDate: "2026-11-30", storageNote: "แฟ้ม PO 2569", note: "ลูกค้าขอเลื่อน" });
  });

  it("says why it cannot be deleted while an invoice delivers from it", async () => {
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "ลบ PO" }));
    expect(await screen.findByText(`PO PO-6611: ${BLOCKED}`)).toBeInTheDocument();
  });

  it("before anything is delivered: edits its lines, saving over the PO it opened", async () => {
    override = (path, init) => {
      if (path === "/api/accounting/sales-orders/so1" && !init?.method) return json(UNTOUCHED);
      if (path === "/api/accounting/sales-orders/so1" && init?.method === "PUT") return json(UNTOUCHED.order);
      return undefined;
    };
    await loaded();
    expect(screen.getByRole("button", { name: "ยกเลิก PO" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "แก้ไข PO" }));
    fireEvent.change(await screen.findByLabelText("ชื่อรายการที่ 1"), { target: { value: "ปั๊มน้ำ 2 นิ้ว" } });
    fireEvent.click(screen.getByRole("button", { name: "บันทึก PO ลูกค้า" }));
    await waitFor(() => expect(calls("/api/accounting/sales-orders/so1", "PUT")).toHaveLength(1));
    const sent = bodyOf("/api/accounting/sales-orders/so1", "PUT");
    expect(sent).toMatchObject({ expectedUpdatedAt: "t1", customerPoNo: "PO-6611", expectedDeliveryDate: "2026-11-30", storageNote: "อีเมลลูกค้า 10 พ.ย." });
    expect(sent.lines[0].name).toBe("ปั๊มน้ำ 2 นิ้ว");
  });

  it("delivered in full: nothing left to cancel or to deliver", async () => {
    override = (path, init) =>
      path === "/api/accounting/sales-orders/so1" && !init?.method
        ? json({ ...DETAIL, order: { ...ORDER, lines: ORDER.lines.map((l) => ({ ...l, deliveredQty: l.qty })) }, orderStatus: "complete", backlogSatang: 0 })
        : undefined;
    await loaded();
    expect(screen.queryByRole("button", { name: /ยกเลิก/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "ส่งของ / ออกใบแจ้งหนี้ ▸" })).not.toBeInTheDocument();
  });

  it("says it could not load, instead of breaking, on an answer that is not a PO", async () => {
    override = (path) => (path === "/api/accounting/sales-orders/so1" ? json({ order: { id: "so1" } }) : undefined);
    render(<SalesOrderPage />);
    expect(await screen.findByText("โหลด PO ลูกค้าไม่สำเร็จ")).toBeInTheDocument();
  });
});

describe("a delivery from a customer PO", () => {
  beforeEach(() => {
    search = new URLSearchParams("fromOrder=so1");
  });
  async function loaded() {
    render(<NewInvoicePage />);
    await screen.findByTestId("delivery-banner");
  }
  const qty = (i: number) => screen.getAllByLabelText("จำนวนที่ส่งรอบนี้")[i];
  const lineDiscount = (i: number) => screen.getAllByLabelText("ส่วนลด (บาท)")[i];

  it("opens with what is left of each line, its discount, and what is left of the bill's", async () => {
    await loaded();
    expect(screen.getByTestId("delivery-banner")).toHaveTextContent("PO-6611");
    expect(screen.getByLabelText("ชื่อรายการที่ 1")).toHaveValue("ปั๊มน้ำ");
    expect(qty(0)).toHaveValue("2");
    expect(qty(1)).toHaveValue("1");
    expect(screen.getAllByTestId("delivery-hint")[0]).toHaveTextContent("PO สั่ง 3 · ส่งแล้ว 1 · เหลือ 2");
    // The rest of the line's 300.00 (100.00 went with the first delivery), the rest of the bill's 320.00.
    expect(lineDiscount(0)).toHaveValue("200.00");
    expect(screen.getByLabelText("ส่วนลดท้ายบิล (บาท)")).toHaveValue("230.00");
    expect(screen.getByLabelText(/เลขที่ PO ลูกค้า/)).toHaveValue("PO-6611");
  });

  it("follows the quantity sent with both discounts", async () => {
    await loaded();
    fireEvent.change(qty(0), { target: { value: "1" } });
    expect(lineDiscount(0)).toHaveValue("100.00");
    // 900 + 500 of 3,200 → 320 × 14/32 = 140.00
    expect(screen.getByLabelText("ส่วนลดท้ายบิล (บาท)")).toHaveValue("140.00");
    expect(within(screen.getByTestId("invoice-totals")).getByText("1,348.20")).toBeInTheDocument();
  });

  it("keeps a discount typed by hand", async () => {
    await loaded();
    fireEvent.change(lineDiscount(0), { target: { value: "50" } });
    fireEvent.change(qty(0), { target: { value: "1" } });
    expect(lineDiscount(0)).toHaveValue("50");
  });

  it("sends nothing beyond what is left of a line", async () => {
    await loaded();
    fireEvent.change(qty(0), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "บันทึกร่าง" }));
    expect(await screen.findByText("ยังบันทึกไม่ได้: เกินจำนวนที่เหลือใน PO (เหลือ 2 ชิ้น)")).toBeInTheDocument();
    expect(calls("/api/accounting/documents", "POST")).toHaveLength(0);
  });

  it("saves the draft pointing at the PO and each of its lines", async () => {
    override = (path, init) => (path === "/api/accounting/documents" && init?.method === "POST" ? json({ ...ORDER, id: "inv-new", docType: "INV", status: "draft" }, 201) : undefined);
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "บันทึกร่าง" }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/accounting/invoices/inv-new"));
    const sent = bodyOf("/api/accounting/documents", "POST");
    expect(sent).toMatchObject({ salesOrderId: "so1", customerPoNo: "PO-6611", discountSatang: 23000 });
    expect(sent.lines.map((l: { sourceLineId: string; qty: number; discountSatang: number }) => [l.sourceLineId, l.qty, l.discountSatang])).toEqual([["a", 2, 20000], ["b", 1, 0]]);
  });

  it("will not open from a cancelled PO, nor one delivered in full — here or as an outside invoice", async () => {
    override = (path) => (path === "/api/accounting/sales-orders/so1" ? json({ ...DETAIL, order: { ...ORDER, status: "void" }, orderStatus: "cancelled" }) : undefined);
    const { unmount } = render(<NewInvoicePage />);
    expect(await screen.findByText("PO ลูกค้านี้ถูกยกเลิกแล้ว — ส่งของจาก PO นี้ไม่ได้")).toBeInTheDocument();
    unmount();
    override = (path) => (path === "/api/accounting/sales-orders/so1" ? json({ ...DETAIL, orderStatus: "complete", backlogSatang: 0 }) : undefined);
    render(<RecordExternalInvoicePage />);
    expect(await screen.findByText("PO ลูกค้านี้ส่งของครบแล้ว")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "กลับไปที่ PO PO-6611" })).toHaveAttribute("href", "/accounting/sales-orders/so1");
  });

  it("still opens while a line is left to send — even one with nothing to charge", async () => {
    override = (path) => (path === "/api/accounting/sales-orders/so1" ? json({ ...DETAIL, backlogSatang: 0 }) : undefined);
    render(<NewInvoicePage />);
    expect(await screen.findByTestId("delivery-banner")).toBeInTheDocument();
  });

  it("records an outside invoice against the PO, opening with what is left", async () => {
    render(<RecordExternalInvoicePage />);
    expect(await screen.findByTestId("delivery-banner")).toHaveTextContent("PO-6611");
    expect(screen.getAllByLabelText("จำนวนที่ส่งรอบนี้")[0]).toHaveValue("2");
    expect(screen.getByLabelText(/เลขที่ตามเอกสารจริง/)).toBeInTheDocument();
  });
});

describe("the dashboard's ยอดรอส่งของ", () => {
  const row = (n: number, late = false) => ({ ...ROWS[0], id: `so${n}`, customerPoNo: `PO-${n}`, late, backlogSatang: 10000 });

  it("shows the totals and the first eight POs, late ones marked, each with ส่งของ ▸", async () => {
    override = (path) =>
      path === "/api/accounting/sales-orders/backlog"
        ? json({ today: "2026-11-19", rows: [row(1, true), ...Array.from({ length: 8 }, (_, i) => row(i + 2))], totals: { backlogSatang: 90000, count: 9, lateSatang: 10000, lateCount: 1 } })
        : undefined;
    render(<BacklogSection />);
    const table = within(await screen.findByTestId("backlog-table"));
    expect(within(screen.getByTestId("backlog-totals")).getByText("฿900.00")).toBeInTheDocument();
    expect(table.getAllByRole("row")).toHaveLength(9); // the header + 8
    expect(table.getByText(/\(เลยแล้ว\)/)).toBeInTheDocument();
    expect(table.getAllByRole("link", { name: "ส่งของ ▸" })[0]).toHaveAttribute("href", "/accounting/invoices/new?fromOrder=so1");
    expect(screen.getByRole("link", { name: "ดูอีก 1 PO →" })).toHaveAttribute("href", "/accounting/sales-orders");
  });

  it("is not there at all while the module is switched off", async () => {
    override = (path) => (path === "/api/accounting/sales-orders/backlog" ? json({ error: "ไม่พบหน้านี้" }, 404) : undefined);
    const { container } = render(<BacklogSection />);
    await waitFor(() => expect(calls("/api/accounting/sales-orders/backlog")).toHaveLength(1));
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it("says it could not load on a bad answer — never taking the dashboard down — and tries again", async () => {
    let answer: unknown = { rows: "x" };
    override = (path) => (path === "/api/accounting/sales-orders/backlog" ? json(answer) : undefined);
    render(<BacklogSection />);
    expect(await screen.findByRole("alert")).toHaveTextContent("โหลดยอดรอส่งของไม่สำเร็จ");
    answer = BACKLOG;
    fireEvent.click(screen.getByRole("button", { name: "ลองใหม่" }));
    expect(await screen.findByTestId("backlog-table")).toBeInTheDocument();
  });
});

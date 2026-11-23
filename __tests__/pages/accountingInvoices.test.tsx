/**
 * /accounting/invoices…, through the real pages:
 *  • the list: status dots and pills like the owner's sample, overdue in red,
 *    the owed / overdue cards, tabs, search, and delete from the ⋯ menu;
 *  • a new invoice: a company fills the buyer in, totals are live, problems
 *    are said before anything is sent, and issuing shows the number it will
 *    get before it is given;
 *  • an issued one: the paper, printing as original or copy, and deleting
 *    with everything it takes along said first.
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

import InvoiceListPage from "@/app/accounting/invoices/page";
import NewInvoicePage from "@/app/accounting/invoices/new/page";
import InvoiceDocumentPage from "@/app/accounting/invoices/[id]/page";

const SELLER = { name: "บริษัท โปรฟิน แล็บ จำกัด", address: "93 นนทบุรี", taxId: "0107537000114", branchCode: "00000", phone: "", email: "" };
const SETTINGS = { seller: SELLER, sellerVersionId: "v1", vatRate: 7, creditDays: 30, bankAccounts: [] };
const ROWS = [
  { id: "d1", docNo: null, status: "draft", source: "internal", isTaxInvoice: true, issueDate: "2026-11-18", dueDate: "2026-12-18", buyerName: "บริษัท ร่าง จำกัด", projectName: "", customerPoNo: "", totalSatang: 100000, paidSatang: 0 },
  { id: "d2", docNo: "INV2026100040", status: "issued", source: "internal", isTaxInvoice: true, issueDate: "2026-10-14", dueDate: "2026-11-13", buyerName: "บริษัท คร๊าฟซ์ แพคเกจจิ้ง ไทย จำกัด", projectName: "เวอร์เนียร์", customerPoNo: "POO2609173", totalSatang: 2225600, paidSatang: 0 },
  { id: "d3", docNo: "INV2026110033", status: "issued", source: "internal", isTaxInvoice: true, issueDate: "2026-11-06", dueDate: "2026-12-06", buyerName: "บริษัท เอ จำกัด", projectName: "", customerPoNo: "", totalSatang: 2033000, paidSatang: 0 },
];
const ISSUED_DOC = {
  id: "d3", docType: "INV", docNo: "INV2026110033", status: "issued", source: "internal", isTaxInvoice: true,
  issueDate: "2026-11-06", dueDate: "2026-12-06", creditDays: 30, companyId: "co1", customerId: "c1", salespersonId: "",
  buyerName: "บริษัท เอ จำกัด", buyerAddress: "1 ถนนงามวงศ์วาน", buyerTaxId: "0107537000114", buyerBranch: "00000",
  priceMode: "exclusive", vatRate: 7, subtotalSatang: 1900000, discountSatang: 0, depositSatang: 0, vatBaseSatang: 1900000,
  vatSatang: 133000, totalSatang: 2033000, paidSatang: 0, customerPoNo: "", projectName: "", note: "",
  salesRecordId: "sale-9", issuedAt: "2026-11-06T03:00:00.000Z", issuedBy: "admin", createdBy: "admin", updatedAt: "t1",
  lines: [{ lineType: "goods", productId: "", name: "อะไหล่ Grip", qty: 1, unit: "ชิ้น", unitPriceSatang: 1900000, discountSatang: 0, amountSatang: 1900000, isMachine: false, serials: "", warrantyMonths: null }],
};
const IMPACT = { status: "issued", docNo: "INV2026110033", isLatestNumber: true, livePayments: 0, dependentDocs: 0, sale: { id: "sale-9", costSatang: 0, sharedWithOtherDocs: false }, machines: { total: 0, withHistory: 0 } };

const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });
let override: ((path: string, init?: RequestInit) => unknown) | null;
let fetchMock: ReturnType<typeof vi.fn>;
const calls = (path: string, method = "GET") =>
  fetchMock.mock.calls.filter(([u, i]) => new URL(String(u), "http://localhost").pathname === path && ((i as RequestInit | undefined)?.method ?? "GET") === method);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-18T05:00:00Z"));
  override = null;
  params = {};
  router.push.mockClear();
  router.replace.mockClear();
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const custom = override?.(url.pathname, init);
    if (custom !== undefined) return custom;
    switch (url.pathname) {
      case "/api/accounting/status": return json({ twoFactorEnabled: true, username: "admin" });
      case "/api/accounting/settings": return json(SETTINGS);
      case "/api/accounting/documents": return json(ROWS);
      case "/api/accounting/documents/summary":
        return json({ outstandingSatang: 4258600, outstandingCount: 2, overdueSatang: 2225600, overdueCount: 1, issuedInMonthSatang: 2033000 });
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

describe("the invoice list", () => {
  async function loaded() {
    render(<InvoiceListPage />);
    await screen.findByTestId("invoice-table");
  }
  const table = () => within(screen.getByTestId("invoice-table"));

  it("shows each document with its status, the customer and project/PO under it, and overdue in red", async () => {
    await loaded();
    expect(table().getByText("INV2026100040")).toBeInTheDocument();
    expect(table().getByText("เวอร์เนียร์ · PO POO2609173")).toBeInTheDocument();
    expect(table().getByText("22,256.00")).toBeInTheDocument();
    expect(table().getByText("เกินกำหนด")).toBeInTheDocument();
    expect(table().getByText("รอเก็บเงิน")).toBeInTheDocument();
    expect(table().getByText("ร่าง", { selector: "span.rounded-md" })).toBeInTheDocument();
  });

  it("shows what is owed and overdue across every invoice", async () => {
    await loaded();
    const cards = within(screen.getByTestId("invoice-summary"));
    expect(cards.getByText("฿42,586.00")).toBeInTheDocument();
    expect(cards.getByText("฿22,256.00")).toBeInTheDocument();
  });

  it("narrows to a status tab and to a search", async () => {
    await loaded();
    fireEvent.click(screen.getByRole("tab", { name: /เกินกำหนด 1/ }));
    expect(table().getAllByRole("row")).toHaveLength(2); // header + one
    fireEvent.click(screen.getByRole("tab", { name: /ทั้งหมด 3/ }));
    fireEvent.change(screen.getByLabelText("ค้นหาเอกสาร"), { target: { value: "POO2609173" } });
    expect(table().getAllByRole("row")).toHaveLength(2);
  });

  it("asks for this year by default and for the range picked", async () => {
    await loaded();
    expect(String(calls("/api/accounting/documents")[0][0])).toContain("from=2026-01-01&to=2027-01-01");
    fireEvent.click(screen.getByRole("button", { name: "ปีนี้" }));
    fireEvent.click(screen.getByRole("button", { name: "เดือนก่อน" }));
    await waitFor(() => expect(String(calls("/api/accounting/documents").at(-1)![0])).toContain("from=2026-10-01&to=2026-11-01"));
  });

  it("deletes a draft from the ⋯ menu, then reloads", async () => {
    override = (path, init) => {
      if (path === "/api/accounting/documents/d1" && !init?.method) {
        return json({ document: {}, seller: SELLER, impact: { ...IMPACT, status: "draft", docNo: null, sale: null } });
      }
      if (path === "/api/accounting/documents/d1" && init?.method === "DELETE") return json({ docNo: null });
      return undefined;
    };
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "ทำรายการกับ ร่าง" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "ลบ" }));
    expect(await screen.findByText("ลบร่างนี้?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "ลบร่าง" }));
    await waitFor(() => expect(calls("/api/accounting/documents/d1", "DELETE")).toHaveLength(1));
    await waitFor(() => expect(calls("/api/accounting/documents").length).toBeGreaterThan(1));
  });
});

// The ⋯ menu of a row. The list sits in a rounded box with overflow-hidden, and
// a menu drawn INSIDE it was cut off at the box's edge — on the last row (or the
// only one) it opened out of sight. It is drawn on <body>, placed by the button.
describe("the invoice list's ⋯ menu", () => {
  async function loaded() {
    render(<InvoiceListPage />);
    await screen.findByTestId("invoice-table");
  }
  const open = (name: string) => {
    fireEvent.click(screen.getByRole("button", { name }));
    return screen.getByRole("menu");
  };
  /** The button's box on screen — jsdom has no layout, so the test gives it one. */
  const placeButton = (name: string, rect: { top: number; bottom: number; right: number }) => {
    const button = screen.getByRole("button", { name });
    vi.spyOn(button, "getBoundingClientRect").mockReturnValue({ ...rect, left: rect.right - 36, width: 36, height: rect.bottom - rect.top, x: rect.right - 36, y: rect.top, toJSON: () => ({}) } as DOMRect);
  };

  it("is drawn outside the list's clipping box, over everything", async () => {
    await loaded();
    const menu = open("ทำรายการกับ INV2026100040");
    // Not inside the table's box (overflow-hidden would cut it) — on <body>, fixed.
    expect(screen.getByTestId("invoice-table").closest(".overflow-hidden")!.contains(menu)).toBe(false);
    expect(menu.parentElement).toBe(document.body);
    expect(menu.className).toContain("fixed");
    // A list that stops Esc of a window under it, as every dropdown panel does.
    expect(menu.hasAttribute("data-dropdown-panel")).toBe(true);
  });

  it("opens below the button, its right edge on the button's", async () => {
    await loaded();
    placeButton("ทำรายการกับ INV2026100040", { top: 100, bottom: 136, right: 900 });
    const menu = open("ทำรายการกับ INV2026100040");
    expect(menu.style.top).toBe("140px");
    expect(menu.style.left).toBe("740px"); // right 900 − the menu's 160 wide
    expect(menu.style.bottom).toBe("");
  });

  it("opens upward when there is no room below — the last row of a short window", async () => {
    await loaded();
    placeButton("ทำรายการกับ INV2026110033", { top: window.innerHeight - 50, bottom: window.innerHeight - 14, right: 900 });
    const menu = open("ทำรายการกับ INV2026110033");
    expect(menu.style.bottom).toBe("54px"); // 50 from the button's top to the window's bottom, + a 4px gap
    expect(menu.style.top).toBe("");
  });

  it("stays on screen at the left edge of a narrow window", async () => {
    await loaded();
    placeButton("ทำรายการกับ INV2026100040", { top: 100, bottom: 136, right: 100 });
    expect(open("ทำรายการกับ INV2026100040").style.left).toBe("8px");
  });

  it("closes on Esc and on a click elsewhere — and again on the button", async () => {
    await loaded();
    open("ทำรายการกับ INV2026100040");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    open("ทำรายการกับ INV2026100040");
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
    open("ทำรายการกับ INV2026100040");
    fireEvent.click(screen.getByRole("button", { name: "ทำรายการกับ INV2026100040" }));
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("a click inside the menu does not close it by the outside-click rule, and opens the document — once, not twice", async () => {
    await loaded();
    const menu = open("ทำรายการกับ INV2026100040");
    fireEvent.mouseDown(within(menu).getByRole("menuitem", { name: "ดู / พิมพ์" }));
    expect(screen.queryByRole("menu")).not.toBeNull();
    fireEvent.click(within(menu).getByRole("menuitem", { name: "ดู / พิมพ์" }));
    expect(router.push).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledWith("/accounting/invoices/d2");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("choosing ลบ asks about deleting and does not also open the row", async () => {
    override = (path, init) =>
      path === "/api/accounting/documents/d2" && !init?.method ? json({ document: {}, seller: SELLER, impact: { ...IMPACT, docNo: "INV2026100040" } }) : undefined;
    await loaded();
    const menu = open("ทำรายการกับ INV2026100040");
    fireEvent.click(within(menu).getByRole("menuitem", { name: "ลบ" }));
    expect(router.push).not.toHaveBeenCalled();
  });

  it("follows the button when the page scrolls, and goes with a window resize", async () => {
    await loaded();
    placeButton("ทำรายการกับ INV2026100040", { top: 100, bottom: 136, right: 900 });
    const menu = open("ทำรายการกับ INV2026100040");
    expect(menu.style.top).toBe("140px");
    placeButton("ทำรายการกับ INV2026100040", { top: 60, bottom: 96, right: 900 });
    fireEvent.scroll(window);
    expect(screen.getByRole("menu").style.top).toBe("100px");
  });
});

describe("a new invoice", () => {
  async function loaded() {
    render(<NewInvoicePage />);
    await screen.findByLabelText(/ชื่อลูกค้าที่พิมพ์ในเอกสาร/);
  }

  it("fills the buyer in from the company, and works the totals out as prices are typed", async () => {
    await loaded();
    await waitFor(() => expect(calls("/api/companies")).toHaveLength(1));
    fireEvent.click(screen.getByLabelText(/บริษัทลูกค้า/));
    fireEvent.click(await screen.findByRole("button", { name: /บริษัท เอ จำกัด/ }));
    expect((screen.getByLabelText(/ชื่อลูกค้าที่พิมพ์ในเอกสาร/) as HTMLInputElement).value).toBe("บริษัท เอ จำกัด");
    expect((screen.getByLabelText("เลขประจำตัวผู้เสียภาษี") as HTMLInputElement).value).toBe("0107537000114");
    expect((screen.getByLabelText("สาขา") as HTMLInputElement).value).toBe("สำนักงานใหญ่");

    fireEvent.change(screen.getByLabelText("ชื่อรายการที่ 1"), { target: { value: "เครื่องชั่ง AND GR-200" } });
    fireEvent.change(screen.getByLabelText("ราคา/หน่วย (บาท)"), { target: { value: "58,000" } });
    expect(within(screen.getByTestId("invoice-totals")).getByText("62,060.00")).toBeInTheDocument();
  });

  it("says what is missing before sending anything", async () => {
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "บันทึกร่าง" }));
    expect(await screen.findByText(/ยังบันทึกไม่ได้: กรุณาเลือกหรือกรอกชื่อลูกค้า/)).toBeInTheDocument();
    expect(calls("/api/accounting/documents", "POST")).toHaveLength(0);
  });

  it("says a branch it cannot read under the field, instead of dropping it", async () => {
    await loaded();
    fireEvent.change(screen.getByLabelText(/ชื่อลูกค้าที่พิมพ์ในเอกสาร/), { target: { value: "บริษัท เอ จำกัด" } });
    fireEvent.change(screen.getByLabelText("สาขา"), { target: { value: "สาขาลาดพร้าว" } });
    fireEvent.change(screen.getByLabelText("ชื่อรายการที่ 1"), { target: { value: "งาน" } });
    fireEvent.change(screen.getByLabelText("ราคา/หน่วย (บาท)"), { target: { value: "100" } });
    fireEvent.click(screen.getByRole("button", { name: "บันทึกร่าง" }));
    expect(await screen.findByText("สาขาต้องเป็น สำนักงานใหญ่ หรือเลขสาขา 5 หลัก เช่น 00001", { selector: "[data-field-error]" })).toBeInTheDocument();
    expect(screen.getByLabelText("สาขา")).toHaveAttribute("aria-invalid", "true");
    expect(calls("/api/accounting/documents", "POST")).toHaveLength(0);
  });

  it("saves, shows the number it will get, and issues on confirmation", async () => {
    override = (path, init) => {
      if (path === "/api/accounting/documents" && init?.method === "POST") {
        return json({ ...ISSUED_DOC, id: "new-1", status: "draft", docNo: null, updatedAt: "t0" }, 201);
      }
      if (path === "/api/accounting/documents/next-number") return json({ docNo: "INV2026110034" });
      if (path === "/api/accounting/documents/new-1/issue") return json({ ...ISSUED_DOC, id: "new-1" });
      return undefined;
    };
    await loaded();
    fireEvent.change(screen.getByLabelText(/ชื่อลูกค้าที่พิมพ์ในเอกสาร/), { target: { value: "บริษัท เอ จำกัด" } });
    fireEvent.change(screen.getByLabelText(/ที่อยู่ลูกค้าที่พิมพ์ในเอกสาร/), { target: { value: "1 ถนนงามวงศ์วาน" } });
    fireEvent.change(screen.getByLabelText("ชื่อรายการที่ 1"), { target: { value: "อะไหล่ Grip" } });
    fireEvent.change(screen.getByLabelText("ราคา/หน่วย (บาท)"), { target: { value: "19000" } });
    fireEvent.click(screen.getByRole("button", { name: "ออกเอกสาร ▸" }));

    const dialog = await screen.findByRole("dialog", { name: "ออกเอกสารนี้?" });
    expect(within(dialog).getByText("INV2026110034")).toBeInTheDocument();
    expect(within(dialog).getByText("20,330.00 บาท")).toBeInTheDocument();
    const posted = JSON.parse(String((calls("/api/accounting/documents", "POST")[0][1] as RequestInit).body));
    expect(posted.lines[0]).toMatchObject({ name: "อะไหล่ Grip", unitPriceSatang: 1900000, qty: 1 });

    fireEvent.click(within(dialog).getByRole("button", { name: "ยืนยันออกเอกสาร" }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/accounting/invoices/new-1"));
    expect(JSON.parse(String((calls("/api/accounting/documents/new-1/issue", "POST")[0][1] as RequestInit).body))).toEqual({ expectedUpdatedAt: "t0" });
  });
});

describe("an issued invoice", () => {
  beforeEach(() => {
    params = { id: "d3" };
    override = (path, init) => {
      if (path === "/api/accounting/documents/d3" && !init?.method) return json({ document: ISSUED_DOC, seller: SELLER, impact: IMPACT });
      return undefined;
    };
  });

  it("prints as the paper the customer gets — title, number, total in words", async () => {
    render(<InvoiceDocumentPage />);
    expect(await screen.findByText("ใบส่งสินค้า / ใบแจ้งหนี้ / ใบกำกับภาษี")).toBeInTheDocument();
    expect(screen.getAllByText("INV2026110033").length).toBeGreaterThan(0);
    expect(screen.getByText(/สองหมื่นสามร้อยสามสิบบาทถ้วน/)).toBeInTheDocument();
  });

  it("prints a copy marked สำเนา", async () => {
    const print = vi.fn();
    vi.stubGlobal("print", print);
    render(<InvoiceDocumentPage />);
    fireEvent.click(await screen.findByRole("button", { name: "พิมพ์สำเนา" }));
    expect(screen.getByText("(สำเนา)")).toBeInTheDocument();
    await waitFor(() => expect(print).toHaveBeenCalledTimes(1));
  });

  it("says what deleting takes along, and asks for the password", async () => {
    render(<InvoiceDocumentPage />);
    fireEvent.click(await screen.findByRole("button", { name: "ลบเอกสาร" }));
    const dialog = screen.getByRole("dialog", { name: "ลบ INV2026110033?" });
    expect(within(dialog).getByText(/รายการขายใน dashboard ที่สร้างจากใบนี้จะถูกลบด้วย/)).toBeInTheDocument();
    expect(within(dialog).getByText(/ใบถัดไปจะได้เลขนี้แทน/)).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/รหัสผ่านของคุณ/)).toBeInTheDocument();
  });

  it("links to its sale on the dashboard", async () => {
    render(<InvoiceDocumentPage />);
    expect(await screen.findByRole("link", { name: /เปิดรายการขายใน dashboard/ })).toHaveAttribute("href", "/dashboard?edit=sale-9");
  });
});

// วันวางบิล — the day the bill is handed to the customer (the owner,
// 2026-11-23). Set on the invoice's page, with a note that the CRM alert
// comes BILLING_REMINDER_LEAD_DAYS (7) days before it.
describe("an issued invoice — วันวางบิล", () => {
  let saved: string | null;
  let refuse: string | null;
  let status: string;
  beforeEach(() => {
    params = { id: "d3" };
    saved = null;
    refuse = null;
    status = "issued";
    override = (path, init) => {
      if (path === "/api/accounting/documents/d3" && !init?.method) {
        return json({ document: { ...ISSUED_DOC, status, billingDate: saved }, seller: SELLER, impact: IMPACT });
      }
      if (path === "/api/accounting/documents/d3/billing-date" && init?.method === "PATCH") {
        if (refuse) return json({ error: refuse }, 400);
        saved = JSON.parse(String(init.body)).billingDate;
        return json({ ...ISSUED_DOC, billingDate: saved });
      }
      return undefined;
    };
  });
  const box = () => screen.getByTestId("invoice-billing-date");
  const sent = () => calls("/api/accounting/documents/d3/billing-date", "PATCH").map(([, i]) => JSON.parse(String((i as RequestInit).body)));

  it("says it is not set yet — and, with a star, that the reminder comes 7 days before", async () => {
    render(<InvoiceDocumentPage />);
    await screen.findByTestId("invoice-billing-date");
    expect(box()).toHaveTextContent("วันวางบิล");
    expect(box()).toHaveTextContent("ยังไม่ได้กำหนด");
    expect(box()).toHaveTextContent("* ระบบจะแจ้งเตือนก่อนถึงวันวางบิล 7 วัน");
  });

  it("sets it, and shows the day saved", async () => {
    render(<InvoiceDocumentPage />);
    fireEvent.click(await screen.findByRole("button", { name: "กำหนดวันวางบิล" }));
    fireEvent.change(screen.getByPlaceholderText("เลือกวันวางบิล"), { target: { value: "2026-11-30" } });
    fireEvent.click(screen.getByRole("button", { name: "บันทึกวันวางบิล" }));
    await waitFor(() => expect(sent()).toEqual([{ billingDate: "2026-11-30" }]));
    await waitFor(() => expect(box()).toHaveTextContent("30 Nov 2026"));
    expect(screen.getByRole("button", { name: "เปลี่ยนวันวางบิล" })).toBeInTheDocument();
  });

  it("ยกเลิก leaves it as it was, sending nothing", async () => {
    render(<InvoiceDocumentPage />);
    fireEvent.click(await screen.findByRole("button", { name: "กำหนดวันวางบิล" }));
    fireEvent.click(within(box()).getByRole("button", { name: "ยกเลิก" }));
    expect(box()).toHaveTextContent("ยังไม่ได้กำหนด");
    expect(sent()).toEqual([]);
  });

  it("clears it", async () => {
    saved = "2026-11-30";
    render(<InvoiceDocumentPage />);
    await waitFor(() => expect(box()).toHaveTextContent("30 Nov 2026"));
    fireEvent.click(screen.getByRole("button", { name: "ล้างวันวางบิล" }));
    await waitFor(() => expect(sent()).toEqual([{ billingDate: null }]));
    await waitFor(() => expect(box()).toHaveTextContent("ยังไม่ได้กำหนด"));
  });

  it("says why when the server refuses, and keeps the form open", async () => {
    refuse = "วันวางบิลต้องไม่ก่อนวันที่ของใบแจ้งหนี้";
    render(<InvoiceDocumentPage />);
    fireEvent.click(await screen.findByRole("button", { name: "กำหนดวันวางบิล" }));
    fireEvent.change(screen.getByPlaceholderText("เลือกวันวางบิล"), { target: { value: "2026-11-01" } });
    fireEvent.click(screen.getByRole("button", { name: "บันทึกวันวางบิล" }));
    expect(await within(box()).findByRole("alert")).toHaveTextContent("วันวางบิลต้องไม่ก่อนวันที่ของใบแจ้งหนี้");
    expect(screen.getByPlaceholderText("เลือกวันวางบิล")).toBeInTheDocument();
  });

  it("a cancelled invoice shows its day but offers no change", async () => {
    saved = "2026-11-30";
    status = "void";
    render(<InvoiceDocumentPage />);
    await waitFor(() => expect(box()).toHaveTextContent("30 Nov 2026"));
    expect(within(box()).queryByRole("button")).toBeNull();
  });
});

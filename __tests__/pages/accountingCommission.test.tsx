/**
 * /accounting/commission, through the real page.
 * The tab "สรุปรายเดือน" (the default):
 *  • the month's POs (by PO date) in the ladder's order — whose, profit, place
 *    on the ladder, ฟอร์ด / พี่ต่อ / บริษัท, and where each stands;
 *  • the month's totals per person — payable now and waiting;
 *  • a PO nobody chose yet can be chosen right there;
 *  • each PO's costs open and close, loaded once;
 *  • the month as an Excel workbook (with every PO's costs).
 * The tab "สรุปการจ่าย": what was paid in a range of paid dates (this month
 * first) and the one-click PDF, the costs in it only when switched on.
 * The tab "ตารางอัตรา":
 *  • the tables in force, as the owner's table writes them (0 – 100,000 …
 *    เกิน 500,000, ฟอร์ด / พี่ต่อ / บริษัท), the first "ตั้งแต่เริ่มต้น";
 *  • editing one: the company's share follows; what is wrong stops the save;
 *  • saving asks for the 6-digit code emailed to the owner, then saves with it;
 *  • a new set starts on the 1st of a month; a later set can be removed.
 */
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => "/accounting/commission",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));

vi.mock("@/app/lib/xlsxExport", async (original) => ({ ...(await original<typeof import("@/app/lib/xlsxExport")>()), downloadExcel: vi.fn(async () => {}) }));
import { downloadExcel } from "@/app/lib/xlsxExport";
// The PDF is drawn in the browser: html2canvas-pro paints each page, jsPDF saves the file.
const pdf = vi.hoisted(() => ({ addImage: vi.fn(), addPage: vi.fn(), save: vi.fn() }));
vi.mock("html2canvas-pro", () => ({ default: vi.fn(async () => ({ toDataURL: () => "data:image/jpeg;base64,AAAA" })) }));
import html2canvas from "html2canvas-pro";
vi.mock("jspdf", () => ({
  jsPDF: class {
    addImage = pdf.addImage;
    addPage = pdf.addPage;
    save = pdf.save;
  },
}));

import CommissionPage from "@/app/accounting/commission/page";
import { DEFAULT_COMMISSION_RULES } from "@/app/lib/accounting/commission";

const FIRST = { id: null, effectiveMonth: "0000-00", rules: DEFAULT_COMMISSION_RULES, savedAt: null, savedBy: null };
const LATER = {
  id: "r2",
  effectiveMonth: "2029-04",
  rules: { ...DEFAULT_COMMISSION_RULES, torFlat: { fordBp: 2000, torBp: 3000 } },
  savedAt: "2026-11-25T08:00:00.000Z",
  savedBy: "admin",
};

const row = (o: Record<string, unknown>) => ({
  customerPoNo: `PO-${o.id}`,
  buyerName: `ลูกค้า ${o.id}`,
  status: "issued",
  orderStatus: "complete",
  salesSatang: 0,
  costSatang: 0,
  costMissing: false,
  paidInFull: true,
  owedSatang: 0,
  slices: [],
  countedSatang: 0,
  ladderFromSatang: null,
  ladderToSatang: null,
  fordSatang: 0,
  torSatang: 0,
  companySatang: 0,
  profitSatang: null,
  ...o,
});
const MONTH = {
  month: "2026-11",
  rateSet: { id: null, effectiveMonth: "0000-00", rules: DEFAULT_COMMISSION_RULES },
  rows: [
    row({ id: "A", issueDate: "2026-11-03", kind: "ford", profitSatang: 8_000_000, countedSatang: 8_000_000, ladderFromSatang: 0, ladderToSatang: 8_000_000, fordSatang: 2_160_000, torSatang: 1_840_000, companySatang: 4_000_000, commissionStatus: "payable" }),
    row({ id: "T", issueDate: "2026-11-05", kind: "tor", profitSatang: 10_000_000, countedSatang: 10_000_000, fordSatang: 1_500_000, torSatang: 3_500_000, companySatang: 5_000_000, commissionStatus: "payable" }),
    row({ id: "N", issueDate: "2026-11-06", kind: null, profitSatang: 5_000_000, commissionStatus: "unassigned" }),
    row({ id: "B", issueDate: "2026-11-10", kind: "ford", profitSatang: 15_000_000, countedSatang: 15_000_000, ladderFromSatang: 8_000_000, ladderToSatang: 23_000_000, fordSatang: 4_700_000, torSatang: 2_800_000, companySatang: 7_500_000, paidInFull: false, commissionStatus: "awaiting-payment" }),
    row({ id: "C", issueDate: "2026-11-20", kind: "ford", profitSatang: 40_000_000, countedSatang: 40_000_000, ladderFromSatang: 23_000_000, ladderToSatang: 63_000_000, fordSatang: 13_850_000, torSatang: 6_150_000, companySatang: 20_000_000, commissionStatus: "payable" }),
    row({ id: "G", issueDate: "2026-11-25", kind: "ford", costMissing: true, ladderFromSatang: 63_000_000, ladderToSatang: 63_000_000, commissionStatus: "cost-missing" }),
    row({ id: "H", issueDate: "2026-11-28", kind: "ford", orderStatus: "open", ladderFromSatang: 63_000_000, ladderToSatang: 63_000_000, commissionStatus: "not-delivered" }),
    // Paid 3,600 / 1,400 on the 24th; as it stands now it comes to 3,700 / 1,300.
    row({
      id: "P", issueDate: "2026-11-29", kind: "ford", profitSatang: 1_000_000, countedSatang: 1_000_000, ladderFromSatang: 63_000_000, ladderToSatang: 64_000_000,
      fordSatang: 370_000, torSatang: 130_000, companySatang: 500_000, commissionStatus: "paid",
      payout: { id: "pay1", paidDate: "2026-11-24", fordSatang: 360_000, torSatang: 140_000, companySatang: 500_000 },
      differenceFordSatang: 10_000, differenceTorSatang: -10_000, paidButNot: null,
    }),
  ],
  totals: {
    ford: { totalSatang: 22_210_000, paidSatang: 360_000, payableSatang: 17_510_000, waitingSatang: 4_700_000, differenceSatang: 10_000 },
    tor: { totalSatang: 14_290_000, paidSatang: 140_000, payableSatang: 11_490_000, waitingSatang: 2_800_000, differenceSatang: -10_000 },
    companySatang: 36_500_000,
    profitSatang: 73_000_000,
    unassigned: 1,
  },
  invoicesWithoutPo: 2,
};
const COSTS_C = {
  poId: "C",
  customerPoNo: "PO-C",
  deliveries: [
    {
      saleId: "c1", saleDate: "2026-12-10", invoiceRef: "INV2026120003", credit: false, salesSatang: 70_000_000, costSatang: 40_750_000, profitSatang: 29_250_000, costMissing: false,
      storedCostSatang: 41_750_000,
      items: [{ id: "c1-i1", productName: "เครื่องชั่ง A", qty: 2, costSatang: 40_000_000 }],
      costs: [
        { id: "k-ship", costType: "shipping", typeLabel: "ค่าขนส่ง", label: "Kerry", note: "", amountSatang: 600_000, counted: true },
        { id: "k-comm", costType: "commission", typeLabel: "ค่าคอมมิชชั่น", label: "", note: "", amountSatang: 1_000_000, counted: false },
      ],
    },
    {
      saleId: "c2", saleDate: "2026-12-20", invoiceRef: "INV2026120010", credit: false, salesSatang: 30_000_000, costSatang: 0, profitSatang: 30_000_000, costMissing: true,
      storedCostSatang: 0, items: [], costs: [],
    },
  ],
  totals: { salesSatang: 70_000_000, costSatang: 40_750_000, profitSatang: 29_250_000, notCountedSatang: 1_000_000, waitingCostSalesSatang: 30_000_000 },
};
/** C after the first delivery's costs were saved: the product 390,000, ค่ารถ 1,500 added, the ค่าคอม row removed. */
const SAVED_C = {
  ...COSTS_C,
  deliveries: [
    {
      ...COSTS_C.deliveries[0],
      costSatang: 39_750_000, profitSatang: 30_250_000, storedCostSatang: 39_750_000,
      items: [{ id: "c1-i1", productName: "เครื่องชั่ง A", qty: 2, costSatang: 39_000_000 }],
      costs: [
        COSTS_C.deliveries[0].costs[0],
        { id: "k-new", costType: "transport", typeLabel: "ค่ารถ / ค่าเดินทาง", label: "", note: "", amountSatang: 150_000, counted: true },
      ],
    },
    COSTS_C.deliveries[1],
  ],
  totals: { salesSatang: 70_000_000, costSatang: 39_750_000, profitSatang: 30_250_000, notCountedSatang: 0, waitingCostSalesSatang: 30_000_000 },
};
/** P (its commission paid): a delivery, and a credit note against it. */
const COSTS_P = {
  poId: "P",
  customerPoNo: "PO-P",
  deliveries: [
    {
      saleId: "p1", saleDate: "2026-11-29", invoiceRef: "INV2026110020", credit: false, salesSatang: 2_000_000, costSatang: 1_000_000, profitSatang: 1_000_000, costMissing: false,
      storedCostSatang: 1_000_000, items: [{ id: "p1-i1", productName: "ตุ้มน้ำหนัก", qty: 1, costSatang: 1_000_000 }], costs: [],
    },
    {
      saleId: "p2", saleDate: "2026-11-30", invoiceRef: "CN2026110001", credit: true, salesSatang: -100_000, costSatang: 0, profitSatang: -100_000, costMissing: false,
      storedCostSatang: 0, items: [{ id: "p2-i1", productName: "ตุ้มน้ำหนัก", qty: 0, costSatang: 0 }], costs: [],
    },
  ],
  totals: { salesSatang: 1_900_000, costSatang: 1_000_000, profitSatang: 900_000, notCountedSatang: 0, waitingCostSalesSatang: 0 },
};
const EMPTY_COSTS = (id: string) => ({
  poId: id,
  customerPoNo: `PO-${id}`,
  deliveries: [],
  totals: { salesSatang: 0, costSatang: 0, profitSatang: 0, notCountedSatang: 0, waitingCostSalesSatang: 0 },
});
const PAYOUTS = {
  rows: [
    {
      id: "pay-A", salesOrderId: "A", customerPoNo: "PO-A", buyerName: "ลูกค้า A", issueDate: "2026-11-03", kind: "ford",
      profitSatang: 8_000_000, ladderFromSatang: 0, ladderToSatang: 8_000_000, fordSatang: 2_160_000, torSatang: 1_840_000, companySatang: 4_000_000,
      rateSetId: null, paidDate: "2026-11-24", createdBy: "admin", changedSince: false,
    },
    {
      id: "pay-T", salesOrderId: "T", customerPoNo: "PO-T", buyerName: "ลูกค้า T", issueDate: "2026-11-05", kind: "tor",
      profitSatang: 10_000_000, ladderFromSatang: null, ladderToSatang: null, fordSatang: 1_500_000, torSatang: 3_500_000, companySatang: 5_000_000,
      rateSetId: null, paidDate: "2026-11-25", createdBy: "admin", changedSince: true,
    },
  ],
  rateSets: [{ id: null, effectiveMonth: "0000-00", rules: DEFAULT_COMMISSION_RULES }],
  changedSince: 1,
  seller: { name: "บริษัท ทดสอบ จำกัด", address: "กรุงเทพฯ", taxId: "0105555000000", branchCode: "00000", phone: "", email: "" },
  exportedBy: "admin",
  exportedAt: "2026-11-25T03:00:00.000Z",
};

const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body, headers: new Headers() });
let rates: { sets: unknown[]; history: unknown[] };
let override: ((path: string, init?: RequestInit) => unknown) | null;
let fetchMock: ReturnType<typeof vi.fn>;
const calls = (path: string, method = "GET") =>
  fetchMock.mock.calls.filter(([u, i]) => new URL(String(u), "http://localhost").pathname === path && ((i as RequestInit | undefined)?.method ?? "GET") === method);
const bodyOf = (path: string, method: string, n = 0) => JSON.parse(String((calls(path, method)[n][1] as RequestInit).body));
const choose = (id: string, label: string) => {
  fireEvent.click(document.getElementById(id)!);
  fireEvent.click(within(document.querySelector("[data-dropdown-panel]") as HTMLElement).getByText(label));
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-25T03:00:00Z"));
  rates = { sets: [FIRST], history: [] };
  override = null;
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const custom = override?.(url.pathname, init);
    if (custom !== undefined) return custom;
    const method = init?.method ?? "GET";
    const costs = /^\/api\/accounting\/commission\/orders\/([^/]+)\/costs$/.exec(url.pathname);
    if (method === "GET" && costs) return json(costs[1] === "C" ? COSTS_C : costs[1] === "P" ? COSTS_P : EMPTY_COSTS(costs[1]));
    if (method === "PUT" && costs) return json(costs[1] === "C" ? SAVED_C : COSTS_P);
    const owner = /^\/api\/accounting\/sales-orders\/([^/]+)\/commission$/.exec(url.pathname);
    if (method === "PUT" && owner) return json({ order: { id: owner[1] }, emailSent: null });
    if (method === "POST" && /^\/api\/accounting\/commission\/payouts\/[^/]+\/void$/.test(url.pathname)) return json({ ok: true });
    if (method === "POST" && url.pathname === "/api/accounting/commission/payouts") return json({ id: "payX" });
    const withCosts = url.searchParams.get("withCosts") === "1";
    switch (`${method} ${url.pathname}`) {
      case "GET /api/accounting/commission": return json({ ...MONTH, month: url.searchParams.get("month"), ...(withCosts ? { costs: { C: COSTS_C } } : {}) });
      case "GET /api/accounting/commission/payouts":
        return json({ ...PAYOUTS, from: url.searchParams.get("from"), to: url.searchParams.get("to"), ...(withCosts ? { costs: { A: EMPTY_COSTS("A") } } : {}) });
      case "GET /api/accounting/status": return json({ twoFactorEnabled: true, username: "admin" });
      case "GET /api/accounting/commission/rates": return json(rates);
      case "POST /api/accounting/commission/rates/otp": return json({ sent: true, email: "am****@gmail.com", minutes: 15 });
      case "PUT /api/accounting/commission/rates": return json({ ...rates, summaryEmailSent: true });
      default: return json({});
    }
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** The page, on the tab "ตารางอัตรา". */
async function loaded() {
  render(<CommissionPage />);
  fireEvent.click(await screen.findByRole("tab", { name: "ตารางอัตรา" }));
  await screen.findByTestId("rate-set-0000-00");
}

/** The page as it opens: the month. */
async function monthLoaded() {
  render(<CommissionPage />);
  await screen.findByTestId("po-row-C");
}
const poRow = (id: string) => screen.getByTestId(`po-row-${id}`);

describe("the month (the tab that opens)", () => {
  it("each PO in the ladder's order: whose, profit, place on the ladder, the three shares, where it stands", async () => {
    await monthLoaded();
    expect(screen.getByRole("tab", { name: "สรุปรายเดือน" })).toHaveAttribute("aria-selected", "true");
    expect(calls("/api/accounting/commission")[0][0]).toContain("month=2026-11");
    const ids = screen.getAllByTestId(/^po-row-/).map((r) => r.getAttribute("data-testid"));
    expect(ids).toEqual(["po-row-A", "po-row-T", "po-row-N", "po-row-B", "po-row-C", "po-row-G", "po-row-H", "po-row-P"]);
    const c = poRow("C");
    for (const text of ["PO-C", "ลูกค้า C", "ลูกค้าฟอร์ด", "400,000.00", "230,000 – 630,000", "138,500.00", "61,500.00", "200,000.00", "จ่ายได้"]) {
      expect(c).toHaveTextContent(text);
    }
    expect(within(c).getByRole("link", { name: "PO-C" })).toHaveAttribute("href", "/accounting/sales-orders/C");
    expect(poRow("T")).toHaveTextContent("ลูกค้าพี่ต่อ");
    expect(poRow("B")).toHaveTextContent("รอลูกค้าจ่าย");
    expect(poRow("G")).toHaveTextContent("ยังไม่กรอกต้นทุน");
    expect(poRow("H")).toHaveTextContent("ยังส่งของไม่ครบ");
    expect(poRow("N")).toHaveTextContent("ยังไม่เลือกค่าคอมของใคร");
    expect(screen.getByText(/คิดตามตารางอัตรา ตั้งแต่เริ่มต้น/)).toBeInTheDocument();
  });

  it("the month's totals per person — payable now and waiting — and what is not counted", async () => {
    await monthLoaded();
    expect(screen.getByTestId("total-ford")).toHaveTextContent("222,100.00");
    expect(screen.getByTestId("payable-ford")).toHaveTextContent("175,100.00");
    expect(screen.getByTestId("waiting-ford")).toHaveTextContent("47,000.00");
    expect(screen.getByTestId("total-tor")).toHaveTextContent("142,900.00");
    expect(screen.getByTestId("payable-tor")).toHaveTextContent("114,900.00");
    expect(screen.getByTestId("total-company")).toHaveTextContent("365,000.00");
    expect(screen.getByText(/มี PO ที่ยังไม่เลือกค่าคอมของใคร 1 ใบ/)).toBeInTheDocument();
    expect(screen.getByText(/ใบแจ้งหนี้ที่ไม่ได้ออกจาก PO ในเดือนนี้ 2 ใบ/)).toBeInTheDocument();
  });

  it("a PO nobody chose yet is chosen right there — then the month is read again", async () => {
    await monthLoaded();
    choose("assign-N", "ลูกค้าฟอร์ด");
    fireEvent.click(within(poRow("N")).getByRole("button", { name: "บันทึก" }));
    await waitFor(() => expect(calls("/api/accounting/sales-orders/N/commission", "PUT")).toHaveLength(1));
    expect(bodyOf("/api/accounting/sales-orders/N/commission", "PUT")).toEqual({ commissionOf: "ford" });
    await waitFor(() => expect(calls("/api/accounting/commission").length).toBeGreaterThanOrEqual(2));
  });

  it("a PO's costs open and close — loaded once", async () => {
    await monthLoaded();
    fireEvent.click(within(poRow("C")).getByRole("button", { name: "ดูต้นทุน" }));
    const panel = await screen.findByTestId("costs-C");
    for (const text of [
      "ส่งของครั้งที่ 1",
      "INV2026120003",
      "ต้นทุนสินค้า: เครื่องชั่ง A × 2",
      "ค่าขนส่ง: Kerry",
      "ค่าคอมมิชชั่น",
      "ไม่นำมาหัก",
      "ยังไม่กรอกต้นทุน",
      "ยอดขาย 700,000.00 − ต้นทุน 407,500.00 = กำไร 292,500.00",
    ]) {
      expect(panel).toHaveTextContent(text);
    }
    // Each delivery's costs are edited right here (not on the dashboard).
    expect(within(panel).getAllByRole("button", { name: "แก้ต้นทุน" })).toHaveLength(2);
    expect(within(panel).queryByRole("link", { name: "แก้ต้นทุน" })).not.toBeInTheDocument();
    fireEvent.click(within(poRow("C")).getByRole("button", { name: "ซ่อนต้นทุน" }));
    expect(screen.queryByTestId("costs-C")).not.toBeInTheDocument();
    fireEvent.click(within(poRow("C")).getByRole("button", { name: "ดูต้นทุน" }));
    expect(await screen.findByTestId("costs-C")).toBeInTheDocument();
    expect(calls("/api/accounting/commission/orders/C/costs")).toHaveLength(1);
  });

  /** The month, C's costs open, the editor of C's first delivery open. */
  async function editingC() {
    await monthLoaded();
    fireEvent.click(within(poRow("C")).getByRole("button", { name: "ดูต้นทุน" }));
    const panel = await screen.findByTestId("costs-C");
    fireEvent.click(within(within(panel).getByTestId("delivery-c1")).getByRole("button", { name: "แก้ต้นทุน" }));
    return { panel, editor: screen.getByRole("region", { name: "แก้ต้นทุน ส่งของครั้งที่ 1" }) };
  }
  const costsPath = "/api/accounting/commission/orders/C/costs";

  it("a delivery's costs are edited right there — a product's cost, a cost added, one removed — saved at once, the month worked out again", async () => {
    const { panel, editor } = await editingC();
    const product = within(editor).getByLabelText("ต้นทุน เครื่องชั่ง A × 2");
    expect(product).toHaveValue("400,000.00");
    fireEvent.change(product, { target: { value: "390,000" } });
    fireEvent.click(within(within(editor).getByTestId("cost-row-k-comm")).getByRole("button", { name: "ลบ" }));
    expect(within(editor).queryByTestId("cost-row-k-comm")).not.toBeInTheDocument();
    fireEvent.click(within(editor).getByRole("button", { name: "+ เพิ่มค่าใช้จ่าย" }));
    choose("cost-type-new-1", "ค่ารถ / ค่าเดินทาง");
    fireEvent.change(within(within(editor).getByTestId("cost-row-new-1")).getByLabelText("จำนวนเงิน"), { target: { value: "1,500" } });
    // What the delivery will come to, before it is saved.
    expect(editor).toHaveTextContent("ต้นทุนครั้งนี้ 397,500.00 · กำไรครั้งนี้ 302,500.00");
    fireEvent.click(within(editor).getByRole("button", { name: "บันทึกต้นทุน" }));
    await waitFor(() => expect(calls(costsPath, "PUT")).toHaveLength(1));
    expect(bodyOf(costsPath, "PUT")).toEqual({
      saleId: "c1",
      expectedCostSatang: 41_750_000,
      lines: [{ id: "c1-i1", costSatang: 39_000_000 }],
      add: [{ costType: "transport", label: "", note: "", amountSatang: 150_000 }],
      update: [],
      remove: ["k-comm"],
    });
    // The saved costs show at once; the month is read again (profit, ladder, commission).
    expect(await within(panel).findByText("ยอดขาย 700,000.00 − ต้นทุน 397,500.00 = กำไร 302,500.00")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /^แก้ต้นทุน/ })).not.toBeInTheDocument();
    await waitFor(() => expect(calls("/api/accounting/commission").length).toBeGreaterThanOrEqual(2));
    expect(screen.getByText(/บันทึกต้นทุนแล้ว/)).toBeInTheDocument();
  });

  it("a cost row's kind, text and amount are changed in place — sent as a change of that row", async () => {
    const { editor } = await editingC();
    const ship = within(editor).getByTestId("cost-row-k-ship");
    fireEvent.change(within(ship).getByLabelText("รายละเอียด"), { target: { value: "Flash" } });
    fireEvent.change(within(ship).getByLabelText("จำนวนเงิน"), { target: { value: "7000" } });
    fireEvent.click(within(editor).getByRole("button", { name: "บันทึกต้นทุน" }));
    await waitFor(() => expect(calls(costsPath, "PUT")).toHaveLength(1));
    expect(bodyOf(costsPath, "PUT")).toMatchObject({
      lines: [],
      add: [],
      update: [{ id: "k-ship", costType: "shipping", label: "Flash", note: "", amountSatang: 700_000 }],
      remove: [],
    });
  });

  it("what is wrong is said before anything is sent — nothing changed, a kind not chosen, a figure that is not one", async () => {
    const { editor } = await editingC();
    const save = () => fireEvent.click(within(editor).getByRole("button", { name: "บันทึกต้นทุน" }));
    save();
    expect(within(editor).getByRole("alert")).toHaveTextContent("ไม่มีอะไรเปลี่ยน");
    fireEvent.click(within(editor).getByRole("button", { name: "+ เพิ่มค่าใช้จ่าย" }));
    fireEvent.change(within(within(editor).getByTestId("cost-row-new-1")).getByLabelText("จำนวนเงิน"), { target: { value: "500" } });
    save();
    expect(within(editor).getByRole("alert")).toHaveTextContent("กรุณาเลือกประเภทของค่าใช้จ่ายทุกรายการ");
    choose("cost-type-new-1", "อื่นๆ");
    fireEvent.change(within(editor).getByLabelText("ต้นทุน เครื่องชั่ง A × 2"), { target: { value: "สี่แสน" } });
    save();
    expect(within(editor).getByRole("alert")).toHaveTextContent("ต้นทุน เครื่องชั่ง A × 2: กรุณากรอกตัวเลข เช่น 1,500 หรือ 1500.50");
    expect(calls(costsPath, "PUT")).toHaveLength(0);
  });

  it("a refusal from the server is said in the editor, which keeps what was typed", async () => {
    override = (path, init) =>
      path === costsPath && init?.method === "PUT"
        ? json({ error: "ต้นทุนของการส่งของครั้งนี้ถูกแก้จากที่อื่นหลังจากเปิดดู — กรุณาโหลดใหม่แล้วแก้อีกครั้ง" }, 409)
        : undefined;
    const { editor } = await editingC();
    fireEvent.change(within(editor).getByLabelText("ต้นทุน เครื่องชั่ง A × 2"), { target: { value: "390000" } });
    fireEvent.click(within(editor).getByRole("button", { name: "บันทึกต้นทุน" }));
    expect(await within(editor).findByRole("alert")).toHaveTextContent("ถูกแก้จากที่อื่นหลังจากเปิดดู");
    expect(within(editor).getByLabelText("ต้นทุน เครื่องชั่ง A × 2")).toHaveValue("390000");
    fireEvent.click(within(editor).getByRole("button", { name: "ยกเลิก" }));
    expect(screen.queryByRole("region", { name: /^แก้ต้นทุน/ })).not.toBeInTheDocument();
  });

  it("a PO already paid: the editor says what was paid stays; a credit note has nothing to edit", async () => {
    await monthLoaded();
    fireEvent.click(within(poRow("P")).getByRole("button", { name: "ดูต้นทุน" }));
    const panel = await screen.findByTestId("costs-P");
    expect(within(within(panel).getByTestId("delivery-p2")).queryByRole("button", { name: "แก้ต้นทุน" })).not.toBeInTheDocument();
    fireEvent.click(within(within(panel).getByTestId("delivery-p1")).getByRole("button", { name: "แก้ต้นทุน" }));
    expect(screen.getByRole("region", { name: "แก้ต้นทุน ส่งของครั้งที่ 1" })).toHaveTextContent(
      "PO นี้บันทึกจ่ายค่าคอมแล้ว — แก้ต้นทุนได้ แต่ยอดที่จ่ายไปจะไม่เปลี่ยน ส่วนที่ต่างจะขึ้นเป็น \"ส่วนต่างหลังจ่าย\""
    );
  });

  it("opens every PO's costs at once, and closes them", async () => {
    await monthLoaded();
    fireEvent.click(screen.getByRole("button", { name: "เปิดต้นทุนทั้งหมด" }));
    await waitFor(() => expect(screen.getAllByTestId(/^costs-/)).toHaveLength(8));
    fireEvent.click(screen.getByRole("button", { name: "ปิดต้นทุนทั้งหมด" }));
    expect(screen.queryAllByTestId(/^costs-/)).toHaveLength(0);
  });

  it("a PO that may be paid is marked paid: its amounts, the date (today), then the month again", async () => {
    await monthLoaded();
    fireEvent.click(within(poRow("C")).getByRole("button", { name: "จ่ายค่าคอมแล้ว" }));
    const dialog = screen.getByRole("dialog", { name: "บันทึกจ่ายค่าคอม PO-C" });
    expect(dialog).toHaveTextContent("138,500.00");
    expect(dialog).toHaveTextContent("61,500.00");
    fireEvent.click(within(dialog).getByRole("button", { name: "บันทึกว่าจ่ายแล้ว" }));
    await waitFor(() => expect(calls("/api/accounting/commission/payouts", "POST")).toHaveLength(1));
    expect(bodyOf("/api/accounting/commission/payouts", "POST")).toEqual({ salesOrderId: "C", paidDate: "2026-11-25" });
    await waitFor(() => expect(calls("/api/accounting/commission").length).toBeGreaterThanOrEqual(2));
  });

  it("only a PO that may be paid has the button", async () => {
    await monthLoaded();
    for (const id of ["B", "N", "G", "H", "P"]) {
      expect(within(poRow(id)).queryByRole("button", { name: "จ่ายค่าคอมแล้ว" })).not.toBeInTheDocument();
    }
  });

  it("a paid PO says when and the difference since; the mark is undone only with a reason", async () => {
    await monthLoaded();
    const p = poRow("P");
    expect(p).toHaveTextContent("จ่ายแล้ว 24 Nov 2026");
    expect(p).toHaveTextContent("ส่วนต่างหลังจ่าย ฟอร์ด +100.00 · พี่ต่อ -100.00");
    expect(screen.getByTestId("paid-ford")).toHaveTextContent("3,600.00");
    expect(screen.getByTestId("difference-ford")).toHaveTextContent("+100.00");
    fireEvent.click(within(p).getByRole("button", { name: "ยกเลิกการบันทึกจ่าย" }));
    const dialog = screen.getByRole("dialog", { name: "ยกเลิกการบันทึกจ่ายค่าคอม PO-P" });
    fireEvent.click(within(dialog).getByRole("button", { name: "ยืนยันยกเลิก" }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent("กรุณาบอกเหตุผลที่ยกเลิกการบันทึกจ่าย");
    expect(calls("/api/accounting/commission/payouts/pay1/void", "POST")).toHaveLength(0);
    fireEvent.change(within(dialog).getByLabelText("เหตุผล"), { target: { value: "จ่ายผิดคน" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "ยืนยันยกเลิก" }));
    await waitFor(() => expect(calls("/api/accounting/commission/payouts/pay1/void", "POST")).toHaveLength(1));
    expect(bodyOf("/api/accounting/commission/payouts/pay1/void", "POST")).toEqual({ reason: "จ่ายผิดคน" });
  });

  it("another month is read when picked", async () => {
    await monthLoaded();
    choose("commission-month", "ตุลาคม 2569");
    await waitFor(() => expect(calls("/api/accounting/commission").some(([u]) => String(u).includes("month=2026-10"))).toBe(true));
  });

  it("the month as an Excel workbook — with every PO's costs, asked for then", async () => {
    await monthLoaded();
    fireEvent.click(screen.getByRole("button", { name: "ดาวน์โหลด Excel" }));
    await waitFor(() => expect(downloadExcel).toHaveBeenCalledTimes(1));
    const [file, sheets] = vi.mocked(downloadExcel).mock.calls[0];
    expect(file).toBe("commission_2026-11.xlsx");
    expect(sheets.map((s) => s.name)).toEqual(["สรุปรายเดือน", "ขั้นบันได", "รายละเอียดต้นทุน"]);
    expect(calls("/api/accounting/commission").some(([u]) => String(u).includes("withCosts=1"))).toBe(true);
    expect(await screen.findByText(/ดาวน์โหลดแล้ว — ไฟล์ commission_2026-11\.xlsx/)).toBeInTheDocument();
  });
});

describe("the payouts (tab สรุปการจ่าย) and the PDF", () => {
  async function payoutsLoaded() {
    render(<CommissionPage />);
    fireEvent.click(await screen.findByRole("tab", { name: "สรุปการจ่าย" }));
    await screen.findByTestId("payout-row-pay-A");
  }
  const payoutCalls = () => calls("/api/accounting/commission/payouts").map(([u]) => String(u));

  it("this month's payouts by paid date — what each person got, every PO paid", async () => {
    await payoutsLoaded();
    expect(payoutCalls()[0]).toContain("from=2026-11-01");
    expect(payoutCalls()[0]).toContain("to=2026-11-30");
    expect(screen.getByTestId("payout-ford")).toHaveTextContent("36,600.00");
    expect(screen.getByTestId("payout-tor")).toHaveTextContent("53,400.00");
    expect(screen.getByTestId("payout-both")).toHaveTextContent("90,000.00");
    const a = screen.getByTestId("payout-row-pay-A");
    for (const text of ["24 Nov 2026", "PO-A", "ลูกค้า A", "ลูกค้าฟอร์ด", "80,000.00", "21,600.00", "18,400.00", "40,000.00"]) {
      expect(a).toHaveTextContent(text);
    }
    expect(screen.getByTestId("payout-row-pay-T")).toHaveTextContent("ลูกค้าพี่ต่อ");
    expect(screen.getByText(/ข้อมูลเปลี่ยนหลังบันทึกจ่าย 1 รายการ/)).toBeInTheDocument();
  });

  it("last month in one click", async () => {
    await payoutsLoaded();
    fireEvent.click(screen.getByRole("button", { name: "เดือนที่แล้ว" }));
    await waitFor(() => expect(payoutCalls().some((u) => u.includes("from=2026-10-01") && u.includes("to=2026-10-31"))).toBe(true));
  });

  it("the PDF in one click — named for the range, the costs left out unless switched on", async () => {
    await payoutsLoaded();
    expect(screen.getByRole("switch", { name: "แสดงรายละเอียดต้นทุน" })).not.toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "ส่งออก PDF" }));
    await waitFor(() => expect(pdf.save).toHaveBeenCalledWith("commission-payout_2026-11-01_2026-11-30.pdf"));
    expect(html2canvas).toHaveBeenCalledTimes(1);
    expect(pdf.addImage).toHaveBeenCalledTimes(1);
    expect(payoutCalls().every((u) => !u.includes("withCosts"))).toBe(true);
    expect(await screen.findByText(/ดาวน์โหลดแล้ว — ไฟล์ commission-payout_2026-11-01_2026-11-30\.pdf/)).toBeInTheDocument();
  });

  it("with the costs switched on, the PDF asks for them", async () => {
    await payoutsLoaded();
    fireEvent.click(screen.getByRole("switch", { name: "แสดงรายละเอียดต้นทุน" }));
    fireEvent.click(screen.getByRole("button", { name: "ส่งออก PDF" }));
    await waitFor(() => expect(pdf.save).toHaveBeenCalledTimes(1));
    expect(payoutCalls().some((u) => u.includes("withCosts=1"))).toBe(true);
  });

  it("nothing paid in the range: said so, and no PDF to make", async () => {
    override = (path, init) =>
      path === "/api/accounting/commission/payouts" && (init?.method ?? "GET") === "GET"
        ? json({ ...PAYOUTS, rows: [], changedSince: 0, from: "2026-11-01", to: "2026-11-30" })
        : undefined;
    render(<CommissionPage />);
    fireEvent.click(await screen.findByRole("tab", { name: "สรุปการจ่าย" }));
    expect(await screen.findByText("ไม่มีการจ่ายค่าคอมในช่วงวันที่นี้")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ส่งออก PDF" })).toBeDisabled();
  });
});
const cells = (row: HTMLElement) => within(row).getAllByRole("cell").map((c) => c.textContent);

describe("the tables in force", () => {
  it("the owner's table, from the beginning — steps, ฟอร์ด / พี่ต่อ / บริษัท, and พี่ต่อ's customers", async () => {
    await loaded();
    const set = screen.getByTestId("rate-set-0000-00");
    expect(within(set).getByText("ตั้งแต่เริ่มต้น")).toBeInTheDocument();
    const rows = within(set).getAllByRole("row").slice(1);
    expect(rows.map(cells)).toEqual([
      ["0 – 100,000", "27%", "23%", "50%"],
      ["100,001 – 300,000", "32%", "18%", "50%"],
      ["300,001 – 500,000", "34%", "16%", "50%"],
      ["เกิน 500,000", "37%", "13%", "50%"],
      ["ดีลลูกค้าพี่ต่อ", "15%", "35%", "50%"],
    ]);
    // The first set is edited, never removed.
    expect(within(set).getByRole("button", { name: "แก้ชุดนี้" })).toBeInTheDocument();
    expect(within(set).queryByRole("button", { name: "ลบชุดนี้" })).not.toBeInTheDocument();
    expect(screen.getByText(/ต้องใส่รหัส 6 หลักที่ส่งไปทางอีเมล/)).toBeInTheDocument();
  });

  it("a later set reads by its month, and can be removed", async () => {
    rates = { sets: [FIRST, LATER], history: [] };
    await loaded();
    const set = screen.getByTestId("rate-set-2029-04");
    expect(within(set).getByText("ตั้งแต่เดือนเมษายน 2572")).toBeInTheDocument();
    expect(within(set).getByRole("button", { name: "ลบชุดนี้" })).toBeInTheDocument();
  });
});

describe("editing a set", () => {
  it("the company's share follows; what is wrong is said and stops the save", async () => {
    await loaded();
    fireEvent.click(within(screen.getByTestId("rate-set-0000-00")).getByRole("button", { name: "แก้ชุดนี้" }));
    const editor = screen.getByRole("region", { name: "แก้ตารางอัตรา ตั้งแต่เริ่มต้น" });
    const save = within(editor).getByRole("button", { name: "บันทึก — ส่งรหัสยืนยันทางอีเมล" });
    // Unchanged: nothing to save.
    expect(save).toBeDisabled();
    fireEvent.change(within(editor).getByLabelText("ขั้นที่ 2 % ฟอร์ด"), { target: { value: "33" } });
    expect(within(editor).getByTestId("company-1")).toHaveTextContent("49%");
    expect(save).toBeEnabled();
    fireEvent.change(within(editor).getByLabelText("ขั้นที่ 1 % ฟอร์ด"), { target: { value: "80" } });
    expect(within(editor).getByRole("alert")).toHaveTextContent("ขั้นที่ 1: ฟอร์ดกับพี่ต่อรวมกันเกิน 100%");
    expect(save).toBeDisabled();
    fireEvent.change(within(editor).getByLabelText("ขั้นที่ 1 % ฟอร์ด"), { target: { value: "2x" } });
    expect(within(editor).getByRole("alert")).toHaveTextContent("ขั้นที่ 1: กรอก % ของฟอร์ดเป็นตัวเลข 0–100 (ทศนิยมไม่เกิน 2 ตำแหน่ง)");
  });

  it("saving asks for the emailed code, then saves with it — and says the summary went", async () => {
    await loaded();
    fireEvent.click(within(screen.getByTestId("rate-set-0000-00")).getByRole("button", { name: "แก้ชุดนี้" }));
    const editor = screen.getByRole("region", { name: "แก้ตารางอัตรา ตั้งแต่เริ่มต้น" });
    fireEvent.change(within(editor).getByLabelText("ขั้นที่ 2 % ฟอร์ด"), { target: { value: "33" } });
    fireEvent.change(within(editor).getByLabelText("ขั้นที่ 2 % พี่ต่อ"), { target: { value: "17" } });
    fireEvent.click(within(editor).getByRole("button", { name: "บันทึก — ส่งรหัสยืนยันทางอีเมล" }));

    const dialog = await screen.findByRole("dialog", { name: "ยืนยันด้วยรหัสจากอีเมล" });
    const sent = bodyOf("/api/accounting/commission/rates/otp", "POST");
    expect(sent.change.kind).toBe("save");
    expect(sent.change.effectiveMonth).toBe("0000-00");
    expect(sent.change.rules.ladder[1]).toEqual({ upToSatang: 30_000_000, fordBp: 3300, torBp: 1700 });
    expect(sent.change.rules.ladder[3]).toEqual({ upToSatang: null, fordBp: 3700, torBp: 1300 });
    expect(within(dialog).getByText(/am\*\*\*\*@gmail\.com/)).toBeInTheDocument();

    const confirm = within(dialog).getByRole("button", { name: "ยืนยัน" });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText("รหัส 6 หลักจากอีเมล"), { target: { value: "123456" } });
    fireEvent.click(confirm);
    await waitFor(() => expect(calls("/api/accounting/commission/rates", "PUT")).toHaveLength(1));
    // Only the code: the change is the one stored with it.
    expect(bodyOf("/api/accounting/commission/rates", "PUT")).toEqual({ otp: "123456" });
    expect(await screen.findByTestId("rates-notice")).toHaveTextContent("บันทึกตารางอัตราแล้ว · ส่งอีเมลสรุปแล้ว");
    expect(screen.queryByRole("dialog", { name: "ยืนยันด้วยรหัสจากอีเมล" })).not.toBeInTheDocument();
  });

  it("a wrong code is said in the window, which stays open", async () => {
    override = (path, init) =>
      path === "/api/accounting/commission/rates" && init?.method === "PUT" ? json({ error: "รหัสยืนยันไม่ถูกต้อง" }, 400) : undefined;
    await loaded();
    fireEvent.click(within(screen.getByTestId("rate-set-0000-00")).getByRole("button", { name: "แก้ชุดนี้" }));
    const editor = screen.getByRole("region", { name: "แก้ตารางอัตรา ตั้งแต่เริ่มต้น" });
    fireEvent.change(within(editor).getByLabelText("ดีลลูกค้าพี่ต่อ % พี่ต่อ"), { target: { value: "36" } });
    fireEvent.click(within(editor).getByRole("button", { name: "บันทึก — ส่งรหัสยืนยันทางอีเมล" }));
    const dialog = await screen.findByRole("dialog", { name: "ยืนยันด้วยรหัสจากอีเมล" });
    fireEvent.change(within(dialog).getByLabelText("รหัส 6 หลักจากอีเมล"), { target: { value: "999999" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "ยืนยัน" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("รหัสยืนยันไม่ถูกต้อง");
  });

  it("asked for codes too often: the wait is said, no window opens", async () => {
    override = (path, init) =>
      path === "/api/accounting/commission/rates/otp" && init?.method === "POST"
        ? json({ error: "ขอรหัส OTP ถี่เกินไป กรุณารออีก 42 วินาที แล้วลองใหม่" }, 429)
        : undefined;
    await loaded();
    fireEvent.click(within(screen.getByTestId("rate-set-0000-00")).getByRole("button", { name: "แก้ชุดนี้" }));
    const editor = screen.getByRole("region", { name: "แก้ตารางอัตรา ตั้งแต่เริ่มต้น" });
    fireEvent.change(within(editor).getByLabelText("ขั้นที่ 2 % ฟอร์ด"), { target: { value: "33" } });
    fireEvent.click(within(editor).getByRole("button", { name: "บันทึก — ส่งรหัสยืนยันทางอีเมล" }));
    expect(await within(editor).findByText("ขอรหัส OTP ถี่เกินไป กรุณารออีก 42 วินาที แล้วลองใหม่")).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "ยืนยันด้วยรหัสจากอีเมล" })).not.toBeInTheDocument();
  });
});

describe("a new set, and removing one", () => {
  it("a new set starts on the 1st of the month picked", async () => {
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "เพิ่มชุดใหม่" }));
    const editor = screen.getByRole("region", { name: "เพิ่มตารางอัตราชุดใหม่" });
    choose("rates-month", "มกราคม 2570");
    fireEvent.change(within(editor).getByLabelText("ขั้นที่ 1 % ฟอร์ด"), { target: { value: "30" } });
    fireEvent.change(within(editor).getByLabelText("ขั้นที่ 1 % พี่ต่อ"), { target: { value: "20" } });
    fireEvent.click(within(editor).getByRole("button", { name: "บันทึก — ส่งรหัสยืนยันทางอีเมล" }));
    await screen.findByRole("dialog", { name: "ยืนยันด้วยรหัสจากอีเมล" });
    const sent = bodyOf("/api/accounting/commission/rates/otp", "POST");
    expect(sent.change.effectiveMonth).toBe("2027-01");
    expect(sent.change.rules.ladder[0]).toEqual({ upToSatang: 10_000_000, fordBp: 3000, torBp: 2000 });
  });

  it("a new set needs its month first", async () => {
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "เพิ่มชุดใหม่" }));
    const editor = screen.getByRole("region", { name: "เพิ่มตารางอัตราชุดใหม่" });
    fireEvent.change(within(editor).getByLabelText("ขั้นที่ 1 % ฟอร์ด"), { target: { value: "30" } });
    expect(within(editor).getByRole("alert")).toHaveTextContent("เลือกเดือนที่เริ่มใช้");
    expect(within(editor).getByRole("button", { name: "บันทึก — ส่งรหัสยืนยันทางอีเมล" })).toBeDisabled();
  });

  it("removing a later set asks for the code too", async () => {
    rates = { sets: [FIRST, LATER], history: [] };
    await loaded();
    fireEvent.click(within(screen.getByTestId("rate-set-2029-04")).getByRole("button", { name: "ลบชุดนี้" }));
    const dialog = await screen.findByRole("dialog", { name: "ยืนยันด้วยรหัสจากอีเมล" });
    expect(bodyOf("/api/accounting/commission/rates/otp", "POST")).toEqual({ change: { kind: "remove", effectiveMonth: "2029-04" } });
    fireEvent.change(within(dialog).getByLabelText("รหัส 6 หลักจากอีเมล"), { target: { value: "123456" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "ยืนยัน" }));
    await waitFor(() => expect(calls("/api/accounting/commission/rates", "PUT")).toHaveLength(1));
  });
});

/**
 * /accounting/commission, through the real page.
 * The tab "สรุปรายเดือน" (the default):
 *  • the month's POs (by PO date) in the ladder's order — whose, profit, place
 *    on the ladder, ฟอร์ด / พี่ต่อ / บริษัท, and where each stands;
 *  • the month's totals per person — payable now and waiting;
 *  • a PO nobody chose yet can be chosen right there;
 *  • each PO's costs open and close, loaded once.
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
      items: [{ productName: "เครื่องชั่ง A", qty: 2, costSatang: 40_000_000 }],
      costs: [
        { costType: "shipping", typeLabel: "ค่าขนส่ง", label: "Kerry", note: "", amountSatang: 600_000, counted: true },
        { costType: "commission", typeLabel: "ค่าคอมมิชชั่น", label: "", note: "", amountSatang: 1_000_000, counted: false },
      ],
    },
    { saleId: "c2", saleDate: "2026-12-20", invoiceRef: "INV2026120010", credit: false, salesSatang: 30_000_000, costSatang: 0, profitSatang: 30_000_000, costMissing: true, items: [], costs: [] },
  ],
  totals: { salesSatang: 70_000_000, costSatang: 40_750_000, profitSatang: 29_250_000, notCountedSatang: 1_000_000, waitingCostSalesSatang: 30_000_000 },
};
const EMPTY_COSTS = (id: string) => ({
  poId: id,
  customerPoNo: `PO-${id}`,
  deliveries: [],
  totals: { salesSatang: 0, costSatang: 0, profitSatang: 0, notCountedSatang: 0, waitingCostSalesSatang: 0 },
});

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
    if (method === "GET" && costs) return json(costs[1] === "C" ? COSTS_C : EMPTY_COSTS(costs[1]));
    const owner = /^\/api\/accounting\/sales-orders\/([^/]+)\/commission$/.exec(url.pathname);
    if (method === "PUT" && owner) return json({ order: { id: owner[1] }, emailSent: null });
    if (method === "POST" && /^\/api\/accounting\/commission\/payouts\/[^/]+\/void$/.test(url.pathname)) return json({ ok: true });
    if (method === "POST" && url.pathname === "/api/accounting/commission/payouts") return json({ id: "payX" });
    switch (`${method} ${url.pathname}`) {
      case "GET /api/accounting/commission": return json({ ...MONTH, month: url.searchParams.get("month") });
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
    expect(within(panel).getAllByRole("link", { name: "แก้ต้นทุน" })[0]).toHaveAttribute("href", "/dashboard?edit=c1");
    fireEvent.click(within(poRow("C")).getByRole("button", { name: "ซ่อนต้นทุน" }));
    expect(screen.queryByTestId("costs-C")).not.toBeInTheDocument();
    fireEvent.click(within(poRow("C")).getByRole("button", { name: "ดูต้นทุน" }));
    expect(await screen.findByTestId("costs-C")).toBeInTheDocument();
    expect(calls("/api/accounting/commission/orders/C/costs")).toHaveLength(1);
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

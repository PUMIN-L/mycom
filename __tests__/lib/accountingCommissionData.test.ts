// @vitest-environment node
/**
 * The commission month, from the real tables (lib/accounting/commissionData.ts):
 *  • the customer POs dated in the month (a cancelled one that delivered
 *    nothing is left out; one cancelled after delivering counts for what it
 *    delivered);
 *  • each PO's profit = its sales (every delivery, credit notes negative) less
 *    the costs typed on them — except "ค่าคอมมิชชั่น" rows; a sale with no cost
 *    typed is not known yet;
 *  • payable = chosen + delivered in full + paid in full + every cost typed;
 *  • the ladder over the month (unpaid POs too), with the month's rate set.
 * The figures are the owner's worked example: A 80,000 / B 150,000 (unpaid) /
 * C 400,000, plus a ลูกค้าพี่ต่อ deal, one nobody chose, and the rest.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/app/lib/db", () => ({ query: vi.fn(), withTransaction: vi.fn() }));
import { query } from "@/app/lib/db";
import { commissionCosts, commissionCostsFor, commissionMonth } from "@/app/lib/accounting/commissionData";

const baht = (n: number) => Math.round(n * 100);
const po = (id: string, issueDate: string, commissionOf: string | null, status = "issued") => ({
  id,
  customerPoNo: `PO-${id}`,
  buyerName: `ลูกค้า ${id}`,
  issueDate,
  createdAt: `${issueDate}T02:00:00.000Z`,
  status,
  commissionOf,
});
const PO_ROWS = [
  po("A", "2026-11-03", "ford"),
  po("T", "2026-11-05", "tor"),
  po("N", "2026-11-06", null),
  po("V", "2026-11-07", "ford", "void"),
  po("B", "2026-11-10", "ford"),
  po("C", "2026-11-20", "ford"),
  po("G", "2026-11-25", "ford"),
  po("H", "2026-11-28", "ford"),
  po("W", "2026-11-29", "ford", "void"),
];
const line = (documentId: string, qty: number, deliveredQty: number) => ({ documentId, qty: String(qty), deliveredQty: String(deliveredQty) });
const LINES = [
  ...["A", "T", "N", "B", "C", "G"].map((id) => line(id, 1, 1)),
  line("H", 2, 0),
  line("V", 1, 0),
  line("W", 2, 1),
];
const inv = (salesOrderId: string, total: number, paid: number, credited = 0) => ({ salesOrderId, totalSatang: total, paidSatang: paid, creditedSatang: credited });
const INVOICES = [inv("A", 8_560_000, 8_560_000), inv("T", 11_235_000, 10_700_000, 535_000), inv("N", 100, 100), inv("B", 21_400_000, 0), inv("C", 74_900_000, 74_900_000), inv("C", 32_100_000, 32_100_000), inv("G", 100, 100), inv("W", 1_605_000, 1_605_000)];
const sale = (id: string, dealId: string, total: string, cost: string, commissionCost = "0.00") => ({ id, dealId, totalAmount: total, costAmount: cost, commissionCost });
const SALES = [
  sale("a1", "A", "100000.00", "20000.00"),
  sale("t1", "T", "110000.00", "5000.00"),
  sale("t2", "T", "-5000.00", "0.00"), // a credit note
  sale("n1", "N", "60000.00", "10000.00"),
  sale("b1", "B", "200000.00", "50000.00"),
  // ฿10,000 of C's first delivery is a "ค่าคอมมิชชั่น" cost row: not deducted.
  sale("c1", "C", "700000.00", "407500.00", "10000.00"),
  sale("c2", "C", "300000.00", "202500.00"),
  sale("g1", "G", "50000.00", "0.00"), // no cost typed yet
  sale("w1", "W", "15000.00", "5000.00"),
];

let calls: { sql: string; params: unknown[] }[] = [];
type Handler = [RegExp, (params: unknown[]) => unknown[]];
const route = (handlers: Handler[]) => async (sql: string, params: unknown[] = []) => {
  calls.push({ sql: String(sql), params });
  for (const [pattern, answer] of handlers) if (pattern.test(String(sql))) return [answer(params), []];
  return [[], []];
};

beforeEach(() => {
  vi.clearAllMocks();
  calls = [];
  vi.mocked(query).mockImplementation(
    route([
      [/FROM acc_commission_rates/, () => []],
      [/FROM acc_documents WHERE docType = 'SO' AND issueDate >= \?/, () => PO_ROWS],
      [/FROM acc_document_lines/, () => LINES],
      [/docType = 'INV' AND status = 'issued' AND salesOrderId IN/, () => INVOICES],
      [/FROM sales_records sr/, () => SALES],
      [/salesOrderId IS NULL/, () => [{ n: 2 }]],
    ]) as never
  );
});

describe("commissionMonth", () => {
  it("reads the month's POs by their PO date", async () => {
    await commissionMonth("2026-11");
    const poQuery = calls.find((c) => /docType = 'SO' AND issueDate >= \?/.test(c.sql))!;
    expect(poQuery.params).toEqual(["2026-11-01", "2026-12-01"]);
    // Every column of a join carries its table — companies has a salespersonId too.
    const salesQuery = calls.find((c) => /FROM sales_records sr/.test(c.sql))!;
    expect(salesQuery.sql).toMatch(/sr\.dealId IN/);
  });

  it("is null for a month that is not one", async () => {
    expect(await commissionMonth("2026-13")).toBeNull();
    expect(await commissionMonth("2026-1")).toBeNull();
  });

  it("each PO: its profit, its place on the ladder, its commission and where it stands", async () => {
    const m = (await commissionMonth("2026-11"))!;
    const r = new Map(m.rows.map((x) => [x.id, x]));
    // V was cancelled before anything went: not part of the month.
    expect([...r.keys()]).toEqual(["A", "T", "N", "B", "C", "G", "H", "W"]);

    expect(r.get("A")).toMatchObject({ profitSatang: baht(80_000), fordSatang: baht(21_600), torSatang: baht(18_400), companySatang: baht(40_000), commissionStatus: "payable" });
    expect(r.get("B")).toMatchObject({ profitSatang: baht(150_000), ladderFromSatang: baht(80_000), ladderToSatang: baht(230_000), fordSatang: baht(47_000), commissionStatus: "awaiting-payment" });
    // C's commission row (฿10,000) is not deducted: 1,000,000 − 600,000.
    expect(r.get("C")).toMatchObject({ salesSatang: baht(1_000_000), costSatang: baht(600_000), profitSatang: baht(400_000), fordSatang: baht(138_500), torSatang: baht(61_500), commissionStatus: "payable" });
    // A credit note lowers the profit: 110,000 − 5,000 − 5,000.
    expect(r.get("T")).toMatchObject({ kind: "tor", profitSatang: baht(100_000), fordSatang: baht(15_000), torSatang: baht(35_000), commissionStatus: "payable" });
    expect(r.get("N")).toMatchObject({ kind: null, fordSatang: 0, torSatang: 0, commissionStatus: "unassigned" });
    expect(r.get("G")).toMatchObject({ costMissing: true, profitSatang: null, fordSatang: 0, commissionStatus: "cost-missing" });
    expect(r.get("H")).toMatchObject({ profitSatang: null, fordSatang: 0, commissionStatus: "not-delivered" });
    // Cancelled after one went: it counts for what it delivered.
    expect(r.get("W")).toMatchObject({ profitSatang: baht(10_000), ladderFromSatang: baht(630_000), fordSatang: baht(3_700), torSatang: baht(1_300), commissionStatus: "payable" });
  });

  it("the month's totals for ฟอร์ด and พี่ต่อ — payable now and waiting — the company's, and what is not counted", async () => {
    const m = (await commissionMonth("2026-11"))!;
    expect(m.totals.ford).toEqual({ totalSatang: baht(225_800), paidSatang: 0, payableSatang: baht(178_800), waitingSatang: baht(47_000), differenceSatang: 0 });
    expect(m.totals.tor).toEqual({ totalSatang: baht(144_200), paidSatang: 0, payableSatang: baht(116_200), waitingSatang: baht(28_000), differenceSatang: 0 });
    expect(m.totals.companySatang).toBe(baht(370_000));
    expect(m.totals.profitSatang).toBe(baht(740_000));
    expect(m.totals.unassigned).toBe(1);
    expect(m.invoicesWithoutPo).toBe(2);
    expect(m.rateSet).toMatchObject({ id: null, effectiveMonth: "0000-00" });
  });

  it("an empty month asks nothing more of the database", async () => {
    vi.mocked(query).mockImplementation(route([[/salesOrderId IS NULL/, () => [{ n: 0 }]]]) as never);
    const m = (await commissionMonth("2026-10"))!;
    expect(m.rows).toEqual([]);
    expect(calls.some((c) => /FROM sales_records/.test(c.sql))).toBe(false);
  });
});

describe("commissionMonth — POs whose commission was marked paid", () => {
  const payout = (salesOrderId: string, ford: number, tor: number) => ({
    id: `pay-${salesOrderId}`,
    salesOrderId,
    kind: "ford",
    profitSatang: baht(80_000),
    fordSatang: baht(ford),
    torSatang: baht(tor),
    companySatang: baht(40_000),
    paidDate: "2026-11-24",
    createdBy: "admin",
  });
  const withPayouts = (rows: unknown[]) =>
    vi.mocked(query).mockImplementation(
      route([
        [/FROM acc_commission_rates/, () => []],
        [/FROM acc_documents WHERE docType = 'SO' AND issueDate >= \?/, () => PO_ROWS],
        [/FROM acc_document_lines/, () => LINES],
        [/docType = 'INV' AND status = 'issued' AND salesOrderId IN/, () => INVOICES],
        [/FROM sales_records sr/, () => SALES],
        [/salesOrderId IS NULL/, () => [{ n: 2 }]],
        [/FROM acc_commission_payouts WHERE salesOrderId IN .* AND voidedAt IS NULL/, () => rows],
      ]) as never
    );

  it("paid: what was locked, when, and the difference since — the totals split paid from payable", async () => {
    // A was paid 21,000 / 19,000; as it stands now it comes to 21,600 / 18,400.
    withPayouts([payout("A", 21_000, 19_000)]);
    const m = (await commissionMonth("2026-11"))!;
    const a = m.rows.find((r) => r.id === "A")!;
    expect(a.commissionStatus).toBe("paid");
    expect(a.payout).toMatchObject({ id: "pay-A", paidDate: "2026-11-24", fordSatang: baht(21_000), torSatang: baht(19_000) });
    expect([a.differenceFordSatang, a.differenceTorSatang]).toEqual([baht(600), baht(-600)]);
    expect(a.paidButNot).toBeNull();
    expect(m.totals.ford).toEqual({ totalSatang: baht(225_800), paidSatang: baht(21_000), payableSatang: baht(157_200), waitingSatang: baht(47_000), differenceSatang: baht(600) });
    expect(m.totals.tor).toMatchObject({ paidSatang: baht(19_000), payableSatang: baht(97_800), differenceSatang: baht(-600) });
  });

  it("paid, but as it stands now it could not be — a refund, a cost taken away — says so", async () => {
    // B's customer has not paid in full (any more).
    withPayouts([{ ...payout("B", 47_000, 28_000), profitSatang: baht(150_000) }]);
    const m = (await commissionMonth("2026-11"))!;
    const b = m.rows.find((r) => r.id === "B")!;
    expect(b.commissionStatus).toBe("paid");
    expect(b.paidButNot).toBe("awaiting-payment");
    expect([b.differenceFordSatang, b.differenceTorSatang]).toEqual([0, 0]);
  });

  it("a PO cancelled with nothing delivered — but marked paid before — stays in the month, so the mark shows and can be undone", async () => {
    // V's deliveries were taken back and V cancelled after its commission was paid 1,000 / 500.
    withPayouts([{ ...payout("V", 1_000, 500), companySatang: baht(1_500), profitSatang: baht(3_000) }]);
    const m = (await commissionMonth("2026-11"))!;
    expect(m.rows.map((r) => r.id)).toEqual(["A", "T", "N", "V", "B", "C", "G", "H", "W"]);
    const v = m.rows.find((r) => r.id === "V")!;
    expect(v).toMatchObject({ commissionStatus: "paid", paidButNot: "not-delivered", countedSatang: 0, fordSatang: 0, torSatang: 0 });
    expect([v.differenceFordSatang, v.differenceTorSatang]).toEqual([baht(-1_000), baht(-500)]);
    // It takes no place on the ladder: the others are as they were.
    expect(m.rows.find((r) => r.id === "B")).toMatchObject({ ladderFromSatang: baht(80_000), fordSatang: baht(47_000) });
    expect(m.totals.ford).toEqual({ totalSatang: baht(225_800), paidSatang: baht(1_000), payableSatang: baht(178_800), waitingSatang: baht(47_000), differenceSatang: baht(-1_000) });
    expect(m.totals.tor).toMatchObject({ paidSatang: baht(500), differenceSatang: baht(-500) });
  });

  it("reads only the live marks — an undone one is no payout", async () => {
    withPayouts([]);
    await commissionMonth("2026-11");
    const q = calls.find((c) => /FROM acc_commission_payouts/.test(c.sql))!;
    expect(q.sql).toMatch(/voidedAt IS NULL/);
  });
});

describe("commissionCosts — what a PO's profit is made of", () => {
  beforeEach(() => {
    vi.mocked(query).mockImplementation(
      route([
        [/FROM acc_documents WHERE id = \?/, () => [{ id: "C", docType: "SO", customerPoNo: "PO-C" }]],
        [
          /FROM sales_records sr/,
          () => [
            { id: "c1", saleDate: "2026-12-10", invoiceRef: "INV2026120003", totalAmount: "700000.00", costAmount: "417500.00" },
            { id: "c2", saleDate: "2026-12-20", invoiceRef: "INV2026120010", totalAmount: "300000.00", costAmount: "0.00" },
            { id: "cn", saleDate: "2026-12-28", invoiceRef: "CN2026120001", totalAmount: "-10000.00", costAmount: "0.00" },
          ],
        ],
        [/FROM sales_record_items/, () => [
          { salesRecordId: "c1", productName: "เครื่องชั่ง A", qty: 2, costAmount: "400000.00" },
          { salesRecordId: "c2", productName: "เครื่องชั่ง B", qty: 1, costAmount: "0.00" },
        ]],
        [/FROM sale_cost_items/, () => [
          { salesRecordId: "c1", costType: "shipping", label: "Kerry", note: "", amount: "6000.00" },
          { salesRecordId: "c1", costType: "transport", label: "", note: "รถบริษัท", amount: "1500.00" },
          { salesRecordId: "c1", costType: "commission", label: "", note: "", amount: "10000.00" },
        ]],
      ]) as never
    );
  });

  it("by delivery: sales, each product's cost, the other costs by type — the commission row shown but not counted", async () => {
    const c = (await commissionCosts("C"))!;
    expect(c.customerPoNo).toBe("PO-C");
    const [d1, d2, cn] = c.deliveries;
    expect(d1).toMatchObject({ saleId: "c1", saleDate: "2026-12-10", invoiceRef: "INV2026120003", credit: false, salesSatang: baht(700_000), costSatang: baht(407_500), profitSatang: baht(292_500), costMissing: false });
    expect(d1.items).toEqual([{ productName: "เครื่องชั่ง A", qty: 2, costSatang: baht(400_000) }]);
    expect(d1.costs).toEqual([
      { costType: "shipping", typeLabel: "ค่าขนส่ง", label: "Kerry", note: "", amountSatang: baht(6_000), counted: true },
      { costType: "transport", typeLabel: "ค่ารถ / ค่าเดินทาง", label: "", note: "รถบริษัท", amountSatang: baht(1_500), counted: true },
      { costType: "commission", typeLabel: "ค่าคอมมิชชั่น", label: "", note: "", amountSatang: baht(10_000), counted: false },
    ]);
    // Nothing typed for the second delivery yet.
    expect(d2).toMatchObject({ costSatang: 0, costMissing: true });
    // A credit note: negative, nothing to type.
    expect(cn).toMatchObject({ credit: true, salesSatang: baht(-10_000), costMissing: false });
    // The totals are what the commission counts: a delivery with no cost yet is
    // left out (its sales shown apart), as the month's row leaves it out.
    expect(c.totals).toEqual({
      salesSatang: baht(690_000),
      costSatang: baht(407_500),
      profitSatang: baht(282_500),
      notCountedSatang: baht(10_000),
      waitingCostSalesSatang: baht(300_000),
    });
  });

  it("reads the costs the way the dashboard counts them — the old product_cost rows left out", async () => {
    await commissionCosts("C");
    const costQuery = calls.find((c) => /FROM sale_cost_items/.test(c.sql))!;
    expect(costQuery.sql).toMatch(/costType <> 'product_cost'/);
  });

  it("only a customer PO", async () => {
    vi.mocked(query).mockImplementation(route([[/FROM acc_documents WHERE id = \?/, () => [{ id: "X", docType: "INV", customerPoNo: "" }]]]) as never);
    expect(await commissionCosts("X")).toBeNull();
    vi.mocked(query).mockImplementation(route([]) as never);
    expect(await commissionCosts("nope")).toBeNull();
  });
});

describe("commissionCostsFor — many POs' costs in one go (the Excel, the PDF)", () => {
  it("every PO's sales at once, then their lines and costs at once — grouped by PO, each as commissionCosts reads it", async () => {
    vi.mocked(query).mockImplementation(
      route([
        [
          /FROM sales_records sr WHERE sr\.dealId IN/,
          () => [
            { id: "a1", dealId: "A", saleDate: "2026-11-10", invoiceRef: "INV2026110001", totalAmount: "100000.00", costAmount: "20000.00" },
            { id: "c1", dealId: "C", saleDate: "2026-12-10", invoiceRef: "INV2026120003", totalAmount: "700000.00", costAmount: "417500.00" },
          ],
        ],
        [/FROM sales_record_items/, () => [
          { salesRecordId: "c1", productName: "เครื่องชั่ง A", qty: 2, costAmount: "400000.00" },
          { salesRecordId: "a1", productName: "เครื่องชั่ง B", qty: 1, costAmount: "20000.00" },
        ]],
        [/FROM sale_cost_items/, () => [
          { salesRecordId: "c1", costType: "shipping", label: "Kerry", note: "", amount: "7500.00" },
          { salesRecordId: "c1", costType: "commission", label: "", note: "", amount: "10000.00" },
        ]],
      ]) as never
    );
    const out = await commissionCostsFor([
      { id: "A", customerPoNo: "PO-A" },
      { id: "C", customerPoNo: "PO-C" },
      { id: "Z", customerPoNo: "PO-Z" },
    ]);
    expect(Object.keys(out)).toEqual(["A", "C", "Z"]);
    expect(out.C.customerPoNo).toBe("PO-C");
    expect(out.C.deliveries).toHaveLength(1);
    expect(out.C.deliveries[0]).toMatchObject({ saleId: "c1", salesSatang: baht(700_000), costSatang: baht(407_500), profitSatang: baht(292_500) });
    expect(out.C.totals.notCountedSatang).toBe(baht(10_000));
    expect(out.A.totals).toMatchObject({ salesSatang: baht(100_000), costSatang: baht(20_000), profitSatang: baht(80_000) });
    expect(out.Z).toEqual({
      poId: "Z",
      customerPoNo: "PO-Z",
      deliveries: [],
      totals: { salesSatang: 0, costSatang: 0, profitSatang: 0, notCountedSatang: 0, waitingCostSalesSatang: 0 },
    });
    for (const table of [/FROM sales_records sr/, /FROM sales_record_items/, /FROM sale_cost_items/]) {
      expect(calls.filter((c) => table.test(c.sql))).toHaveLength(1);
    }
    expect(calls.find((c) => /FROM sales_records sr/.test(c.sql))!.params).toEqual(["A", "C", "Z"]);
    expect(calls.find((c) => /FROM sale_cost_items/.test(c.sql))!.sql).toMatch(/costType <> 'product_cost'/);
  });

  it("no PO, no question to the database", async () => {
    expect(await commissionCostsFor([])).toEqual({});
    expect(calls).toHaveLength(0);
  });
});

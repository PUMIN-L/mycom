// @vitest-environment node
/**
 * The commission payout summary's data (lib/accounting/commissionReport.ts), for the PDF:
 *  • the LIVE marks paid in a range of paid dates, with their PO — the amounts
 *    as they were locked;
 *  • which of them changed since (as the PO's month stands now);
 *  • the rate sets they were worked out with; the company for the header; who
 *    exported it and when; each PO's costs only when asked.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/app/lib/db", () => ({ query: vi.fn(), withTransaction: vi.fn() }));
import { query } from "@/app/lib/db";
vi.mock("@/app/lib/accounting/commissionData", () => ({ commissionMonth: vi.fn(), commissionCostsFor: vi.fn() }));
import { commissionCostsFor, commissionMonth } from "@/app/lib/accounting/commissionData";
vi.mock("@/app/lib/accounting/settings", () => ({
  getSellerProfile: vi.fn(async () => ({
    seller: { name: "บริษัท ทดสอบ จำกัด", address: "กรุงเทพฯ", taxId: "0105555000000", branchCode: "00000", phone: "02-000-0000", email: "" },
    versionId: "v1",
  })),
}));
import { PAYOUT_REPORT_LIMIT, payoutReport } from "@/app/lib/accounting/commissionReport";
import { DEFAULT_COMMISSION_RULES } from "@/app/lib/accounting/commission";

const baht = (n: number) => Math.round(n * 100);
const mark = (o: Record<string, unknown>) => ({
  id: "pay-A",
  salesOrderId: "A",
  kind: "ford",
  profitSatang: String(baht(80_000)),
  ladderFromSatang: "0",
  ladderToSatang: String(baht(80_000)),
  fordSatang: String(baht(21_600)),
  torSatang: String(baht(18_400)),
  companySatang: String(baht(40_000)),
  rateSetId: null,
  paidDate: "2026-11-24",
  createdBy: "admin",
  customerPoNo: "PO-A",
  buyerName: "ลูกค้า A",
  issueDate: "2026-11-03",
  ...o,
});
const MARKS = [
  mark({}),
  mark({ id: "pay-C", salesOrderId: "C", customerPoNo: "PO-C", fordSatang: String(baht(138_500)), torSatang: String(baht(61_500)), paidDate: "2026-11-25", issueDate: "2026-11-20" }),
  mark({ id: "pay-T", salesOrderId: "T", customerPoNo: "PO-T", kind: "tor", ladderFromSatang: null, ladderToSatang: null, fordSatang: String(baht(15_000)), torSatang: String(baht(35_000)), issueDate: "2026-10-05", rateSetId: "r2" }),
  mark({ id: "pay-X", salesOrderId: "X", customerPoNo: "PO-X", issueDate: "2026-10-09" }),
];
const R2_RULES = { ...DEFAULT_COMMISSION_RULES, torFlat: { fordBp: 2000, torBp: 3000 } };

let calls: { sql: string; params: unknown[] }[] = [];
const route = (handlers: [RegExp, (params: unknown[]) => unknown[]][]) => async (sql: string, params: unknown[] = []) => {
  calls.push({ sql: String(sql), params });
  for (const [pattern, answer] of handlers) if (pattern.test(String(sql))) return [answer(params), []];
  return [[], []];
};
const OPTIONS = { withCosts: false, exportedBy: "admin" };

beforeEach(() => {
  vi.clearAllMocks();
  calls = [];
  vi.mocked(query).mockImplementation(
    route([
      [/FROM acc_commission_payouts p/, () => MARKS],
      [/FROM acc_commission_rates WHERE id IN/, () => [{ id: "r2", effectiveMonth: "2026-10", rulesJson: JSON.stringify(R2_RULES) }]],
    ]) as never
  );
  // As the months stand now: A as paid; C worked out again higher; T no longer payable; X not in its month.
  vi.mocked(commissionMonth).mockImplementation((async (month: string) => {
    if (month === "2026-11") {
      return {
        rows: [
          { id: "A", payout: { id: "pay-A" }, fordSatang: baht(21_600), torSatang: baht(18_400), paidButNot: null },
          { id: "C", payout: { id: "pay-C" }, fordSatang: baht(139_000), torSatang: baht(61_000), paidButNot: null },
        ],
      };
    }
    if (month === "2026-10") return { rows: [{ id: "T", payout: { id: "pay-T" }, fordSatang: baht(15_000), torSatang: baht(35_000), paidButNot: "awaiting-payment" }] };
    return null;
  }) as never);
  vi.mocked(commissionCostsFor).mockImplementation((async (pos: { id: string }[]) => Object.fromEntries(pos.map((p) => [p.id, { poId: p.id, deliveries: [] }]))) as never);
});

describe("payoutReport", () => {
  it("reads the live marks paid in the range, with their PO — every column carrying its table", async () => {
    await payoutReport("2026-11-01", "2026-11-30", OPTIONS);
    const q = calls.find((c) => /FROM acc_commission_payouts p/.test(c.sql))!;
    expect(q.sql).toMatch(/^SELECT p\.id, p\.salesOrderId, p\.kind, /);
    expect(q.sql).toMatch(/LEFT JOIN acc_documents d ON d\.id = p\.salesOrderId/);
    expect(q.sql).toMatch(/WHERE p\.voidedAt IS NULL AND p\.paidDate >= \? AND p\.paidDate <= \?/);
    expect(q.sql).toMatch(/ORDER BY p\.paidDate ASC, d\.customerPoNo ASC, p\.id ASC/);
    expect(q.params).toEqual(["2026-11-01", "2026-11-30"]);
  });

  it("each mark: what was locked, as numbers, with its PO's number, customer and date", async () => {
    const r = await payoutReport("2026-11-01", "2026-11-30", OPTIONS);
    expect(r.rows[0]).toEqual({
      id: "pay-A",
      salesOrderId: "A",
      customerPoNo: "PO-A",
      buyerName: "ลูกค้า A",
      issueDate: "2026-11-03",
      kind: "ford",
      profitSatang: baht(80_000),
      ladderFromSatang: 0,
      ladderToSatang: baht(80_000),
      fordSatang: baht(21_600),
      torSatang: baht(18_400),
      companySatang: baht(40_000),
      rateSetId: null,
      paidDate: "2026-11-24",
      createdBy: "admin",
      changedSince: false,
    });
    expect(r.rows[2]).toMatchObject({ kind: "tor", ladderFromSatang: null, ladderToSatang: null });
    expect([r.from, r.to]).toEqual(["2026-11-01", "2026-11-30"]);
  });

  it("which changed since they were paid — by each PO's month as it stands now, each month read once", async () => {
    const r = await payoutReport("2026-11-01", "2026-11-30", OPTIONS);
    expect(r.rows.map((x) => [x.id, x.changedSince])).toEqual([
      ["pay-A", false],
      ["pay-C", true],
      ["pay-T", true],
      ["pay-X", true],
    ]);
    expect(r.changedSince).toBe(3);
    expect(vi.mocked(commissionMonth).mock.calls.map((c) => c[0]).sort()).toEqual(["2026-10", "2026-11"]);
  });

  it("the rate sets used: the owner's table for a mark made with it, a saved set read by its id", async () => {
    const r = await payoutReport("2026-11-01", "2026-11-30", OPTIONS);
    expect(r.rateSets).toEqual([
      { id: null, effectiveMonth: "0000-00", rules: DEFAULT_COMMISSION_RULES },
      { id: "r2", effectiveMonth: "2026-10", rules: R2_RULES },
    ]);
    expect(calls.find((c) => /FROM acc_commission_rates/.test(c.sql))!.params).toEqual(["r2"]);
  });

  it("the company for the header, who exported it and when", async () => {
    const r = await payoutReport("2026-11-01", "2026-11-30", OPTIONS);
    expect(r.seller.name).toBe("บริษัท ทดสอบ จำกัด");
    expect(r.exportedBy).toBe("admin");
    expect(r.exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("each PO's costs only when asked — every PO once", async () => {
    const without = await payoutReport("2026-11-01", "2026-11-30", OPTIONS);
    expect("costs" in without).toBe(false);
    expect(commissionCostsFor).not.toHaveBeenCalled();
    const withCosts = await payoutReport("2026-11-01", "2026-11-30", { ...OPTIONS, withCosts: true });
    expect(commissionCostsFor).toHaveBeenCalledWith([
      { id: "A", customerPoNo: "PO-A" },
      { id: "C", customerPoNo: "PO-C" },
      { id: "T", customerPoNo: "PO-T" },
      { id: "X", customerPoNo: "PO-X" },
    ]);
    expect(Object.keys(withCosts.costs!)).toEqual(["A", "C", "T", "X"]);
  });

  it("nothing paid in the range: no month, no rate set read", async () => {
    vi.mocked(query).mockImplementation(route([]) as never);
    const r = await payoutReport("2026-11-01", "2026-11-30", OPTIONS);
    expect(r.rows).toEqual([]);
    expect(r.changedSince).toBe(0);
    expect(r.rateSets).toEqual([]);
    expect(commissionMonth).not.toHaveBeenCalled();
  });

  it("a range that is not one, or longer than a year — refused in Thai, nothing read", async () => {
    for (const [from, to] of [["2026-13-01", "2026-11-30"], ["2026-11-01", ""], ["2026-11-30", "2026-11-01"]]) {
      await expect(payoutReport(from, to, OPTIONS)).rejects.toMatchObject({ status: 400, message: "ช่วงวันที่ไม่ถูกต้อง" });
    }
    await expect(payoutReport("2025-01-01", "2026-11-30", OPTIONS)).rejects.toMatchObject({ status: 400, message: "ช่วงวันที่ต้องไม่เกิน 1 ปี" });
    expect(query).not.toHaveBeenCalled();
    await expect(payoutReport("2025-12-01", "2026-11-30", OPTIONS)).resolves.toBeTruthy();
  });

  it("more than one paper can hold — asks for a shorter range", async () => {
    const many = Array.from({ length: PAYOUT_REPORT_LIMIT + 1 }, (_, i) => mark({ id: `pay-${i}`, salesOrderId: `so-${i}` }));
    vi.mocked(query).mockImplementation(route([[/FROM acc_commission_payouts p/, () => many]]) as never);
    await expect(payoutReport("2026-11-01", "2026-11-30", OPTIONS)).rejects.toMatchObject({ status: 400, message: "รายการมากเกินไป กรุณาเลือกช่วงวันที่ให้สั้นลง" });
  });
});

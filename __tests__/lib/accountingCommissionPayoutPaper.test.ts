// @vitest-environment node
/**
 * The commission payout summary's paper, worked out before it is drawn
 * (lib/accounting/commissionPayoutPaper.ts — pure):
 *  • the summary: what each person got, split by whose customer the deal was;
 *  • the pages: rows never split, a PO's row kept with its cost detail, the
 *    totals + notes + signatures together on the last page;
 *  • the units a paper is made of, the rates box, the range and the file name.
 */
import { describe, it, expect } from "vitest";
import {
  deliveryTitles,
  paginatePaper,
  paperUnits,
  payoutPdfFilename,
  payoutRangeLabel,
  payoutSummary,
  rateSetLines,
} from "@/app/lib/accounting/commissionPayoutPaper";
import type { PayoutReportRow, PoCosts } from "@/app/lib/accounting/commissionTypes";
import { DEFAULT_COMMISSION_RULES } from "@/app/lib/accounting/commission";

const baht = (n: number) => Math.round(n * 100);
const row = (o: Partial<PayoutReportRow> & { id: string }): PayoutReportRow => ({
  salesOrderId: `so-${o.id}`,
  customerPoNo: `PO-${o.id}`,
  buyerName: `ลูกค้า ${o.id}`,
  issueDate: "2026-11-03",
  kind: "ford",
  profitSatang: 0,
  ladderFromSatang: null,
  ladderToSatang: null,
  fordSatang: 0,
  torSatang: 0,
  companySatang: 0,
  rateSetId: null,
  paidDate: "2026-11-24",
  createdBy: "admin",
  changedSince: false,
  ...o,
});
const costs = (poId: string, deliveries: { credit: boolean }[]): PoCosts => ({
  poId,
  customerPoNo: `PO-${poId}`,
  deliveries: deliveries.map((d, i) => ({
    saleId: `${poId}-${i}`,
    saleDate: "2026-11-10",
    invoiceRef: `INV-${i}`,
    credit: d.credit,
    salesSatang: d.credit ? -100 : 1000,
    costSatang: 0,
    profitSatang: 0,
    costMissing: false,
    storedCostSatang: 0,
    items: [],
    costs: [],
  })),
  totals: { salesSatang: 0, costSatang: 0, profitSatang: 0, notCountedSatang: 0, waitingCostSalesSatang: 0 },
});

describe("payoutSummary", () => {
  it("what each person got — from ลูกค้าฟอร์ด deals and from ลูกค้าพี่ต่อ deals — the company's share and the profit", () => {
    const s = payoutSummary([
      row({ id: "A", kind: "ford", profitSatang: baht(80_000), fordSatang: baht(21_600), torSatang: baht(18_400), companySatang: baht(40_000) }),
      row({ id: "C", kind: "ford", profitSatang: baht(400_000), fordSatang: baht(138_500), torSatang: baht(61_500), companySatang: baht(200_000) }),
      row({ id: "T", kind: "tor", profitSatang: baht(100_000), fordSatang: baht(15_000), torSatang: baht(35_000), companySatang: baht(50_000) }),
    ]);
    expect(s).toEqual({
      count: 3,
      profitSatang: baht(580_000),
      companySatang: baht(290_000),
      ford: { totalSatang: baht(175_100), fromFordSatang: baht(160_100), fromTorSatang: baht(15_000) },
      tor: { totalSatang: baht(114_900), fromFordSatang: baht(79_900), fromTorSatang: baht(35_000) },
      bothSatang: baht(290_000),
    });
  });

  it("nothing paid in the range: all 0", () => {
    expect(payoutSummary([])).toEqual({
      count: 0,
      profitSatang: 0,
      companySatang: 0,
      ford: { totalSatang: 0, fromFordSatang: 0, fromTorSatang: 0 },
      tor: { totalSatang: 0, fromFordSatang: 0, fromTorSatang: 0 },
      bothSatang: 0,
    });
  });
});

describe("paginatePaper", () => {
  const u = (height: number, keepWithNext = false) => ({ height, keepWithNext });

  it("all on one page — the totals, notes and signatures too", () => {
    expect(paginatePaper([u(10), u(10)], 100, 120, 30)).toEqual([{ units: [0, 1], tail: true }]);
  });

  it("a row never splits: the one that does not fit starts the next page — the first page holds less (it has the summary)", () => {
    expect(paginatePaper([u(10), u(10), u(10), u(10), u(10), u(10)], 25, 35, 0)).toEqual([
      { units: [0, 1], tail: false },
      { units: [2, 3, 4], tail: false },
      { units: [5], tail: true },
    ]);
  });

  it("the totals, notes and signatures stay together: when they do not fit, they go to a page of their own", () => {
    expect(paginatePaper([u(10), u(10)], 30, 30, 15)).toEqual([
      { units: [0, 1], tail: false },
      { units: [], tail: true },
    ]);
  });

  it("a PO's row goes with its cost detail — never left alone at the foot of a page", () => {
    expect(paginatePaper([u(10), u(10, true), u(15)], 30, 30, 0)).toEqual([
      { units: [0], tail: false },
      { units: [1, 2], tail: true },
    ]);
  });

  it("a row moves with its detail only when the two fit on the next page together — a page is never overfilled", () => {
    // Row 1 + its detail (60) would not fit a page of 54: the row stays, the detail starts the next page.
    expect(paginatePaper([u(10), u(10, true), u(50)], 30, 54, 0)).toEqual([
      { units: [0, 1], tail: false },
      { units: [2], tail: true },
    ]);
  });

  it("a part taller than a page takes a page of its own — and the pages still end", () => {
    expect(paginatePaper([u(10), u(50), u(10)], 30, 30, 0)).toEqual([
      { units: [0], tail: false },
      { units: [1], tail: false },
      { units: [2], tail: true },
    ]);
  });

  it("nothing measured (all 0) — one page", () => {
    expect(paginatePaper([u(0), u(0), u(0, true), u(0)], 0, 0, 0)).toEqual([{ units: [0, 1, 2, 3], tail: true }]);
  });

  it("no rows — one page, with the totals", () => {
    expect(paginatePaper([], 100, 100, 20)).toEqual([{ units: [], tail: true }]);
  });
});

describe("paperUnits", () => {
  it("without the costs: one part per paid PO, striped by its place", () => {
    const units = paperUnits({ rows: [row({ id: "A" }), row({ id: "C" })] });
    expect(units.map((x) => [x.kind, x.row.id, x.keepWithNext])).toEqual([
      ["row", "A", false],
      ["row", "C", false],
    ]);
    expect(units.map((x) => (x.kind === "row" ? x.index : -1))).toEqual([0, 1]);
  });

  it("with the costs: each PO's row, each delivery, its total — the row kept with what follows; no breakdown said so", () => {
    const units = paperUnits({
      rows: [row({ id: "A" }), row({ id: "B" }), row({ id: "C" })],
      costs: { "so-A": costs("so-A", [{ credit: false }, { credit: true }]), "so-B": costs("so-B", []) },
    });
    expect(units.map((x) => `${x.kind}:${x.row.id}`)).toEqual([
      "row:A",
      "delivery:A",
      "delivery:A",
      "costs-total:A",
      "row:B",
      "no-costs:B",
      "row:C",
      "no-costs:C",
    ]);
    expect(units.map((x) => x.keepWithNext)).toEqual([true, false, false, false, true, false, true, false]);
    expect(units[1]).toMatchObject({ kind: "delivery", title: "ส่งของครั้งที่ 1" });
    expect(units[2]).toMatchObject({ kind: "delivery", title: "ใบลดหนี้" });
  });
});

describe("the small things on the paper", () => {
  it("deliveries are numbered; a credit note is not one", () => {
    expect(deliveryTitles([{ credit: false }, { credit: true }, { credit: false }])).toEqual(["ส่งของครั้งที่ 1", "ใบลดหนี้", "ส่งของครั้งที่ 2"]);
  });

  it("the rates box writes a set as the owner's table does", () => {
    expect(rateSetLines({ id: null, effectiveMonth: "0000-00", rules: DEFAULT_COMMISSION_RULES })).toEqual({
      title: "ตั้งแต่เริ่มต้น",
      ladder: [
        "0 – 100,000: ฟอร์ด 27% · พี่ต่อ 23% · บริษัท 50%",
        "100,001 – 300,000: ฟอร์ด 32% · พี่ต่อ 18% · บริษัท 50%",
        "300,001 – 500,000: ฟอร์ด 34% · พี่ต่อ 16% · บริษัท 50%",
        "เกิน 500,000: ฟอร์ด 37% · พี่ต่อ 13% · บริษัท 50%",
      ],
      tor: "ฟอร์ด 15% · พี่ต่อ 35% · บริษัท 50%",
    });
    expect(rateSetLines({ id: "r2", effectiveMonth: "2027-01", rules: DEFAULT_COMMISSION_RULES }).title).toBe("ตั้งแต่เดือนมกราคม 2570");
  });

  it("the payment range, and the file name carrying it", () => {
    expect(payoutRangeLabel("2026-11-01", "2026-11-30")).toBe("1 Nov 2026 – 30 Nov 2026");
    expect(payoutRangeLabel("2026-11-24", "2026-11-24")).toBe("24 Nov 2026");
    expect(payoutPdfFilename("2026-11-01", "2026-11-30")).toBe("commission-payout_2026-11-01_2026-11-30.pdf");
  });
});

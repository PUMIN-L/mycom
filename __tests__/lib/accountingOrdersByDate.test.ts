// @vitest-environment node
//
// ordersByIssueDate — the customer POs received per day, by their own PO date,
// for the dashboard's "ยอดตาม PO ลูกค้า". Counted as soon as a PO is recorded
// (open, not cancelled), never waiting for a delivery or a payment; ex VAT,
// like every sales figure on the dashboard.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/app/lib/db", () => ({ query: vi.fn(), withTransaction: vi.fn() }));
import { query } from "@/app/lib/db";
import { ordersByIssueDate } from "@/app/lib/accounting/salesOrders";

beforeEach(() => vi.clearAllMocks());

describe("ordersByIssueDate", () => {
  it("asks for the open POs in [from, to) by PO date, one row per day", async () => {
    vi.mocked(query).mockResolvedValueOnce([[]] as never);
    await ordersByIssueDate("2026-01-01", "2027-01-01");
    const [sql, params] = vi.mocked(query).mock.calls[0];
    const flat = String(sql).replace(/\s+/g, " ");
    expect(flat).toContain("FROM acc_documents");
    expect(flat).toContain("docType = 'SO'");
    // A cancelled PO (void) is not counted; an open one is, delivered or not.
    expect(flat).toContain("status = 'issued'");
    expect(flat).toContain("issueDate >= ? AND issueDate < ?");
    expect(flat).toContain("GROUP BY issueDate");
    expect(flat).toContain("SUM(vatBaseSatang)");
    expect(params).toEqual(["2026-01-01", "2027-01-01"]);
  });

  it("answers numbers — the database's strings read once, here", async () => {
    vi.mocked(query).mockResolvedValueOnce([
      [
        { issueDate: "2026-11-03", n: "2", exVat: "15050000" },
        { issueDate: "2026-11-20", n: 1, exVat: null },
      ],
    ] as never);
    expect(await ordersByIssueDate("2026-11-01", "2026-12-01")).toEqual([
      { date: "2026-11-03", count: 2, exVatSatang: 15050000 },
      { date: "2026-11-20", count: 1, exVatSatang: 0 },
    ]);
  });
});

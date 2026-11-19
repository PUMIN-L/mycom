// @vitest-environment node
/**
 * What an invoice's credit notes took off it (lib/accounting/creditLedger.ts):
 * the sum over its ISSUED credit notes only — read with locks inside a
 * transaction — and the one writer of the invoice's cache, a full re-sum.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/app/lib/db", () => ({ query: vi.fn() }));
import { query } from "@/app/lib/db";
import { creditedOf, recomputeCreditedTx } from "@/app/lib/accounting/creditLedger";

const conn = { query: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  conn.query.mockReset();
});

describe("creditedOf", () => {
  it("sums the issued credit notes of the invoice — DECIMALs come back as strings", async () => {
    vi.mocked(query).mockResolvedValue([[{ t: "160500", v: "10500", b: "150000" }], []] as never);
    expect(await creditedOf(null, "inv1")).toEqual({ totalSatang: 160500, vatSatang: 10500, baseSatang: 150000 });
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(String(sql)).toContain("WHERE relatedDocId = ? AND docType = 'CN' AND status = 'issued'");
    expect(String(sql)).not.toContain("FOR UPDATE");
    expect(params).toEqual(["inv1"]);
  });

  it("reads with locks inside a transaction", async () => {
    conn.query.mockResolvedValue([[{ t: 0, v: 0, b: 0 }], []]);
    expect(await creditedOf(conn, "inv1")).toEqual({ totalSatang: 0, vatSatang: 0, baseSatang: 0 });
    expect(String(conn.query.mock.calls[0][0])).toMatch(/FOR UPDATE$/);
    expect(query).not.toHaveBeenCalled();
  });
});

describe("recomputeCreditedTx", () => {
  it("writes the full re-sum — never adds to what is there", async () => {
    conn.query.mockResolvedValueOnce([[{ t: 107000, v: 7000, b: 100000 }], []]).mockResolvedValueOnce([{}, []]);
    await recomputeCreditedTx(conn, "inv1");
    expect(conn.query).toHaveBeenLastCalledWith("UPDATE acc_documents SET creditedSatang = ?, creditedVatSatang = ? WHERE id = ?", [107000, 7000, "inv1"]);
  });
});

// @vitest-environment node
/**
 * One delivery's costs edited at once (salesDashboardStore.applySaleCostEditTx —
 * the commission screen's editor writes through it):
 *  • each named product line's cost set to an absolute amount (only when it
 *    changes); the bill-level cost rows added, changed, removed;
 *  • every read a LOCKING read — in a TiDB transaction a plain SELECT reads the
 *    snapshot it began with and would miss a cost saved while this waited;
 *  • only this sale's own lines and rows; a legacy "product_cost" row never
 *    (history, not counted); ต้นทุนสินค้า never as a bill-level row;
 *  • the sale's costAmount re-derived from the rows as they are after it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/app/lib/db", () => ({ query: vi.fn(), withTransaction: vi.fn() }));
import { ProductCostIsPerLineError, applySaleCostEditTx, type SaleCostEdit } from "@/app/lib/salesDashboardStore";

type Line = { id: string; salesRecordId: string; productName: string; costAmount: string };
type Row = { id: string; salesRecordId: string; costType: string; label: string; note: string; amount: string };
let lines: Line[];
let rows: Row[];
let saleCost: number | null;
let calls: { sql: string; params: unknown[] }[];

const conn = {
  query: vi.fn(async (sql: string, params: unknown[] = []) => {
    const s = String(sql).replace(/\s+/g, " ").trim();
    calls.push({ sql: s, params });
    if (/FROM sales_record_items WHERE salesRecordId = \?/.test(s)) return [lines.filter((l) => l.salesRecordId === params[0]), []];
    if (/FROM sale_cost_items WHERE salesRecordId = \?/.test(s)) return [rows.filter((r) => r.salesRecordId === params[0]), []];
    if (s.startsWith("UPDATE sales_record_items SET costAmount = ? WHERE id = ? AND salesRecordId = ?")) {
      const l = lines.find((x) => x.id === params[1] && x.salesRecordId === params[2]);
      if (l) l.costAmount = String(params[0]);
      return [{ affectedRows: l ? 1 : 0 }, []];
    }
    if (s.startsWith("INSERT INTO sale_cost_items")) {
      const [id, salesRecordId, costType, label, amount, note] = params as string[];
      rows.push({ id, salesRecordId, costType, label, note, amount: String(amount) });
      return [{ affectedRows: 1 }, []];
    }
    if (s.startsWith("UPDATE sale_cost_items SET costType = ?, label = ?, amount = ?, note = ? WHERE id = ? AND salesRecordId = ?")) {
      const r = rows.find((x) => x.id === params[4] && x.salesRecordId === params[5]);
      if (r) Object.assign(r, { costType: params[0], label: params[1], amount: String(params[2]), note: params[3] });
      return [{ affectedRows: r ? 1 : 0 }, []];
    }
    if (s.startsWith("DELETE FROM sale_cost_items WHERE id = ? AND salesRecordId = ?")) {
      const before = rows.length;
      rows = rows.filter((x) => !(x.id === params[0] && x.salesRecordId === params[1]));
      return [{ affectedRows: before - rows.length }, []];
    }
    if (s.startsWith("UPDATE sales_records SET costAmount = ? WHERE id = ?")) {
      saleCost = Number(params[0]);
      return [{ affectedRows: 1 }, []];
    }
    return [[], []];
  }),
};
const writes = () => calls.filter((c) => /^(UPDATE|INSERT|DELETE)/.test(c.sql));
const EDIT: SaleCostEdit = {
  lines: [
    { id: "l1", costAmount: 30_000 },
    { id: "l2", costAmount: 1_500 }, // as it is — not written
  ],
  add: [{ costType: "shipping", label: "Kerry", note: "", amount: 500 }],
  update: [{ id: "x1", costType: "transport", label: "", note: "รถบริษัท", amount: 300 }],
  remove: ["x2"],
};

beforeEach(() => {
  vi.clearAllMocks();
  calls = [];
  saleCost = null;
  lines = [
    { id: "l1", salesRecordId: "s1", productName: "เครื่องชั่ง A", costAmount: "0.00" },
    { id: "l2", salesRecordId: "s1", productName: "ตุ้มน้ำหนัก", costAmount: "1500.00" },
    { id: "l9", salesRecordId: "s2", productName: "of another sale", costAmount: "5.00" },
  ];
  rows = [
    { id: "x1", salesRecordId: "s1", costType: "transport", label: "", note: "รถบริษัท", amount: "200.00" },
    { id: "x2", salesRecordId: "s1", costType: "commission", label: "", note: "", amount: "1000.00" },
    { id: "old", salesRecordId: "s1", costType: "product_cost", label: "", note: "", amount: "999.00" },
    { id: "y1", salesRecordId: "s2", costType: "shipping", label: "", note: "", amount: "50.00" },
  ];
});

describe("applySaleCostEditTx", () => {
  it("sets the product costs that changed, adds / changes / removes the other costs, and re-derives the sale's cost", async () => {
    const result = await applySaleCostEditTx(conn, "s1", EDIT);
    expect(result).toEqual({
      lines: [{ id: "l1", productName: "เครื่องชั่ง A", before: 0, after: 30_000 }],
      added: [{ costType: "shipping", label: "Kerry", amount: 500 }],
      updated: [
        { id: "x1", before: { costType: "transport", label: "", note: "รถบริษัท", amount: 200 }, after: { costType: "transport", label: "", note: "รถบริษัท", amount: 300 } },
      ],
      removed: [{ id: "x2", costType: "commission", label: "", amount: 1_000 }],
      // Lines + every other cost but the legacy product_cost row (the dashboard's costAmount — ค่าคอม included).
      costAmountBefore: 2_700,
      costAmountAfter: 32_300,
    });
    expect(saleCost).toBe(32_300);
    expect(lines.find((l) => l.id === "l1")!.costAmount).toBe("30000");
    expect(rows.map((r) => r.id).sort()).toEqual(expect.arrayContaining(["x1", "old", "y1"]));
    expect(rows.find((r) => r.id === "x2")).toBeUndefined();
    expect(rows.find((r) => r.id === "old")!.amount).toBe("999.00");
    expect(rows.find((r) => r.id === "y1")!.amount).toBe("50.00");
    expect(writes().filter((c) => c.sql.startsWith("UPDATE sales_record_items"))).toHaveLength(1);
  });

  it("reads only with locks — before it writes, and again to sum the cost", async () => {
    await applySaleCostEditTx(conn, "s1", EDIT);
    const reads = calls.filter((c) => c.sql.startsWith("SELECT"));
    expect(reads.length).toBeGreaterThanOrEqual(4);
    for (const r of reads) expect(r.sql).toMatch(/FOR UPDATE$/);
    // The sum is read again after the last cost written, before it is stored.
    const lastCostWrite = Math.max(
      ...calls.map((c, i) => (/^(UPDATE sales_record_items|INSERT INTO sale_cost_items|UPDATE sale_cost_items|DELETE FROM sale_cost_items)/.test(c.sql) ? i : -1))
    );
    const sumWrite = calls.findIndex((c) => c.sql.startsWith("UPDATE sales_records SET costAmount"));
    expect(lastCostWrite).toBeGreaterThan(-1);
    expect(sumWrite).toBeGreaterThan(lastCostWrite);
    expect(calls.slice(lastCostWrite + 1, sumWrite).some((c) => c.sql.startsWith("SELECT"))).toBe(true);
  });

  it("only this sale's own — another sale's line or row, a legacy product_cost row, one gone since: 409, nothing written", async () => {
    for (const bad of [
      { ...EDIT, lines: [{ id: "l9", costAmount: 1 }] },
      { ...EDIT, update: [{ id: "y1", costType: "shipping", label: "", note: "", amount: 1 }] },
      { ...EDIT, update: [{ id: "old", costType: "other", label: "", note: "", amount: 1 }] },
      { ...EDIT, remove: ["old"] },
      { ...EDIT, remove: ["gone"] },
    ]) {
      calls = [];
      await expect(applySaleCostEditTx(conn, "s1", bad)).rejects.toMatchObject({ status: 409, message: "รายการต้นทุนนี้ถูกแก้หรือลบจากที่อื่นแล้ว — กรุณาโหลดใหม่แล้วแก้อีกครั้ง" });
      expect(writes()).toEqual([]);
    }
  });

  it("ต้นทุนสินค้า is never a bill-level row — it lives on the lines", async () => {
    await expect(applySaleCostEditTx(conn, "s1", { lines: [], add: [{ costType: "product_cost", label: "", note: "", amount: 5 }], update: [], remove: [] })).rejects.toBeInstanceOf(
      ProductCostIsPerLineError
    );
    await expect(
      applySaleCostEditTx(conn, "s1", { lines: [], add: [], update: [{ id: "x1", costType: "product_cost", label: "", note: "", amount: 5 }], remove: [] })
    ).rejects.toBeInstanceOf(ProductCostIsPerLineError);
    expect(writes()).toEqual([]);
  });

  it("the text is cleaned as the dashboard cleans it — tags out, cut to the column", async () => {
    await applySaleCostEditTx(conn, "s1", {
      lines: [],
      add: [{ costType: "other", label: `<b>Kerry</b>${"ก".repeat(300)}`, note: "ok", amount: 1 }],
      update: [],
      remove: [],
    });
    const added = rows.find((r) => !["x1", "x2", "old", "y1"].includes(r.id))!;
    expect(added.label.startsWith("Kerry")).toBe(true);
    expect(added.label.length).toBe(255);
  });

  it("the same figures sent back change nothing — and write nothing but the sum", async () => {
    const result = await applySaleCostEditTx(conn, "s1", {
      lines: [{ id: "l2", costAmount: 1_500 }],
      add: [],
      update: [{ id: "x1", costType: "transport", label: "", note: "รถบริษัท", amount: 200 }],
      remove: [],
    });
    expect(result).toMatchObject({ lines: [], added: [], updated: [], removed: [], costAmountBefore: 2_700, costAmountAfter: 2_700 });
    expect(writes().map((c) => c.sql.slice(0, 30))).toEqual(["UPDATE sales_records SET costA"]);
  });
});

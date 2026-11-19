// @vitest-environment node
/**
 * Deliveries against a customer PO (lib/accounting/orderDelivery.ts):
 *  • an invoice may take from a PO only what it still holds — counted over
 *    ISSUED invoices only, never the invoice being issued itself;
 *  • a missing or cancelled PO, a line no longer on it, are refused in Thai;
 *  • inside the issuing transaction every read is a LOCKING read (TiDB's
 *    snapshot would miss a delivery committed while it waited) and the PO is
 *    locked first; a draft being saved reads plainly;
 *  • deliveredQty is RE-SUMMED from the issued invoices — never `+ ?`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/app/lib/db", () => ({ query: vi.fn(), withTransaction: vi.fn() }));
import { query } from "@/app/lib/db";
import { checkDeliveryTx, draftDeliveryProblem, lockOrderTx, recomputeDeliveredTx } from "@/app/lib/accounting/orderDelivery";
import type { DocLineInput } from "@/app/lib/accounting/invoiceRules";

type Handler = [RegExp, (params: unknown[]) => unknown];
function router(handlers: Handler[]) {
  return async (sql: string, params: unknown[] = []) => {
    for (const [pattern, answer] of handlers) if (pattern.test(sql)) return [answer(params), []];
    return [[], []];
  };
}
const conn = { query: vi.fn() };
const connStatements = () => conn.query.mock.calls.map(([sql]) => String(sql));

const sent = (sourceLineId: string, qty: number, name = "ปั๊ม"): DocLineInput => ({
  lineType: "goods", productId: "", name, qty, unit: "ชิ้น", unitPriceSatang: 10000, discountSatang: 0,
  isMachine: false, serials: "", warrantyMonths: null, sourceLineId,
});

/** PO so1: line a (pump, 5 ชิ้น) and b (hose, 2); issued invoice inv1 sent 2 pumps, inv2 sent 1 pump + 2 hoses. */
function orderDb(order: Record<string, unknown> | null = { docType: "SO", status: "issued" }) {
  return router([
    [/SELECT docType, status, vatRate FROM acc_documents WHERE id = \?/, () => (order ? [order] : [])],
    [/SELECT id, name, unit, qty FROM acc_document_lines WHERE documentId = \?/, () => [
      { id: "a", name: "ปั๊ม", unit: "ชิ้น", qty: "5.00" },
      { id: "b", name: "สายยาง", unit: "เส้น", qty: "2.00" },
    ]],
    [/SELECT id FROM acc_documents WHERE salesOrderId = \? AND docType = 'INV' AND status = 'issued'/, () => [{ id: "inv1" }, { id: "inv2" }]],
    [/SELECT sourceLineId, qty FROM acc_document_lines WHERE documentId IN/, () => [
      { sourceLineId: "a", qty: "2.00" },
      { sourceLineId: "a", qty: "1.00" },
      { sourceLineId: "b", qty: "2.00" },
    ]],
    [/SELECT id FROM acc_documents WHERE id = \? FOR UPDATE/, () => (order ? [{ id: "so1" }] : [])],
  ]);
}

beforeEach(() => {
  vi.clearAllMocks();
  conn.query.mockReset();
  vi.mocked(query).mockReset();
});

describe("draftDeliveryProblem — a draft being saved", () => {
  it("lets through what the PO still holds, reading plainly — nothing locked", async () => {
    vi.mocked(query).mockImplementation(orderDb() as never);
    expect(await draftDeliveryProblem("so1", [sent("a", 2)], null)).toBeNull();
    const sqls = vi.mocked(query).mock.calls.map(([sql]) => String(sql));
    expect(sqls.some((s) => s.includes("FOR UPDATE"))).toBe(false);
  });

  it("says how much is left of a line sent beyond it — two lines from one PO line count together", async () => {
    vi.mocked(query).mockImplementation(orderDb() as never);
    expect(await draftDeliveryProblem("so1", [sent("a", 1), sent("a", 2)], null)).toBe('ส่ง "ปั๊ม" เกินจำนวนที่เหลือใน PO — เหลือ 2 ชิ้น');
  });

  it("says a line already delivered in full is done", async () => {
    vi.mocked(query).mockImplementation(orderDb() as never);
    expect(await draftDeliveryProblem("so1", [sent("b", 1, "สายยาง")], null)).toBe('"สายยาง" ใน PO นี้ส่งครบแล้ว');
  });

  it("refuses a line that is no longer on the PO", async () => {
    vi.mocked(query).mockImplementation(orderDb() as never);
    expect(await draftDeliveryProblem("so1", [sent("gone", 1, "วาล์ว")], null)).toContain('รายการ "วาล์ว" ไม่อยู่ใน PO นี้แล้ว');
  });

  it("refuses a PO that is not there, is not a customer PO, or was cancelled", async () => {
    vi.mocked(query).mockImplementation(orderDb(null) as never);
    expect(await draftDeliveryProblem("so1", [sent("a", 1)], null)).toBe("ไม่พบ PO ลูกค้าที่ใบนี้ส่งของ — อาจถูกลบไปแล้ว");
    vi.mocked(query).mockImplementation(orderDb({ docType: "INV", status: "issued" }) as never);
    expect(await draftDeliveryProblem("so1", [sent("a", 1)], null)).toBe("ไม่พบ PO ลูกค้าที่ใบนี้ส่งของ — อาจถูกลบไปแล้ว");
    vi.mocked(query).mockImplementation(orderDb({ docType: "SO", status: "void" }) as never);
    expect(await draftDeliveryProblem("so1", [sent("a", 1)], null)).toBe("PO ลูกค้านี้ถูกยกเลิกแล้ว — ส่งของจาก PO นี้ไม่ได้");
  });

  it("asks nothing more of a delivery with no line from the PO", async () => {
    vi.mocked(query).mockImplementation(orderDb() as never);
    expect(await draftDeliveryProblem("so1", [sent("", 99)], null)).toBeNull();
  });

  it("does not count the invoice itself among what was delivered", async () => {
    vi.mocked(query).mockImplementation(orderDb() as never);
    await draftDeliveryProblem("so1", [sent("a", 1)], "inv9");
    const call = vi.mocked(query).mock.calls.find(([sql]) => String(sql).includes("status = 'issued'"))!;
    expect(String(call[0])).toContain("AND id <> ?");
    expect(call[1]).toEqual(["so1", "inv9"]);
  });
});

describe("checkDeliveryTx — inside the issuing transaction", () => {
  it("locks the PO first, and reads its lines and deliveries with locks", async () => {
    conn.query.mockImplementation(orderDb());
    await checkDeliveryTx(conn, "so1", [sent("a", 2)], "inv9");
    const sqls = connStatements();
    expect(sqls[0]).toBe("SELECT docType, status, vatRate FROM acc_documents WHERE id = ? FOR UPDATE");
    expect(sqls.filter((s) => s.startsWith("SELECT")).every((s) => s.endsWith("FOR UPDATE"))).toBe(true);
  });

  it("refuses with 409 what the PO cannot give", async () => {
    conn.query.mockImplementation(orderDb());
    await expect(checkDeliveryTx(conn, "so1", [sent("a", 3)], "inv9")).rejects.toMatchObject({ status: 409, message: expect.stringContaining("เหลือ 2 ชิ้น") });
  });
});

describe("recomputeDeliveredTx", () => {
  it("writes each PO line's delivered quantity as the sum of the issued invoices — a line with none gets 0", async () => {
    conn.query.mockImplementation(
      router([
        [/SELECT id, name, unit, qty FROM acc_document_lines/, () => [
          { id: "a", name: "ปั๊ม", unit: "ชิ้น", qty: "5.00" },
          { id: "b", name: "สายยาง", unit: "เส้น", qty: "2.00" },
          { id: "c", name: "วาล์ว", unit: "ตัว", qty: "1.00" },
        ]],
        [/SELECT id FROM acc_documents WHERE salesOrderId/, () => [{ id: "inv1" }]],
        [/SELECT sourceLineId, qty FROM acc_document_lines/, () => [
          { sourceLineId: "a", qty: "1.25" },
          { sourceLineId: "a", qty: "1.50" },
          { sourceLineId: "b", qty: "2.00" },
        ]],
      ])
    );
    await recomputeDeliveredTx(conn, "so1");
    const updates = conn.query.mock.calls.filter(([sql]) => String(sql).startsWith("UPDATE"));
    expect(updates).toEqual([
      ["UPDATE acc_document_lines SET deliveredQty = ? WHERE id = ?", [2.75, "a"]],
      ["UPDATE acc_document_lines SET deliveredQty = ? WHERE id = ?", [2, "b"]],
      ["UPDATE acc_document_lines SET deliveredQty = ? WHERE id = ?", [0, "c"]],
    ]);
    // Over ISSUED invoices, every one of them (none excepted).
    const invoices = connStatements().find((s) => s.includes("salesOrderId = ?"))!;
    expect(invoices).toBe("SELECT id FROM acc_documents WHERE salesOrderId = ? AND docType = 'INV' AND status = 'issued' FOR UPDATE");
  });

  it("sets every line back to 0 once its last delivery is gone", async () => {
    conn.query.mockImplementation(router([[/SELECT id, name, unit, qty FROM acc_document_lines/, () => [{ id: "a", name: "ปั๊ม", unit: "ชิ้น", qty: "5.00" }]]]));
    await recomputeDeliveredTx(conn, "so1");
    expect(conn.query).toHaveBeenCalledWith("UPDATE acc_document_lines SET deliveredQty = ? WHERE id = ?", [0, "a"]);
  });

  it("does nothing for a PO with no lines (deleted already)", async () => {
    conn.query.mockImplementation(router([]));
    await recomputeDeliveredTx(conn, "so1");
    expect(connStatements().some((s) => s.startsWith("UPDATE"))).toBe(false);
  });
});

describe("lockOrderTx", () => {
  it("locks the PO row and says whether it is there", async () => {
    conn.query.mockImplementation(orderDb());
    expect(await lockOrderTx(conn, "so1")).toBe(true);
    expect(connStatements()).toEqual(["SELECT id FROM acc_documents WHERE id = ? FOR UPDATE"]);
    conn.query.mockImplementation(orderDb(null));
    expect(await lockOrderTx(conn, "so1")).toBe(false);
  });
});

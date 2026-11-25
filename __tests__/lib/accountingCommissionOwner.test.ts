// @vitest-environment node
//
// setSalesOrderCommission — whose commission a customer PO is (the owner,
// 2026-11-25): "ลูกค้าฟอร์ด" or "ลูกค้าพี่ต่อ", chosen by hand on the PO —
// not its salesperson, not the company's เซลล์ผู้ดูแล. The PO is locked to
// change it; every change is in the history; its updatedAt (what an edit of
// its lines checks) is left alone.
import { describe, it, expect, vi, beforeEach } from "vitest";

const conn = { query: vi.fn() };
vi.mock("@/app/lib/db", () => ({
  query: vi.fn(),
  withTransaction: vi.fn(async (fn: (c: typeof conn) => Promise<unknown>) => fn(conn)),
}));
import { query } from "@/app/lib/db";
vi.mock("@/app/lib/salesDashboardStore", () => ({ prepareSaleWithLineItems: vi.fn(), insertPreparedSaleTx: vi.fn() }));
vi.mock("@/app/lib/accounting/settings", () => ({ getVatRate: vi.fn(async () => 7), getSellerProfile: vi.fn() }));
vi.mock("@/app/lib/accounting/audit", () => ({ writeAudit: vi.fn(async () => {}) }));
import { writeAudit } from "@/app/lib/accounting/audit";
import { setSalesOrderCommission } from "@/app/lib/accounting/commissionOwner";

const actor = { userId: "admin-001", username: "admin" };
const LOCKED = { id: "so1", docType: "SO", status: "issued", customerPoNo: "PO-6611", commissionOf: null as string | null };

type Handler = [RegExp, (params: unknown[]) => unknown];
const router = (handlers: Handler[]) => async (sql: string, params: unknown[] = []) => {
  for (const [pattern, answer] of handlers) if (pattern.test(sql)) return [answer(params), []];
  return [[], []];
};
const locked = (over: Partial<typeof LOCKED> = {}) => conn.query.mockImplementation(router([[/FOR UPDATE/, () => [{ ...LOCKED, ...over }]]]));
const updates = () => conn.query.mock.calls.filter(([sql]) => String(sql).startsWith("UPDATE"));

beforeEach(() => {
  vi.clearAllMocks();
  conn.query.mockReset();
  // The PO read back after the change.
  vi.mocked(query).mockImplementation(
    router([
      [/FROM acc_documents WHERE id = \?/, () => [{ ...LOCKED, commissionOf: "tor" }]],
      [/FROM acc_document_lines/, () => []],
    ]) as never
  );
});

describe("setSalesOrderCommission", () => {
  it("the first choice: written, in the history, and the PO read back", async () => {
    locked();
    const change = await setSalesOrderCommission("so1", "ford", actor);
    expect(updates()).toHaveLength(1);
    // Not the PO's content: its updatedAt is left alone.
    expect(updates()[0][0]).toBe("UPDATE acc_documents SET commissionOf = ? WHERE id = ?");
    expect(updates()[0][1]).toEqual(["ford", "so1"]);
    expect(writeAudit).toHaveBeenCalledWith(
      conn,
      expect.objectContaining({ action: "commission.owner", documentId: "so1", docNo: "PO-6611", detail: "ค่าคอมของ: ยังไม่เลือก → ลูกค้าฟอร์ด" })
    );
    expect(change.from).toBeNull();
    expect(change.to).toBe("ford");
    expect(change.order.commissionOf).toBe("tor");
  });

  it("a switch to the other person says from whom", async () => {
    locked({ commissionOf: "ford" });
    const change = await setSalesOrderCommission("so1", "tor", actor);
    expect(updates()[0][1]).toEqual(["tor", "so1"]);
    expect(writeAudit).toHaveBeenCalledWith(conn, expect.objectContaining({ detail: "ค่าคอมของ: ลูกค้าฟอร์ด → ลูกค้าพี่ต่อ" }));
    expect(change.from).toBe("ford");
  });

  it("writes nothing when it already is that", async () => {
    locked({ commissionOf: "tor" });
    const change = await setSalesOrderCommission("so1", "tor", actor);
    expect(updates()).toHaveLength(0);
    expect(writeAudit).not.toHaveBeenCalled();
    expect(change.from).toBe("tor");
  });

  it("locks the PO to change it", async () => {
    locked();
    await setSalesOrderCommission("so1", "ford", actor);
    expect(String(conn.query.mock.calls[0][0])).toMatch(/FROM acc_documents WHERE id = \? .*FOR UPDATE/);
  });

  it("a cancelled PO can still be chosen — what it delivered before still counts", async () => {
    locked({ status: "void" });
    await setSalesOrderCommission("so1", "ford", actor);
    expect(updates()).toHaveLength(1);
  });

  it("only a customer PO: anything else, or nothing, is not found", async () => {
    locked({ docType: "INV" });
    await expect(setSalesOrderCommission("so1", "ford", actor)).rejects.toMatchObject({ status: 404, message: "ไม่พบ PO ลูกค้านี้" });
    conn.query.mockImplementation(router([]));
    await expect(setSalesOrderCommission("nope", "ford", actor)).rejects.toMatchObject({ status: 404 });
    expect(updates()).toHaveLength(0);
  });

  it("refuses anyone but the two — before reading anything", async () => {
    await expect(setSalesOrderCommission("so1", "boss" as never, actor)).rejects.toMatchObject({
      status: 400,
      message: "กรุณาเลือกว่าเป็นค่าคอมของลูกค้าฟอร์ดหรือลูกค้าพี่ต่อ",
    });
    expect(conn.query).not.toHaveBeenCalled();
  });
});

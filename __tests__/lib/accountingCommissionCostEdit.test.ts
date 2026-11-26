// @vitest-environment node
/**
 * A delivery's costs edited on the commission screen
 * (lib/accounting/commissionCostEdit.ts → editDeliveryCosts):
 *  • what was sent checked first (in Thai), the PO a customer PO;
 *  • then under the SALE's lock (a locking read — TiDB): a delivery of THIS PO,
 *    not a credit note, its cost as it was when the editor opened;
 *  • written through the dashboard's own cost store, in baht, and a line in
 *    the PO's history in the same transaction;
 *  • answers the PO's costs as they are now.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const conn = { query: vi.fn() };
vi.mock("@/app/lib/db", () => ({
  query: vi.fn(),
  withTransaction: vi.fn(async (fn: (c: typeof conn) => Promise<unknown>) => fn(conn)),
}));
import { query } from "@/app/lib/db";
vi.mock("@/app/lib/accounting/audit", () => ({ writeAudit: vi.fn(async () => {}) }));
import { writeAudit } from "@/app/lib/accounting/audit";
vi.mock("@/app/lib/accounting/commissionData", () => ({
  commissionCosts: vi.fn(async (id: string) => ({ poId: id, customerPoNo: "PO-C", deliveries: [], totals: {} })),
}));
import { commissionCosts } from "@/app/lib/accounting/commissionData";
vi.mock("@/app/lib/salesDashboardStore", () => ({ applySaleCostEditTx: vi.fn() }));
import { applySaleCostEditTx } from "@/app/lib/salesDashboardStore";
import { editDeliveryCosts } from "@/app/lib/accounting/commissionCostEdit";

const actor = { userId: "admin-001", username: "admin" };
const BODY = {
  saleId: "c1",
  expectedCostSatang: 0,
  lines: [{ id: "l1", costSatang: 3_000_000 }],
  add: [{ costType: "shipping", label: "Kerry", note: "", amountSatang: 50_000 }],
  update: [],
  remove: [],
};
const RESULT = {
  lines: [{ id: "l1", productName: "COMETECH QC-548D2 (5kN)", before: 0, after: 30_000 }],
  added: [{ costType: "shipping", label: "Kerry", amount: 500 }],
  updated: [],
  removed: [],
  costAmountBefore: 0,
  costAmountAfter: 30_500,
};
const SALE = { id: "c1", dealId: "C", invoiceRef: "INV2026110004", totalAmount: "49000.00", costAmount: "0.00" };
const withSale = (sale: Record<string, unknown> | null) =>
  conn.query.mockImplementation(async (sql: string) => (/FROM sales_records WHERE id = \? FOR UPDATE/.test(String(sql)) ? [sale ? [sale] : [], []] : [[], []]));

beforeEach(() => {
  vi.clearAllMocks();
  conn.query.mockReset();
  vi.mocked(query).mockResolvedValue([[{ id: "C", docType: "SO", customerPoNo: "PO-C" }], []] as never);
  withSale(SALE);
  vi.mocked(applySaleCostEditTx).mockResolvedValue(RESULT);
});

describe("editDeliveryCosts", () => {
  it("writes under the sale's lock, in baht, with a line in the PO's history — and answers the PO's costs as they are now", async () => {
    const answer = await editDeliveryCosts("C", BODY, actor);
    expect(String(conn.query.mock.calls[0][0])).toMatch(/^SELECT id, dealId, invoiceRef, totalAmount, costAmount FROM sales_records WHERE id = \? FOR UPDATE$/);
    expect(conn.query.mock.calls[0][1]).toEqual(["c1"]);
    expect(applySaleCostEditTx).toHaveBeenCalledWith(conn, "c1", {
      lines: [{ id: "l1", costAmount: 30_000 }],
      add: [{ costType: "shipping", label: "Kerry", note: "", amount: 500 }],
      update: [],
      remove: [],
    });
    expect(writeAudit).toHaveBeenCalledWith(conn, {
      ...actor,
      action: "commission.cost",
      documentId: "C",
      docNo: "PO-C",
      detail: "แก้ต้นทุน INV2026110004 · ต้นทุนสินค้า COMETECH QC-548D2 (5kN) 0.00 → 30,000.00 · เพิ่ม ค่าขนส่ง (Kerry) 500.00 · ต้นทุนรวม 0.00 → 30,500.00",
    });
    expect(commissionCosts).toHaveBeenCalledWith("C");
    expect(answer).toMatchObject({ poId: "C", customerPoNo: "PO-C" });
  });

  it("what was sent is checked before anything is locked — not an edit, what is wrong with it, a PO that is not one", async () => {
    await expect(editDeliveryCosts("C", null, actor)).rejects.toMatchObject({ status: 400, message: "ข้อมูลต้นทุนไม่ถูกต้อง" });
    await expect(editDeliveryCosts("C", { ...BODY, add: [{ ...BODY.add[0], amountSatang: 0 }] }, actor)).rejects.toMatchObject({
      status: 400,
      message: "ค่าขนส่ง (Kerry): จำนวนเงินต้องมากกว่า 0 — ถ้าไม่ใช้รายการนี้ ให้กดลบ",
    });
    vi.mocked(query).mockResolvedValue([[{ id: "C", docType: "INV", customerPoNo: "" }], []] as never);
    await expect(editDeliveryCosts("C", BODY, actor)).rejects.toMatchObject({ status: 404, message: "ไม่พบ PO ลูกค้านี้" });
    expect(conn.query).not.toHaveBeenCalled();
    expect(applySaleCostEditTx).not.toHaveBeenCalled();
  });

  it("a delivery of another PO, a credit note, or costs changed since the editor opened — refused, nothing written", async () => {
    for (const [sale, status, message] of [
      [null, 404, "ไม่พบการส่งของนี้ใน PO นี้"],
      [{ ...SALE, dealId: "X" }, 404, "ไม่พบการส่งของนี้ใน PO นี้"],
      [{ ...SALE, totalAmount: "-1000.00" }, 409, "ใบลดหนี้ไม่มีต้นทุนให้แก้"],
      [{ ...SALE, costAmount: "100.00" }, 409, "ต้นทุนของการส่งของครั้งนี้ถูกแก้จากที่อื่นหลังจากเปิดดู — กรุณาโหลดใหม่แล้วแก้อีกครั้ง"],
    ] as const) {
      withSale(sale);
      await expect(editDeliveryCosts("C", BODY, actor)).rejects.toMatchObject({ status, message });
    }
    expect(applySaleCostEditTx).not.toHaveBeenCalled();
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("the same figures sent back — nothing changed: said so, nothing in the history", async () => {
    vi.mocked(applySaleCostEditTx).mockResolvedValue({ ...RESULT, lines: [], added: [], costAmountAfter: 0 });
    await expect(editDeliveryCosts("C", BODY, actor)).rejects.toMatchObject({ status: 400, message: "ไม่มีอะไรเปลี่ยน" });
    expect(writeAudit).not.toHaveBeenCalled();
  });
});

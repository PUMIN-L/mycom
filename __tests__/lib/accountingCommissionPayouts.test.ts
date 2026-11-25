// @vitest-environment node
/**
 * Marking a PO's commission paid (lib/accounting/commissionPayouts.ts):
 *  • only a PO that may be paid — chosen, delivered in full, paid in full, every
 *    cost typed — and only once: the PO is locked, and "no live mark yet" is a
 *    LOCKING read (TiDB's plain SELECT reads the transaction's start snapshot);
 *  • the amounts as worked out now are LOCKED in the mark; a later change shows
 *    as a difference, never rewrites it;
 *  • the PO only is locked — never an invoice (the module's order is invoice →
 *    PO), so it cannot deadlock an issue;
 *  • undone with a reason, the PO then the mark locked; every step audited.
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
vi.mock("@/app/lib/accounting/commissionData", () => ({ commissionMonth: vi.fn() }));
import { commissionMonth } from "@/app/lib/accounting/commissionData";
import { recordPayout, voidPayout } from "@/app/lib/accounting/commissionPayouts";

const actor = { userId: "admin-001", username: "admin" };
const baht = (n: number) => Math.round(n * 100);
const ROW = {
  id: "C",
  customerPoNo: "PO-C",
  kind: "ford",
  countedSatang: baht(400_000),
  profitSatang: baht(400_000),
  ladderFromSatang: baht(230_000),
  ladderToSatang: baht(630_000),
  fordSatang: baht(138_500),
  torSatang: baht(61_500),
  companySatang: baht(200_000),
  commissionStatus: "payable",
};
const month = (row: Record<string, unknown> = {}) =>
  vi.mocked(commissionMonth).mockResolvedValue({ month: "2026-11", rateSet: { id: "r1", effectiveMonth: "0000-00" }, rows: [{ ...ROW, ...row }] } as never);

type Handler = [RegExp, (params: unknown[]) => unknown];
const router = (handlers: Handler[]) => async (sql: string, params: unknown[] = []) => {
  for (const [pattern, answer] of handlers) if (pattern.test(String(sql))) return [answer(params), []];
  return [[], []];
};
const inserts = () => conn.query.mock.calls.filter(([sql]) => String(sql).startsWith("INSERT INTO acc_commission_payouts"));
const updates = () => conn.query.mock.calls.filter(([sql]) => String(sql).startsWith("UPDATE acc_commission_payouts"));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-25T03:00:00Z"));
  vi.clearAllMocks();
  conn.query.mockReset();
  vi.mocked(query).mockImplementation(router([[/FROM acc_documents WHERE id = \? LIMIT 1/, () => [{ id: "C", docType: "SO", issueDate: "2026-11-20", customerPoNo: "PO-C" }]]]) as never);
  conn.query.mockImplementation(router([[/FROM acc_documents WHERE id = \? FOR UPDATE/, () => [{ id: "C", commissionOf: "ford", customerPoNo: "PO-C" }]]]));
  month();
});

describe("recordPayout", () => {
  it("locks the amounts worked out now, with the PO's month and the rate set used — and the history says so", async () => {
    const result = await recordPayout("C", "2026-11-25", actor);
    expect(commissionMonth).toHaveBeenCalledWith("2026-11");
    expect(inserts()).toHaveLength(1);
    const params = inserts()[0][1] as unknown[];
    expect(params.slice(1)).toEqual([
      "C",
      "ford",
      "2026-11",
      baht(400_000),
      baht(230_000),
      baht(630_000),
      baht(138_500),
      baht(61_500),
      baht(200_000),
      "r1",
      "2026-11-25",
      expect.any(String),
      "admin",
    ]);
    expect(result.id).toBe(params[0]);
    expect(writeAudit).toHaveBeenCalledWith(
      conn,
      expect.objectContaining({
        action: "commission.payout",
        documentId: "C",
        docNo: "PO-C",
        detail: "บันทึกจ่ายค่าคอม วันที่ 25 Nov 2026 · ฟอร์ด 138,500.00 · พี่ต่อ 61,500.00 บาท",
      })
    );
  });

  it("the PO first, then a LOCKING read for a mark already there — and never an invoice", async () => {
    await recordPayout("C", "2026-11-25", actor);
    const sql = conn.query.mock.calls.map(([s]) => String(s));
    expect(sql[0]).toMatch(/FROM acc_documents WHERE id = \? FOR UPDATE/);
    expect(sql[1]).toMatch(/FROM acc_commission_payouts WHERE salesOrderId = \? AND voidedAt IS NULL .*FOR UPDATE/);
    expect(sql.some((s) => /docType = 'INV'/.test(s))).toBe(false);
  });

  it("once only", async () => {
    conn.query.mockImplementation(
      router([
        [/FROM acc_documents WHERE id = \? FOR UPDATE/, () => [{ id: "C", commissionOf: "ford", customerPoNo: "PO-C" }]],
        [/FROM acc_commission_payouts WHERE salesOrderId = \?/, () => [{ id: "pay0" }]],
      ])
    );
    await expect(recordPayout("C", "2026-11-25", actor)).rejects.toMatchObject({ status: 409, message: "บันทึกจ่ายค่าคอมของ PO นี้ไปแล้ว" });
    month({ commissionStatus: "paid" });
    await expect(recordPayout("C", "2026-11-25", actor)).rejects.toMatchObject({ status: 409, message: "บันทึกจ่ายค่าคอมของ PO นี้ไปแล้ว" });
    expect(inserts()).toHaveLength(0);
  });

  it("only a PO that may be paid — and says why not", async () => {
    const cases: [string, string][] = [
      ["unassigned", "ยังไม่ได้เลือกว่า PO นี้เป็นค่าคอมของใคร"],
      ["not-delivered", "PO นี้ยังส่งของไม่ครบ"],
      ["cost-missing", "ยังกรอกต้นทุนของ PO นี้ไม่ครบ"],
      ["awaiting-payment", "ลูกค้ายังจ่ายเงิน PO นี้ไม่ครบ"],
    ];
    for (const [status, message] of cases) {
      month({ commissionStatus: status });
      await expect(recordPayout("C", "2026-11-25", actor)).rejects.toMatchObject({ status: 409, message });
    }
    expect(inserts()).toHaveLength(0);
  });

  it("whose commission it is changed since it was worked out: refused", async () => {
    conn.query.mockImplementation(router([[/FROM acc_documents WHERE id = \? FOR UPDATE/, () => [{ id: "C", commissionOf: "tor", customerPoNo: "PO-C" }]]]));
    await expect(recordPayout("C", "2026-11-25", actor)).rejects.toMatchObject({ status: 409, message: "ค่าคอมของ PO นี้เพิ่งถูกเปลี่ยน กรุณาโหลดหน้าใหม่" });
    expect(inserts()).toHaveLength(0);
  });

  it("a real date, not in the future — before reading anything", async () => {
    await expect(recordPayout("C", "2026-11-31", actor)).rejects.toMatchObject({ status: 400, message: "วันที่จ่ายไม่ถูกต้อง" });
    await expect(recordPayout("C", "2026-11-26", actor)).rejects.toMatchObject({ status: 400, message: "วันที่จ่ายต้องไม่เป็นวันในอนาคต" });
    expect(commissionMonth).not.toHaveBeenCalled();
  });

  it("only a customer PO", async () => {
    vi.mocked(query).mockImplementation(router([[/FROM acc_documents WHERE id = \? LIMIT 1/, () => [{ id: "X", docType: "INV", issueDate: "2026-11-20" }]]]) as never);
    await expect(recordPayout("X", "2026-11-25", actor)).rejects.toMatchObject({ status: 404, message: "ไม่พบ PO ลูกค้านี้" });
  });
});

describe("voidPayout", () => {
  const PAYOUT = { id: "pay1", salesOrderId: "C", voidedAt: null, paidDate: "2026-11-24" };
  beforeEach(() => {
    vi.mocked(query).mockImplementation(router([[/FROM acc_commission_payouts WHERE id = \? LIMIT 1/, () => [PAYOUT]]]) as never);
    conn.query.mockImplementation(
      router([
        [/FROM acc_documents WHERE id = \? FOR UPDATE/, () => [{ id: "C", customerPoNo: "PO-C" }]],
        [/FROM acc_commission_payouts WHERE id = \? FOR UPDATE/, () => [PAYOUT]],
      ])
    );
  });

  it("undone with the reason, as the admin who did it — the PO then the mark locked", async () => {
    await voidPayout("pay1", "  จ่ายผิดคน ", actor);
    const sql = conn.query.mock.calls.map(([s]) => String(s));
    expect(sql[0]).toMatch(/FROM acc_documents WHERE id = \? FOR UPDATE/);
    expect(sql[1]).toMatch(/FROM acc_commission_payouts WHERE id = \? FOR UPDATE/);
    expect(updates()).toHaveLength(1);
    expect(updates()[0][1]).toEqual([expect.any(String), "admin", "จ่ายผิดคน", "pay1"]);
    expect(writeAudit).toHaveBeenCalledWith(
      conn,
      expect.objectContaining({ action: "commission.payout.void", documentId: "C", docNo: "PO-C", detail: "ยกเลิกการบันทึกจ่ายค่าคอม (จ่ายเมื่อ 24 Nov 2026) · เหตุผล: จ่ายผิดคน" })
    );
  });

  it("needs a reason — before reading anything", async () => {
    await expect(voidPayout("pay1", "  ", actor)).rejects.toMatchObject({ status: 400, message: "กรุณาบอกเหตุผลที่ยกเลิกการบันทึกจ่าย" });
    await expect(voidPayout("pay1", null, actor)).rejects.toMatchObject({ status: 400 });
    expect(conn.query).not.toHaveBeenCalled();
  });

  it("once only; and only one that exists", async () => {
    conn.query.mockImplementation(
      router([
        [/FROM acc_documents WHERE id = \? FOR UPDATE/, () => [{ id: "C", customerPoNo: "PO-C" }]],
        [/FROM acc_commission_payouts WHERE id = \? FOR UPDATE/, () => [{ ...PAYOUT, voidedAt: "2026-11-24T10:00:00.000Z" }]],
      ])
    );
    await expect(voidPayout("pay1", "ซ้ำ", actor)).rejects.toMatchObject({ status: 409, message: "รายการนี้ยกเลิกไปแล้ว" });
    vi.mocked(query).mockImplementation(router([]) as never);
    await expect(voidPayout("nope", "ซ้ำ", actor)).rejects.toMatchObject({ status: 404, message: "ไม่พบรายการจ่ายค่าคอมนี้" });
    expect(updates()).toHaveLength(0);
  });
});

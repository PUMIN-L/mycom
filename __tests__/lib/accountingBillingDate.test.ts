// @vitest-environment node
//
// setInvoiceBillingDate — วันวางบิล on an invoice (the owner, 2026-11-23): the
// day the bill is to be handed to the customer. Internal (never printed), the
// CRM alert opens BILLING_REMINDER_LEAD_DAYS before it. Changeable on any
// invoice not cancelled; null clears it; every change is in the history.
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
import { setInvoiceBillingDate } from "@/app/lib/accounting/documents";

const actor = { userId: "admin-001", username: "admin" };
const LOCKED = { id: "d3", docType: "INV", status: "issued", docNo: "INV2026110033", issueDate: "2026-11-06", billingDate: null as string | null };

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
  // The document read back after the change.
  vi.mocked(query).mockImplementation(
    router([
      [/FROM acc_documents WHERE id = \?/, () => [{ ...LOCKED, billingDate: "2026-11-30" }]],
      [/FROM acc_document_lines/, () => []],
    ]) as never
  );
});

describe("setInvoiceBillingDate", () => {
  it("sets it, and the history says from what to what", async () => {
    locked();
    const doc = await setInvoiceBillingDate("d3", "2026-11-30", actor);
    expect(updates()).toHaveLength(1);
    // Not the document's content: its updatedAt (what a draft's save checks) is left alone.
    expect(updates()[0][0]).toBe("UPDATE acc_documents SET billingDate = ? WHERE id = ?");
    expect(updates()[0][1]).toEqual(["2026-11-30", "d3"]);
    expect(writeAudit).toHaveBeenCalledWith(
      conn,
      expect.objectContaining({ action: "doc.update", documentId: "d3", docNo: "INV2026110033", detail: "วันวางบิล — → 30 Nov 2026" })
    );
    expect(doc.billingDate).toBe("2026-11-30");
  });

  it("locks the invoice to change it", async () => {
    locked();
    await setInvoiceBillingDate("d3", "2026-11-30", actor);
    expect(String(conn.query.mock.calls[0][0])).toMatch(/FROM acc_documents WHERE id = \? .*FOR UPDATE/);
  });

  it("moves it, and clears it (null)", async () => {
    locked({ billingDate: "2026-11-30" });
    await setInvoiceBillingDate("d3", "2026-12-05", actor);
    expect(writeAudit).toHaveBeenLastCalledWith(conn, expect.objectContaining({ detail: "วันวางบิล 30 Nov 2026 → 5 Dec 2026" }));
    locked({ billingDate: "2026-12-05" });
    await setInvoiceBillingDate("d3", null, actor);
    expect(updates().at(-1)![1]).toEqual([null, "d3"]);
    expect(writeAudit).toHaveBeenLastCalledWith(conn, expect.objectContaining({ detail: "วันวางบิล 5 Dec 2026 → —" }));
  });

  it("writes nothing when it is already that day", async () => {
    locked({ billingDate: "2026-11-30" });
    await setInvoiceBillingDate("d3", "2026-11-30", actor);
    expect(updates()).toHaveLength(0);
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("refuses a day that is not a date — before reading anything", async () => {
    await expect(setInvoiceBillingDate("d3", "2026-13-01", actor)).rejects.toMatchObject({ status: 400, message: "วันวางบิลไม่ถูกต้อง" });
    expect(conn.query).not.toHaveBeenCalled();
  });

  it("refuses a day before the invoice's own date", async () => {
    locked();
    await expect(setInvoiceBillingDate("d3", "2026-11-05", actor)).rejects.toMatchObject({ status: 400, message: "วันวางบิลต้องไม่ก่อนวันที่ของใบแจ้งหนี้" });
    expect(updates()).toHaveLength(0);
  });

  it("only an invoice: anything else, or nothing, is not found", async () => {
    locked({ docType: "SO" });
    await expect(setInvoiceBillingDate("d3", "2026-11-30", actor)).rejects.toMatchObject({ status: 404 });
    conn.query.mockImplementation(router([]));
    await expect(setInvoiceBillingDate("nope", "2026-11-30", actor)).rejects.toMatchObject({ status: 404 });
    expect(updates()).toHaveLength(0);
  });

  it("not on a cancelled invoice", async () => {
    locked({ status: "void" });
    await expect(setInvoiceBillingDate("d3", "2026-11-30", actor)).rejects.toMatchObject({ status: 409, message: "ใบแจ้งหนี้นี้ยกเลิกแล้ว" });
    expect(updates()).toHaveLength(0);
  });
});

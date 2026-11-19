// @vitest-environment node
/**
 * Customer POs (lib/accounting/salesOrders.ts):
 *  • recorded as they are — no number of ours, never a tax invoice, nothing
 *    due, where the paper is kept — and never the same PO twice;
 *  • its lines change only while nothing is invoiced from it; its delivery
 *    date and notes, any time before it is cancelled;
 *  • cancelled with a reason — not once delivered in full;
 *  • read with what each still holds, ex VAT: the list, the dashboard's
 *    backlog (late first, then soonest due), one PO's deliveries.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const conn = { query: vi.fn() };
vi.mock("@/app/lib/db", () => ({
  query: vi.fn(),
  withTransaction: vi.fn(async (fn: (c: typeof conn) => Promise<unknown>) => fn(conn)),
}));
import { query, withTransaction } from "@/app/lib/db";
vi.mock("@/app/lib/salesDashboardStore", () => ({ prepareSaleWithLineItems: vi.fn(), insertPreparedSaleTx: vi.fn() }));
vi.mock("@/app/lib/accounting/settings", () => ({
  getSellerProfile: vi.fn(async () => ({ seller: {}, versionId: "v1" })),
  getVatRate: vi.fn(async () => 7),
}));
vi.mock("@/app/lib/accounting/audit", () => ({ writeAudit: vi.fn(async () => {}) }));
import { writeAudit } from "@/app/lib/accounting/audit";

import {
  cancelSalesOrder,
  createSalesOrder,
  listSalesOrders,
  orderBacklog,
  salesOrderDetail,
  updateSalesOrder,
  updateSalesOrderSchedule,
} from "@/app/lib/accounting/salesOrders";
import type { OrderInput } from "@/app/lib/accounting/orderRules";

const actor = { userId: "admin-001", username: "admin" };

type Handler = [RegExp, (params: unknown[]) => unknown];
function router(handlers: Handler[]) {
  return async (sql: string, params: unknown[] = []) => {
    for (const [pattern, answer] of handlers) if (pattern.test(sql)) return [answer(params), []];
    return [[], []];
  };
}
const statements = () => conn.query.mock.calls.map(([sql]) => String(sql));

const INPUT: OrderInput = {
  issueDate: "2026-11-10", creditDays: 30, companyId: "co1", customerId: "c1", salespersonId: "sp1",
  buyerName: "บริษัท เอ จำกัด", buyerAddress: "1 ถนนงามวงศ์วาน", buyerTaxId: "0107537000114", buyerBranch: "00000",
  priceMode: "exclusive", discountSatang: 0, isTaxInvoice: false, customerPoNo: "PO-6611", projectName: "โรงงานบางนา", note: "",
  lines: [{ lineType: "goods", productId: "p1", name: "เครื่องชั่ง", qty: 2, unit: "เครื่อง", unitPriceSatang: 5000000, discountSatang: 0, isMachine: true, serials: "", warrantyMonths: 12, sourceLineId: "" }],
  salesOrderId: "", expectedDeliveryDate: "2026-11-30", storageNote: "แฟ้ม PO ลูกค้า 2569",
};

const SO_ROW = {
  id: "so1", docType: "SO", docNo: null, status: "issued", source: "internal", externalNote: "แฟ้ม PO ลูกค้า 2569", isTaxInvoice: 0,
  issueDate: "2026-11-10", dueDate: null, expectedDeliveryDate: "2026-11-30", creditDays: 30, companyId: "co1", customerId: "c1", salespersonId: "sp1",
  buyerName: "บริษัท เอ จำกัด", buyerAddress: "1 ถนนงามวงศ์วาน", buyerTaxId: "0107537000114", buyerBranch: "00000",
  sellerVersionId: null, priceMode: "exclusive", vatRate: "7.00", subtotalSatang: 10000000, discountSatang: 0, depositSatang: 0,
  vatBaseSatang: 10000000, vatSatang: 700000, totalSatang: 10700000, paidSatang: 0, customerPoNo: "PO-6611", projectName: "โรงงานบางนา", note: "",
  quotationId: null, salesOrderId: null, relatedDocId: null, salesRecordId: null, issuedAt: "2026-11-10T03:00:00.000Z", issuedBy: "admin",
  voidedAt: null, voidReason: null, createdAt: "2026-11-10T03:00:00.000Z", createdBy: "admin", updatedAt: "2026-11-10T03:00:00.000Z",
};
const SO_LINE = {
  id: "a", sortOrder: 0, lineType: "goods", productId: "p1", name: "เครื่องชั่ง", qty: "2.00", unit: "เครื่อง",
  unitPriceSatang: 5000000, discountSatang: 0, amountSatang: 10000000, isMachine: 1, serials: "", warrantyMonths: 12, deliveredQty: "0.00", sourceLineId: null,
};
/** getAccDocument after a write: the PO as stored. */
const stored = (row: Record<string, unknown> = SO_ROW, lines: Record<string, unknown>[] = [SO_LINE]): Handler[] => [
  [/SELECT \* FROM acc_documents WHERE id = \? LIMIT 1/, () => [row]],
  [/SELECT \* FROM acc_document_lines WHERE documentId = \?/, () => lines],
];
/** The PO row lockOrder reads. */
const LOCKED = { id: "so1", docType: "SO", status: "issued", updatedAt: "2026-11-10T03:00:00.000Z", customerPoNo: "PO-6611", issueDate: "2026-11-10", expectedDeliveryDate: "2026-11-30" };

beforeEach(() => {
  vi.clearAllMocks();
  conn.query.mockReset();
  vi.mocked(query).mockReset();
});

describe("createSalesOrder", () => {
  it("records it as it is — no number of ours, not a tax invoice, nothing due, where the paper is kept — with its lines and an audit line", async () => {
    vi.mocked(query).mockImplementation(router(stored()) as never);
    conn.query.mockResolvedValue([{}, []]);
    const doc = await createSalesOrder(INPUT, actor);
    expect(doc.docType).toBe("SO");

    const insert = conn.query.mock.calls.find(([sql]) => String(sql).startsWith("INSERT INTO acc_documents"))!;
    const cols = String(insert[0]).match(/\(([^)]+)\) VALUES/)![1].split(", ");
    const at = (col: string) => (insert[1] as unknown[])[cols.indexOf(col)];
    expect(at("docType")).toBe("SO");
    expect(at("status")).toBe("issued");
    expect(at("isTaxInvoice")).toBe(0);
    expect(at("dueDate")).toBeNull();
    expect(at("salesOrderId")).toBeNull();
    expect(at("expectedDeliveryDate")).toBe("2026-11-30");
    expect(at("externalNote")).toBe("แฟ้ม PO ลูกค้า 2569");
    expect(at("customerPoNo")).toBe("PO-6611");
    expect(at("vatBaseSatang")).toBe(10000000);
    expect(at("totalSatang")).toBe(10700000);
    expect(cols).not.toContain("docNo"); // the customer's number is customerPoNo

    const lines = conn.query.mock.calls.find(([sql]) => String(sql).startsWith("INSERT INTO acc_document_lines"))!;
    const lineCols = String(lines[0]).match(/\(([^)]+)\) VALUES/)![1].split(", ");
    expect((lines[1] as unknown[])[lineCols.indexOf("sourceLineId")]).toBeNull();
    expect(writeAudit).toHaveBeenCalledWith(conn, expect.objectContaining({ action: "doc.create", docNo: "PO-6611", detail: expect.stringContaining("รับ PO ลูกค้า PO-6611") }));
  });

  it("refuses one without the customer's PO number, before anything is written", async () => {
    await expect(createSalesOrder({ ...INPUT, customerPoNo: "" }, actor)).rejects.toMatchObject({ status: 400, message: "กรุณากรอกเลขที่ PO ของลูกค้า" });
    expect(withTransaction).not.toHaveBeenCalled();
  });

  it("refuses one that comes to nothing", async () => {
    const free = { ...INPUT, lines: [{ ...INPUT.lines[0], unitPriceSatang: 0 }] };
    await expect(createSalesOrder(free, actor)).rejects.toMatchObject({ status: 400, message: "ยอดรวมต้องมากกว่า 0 บาท" });
  });

  it("refuses the same PO number of the same customer twice — one cancelled does not count", async () => {
    vi.mocked(query).mockImplementation(router([[/WHERE docType = 'SO' AND status <> 'void' AND customerPoNo = \?/, () => [{ id: "so0" }]]]) as never);
    await expect(createSalesOrder(INPUT, actor)).rejects.toMatchObject({ status: 409, message: "PO เลขที่ PO-6611 ของลูกค้านี้บันทึกไว้แล้ว" });
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(String(sql)).toContain("companyId = ?");
    expect(params).toEqual(["PO-6611", "co1"]);
    expect(withTransaction).not.toHaveBeenCalled();
  });

  it("knows a customer not in the list by name", async () => {
    vi.mocked(query).mockImplementation(router([[/customerPoNo = \?/, () => [{ id: "so0" }]]]) as never);
    await expect(createSalesOrder({ ...INPUT, companyId: "" }, actor)).rejects.toMatchObject({ status: 409 });
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(String(sql)).toContain("buyerName = ?");
    expect(params).toEqual(["PO-6611", "บริษัท เอ จำกัด"]);
  });
});

describe("updateSalesOrder", () => {
  const lockedDb = (over: Partial<typeof LOCKED> = {}, invoices = 0) =>
    conn.query.mockImplementation(router([
      [/SELECT id, docType, status, updatedAt, customerPoNo, issueDate, expectedDeliveryDate FROM acc_documents WHERE id = \? FOR UPDATE/, () => [{ ...LOCKED, ...over }]],
      [/SELECT COUNT\(\*\) AS n FROM acc_documents WHERE salesOrderId = \? FOR UPDATE/, () => [{ n: invoices }]],
    ]));

  it("saves over it, lines and all, while nothing is invoiced from it", async () => {
    lockedDb();
    vi.mocked(query).mockImplementation(router(stored()) as never);
    await updateSalesOrder("so1", { ...INPUT, expectedDeliveryDate: "2026-12-05" }, actor, LOCKED.updatedAt);
    const update = conn.query.mock.calls.find(([sql]) => String(sql).startsWith("UPDATE acc_documents SET"))!;
    expect(String(update[0])).toContain("expectedDeliveryDate = ?");
    expect(update[1]).toContain("2026-12-05");
    expect(statements()).toContain("DELETE FROM acc_document_lines WHERE documentId = ?");
    expect(writeAudit).toHaveBeenCalledWith(conn, expect.objectContaining({ action: "doc.update", documentId: "so1" }));
  });

  it("refuses once an invoice delivers from it — a draft too: its lines point at the PO's", async () => {
    lockedDb({}, 1);
    await expect(updateSalesOrder("so1", INPUT, actor)).rejects.toMatchObject({
      status: 409,
      message: "PO นี้มีใบแจ้งหนี้แล้ว — แก้รายการไม่ได้ แก้ได้เฉพาะกำหนดส่งและหมายเหตุ",
    });
    expect(statements().some((s) => s.startsWith("UPDATE"))).toBe(false);
  });

  it("refuses a save over a newer one from another tab", async () => {
    lockedDb({ updatedAt: "2026-11-11T00:00:00.000Z" });
    await expect(updateSalesOrder("so1", INPUT, actor, LOCKED.updatedAt)).rejects.toMatchObject({ status: 409 });
  });

  it("refuses a cancelled PO, and anything that is not one", async () => {
    lockedDb({ status: "void" });
    await expect(updateSalesOrder("so1", INPUT, actor)).rejects.toMatchObject({ status: 409, message: "PO นี้ถูกยกเลิกแล้ว" });
    lockedDb({ docType: "INV" });
    await expect(updateSalesOrder("so1", INPUT, actor)).rejects.toMatchObject({ status: 404 });
  });

  it("refuses to take another PO's number of the same customer", async () => {
    conn.query.mockImplementation(router([
      [/FOR UPDATE/, () => [LOCKED]],
      [/customerPoNo = \? AND companyId = \? AND id <> \?/, () => [{ id: "so0" }]],
    ]));
    // The count of invoices answers with the PO row (no `n`) → 0.
    await expect(updateSalesOrder("so1", INPUT, actor)).rejects.toMatchObject({ status: 409, message: expect.stringContaining("บันทึกไว้แล้ว") });
  });
});

describe("updateSalesOrderSchedule", () => {
  const lockedDb = (over: Partial<typeof LOCKED> = {}) => conn.query.mockImplementation(router([[/FOR UPDATE/, () => [{ ...LOCKED, ...over }]]]));
  const change = { expectedDeliveryDate: "2026-12-15", storageNote: "ตู้ 2", note: "ลูกค้าขอเลื่อน" };

  it("moves the delivery date, and the history says from when to when", async () => {
    lockedDb();
    vi.mocked(query).mockImplementation(router(stored()) as never);
    await updateSalesOrderSchedule("so1", change, actor);
    const update = conn.query.mock.calls.find(([sql]) => String(sql).startsWith("UPDATE"))!;
    expect(update[0]).toBe("UPDATE acc_documents SET expectedDeliveryDate = ?, externalNote = ?, note = ?, updatedAt = ? WHERE id = ?");
    expect(update[1]).toEqual(["2026-12-15", "ตู้ 2", "ลูกค้าขอเลื่อน", expect.any(String), "so1"]);
    expect(writeAudit).toHaveBeenCalledWith(conn, expect.objectContaining({ action: "doc.update", docNo: "PO-6611", detail: "เลื่อนกำหนดส่ง 30 Nov 2026 → 15 Dec 2026" }));
  });

  it("clears the date when none is given; notes alone say so", async () => {
    lockedDb();
    vi.mocked(query).mockImplementation(router(stored()) as never);
    await updateSalesOrderSchedule("so1", { ...change, expectedDeliveryDate: "" }, actor);
    expect(conn.query.mock.calls.find(([sql]) => String(sql).startsWith("UPDATE"))![1]).toEqual([null, "ตู้ 2", "ลูกค้าขอเลื่อน", expect.any(String), "so1"]);
    expect(writeAudit).toHaveBeenCalledWith(conn, expect.objectContaining({ detail: "เลื่อนกำหนดส่ง 30 Nov 2026 → —" }));

    lockedDb();
    await updateSalesOrderSchedule("so1", { ...change, expectedDeliveryDate: "2026-11-30" }, actor);
    expect(writeAudit).toHaveBeenLastCalledWith(conn, expect.objectContaining({ detail: "แก้หมายเหตุ / ที่เก็บ PO" }));
  });

  it("refuses a date that is not one, or one before the PO's own", async () => {
    await expect(updateSalesOrderSchedule("so1", { ...change, expectedDeliveryDate: "2026-02-30" }, actor)).rejects.toMatchObject({ status: 400, message: "กำหนดส่งไม่ถูกต้อง" });
    expect(withTransaction).not.toHaveBeenCalled();
    lockedDb();
    await expect(updateSalesOrderSchedule("so1", { ...change, expectedDeliveryDate: "2026-11-09" }, actor)).rejects.toMatchObject({ status: 400, message: "กำหนดส่งต้องไม่ก่อนวันที่ของ PO" });
  });

  it("refuses a storage note over 255 characters", async () => {
    await expect(updateSalesOrderSchedule("so1", { ...change, storageNote: "x".repeat(256) }, actor)).rejects.toMatchObject({ status: 400 });
  });
});

describe("cancelSalesOrder", () => {
  const cancelDb = (lines: { qty: string; deliveredQty: string }[], over: Partial<typeof LOCKED> = {}) =>
    conn.query.mockImplementation(router([
      [/SELECT id, docType, status/, () => [{ ...LOCKED, ...over }]],
      [/SELECT qty, deliveredQty FROM acc_document_lines WHERE documentId = \? FOR UPDATE/, () => lines],
    ]));

  it("cancels it with the reason, and takes nothing back from what was delivered", async () => {
    cancelDb([{ qty: "2.00", deliveredQty: "1.00" }]);
    vi.mocked(query).mockImplementation(router(stored()) as never);
    await cancelSalesOrder("so1", "  ลูกค้ายกเลิกส่วนที่เหลือ ", actor);
    const update = conn.query.mock.calls.find(([sql]) => String(sql).startsWith("UPDATE"))!;
    expect(update[0]).toBe("UPDATE acc_documents SET status = 'void', voidReason = ?, voidedAt = ?, voidedBy = ?, updatedAt = ? WHERE id = ?");
    expect(update[1]).toEqual(["ลูกค้ายกเลิกส่วนที่เหลือ", expect.any(String), "admin", expect.any(String), "so1"]);
    expect(statements().filter((s) => s.startsWith("UPDATE"))).toHaveLength(1); // its invoices untouched
    expect(writeAudit).toHaveBeenCalledWith(conn, expect.objectContaining({
      action: "doc.void",
      docNo: "PO-6611",
      detail: "ยกเลิก PO ลูกค้า (ส่วนที่ยังไม่ส่ง — ที่ส่งแล้วยังอยู่) · เหตุผล: ลูกค้ายกเลิกส่วนที่เหลือ",
    }));
  });

  it("refuses one delivered in full — there is nothing left to cancel", async () => {
    cancelDb([{ qty: "2.00", deliveredQty: "2.00" }]);
    await expect(cancelSalesOrder("so1", "เหตุผล", actor)).rejects.toMatchObject({ status: 409, message: "PO นี้ส่งครบแล้ว — ไม่มีส่วนที่เหลือให้ยกเลิก" });
    expect(statements().some((s) => s.startsWith("UPDATE"))).toBe(false);
  });

  it("asks for a reason, of at most 300 characters", async () => {
    await expect(cancelSalesOrder("so1", "  ", actor)).rejects.toMatchObject({ status: 400, message: "กรุณาบอกเหตุผลที่ยกเลิก" });
    await expect(cancelSalesOrder("so1", "x".repeat(301), actor)).rejects.toMatchObject({ status: 400 });
    expect(withTransaction).not.toHaveBeenCalled();
  });

  it("refuses one cancelled already", async () => {
    cancelDb([{ qty: "2.00", deliveredQty: "0.00" }], { status: "void" });
    await expect(cancelSalesOrder("so1", "ซ้ำ", actor)).rejects.toMatchObject({ status: 409, message: "PO นี้ถูกยกเลิกแล้ว" });
  });
});

describe("listSalesOrders", () => {
  it("keeps to the range, searches with % and _ taken literally, and says what each still holds", async () => {
    vi.mocked(query).mockImplementation(router([
      [/FROM acc_documents WHERE/, () => [{ ...SO_ROW }]],
      [/FROM acc_document_lines WHERE documentId IN/, () => [{ documentId: "so1", qty: "2.00", deliveredQty: "1.00", amountSatang: 10000000 }]],
    ]) as never);
    const [row] = await listSalesOrders({ from: "2026-11-01", to: "2026-12-01", q: "50%_", today: "2026-12-01" });
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(String(sql)).toContain("docType = 'SO'");
    expect(String(sql)).toContain("ESCAPE '!'");
    expect(params).toEqual(["2026-11-01", "2026-12-01", "%50!%!_%", "%50!%!_%", "%50!%!_%"]);
    expect(row).toMatchObject({ id: "so1", customerPoNo: "PO-6611", orderStatus: "partial", backlogSatang: 5000000, late: true });
  });
});

describe("orderBacklog", () => {
  it("lists every PO still holding something — late ones first, then the soonest due — with the totals", async () => {
    const po = (id: string, due: string | null, delivered: string, status = "issued") => ({ ...SO_ROW, id, customerPoNo: id, expectedDeliveryDate: due, status, _d: delivered });
    const rows = [po("later", "2026-12-20", "0.00"), po("done", "2026-11-01", "2.00"), po("late", "2026-11-15", "1.00"), po("soon", "2026-11-25", "0.00"), po("open", null, "0.00")];
    vi.mocked(query).mockImplementation(router([
      [/FROM acc_documents WHERE docType = 'SO' AND status = 'issued'/, () => rows],
      [/FROM acc_document_lines WHERE documentId IN/, () => rows.map((r) => ({ documentId: r.id, qty: "2.00", deliveredQty: r._d, amountSatang: 10000000 }))],
    ]) as never);
    const backlog = await orderBacklog("2026-11-19");
    expect(backlog.rows.map((r) => r.id)).toEqual(["late", "soon", "later", "open"]);
    expect(backlog.totals).toEqual({ backlogSatang: 35000000, count: 4, lateSatang: 5000000, lateCount: 1 });
    expect(backlog.today).toBe("2026-11-19");
  });
});

describe("salesOrderDetail", () => {
  it("is null for anything that is not a customer PO", async () => {
    vi.mocked(query).mockImplementation(router(stored({ ...SO_ROW, docType: "INV" })) as never);
    expect(await salesOrderDetail("so1")).toBeNull();
  });

  it("lists its invoices, drafts too, and the discounts only the ISSUED ones already carry", async () => {
    vi.mocked(query).mockImplementation(router([
      ...stored(SO_ROW, [{ ...SO_LINE, discountSatang: 30000, amountSatang: 9970000, deliveredQty: "1.00" }]),
      [/FROM acc_documents WHERE salesOrderId = \? AND docType = 'INV'/, () => [
        { id: "inv1", docNo: "INV2026110001", status: "issued", source: "internal", issueDate: "2026-11-12", totalSatang: 5333950, discountSatang: 2000 },
        { id: "inv2", docNo: null, status: "draft", source: "internal", issueDate: "2026-11-18", totalSatang: 5333950, discountSatang: 2000 },
      ]],
      [/SELECT sourceLineId, discountSatang FROM acc_document_lines WHERE documentId IN \(\?\)/, (params) => (params[0] === "inv1" ? [{ sourceLineId: "a", discountSatang: 15000 }] : [])],
    ]) as never);
    const detail = (await salesOrderDetail("so1"))!;
    expect(detail.orderStatus).toBe("partial");
    expect(detail.deliveries.map((d) => [d.id, d.status])).toEqual([["inv1", "issued"], ["inv2", "draft"]]);
    expect(detail.invoicedLineDiscounts).toEqual({ a: 15000 });
    expect(detail.invoicedBillDiscountSatang).toBe(2000);
    expect(detail.backlogSatang).toBe(5000000);
  });
});

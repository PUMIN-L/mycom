// @vitest-environment node
/**
 * Credit notes and refunds (lib/accounting/creditNotes.ts):
 *  • issued at once against an issued invoice (CN series), a tax document
 *    when the invoice was the tax invoice — checked again under the invoice's
 *    lock; the invoice's credited figures re-summed; the dashboard's sales
 *    lowered in the credit note's own month (a negative sale, same deal);
 *  • voided with a reason: its number kept, the invoice owes it again, its
 *    negative sale goes;
 *  • a refund: money handed back when credit notes took off more than was
 *    owed — a negative payment, never more than is due back.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const conn = { query: vi.fn() };
vi.mock("@/app/lib/db", () => ({
  query: vi.fn(),
  withTransaction: vi.fn(async (fn: (c: typeof conn) => Promise<unknown>) => fn(conn)),
}));
import { query } from "@/app/lib/db";
vi.mock("@/app/lib/accounting/documents", () => ({
  getAccDocument: vi.fn(),
  replaceLines: vi.fn(async () => {}),
  likeEscape: (s: string) => s.replace(/[!%_]/g, (c) => `!${c}`),
}));
import { getAccDocument, replaceLines } from "@/app/lib/accounting/documents";
vi.mock("@/app/lib/salesDashboardStore", () => ({ insertCreditSaleTx: vi.fn(async () => "credit-sale-1") }));
import { insertCreditSaleTx } from "@/app/lib/salesDashboardStore";
vi.mock("@/app/lib/accounting/settings", () => ({ getSellerProfile: vi.fn(async () => ({ seller: {}, versionId: "v1" })) }));
import { getSellerProfile } from "@/app/lib/accounting/settings";
vi.mock("@/app/lib/accounting/audit", () => ({ writeAudit: vi.fn(async () => {}) }));
import { writeAudit } from "@/app/lib/accounting/audit";
vi.mock("@/app/lib/accounting/numbering", () => ({ allocateDocNo: vi.fn(async () => "CN2026110001") }));
import { allocateDocNo } from "@/app/lib/accounting/numbering";
vi.mock("@/app/lib/accounting/paymentLedger", () => ({ recomputePaidSatang: vi.fn(async () => {}) }));
import { recomputePaidSatang } from "@/app/lib/accounting/paymentLedger";
vi.mock("@/app/lib/accounting/creditLedger", () => ({
  creditedOf: vi.fn(async () => ({ totalSatang: 0, vatSatang: 0, baseSatang: 0 })),
  recomputeCreditedTx: vi.fn(async () => {}),
}));
import { creditedOf, recomputeCreditedTx } from "@/app/lib/accounting/creditLedger";
vi.mock("@/app/lib/accounting/payments", () => ({
  assertBankAccountUsable: vi.fn(async () => {}),
  insertPaymentTx: vi.fn(async () => "pay-1"),
}));
import { assertBankAccountUsable, insertPaymentTx } from "@/app/lib/accounting/payments";

import { creditContext, issueCreditNote, listCreditNotes, recordRefund, voidCreditNote } from "@/app/lib/accounting/creditNotes";
import type { CreditNoteInput } from "@/app/lib/accounting/creditRules";

const actor = { userId: "admin-001", username: "admin" };

type Handler = [RegExp, (params: unknown[]) => unknown];
function router(handlers: Handler[]) {
  return async (sql: string, params: unknown[] = []) => {
    for (const [pattern, answer] of handlers) if (pattern.test(sql)) return [answer(params), []];
    return [[], []];
  };
}
const statements = () => conn.query.mock.calls.map(([sql]) => String(sql));
const inserted = () => {
  const call = conn.query.mock.calls.find(([sql]) => String(sql).startsWith("INSERT INTO acc_documents"))!;
  const cols = String(call[0]).match(/\(([^)]+)\) VALUES/)![1].split(", ");
  return (col: string) => (call[1] as unknown[])[cols.indexOf(col)];
};

const line = (over: Record<string, unknown> = {}) => ({
  lineType: "goods" as const,
  productId: "p1",
  name: "เครื่องวัดความดัน",
  qty: 1,
  unit: "เครื่อง",
  unitPriceSatang: 100000,
  discountSatang: 0,
  isMachine: false,
  serials: "",
  warrantyMonths: null,
  ...over,
});

/** 2 machines at 1,000.00 + VAT = 2,140.00, the tax invoice, of บริษัท เอ — unpaid. */
const INVOICE = {
  id: "inv1", docType: "INV", status: "issued", docNo: "INV2026110001", issueDate: "2026-11-01", isTaxInvoice: true, priceMode: "exclusive", vatRate: 7,
  subtotalSatang: 200000, vatBaseSatang: 200000, vatSatang: 14000, totalSatang: 214000, paidSatang: 0, creditedSatang: 0, companyId: "co1", customerId: "c1",
  salespersonId: "sp1", buyerName: "บริษัท เอ จำกัด", buyerAddress: "1 ถนนงามวงศ์วาน", buyerTaxId: "0107537000114", buyerBranch: "00000", customerPoNo: "PO-77",
  projectName: "", salesRecordId: "sale-1", lines: [line({ qty: 2 })],
};
const INPUT: CreditNoteInput = { invoiceId: "inv1", issueDate: "2026-11-19", reason: "รับคืนสินค้า เนื่องจากชำรุด", lines: [line()] };

/** The transaction's answers: the invoice under its lock, its live payments, its sale. */
const txDb = (over: { inv?: Record<string, unknown> | null; paid?: number; sale?: Record<string, unknown> | null } = {}) =>
  conn.query.mockImplementation(
    router([
      [/SELECT status, totalSatang, paidSatang, salesRecordId FROM acc_documents WHERE id = \? FOR UPDATE/, () => (over.inv === null ? [] : [{ status: "issued", totalSatang: 214000, paidSatang: 0, salesRecordId: "sale-1", ...over.inv }])],
      [/SUM\(amountSatang\), 0\) AS p FROM acc_payments WHERE documentId = \? AND voidedAt IS NULL FOR UPDATE/, () => [{ p: over.paid ?? 0 }]],
      [/SELECT id, dealId FROM sales_records WHERE id = \?/, () => (over.sale === null ? [] : [{ id: "sale-1", dealId: null, ...over.sale }])],
    ])
  );

beforeEach(() => {
  vi.clearAllMocks();
  conn.query.mockReset();
  vi.mocked(query).mockReset();
  vi.mocked(query).mockImplementation(router([[/FROM products WHERE id IN/, () => [{ id: "p1", categoryId: 4 }]]]) as never);
  vi.mocked(getSellerProfile).mockResolvedValue({ seller: {} as never, versionId: "v1" });
  vi.mocked(creditedOf).mockResolvedValue({ totalSatang: 0, vatSatang: 0, baseSatang: 0 });
  vi.mocked(getAccDocument).mockImplementation(async (id: string) => (id === "inv1" ? (INVOICE as never) : ({ id, docType: "CN" } as never)));
});

describe("creditContext", () => {
  it("is null for anything but an issued invoice", async () => {
    vi.mocked(getAccDocument).mockResolvedValueOnce(null);
    expect(await creditContext("x")).toBeNull();
    vi.mocked(getAccDocument).mockResolvedValueOnce({ ...INVOICE, docType: "RE" } as never);
    expect(await creditContext("x")).toBeNull();
    vi.mocked(getAccDocument).mockResolvedValueOnce({ ...INVOICE, status: "draft" } as never);
    expect(await creditContext("x")).toBeNull();
  });

  it("gives the invoice as the rules see it, its credit notes oldest first, and what is due back", async () => {
    vi.mocked(creditedOf).mockResolvedValue({ totalSatang: 107000, vatSatang: 7000, baseSatang: 100000 });
    vi.mocked(getAccDocument).mockResolvedValue({ ...INVOICE, paidSatang: 214000 } as never);
    vi.mocked(query).mockImplementation(router([[/docType = 'CN' ORDER BY issueDate ASC/, () => [{ id: "cn1", docNo: "CN2026110001", status: "issued", issueDate: "2026-11-10", totalSatang: "107000" }]]]) as never);
    const ctx = (await creditContext("inv1"))!;
    expect(creditedOf).toHaveBeenCalledWith(null, "inv1");
    expect(ctx.credit).toMatchObject({ totalSatang: 214000, creditedSatang: 107000, creditedBaseSatang: 100000, paidSatang: 214000, isTaxInvoice: true });
    expect(ctx.creditNotes).toEqual([{ id: "cn1", docNo: "CN2026110001", status: "issued", issueDate: "2026-11-10", totalSatang: 107000 }]);
    expect(ctx.refundDueSatang).toBe(107000);
  });

  it("does not read the invoice again when the caller has it", async () => {
    vi.mocked(query).mockImplementation(router([]) as never);
    await creditContext("inv1", INVOICE as never);
    expect(getAccDocument).not.toHaveBeenCalled();
  });
});

describe("issueCreditNote", () => {
  it("refuses what is not an issued invoice", async () => {
    vi.mocked(getAccDocument).mockResolvedValueOnce(null);
    await expect(issueCreditNote(INPUT, actor)).rejects.toMatchObject({ status: 404, message: "ไม่พบใบแจ้งหนี้นี้" });
    vi.mocked(getAccDocument).mockResolvedValueOnce({ ...INVOICE, status: "void" } as never);
    await expect(issueCreditNote(INPUT, actor)).rejects.toMatchObject({ status: 409, message: "ใบแจ้งหนี้นี้ถูกยกเลิกแล้ว — ออกใบลดหนี้ไม่ได้" });
    vi.mocked(getAccDocument).mockResolvedValueOnce({ ...INVOICE, status: "draft" } as never);
    await expect(issueCreditNote(INPUT, actor)).rejects.toMatchObject({ status: 409, message: "ออกใบแจ้งหนี้ก่อนจึงจะลดหนี้ได้" });
    expect(conn.query).not.toHaveBeenCalled();
  });

  it("says what is wrong before touching anything", async () => {
    await expect(issueCreditNote({ ...INPUT, reason: "" }, actor)).rejects.toMatchObject({ status: 400, message: "กรุณาระบุเหตุที่ลดหนี้" });
    expect(conn.query).not.toHaveBeenCalled();
  });

  it("needs the company's details to print", async () => {
    vi.mocked(getSellerProfile).mockResolvedValue({ seller: {} as never, versionId: null as never });
    await expect(issueCreditNote(INPUT, actor)).rejects.toMatchObject({ status: 409 });
    expect(conn.query).not.toHaveBeenCalled();
  });

  it("issues it in one transaction: the invoice locked first, numbered, its lines, the invoice's credit re-summed", async () => {
    txDb();
    await issueCreditNote(INPUT, actor);
    expect(statements()[0]).toMatch(/FROM acc_documents WHERE id = \? FOR UPDATE/);
    expect(creditedOf).toHaveBeenCalledWith(conn, "inv1");
    expect(allocateDocNo).toHaveBeenCalledWith(conn, "CN", "2026-11-19");
    const row = inserted();
    expect(row("docType")).toBe("CN");
    expect(row("docNo")).toBe("CN2026110001");
    expect(row("status")).toBe("issued");
    expect(row("isTaxInvoice")).toBe(1);
    expect(row("relatedDocId")).toBe("inv1");
    expect(row("note")).toBe("รับคืนสินค้า เนื่องจากชำรุด");
    expect(row("sellerVersionId")).toBe("v1");
    expect(row("buyerName")).toBe("บริษัท เอ จำกัด");
    expect([row("vatBaseSatang"), row("vatSatang"), row("totalSatang")]).toEqual([100000, 7000, 107000]);
    expect(row("refValueSatang")).toBe(200000);
    expect(replaceLines).toHaveBeenCalledWith(conn, expect.any(String), INPUT.lines);
    expect(recomputeCreditedTx).toHaveBeenCalledWith(conn, "inv1");
    const audits = vi.mocked(writeAudit).mock.calls.map(([, a]) => [a.action, a.docNo, a.detail]);
    expect(audits[0]).toEqual(["doc.issue", "CN2026110001", expect.stringContaining("ออกใบลดหนี้ · บริษัท เอ จำกัด · 1,070.00 บาท · ของใบแจ้งหนี้ INV2026110001")]);
    expect(audits[1]).toEqual(["doc.update", "INV2026110001", "ลดหนี้ 1,070.00 บาท (ใบลดหนี้ CN2026110001)"]);
  });

  it("prints the value it was set against less what earlier credit notes took", async () => {
    vi.mocked(creditedOf).mockResolvedValue({ totalSatang: 53500, vatSatang: 3500, baseSatang: 50000 });
    txDb();
    await issueCreditNote(INPUT, actor);
    expect(inserted()("refValueSatang")).toBe(150000);
  });

  it("lowers the dashboard's sales in its own month — a negative sale in the invoice sale's deal", async () => {
    txDb();
    await issueCreditNote(INPUT, actor);
    expect(insertCreditSaleTx).toHaveBeenCalledWith(conn, {
      saleDate: "2026-11-19",
      dealId: "sale-1",
      salespersonId: "sp1",
      customerId: "c1",
      companyId: "co1",
      saleType: "equipment",
      poRef: "PO-77",
      invoiceRef: "CN2026110001",
      note: "ใบลดหนี้ CN2026110001 ของใบแจ้งหนี้ INV2026110001",
      // Goods taken back: the quantity sold goes down too.
      lines: [{ productId: "p1", productName: "เครื่องวัดความดัน", categoryId: 4, qty: -1, totalAmount: -1000 }],
    });
    expect(conn.query).toHaveBeenCalledWith("UPDATE acc_documents SET salesRecordId = ? WHERE id = ?", ["credit-sale-1", expect.any(String)]);
  });

  it("joins the deal the invoice's sale is already in, and shares the value over the lines as an invoice's sale is", async () => {
    txDb({ sale: { dealId: "deal-9" } });
    await issueCreditNote({ ...INPUT, lines: [line({ unitPriceSatang: 60000 }), line({ productId: "", name: "ค่าติดตั้ง", lineType: "service", unitPriceSatang: 40000 })] }, actor);
    const call = vi.mocked(insertCreditSaleTx).mock.calls[0][1];
    expect(call.dealId).toBe("deal-9");
    expect(call.lines.map((l) => [l.productName, l.categoryId, l.qty, l.totalAmount])).toEqual([["เครื่องวัดความดัน", 4, -1, -600], ["ค่าติดตั้ง", null, 0, -400]]);
  });

  it("a price cut takes value off the dashboard, not quantity", async () => {
    txDb();
    await issueCreditNote({ ...INPUT, reason: "ลดราคาสินค้า เนื่องจากผิดข้อกำหนด / ชำรุด / ขาดจำนวน" }, actor);
    expect(vi.mocked(insertCreditSaleTx).mock.calls[0][1].lines).toEqual([{ productId: "p1", productName: "เครื่องวัดความดัน", categoryId: 4, qty: 0, totalAmount: -1000 }]);
  });

  it("writes no sale when the invoice's own sale is gone", async () => {
    txDb({ sale: null });
    await issueCreditNote(INPUT, actor);
    expect(insertCreditSaleTx).not.toHaveBeenCalled();
    expect(recomputeCreditedTx).toHaveBeenCalled();
  });

  it("refuses when the invoice was voided while the form was open", async () => {
    txDb({ inv: { status: "void" } });
    await expect(issueCreditNote(INPUT, actor)).rejects.toMatchObject({ status: 409, message: "ใบแจ้งหนี้นี้เปลี่ยนไปแล้ว — กรุณาเปิดหน้านี้ใหม่" });
    expect(allocateDocNo).not.toHaveBeenCalled();
  });

  it("checks again with what was paid meanwhile — read under the lock", async () => {
    vi.mocked(getAccDocument).mockResolvedValue({ ...INVOICE, isTaxInvoice: false } as never);
    txDb({ paid: 150000 });
    await expect(issueCreditNote(INPUT, actor)).rejects.toMatchObject({ status: 409, message: "ใบแจ้งหนี้นี้ไม่ใช่ใบกำกับภาษี — ลดได้ไม่เกินยอดที่ยังค้าง 640.00 บาท" });
    expect(allocateDocNo).not.toHaveBeenCalled();
  });
});

describe("voidCreditNote", () => {
  const voidDb = (cn: Record<string, unknown> | null = {}) =>
    conn.query.mockImplementation(
      router([
        [/SELECT relatedDocId FROM acc_documents WHERE id = \?$/, () => (cn === null ? [] : [{ relatedDocId: "inv1" }])],
        [/SELECT id, docNo FROM acc_documents WHERE id = \? FOR UPDATE/, () => [{ id: "inv1", docNo: "INV2026110001" }]],
        [/SELECT docType, status, docNo, salesRecordId, totalSatang FROM acc_documents WHERE id = \? FOR UPDATE/, () => [{ docType: "CN", status: "issued", docNo: "CN2026110001", salesRecordId: "credit-sale-1", totalSatang: 107000, ...cn }]],
      ])
    );

  it("asks why, within its length — before anything is locked", async () => {
    await expect(voidCreditNote("cn1", "  ", actor)).rejects.toMatchObject({ status: 400, message: "กรุณาบอกเหตุผลที่ยกเลิก" });
    await expect(voidCreditNote("cn1", "ก".repeat(301), actor)).rejects.toMatchObject({ status: 400 });
    expect(conn.query).not.toHaveBeenCalled();
  });

  it("refuses what is not a live credit note", async () => {
    voidDb(null);
    await expect(voidCreditNote("cn1", "ออกผิด", actor)).rejects.toMatchObject({ status: 404 });
    voidDb({ docType: "RE" });
    await expect(voidCreditNote("cn1", "ออกผิด", actor)).rejects.toMatchObject({ status: 404 });
    voidDb({ status: "void" });
    await expect(voidCreditNote("cn1", "ออกผิด", actor)).rejects.toMatchObject({ status: 409, message: "ใบลดหนี้นี้ถูกยกเลิกไปแล้ว" });
  });

  it("locks the invoice first, keeps the number marked void, removes its negative sale and gives the invoice its value back", async () => {
    voidDb();
    await voidCreditNote("cn1", "ออกผิดใบ", actor);
    const sql = statements();
    expect(sql.findIndex((s) => s.startsWith("SELECT id, docNo FROM acc_documents"))).toBeLessThan(sql.findIndex((s) => s.startsWith("SELECT docType, status")));
    expect(conn.query).toHaveBeenCalledWith(expect.stringContaining("SET status = 'void', voidReason = ?"), ["ออกผิดใบ", expect.any(String), "admin", expect.any(String), "cn1"]);
    expect(sql.find((s) => s.includes("SET status = 'void'"))).toContain("salesRecordId = NULL");
    expect(conn.query).toHaveBeenCalledWith("DELETE FROM sales_record_items WHERE salesRecordId = ?", ["credit-sale-1"]);
    expect(conn.query).toHaveBeenCalledWith("DELETE FROM sales_records WHERE id = ?", ["credit-sale-1"]);
    expect(recomputeCreditedTx).toHaveBeenCalledWith(conn, "inv1");
    const audits = vi.mocked(writeAudit).mock.calls.map(([, a]) => [a.action, a.docNo, a.detail]);
    expect(audits).toEqual([
      ["doc.void", "CN2026110001", "ยกเลิกใบลดหนี้ · เหตุผล: ออกผิดใบ"],
      ["doc.update", "INV2026110001", "ยกเลิกใบลดหนี้ CN2026110001 — 1,070.00 บาท กลับเป็นยอดของใบนี้ · เหตุผล: ออกผิดใบ"],
    ]);
  });

  it("has no sale to remove when it never wrote one", async () => {
    voidDb({ salesRecordId: null });
    await voidCreditNote("cn1", "ออกผิดใบ", actor);
    expect(statements().some((s) => s.startsWith("DELETE FROM sales_records"))).toBe(false);
  });
});

describe("listCreditNotes", () => {
  it("lists in the range and matching the search, newest first, each with its invoice", async () => {
    vi.mocked(query).mockImplementation(router([[/FROM acc_documents d LEFT JOIN acc_documents i/, () => [
      { id: "cn1", docNo: "CN2026110001", status: "issued", issueDate: "2026-11-19", buyerName: "บริษัท เอ จำกัด", totalSatang: "107000", relatedDocId: "inv1", note: "รับคืน", invoiceNo: "INV2026110001" },
    ]]]) as never);
    const rows = await listCreditNotes({ from: "2026-11-01", to: "2026-12-01", q: "50%" });
    expect(rows).toEqual([{ id: "cn1", docNo: "CN2026110001", status: "issued", issueDate: "2026-11-19", buyerName: "บริษัท เอ จำกัด", totalSatang: 107000, invoiceId: "inv1", invoiceNo: "INV2026110001", reason: "รับคืน" }]);
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(String(sql)).toContain("d.docType = 'CN'");
    expect(String(sql)).toContain("ORDER BY d.issueDate DESC");
    expect(params).toEqual(["2026-11-01", "2026-12-01", "%50!%%", "%50!%%", "%50!%%"]);
  });

  it("lists all of them when nothing narrows it", async () => {
    vi.mocked(query).mockImplementation(router([]) as never);
    expect(await listCreditNotes({})).toEqual([]);
    expect(vi.mocked(query).mock.calls[0][1]).toEqual([]);
  });
});

describe("recordRefund", () => {
  const REFUND = { paidDate: "2026-11-10", method: "transfer" as const, bankAccountId: "bank1", amountSatang: 107000, note: "" };
  const refundDb = (inv: Record<string, unknown> | null = {}, paid = 214000) =>
    conn.query.mockImplementation(
      router([
        [/SELECT docType, status, docNo, totalSatang, creditedSatang FROM acc_documents WHERE id = \? FOR UPDATE/, () => (inv === null ? [] : [{ docType: "INV", status: "issued", docNo: "INV2026110001", totalSatang: 214000, creditedSatang: 107000, ...inv }])],
        [/AS p FROM acc_payments WHERE documentId = \? AND voidedAt IS NULL FOR UPDATE/, () => [{ p: paid }]],
      ])
    );

  it("checks the date, the amount and the note before anything", async () => {
    await expect(recordRefund("inv1", { ...REFUND, paidDate: "19/11/2026" }, actor)).rejects.toMatchObject({ status: 400, message: "วันที่คืนเงินไม่ถูกต้อง" });
    await expect(recordRefund("inv1", { ...REFUND, paidDate: "2999-01-01" }, actor)).rejects.toMatchObject({ status: 400 });
    await expect(recordRefund("inv1", { ...REFUND, amountSatang: 0 }, actor)).rejects.toMatchObject({ status: 400, message: "กรุณากรอกยอดที่คืน" });
    await expect(recordRefund("inv1", { ...REFUND, note: "ก".repeat(501) }, actor)).rejects.toMatchObject({ status: 400 });
    expect(conn.query).not.toHaveBeenCalled();
  });

  it("refuses an account that is not ours or no longer used", async () => {
    vi.mocked(assertBankAccountUsable).mockRejectedValueOnce(Object.assign(new Error("บัญชีนี้ปิดใช้งานแล้ว"), { status: 400 }));
    await expect(recordRefund("inv1", REFUND, actor)).rejects.toThrow("บัญชีนี้ปิดใช้งานแล้ว");
    expect(conn.query).not.toHaveBeenCalled();
  });

  it("refuses anything but an invoice", async () => {
    refundDb(null);
    await expect(recordRefund("inv1", REFUND, actor)).rejects.toMatchObject({ status: 404 });
  });

  it("never hands back more than is due — read under the invoice's lock", async () => {
    refundDb({}, 214000);
    await expect(recordRefund("inv1", { ...REFUND, amountSatang: 107001 }, actor)).rejects.toMatchObject({ status: 409, message: "คืนเงินเกินยอดที่ต้องคืน — ต้องคืน 1,070.00 บาท" });
    refundDb({}, 107000);
    await expect(recordRefund("inv1", REFUND, actor)).rejects.toMatchObject({ status: 409, message: "ใบนี้ไม่มียอดที่ต้องคืนเงินลูกค้า" });
    expect(insertPaymentTx).not.toHaveBeenCalled();
  });

  it("records a negative payment with no receipt and no VAT, then re-sums what the invoice was paid", async () => {
    refundDb();
    await recordRefund("inv1", REFUND, actor);
    expect(statements()[0]).toContain("FOR UPDATE");
    expect(insertPaymentTx).toHaveBeenCalledWith(conn, {
      documentId: "inv1",
      receiptId: null,
      input: expect.objectContaining({ paidDate: "2026-11-10", method: "transfer", bankAccountId: "bank1", amountSatang: -107000, whtSatang: 0, feeSatang: 0, note: "คืนเงินลูกค้า" }),
      actor,
      now: expect.any(String),
      vatSatang: 0,
    });
    expect(recomputePaidSatang).toHaveBeenCalledWith(conn, "inv1");
    const [, audit] = vi.mocked(writeAudit).mock.calls[0];
    expect(audit).toMatchObject({ action: "payment.create", documentId: "inv1", docNo: "INV2026110001" });
    expect(audit.detail).toContain("คืนเงินลูกค้า 1,070.00 บาท");
  });

  it("a cash refund names no bank account", async () => {
    refundDb();
    await recordRefund("inv1", { ...REFUND, method: "cash", note: "คืนเงินสดที่สำนักงาน" }, actor);
    expect(vi.mocked(insertPaymentTx).mock.calls[0][1].input).toMatchObject({ bankAccountId: "", note: "คืนเงินสดที่สำนักงาน" });
  });
});

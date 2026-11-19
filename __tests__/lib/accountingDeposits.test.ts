// @vitest-environment node
/**
 * Deposits against a customer PO (lib/accounting/deposits.ts, depositLedger.ts):
 *  • a deposit is ALWAYS our ใบเสร็จรับเงิน/ใบกำกับภาษี, its VAT taken out of
 *    the amount paid, pointing at the PO; the payment's document is the PO;
 *  • never more than the PO still holds before VAT (with the deposits not yet
 *    deducted) — checked again under the PO's lock, PO locked first;
 *  • the ledger is sums of what is there: live deposits (their receipts'
 *    before-VAT amounts), what issued invoices deducted — locking reads
 *    inside a transaction;
 *  • a deposit the invoices lean on cannot go.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const conn = { query: vi.fn() };
vi.mock("@/app/lib/db", () => ({
  query: vi.fn(),
  withTransaction: vi.fn(async (fn: (c: typeof conn) => Promise<unknown>) => fn(conn)),
}));
import { query, withTransaction } from "@/app/lib/db";
vi.mock("@/app/lib/accounting/documents", () => ({ getAccDocument: vi.fn() }));
import { getAccDocument } from "@/app/lib/accounting/documents";
vi.mock("@/app/lib/accounting/settings", () => ({ getSellerProfile: vi.fn(async () => ({ seller: {}, versionId: "v1" })) }));
import { getSellerProfile } from "@/app/lib/accounting/settings";
vi.mock("@/app/lib/accounting/audit", () => ({ writeAudit: vi.fn(async () => {}) }));
import { writeAudit } from "@/app/lib/accounting/audit";
vi.mock("@/app/lib/accounting/numbering", () => ({ allocateDocNo: vi.fn(async () => "RE2026110007") }));
import { allocateDocNo } from "@/app/lib/accounting/numbering";

import { depositContext, recordDeposit } from "@/app/lib/accounting/deposits";
import { assertDepositNotDeductedTx, depositDeductionProblem, depositLedgerOf } from "@/app/lib/accounting/depositLedger";
import type { PaymentInput } from "@/app/lib/accounting/paymentRules";

const actor = { userId: "admin-001", username: "admin" };

type Handler = [RegExp, (params: unknown[]) => unknown];
function router(handlers: Handler[]) {
  return async (sql: string, params: unknown[] = []) => {
    for (const [pattern, answer] of handlers) if (pattern.test(sql)) return [answer(params), []];
    return [[], []];
  };
}
const statements = () => conn.query.mock.calls.map(([sql]) => String(sql));
const insertOf = (table: string) => {
  const call = conn.query.mock.calls.find(([sql]) => String(sql).startsWith(`INSERT INTO ${table}`))!;
  const cols = String(call[0]).match(/\(([^)]+)\) VALUES/)![1].split(", ");
  return (col: string) => (call[1] as unknown[])[cols.indexOf(col)];
};

/** PO-6611: 10 scales × 10,000.00 = 100,000.00 before VAT, 107,000.00 with it; one delivered. */
const ORDER = {
  id: "so1", docType: "SO", status: "issued", customerPoNo: "PO-6611", companyId: "co1", customerId: "c1", salespersonId: "",
  buyerName: "บริษัท เอ จำกัด", buyerAddress: "1 ถนนงามวงศ์วาน", buyerTaxId: "0107537000114", buyerBranch: "00000",
  vatRate: 7, vatBaseSatang: 10000000, totalSatang: 10700000, projectName: "", issueDate: "2026-11-10",
  lines: [{ id: "a", lineType: "goods", qty: 10, deliveredQty: 1, amountSatang: 10000000, unitPriceSatang: 1000000, discountSatang: 0 }],
};
const INPUT: PaymentInput = {
  paidDate: "2026-11-18", method: "transfer", bankAccountId: "", amountSatang: 3210000, whtPercent: 0, whtSatang: 0, feeSatang: 0,
  cert50Received: false, cert50Note: "", externalReceiptNo: "", note: "",
};

/** The ledger: deposits (each with its receipt's before-VAT amount) and what issued invoices deducted. */
const ledgerDb = (deposits: { id: string; amount: number; receiptId: string | null; exVat?: number }[], deducted = 0): Handler[] => [
  [/SELECT id, amountSatang, receiptId FROM acc_payments WHERE documentId = \? AND voidedAt IS NULL/, () => deposits.map((d) => ({ id: d.id, amountSatang: d.amount, receiptId: d.receiptId }))],
  [/SELECT id, vatBaseSatang FROM acc_documents WHERE id IN/, () => deposits.filter((d) => d.receiptId).map((d) => ({ id: d.receiptId, vatBaseSatang: d.exVat }))],
  [/COALESCE\(SUM\(depositSatang\), 0\) AS d FROM acc_documents WHERE salesOrderId = \?/, () => [{ d: deducted }]],
];

beforeEach(() => {
  vi.clearAllMocks();
  conn.query.mockReset();
  vi.mocked(query).mockReset();
  vi.mocked(getAccDocument).mockResolvedValue(ORDER as never);
  vi.mocked(getSellerProfile).mockResolvedValue({ seller: {} as never, versionId: "v1" });
});

describe("depositLedgerOf", () => {
  it("sums the live deposits — before VAT from their receipts — and what issued invoices deducted", async () => {
    vi.mocked(query).mockImplementation(router(ledgerDb([{ id: "p1", amount: 3210000, receiptId: "re1", exVat: 3000000 }, { id: "p2", amount: 107, receiptId: null }], 1000000)) as never);
    expect(await depositLedgerOf(null, "so1", 7)).toEqual({ receivedSatang: 3210107, receivedExVatSatang: 3000100, deductedSatang: 1000000 });
    // Plain reads outside a transaction.
    expect(vi.mocked(query).mock.calls.some(([sql]) => String(sql).includes("FOR UPDATE"))).toBe(false);
  });

  it("reads with locks inside a transaction, leaving the invoice being checked out of what was deducted", async () => {
    conn.query.mockImplementation(router(ledgerDb([{ id: "p1", amount: 3210000, receiptId: "re1", exVat: 3000000 }])));
    await depositLedgerOf(conn, "so1", 7, "inv9");
    expect(statements().every((s) => s.endsWith("FOR UPDATE"))).toBe(true);
    const deducted = conn.query.mock.calls.find(([sql]) => String(sql).includes("SUM(depositSatang)"))!;
    expect(String(deducted[0])).toContain("AND id <> ?");
    expect(deducted[1]).toEqual(["so1", "inv9"]);
  });
});

describe("depositDeductionProblem / assertDepositNotDeductedTx", () => {
  it("lets an invoice deduct no more than is left of the deposits", async () => {
    vi.mocked(query).mockImplementation(router(ledgerDb([{ id: "p1", amount: 3210000, receiptId: "re1", exVat: 3000000 }], 1000000)) as never);
    expect(await depositDeductionProblem(null, "so1", 7, 2000000, "inv9")).toBeNull();
    expect(await depositDeductionProblem(null, "so1", 7, 2000001, "inv9")).toBe("หักมัดจำเกินมัดจำที่เหลือ — เหลือ 20,000.00 บาท (ก่อน VAT)");
    expect(await depositDeductionProblem(null, "so1", 7, 0, "inv9")).toBeNull();
  });

  it("says when nothing is left to deduct", async () => {
    vi.mocked(query).mockImplementation(router(ledgerDb([], 0)) as never);
    expect(await depositDeductionProblem(null, "so1", 7, 1, null)).toBe("PO นี้ไม่มีมัดจำเหลือให้หักแล้ว");
  });

  it("will not let a deposit go while the invoices lean on it", async () => {
    conn.query.mockImplementation(router(ledgerDb([{ id: "p1", amount: 3210000, receiptId: "re1", exVat: 3000000 }, { id: "p2", amount: 1070000, receiptId: "re2", exVat: 1000000 }], 3500000)));
    await expect(assertDepositNotDeductedTx(conn, "so1", 7, 1000000)).rejects.toMatchObject({ status: 409, message: expect.stringContaining("ลบใบแจ้งหนี้ที่หักมัดจำก่อน") });
    conn.query.mockImplementation(router(ledgerDb([{ id: "p1", amount: 3210000, receiptId: "re1", exVat: 3000000 }, { id: "p2", amount: 1070000, receiptId: "re2", exVat: 1000000 }], 3000000)));
    await expect(assertDepositNotDeductedTx(conn, "so1", 7, 1000000)).resolves.toBeUndefined();
  });
});

describe("depositContext", () => {
  it("is the most a new deposit may be, what was deducted and is left, and the customer's usual withholding", async () => {
    vi.mocked(query).mockImplementation(router([
      ...ledgerDb([{ id: "p1", amount: 3210000, receiptId: "re1", exVat: 3000000 }], 1000000),
      [/SELECT whtPercent FROM companies/, () => [{ whtPercent: "3.00" }]],
    ]) as never);
    // 9 of 10 left → 90,000.00 held; 20,000.00 of deposit not yet deducted → room 70,000.00 + VAT
    expect(await depositContext("so1")).toMatchObject({
      outstandingSatang: 7490000,
      receivedSatang: 3210000,
      receivedExVatSatang: 3000000,
      deductedSatang: 1000000,
      leftSatang: 2000000,
      defaultWhtPercent: 3,
      receiptIsTaxInvoice: true,
      serviceBaseSatang: 0,
    });
  });

  it("takes no more deposits on a PO cancelled or delivered in full; is null for anything not a PO", async () => {
    vi.mocked(query).mockImplementation(router(ledgerDb([])) as never);
    vi.mocked(getAccDocument).mockResolvedValueOnce({ ...ORDER, status: "void" } as never);
    expect((await depositContext("so1"))!.outstandingSatang).toBe(0);
    vi.mocked(getAccDocument).mockResolvedValueOnce({ ...ORDER, lines: [{ ...ORDER.lines[0], deliveredQty: 10 }] } as never);
    expect((await depositContext("so1"))!.outstandingSatang).toBe(0);
    vi.mocked(getAccDocument).mockResolvedValueOnce({ ...ORDER, docType: "INV" } as never);
    expect(await depositContext("so1")).toBeNull();
  });
});

describe("recordDeposit", () => {
  const lockedDb = (lines = [{ qty: "10.00", deliveredQty: "1.00", amountSatang: 10000000 }], deposits: Parameters<typeof ledgerDb>[0] = []) =>
    conn.query.mockImplementation(router([
      [/SELECT status, vatRate, vatBaseSatang FROM acc_documents WHERE id = \? FOR UPDATE/, () => [{ status: "issued", vatRate: "7.00", vatBaseSatang: 10000000 }]],
      [/SELECT qty, deliveredQty, amountSatang FROM acc_document_lines WHERE documentId = \? FOR UPDATE/, () => lines],
      ...ledgerDb(deposits),
      [/COALESCE\(SUM\(amountSatang\), 0\) AS paid/, () => [{ paid: 3210000 }]],
    ]));
  beforeEach(() => {
    vi.mocked(query).mockImplementation(router(ledgerDb([])) as never);
  });

  it("issues a ใบเสร็จรับเงิน/ใบกำกับภาษี for it — VAT taken out of what was paid — pointing at the PO, in one transaction, PO locked first", async () => {
    lockedDb();
    const result = await recordDeposit("so1", INPUT, actor);
    expect(statements()[0]).toBe("SELECT status, vatRate, vatBaseSatang FROM acc_documents WHERE id = ? FOR UPDATE");
    const receipt = insertOf("acc_documents");
    expect(receipt("docType")).toBe("RE");
    expect(receipt("docNo")).toBe("RE2026110007");
    expect(receipt("isTaxInvoice")).toBe(1);
    expect(receipt("relatedDocId")).toBe("so1");
    expect(receipt("vatSatang")).toBe(210000);
    expect(receipt("vatBaseSatang")).toBe(3000000);
    expect(receipt("totalSatang")).toBe(3210000);
    expect(receipt("customerPoNo")).toBe("PO-6611");
    expect(allocateDocNo).toHaveBeenCalledWith(conn, "RE", "2026-11-18");
    const payment = insertOf("acc_payments");
    expect(payment("documentId")).toBe("so1");
    expect(payment("receiptId")).toBe(receipt("id"));
    expect(conn.query).toHaveBeenCalledWith("UPDATE acc_documents SET paidSatang = ? WHERE id = ?", [3210000, "so1"]);
    expect(writeAudit).toHaveBeenCalledWith(conn, expect.objectContaining({ action: "payment.create", documentId: "so1", docNo: "PO-6611", detail: expect.stringContaining("รับเงินมัดจำ 32,100.00 บาท") }));
    expect(result.receipt).toMatchObject({ docNo: "RE2026110007", title: "ใบเสร็จรับเงิน/ใบกำกับภาษี" });
  });

  it("refuses more than the PO still holds — said in Thai before anything is written", async () => {
    // 90,000.00 held → at most 96,300.00
    await expect(recordDeposit("so1", { ...INPUT, amountSatang: 9630001 }, actor)).rejects.toMatchObject({ status: 400, message: "มัดจำเกินมูลค่าที่ยังไม่ได้ส่ง (รวมมัดจำที่ยังไม่ได้หัก)" });
    expect(withTransaction).not.toHaveBeenCalled();
  });

  it("checks again under the lock — a delivery issued meanwhile leaves less room", async () => {
    lockedDb([{ qty: "10.00", deliveredQty: "8.00", amountSatang: 10000000 }]);
    // Now only 20,000.00 held → at most 21,400.00
    await expect(recordDeposit("so1", { ...INPUT, amountSatang: 3210000 }, actor)).rejects.toMatchObject({ status: 409, message: "มัดจำเกินมูลค่าที่ยังไม่ได้ส่ง — รับได้อีกไม่เกิน 21,400.00 บาท" });
    expect(allocateDocNo).not.toHaveBeenCalled();
  });

  it("is always our own receipt — never one issued elsewhere", async () => {
    await expect(recordDeposit("so1", { ...INPUT, externalReceiptNo: "เล่ม 3/12" }, actor)).rejects.toMatchObject({ status: 400 });
  });

  it("refuses a PO cancelled, delivered in full, or not there", async () => {
    vi.mocked(getAccDocument).mockResolvedValueOnce({ ...ORDER, status: "void" } as never);
    await expect(recordDeposit("so1", INPUT, actor)).rejects.toMatchObject({ status: 409 });
    vi.mocked(getAccDocument).mockResolvedValueOnce({ ...ORDER, lines: [{ ...ORDER.lines[0], deliveredQty: 10 }] } as never);
    await expect(recordDeposit("so1", INPUT, actor)).rejects.toMatchObject({ status: 409, message: expect.stringContaining("ส่งของครบแล้ว") });
    vi.mocked(getAccDocument).mockResolvedValueOnce(null);
    await expect(recordDeposit("so1", INPUT, actor)).rejects.toMatchObject({ status: 404 });
  });

  it("refuses while our company is not set up to print on the receipt", async () => {
    vi.mocked(getSellerProfile).mockResolvedValueOnce({ seller: {} as never, versionId: null });
    await expect(recordDeposit("so1", INPUT, actor)).rejects.toMatchObject({ status: 409, message: expect.stringContaining("ตั้งค่าบัญชี") });
  });
});

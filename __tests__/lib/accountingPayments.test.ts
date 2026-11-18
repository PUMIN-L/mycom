// @vitest-environment node
/**
 * Money received against an invoice (lib/accounting/payments.ts):
 *  • recording one issues its receipt (RE, our next number — a tax invoice
 *    for services), re-sums what the invoice has been paid, and fills the
 *    dashboard sale's receipt number, all in ONE transaction, the invoice
 *    locked first; refused for more than is owed, checked again under the lock;
 *  • an outside receipt number issues nothing of ours;
 *  • voiding needs a reason, voids the receipt with it (number kept);
 *  • the 50 ทวิ flag; receivables by age.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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
vi.mock("@/app/lib/accounting/numbering", () => ({ allocateDocNo: vi.fn(async () => "RE2026110001") }));
import { allocateDocNo } from "@/app/lib/accounting/numbering";

import { paymentContext, receivables, recordPayment, updateCert50, voidPayment } from "@/app/lib/accounting/payments";
import { recomputePaidSatang, syncSaleReceiptRef } from "@/app/lib/accounting/paymentLedger";
import type { PaymentInput } from "@/app/lib/accounting/paymentRules";

const actor = { userId: "admin-001", username: "admin" };

type Handler = [RegExp, (params: unknown[]) => unknown];
function router(handlers: Handler[]) {
  return async (sql: string, params: unknown[] = []) => {
    for (const [pattern, answer] of handlers) if (pattern.test(sql)) return [answer(params), []];
    return [[], []];
  };
}
const statements = () => vi.mocked(conn.query).mock.calls.map(([sql]) => String(sql));
const insertOf = (table: string) => {
  const call = vi.mocked(conn.query).mock.calls.find(([sql]) => String(sql).startsWith(`INSERT INTO ${table}`));
  if (!call) return null;
  const cols = String(call[0]).match(/\(([^)]+)\) VALUES/)![1].split(", ");
  return (col: string) => (call[1] as unknown[])[cols.indexOf(col)];
};

/** Services 19,000 + VAT 7% = 20,330 — the receipt will be the tax invoice. */
const INVOICE = {
  id: "inv1", docType: "INV", docNo: "INV2026110001", status: "issued", source: "internal", isTaxInvoice: false, issueDate: "2026-11-10",
  companyId: "co1", customerId: "c1", salespersonId: "sp1", buyerName: "บริษัท เอ จำกัด", buyerAddress: "1 ถนนงามวงศ์วาน",
  buyerTaxId: "0107537000114", buyerBranch: "00000", priceMode: "exclusive", vatRate: 7, vatBaseSatang: 1900000, vatSatang: 133000,
  totalSatang: 2033000, paidSatang: 0, customerPoNo: "PO-1", projectName: "", salesRecordId: "sale-1",
  lines: [{ lineType: "service", amountSatang: 1900000, name: "สอบเทียบ", qty: 1, unit: "งาน" }],
};
const PAYMENT: PaymentInput = {
  paidDate: "2026-11-18", method: "transfer", bankAccountId: "b1", amountSatang: 2033000, whtPercent: 3, whtSatang: 57000,
  feeSatang: 0, cert50Received: false, cert50Note: "", externalReceiptNo: "", note: "",
};
const PAYMENT_ROW = { id: "p1", documentId: "inv1", receiptId: "re1", receiptNo: "RE2026110001", paidDate: "2026-11-18", method: "transfer", amountSatang: 2033000, whtPercent: "3.00", whtSatang: 57000, feeSatang: 0, cert50Received: 0 };

/** The transaction's answers for a first, full payment. */
function firstPayment(over: { lockedStatus?: string; livePaid?: number; resum?: number } = {}) {
  conn.query.mockImplementation(router([
    [/SELECT status, totalSatang, vatSatang FROM acc_documents WHERE id = \? FOR UPDATE/, () => [{ status: over.lockedStatus ?? "issued", totalSatang: 2033000, vatSatang: 133000 }]],
    [/COALESCE\(SUM\(amountSatang\), 0\) AS paid/, () => [{ paid: over.resum ?? 2033000 }]],
    [/SELECT id, amountSatang, receiptId FROM acc_payments/, () => (over.livePaid ? [{ id: "p0", amountSatang: over.livePaid, receiptId: null }] : [])],
    [/SELECT receiptId, externalReceiptNo FROM acc_payments/, () => [{ receiptId: "re-new", externalReceiptNo: "" }]],
    [/SELECT id, docNo FROM acc_documents WHERE id IN/, () => [{ id: "re-new", docNo: "RE2026110001" }]],
  ]));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-18T05:00:00.000Z"));
  vi.clearAllMocks();
  conn.query.mockReset();
  vi.mocked(query).mockReset();
  vi.mocked(query).mockImplementation(router([
    [/SELECT isActive FROM acc_bank_accounts/, () => [{ isActive: 1 }]],
    [/FROM acc_payments p/, () => [PAYMENT_ROW]],
  ]) as never);
  vi.mocked(getAccDocument).mockResolvedValue(INVOICE as never);
  vi.mocked(getSellerProfile).mockResolvedValue({ seller: {} as never, versionId: "v1" });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("recordPayment", () => {
  it("issues the receipt — a tax invoice for services, with all the invoice's VAT on a full payment", async () => {
    firstPayment();
    const result = await recordPayment("inv1", PAYMENT, actor);

    expect(allocateDocNo).toHaveBeenCalledWith(conn, "RE", "2026-11-18");
    const re = insertOf("acc_documents")!;
    expect(re("docType")).toBe("RE");
    expect(re("docNo")).toBe("RE2026110001");
    expect(re("status")).toBe("issued");
    expect(re("isTaxInvoice")).toBe(1);
    expect(re("relatedDocId")).toBe("inv1");
    expect(re("issueDate")).toBe("2026-11-18");
    expect(re("totalSatang")).toBe(2033000);
    expect(re("vatSatang")).toBe(133000);
    expect(re("vatBaseSatang")).toBe(1900000);
    expect(re("paidSatang")).toBe(2033000);
    expect(re("buyerTaxId")).toBe("0107537000114");
    expect(re("sellerVersionId")).toBe("v1");
    expect(result.receipt).toMatchObject({ docNo: "RE2026110001", title: "ใบเสร็จรับเงิน/ใบกำกับภาษี" });
    expect(result.paidSatang).toBe(2033000);
  });

  it("records the payment against the invoice with its withholding, pointing at the receipt", async () => {
    firstPayment();
    await recordPayment("inv1", { ...PAYMENT, cert50Received: true, cert50Note: "แฟ้ม 50 ทวิ" }, actor);
    const p = insertOf("acc_payments")!;
    expect(p("documentId")).toBe("inv1");
    expect(p("receiptId")).toBe(insertOf("acc_documents")!("id"));
    expect(p("amountSatang")).toBe(2033000);
    expect(p("whtPercent")).toBe(3);
    expect(p("whtSatang")).toBe(57000);
    expect(p("cert50Received")).toBe(1);
    expect(p("cert50Note")).toBe("แฟ้ม 50 ทวิ");
    expect(p("bankAccountId")).toBe("b1");
  });

  it("re-sums the invoice's paid amount and fills the sale's receipt number, in the same transaction, invoice locked first", async () => {
    firstPayment({ resum: 2033000 });
    await recordPayment("inv1", PAYMENT, actor);
    const calls = vi.mocked(conn.query).mock.calls;
    expect(calls).toContainEqual(["UPDATE acc_documents SET paidSatang = ? WHERE id = ?", [2033000, "inv1"]]);
    expect(calls).toContainEqual(["UPDATE sales_records SET receiptRef = ? WHERE id = ?", ["RE2026110001", "sale-1"]]);
    const order = statements();
    const invoiceLock = order.findIndex((s) => /FROM acc_documents WHERE id = \? FOR UPDATE/.test(s));
    const paymentsLock = order.findIndex((s) => /FROM acc_payments WHERE documentId = \? AND voidedAt IS NULL FOR UPDATE/.test(s));
    expect(invoiceLock).toBeGreaterThan(-1);
    expect(invoiceLock).toBeLessThan(paymentsLock);
    expect(withTransaction).toHaveBeenCalledTimes(1);
    expect(writeAudit).toHaveBeenCalledWith(conn, expect.objectContaining({ action: "doc.issue", docNo: "RE2026110001" }));
    expect(writeAudit).toHaveBeenCalledWith(conn, expect.objectContaining({ action: "payment.create", documentId: "inv1", detail: expect.stringContaining("หัก ณ ที่จ่าย 3% 570.00") }));
    // Dates in the history read as the pages print them.
    expect(writeAudit).toHaveBeenCalledWith(conn, expect.objectContaining({ action: "payment.create", detail: expect.stringContaining("(โอนเงิน 18 Nov 2026)") }));
  });

  it("a goods invoice was the tax invoice already — its receipt is a plain one", async () => {
    vi.mocked(getAccDocument).mockResolvedValue({ ...INVOICE, isTaxInvoice: true } as never);
    firstPayment();
    const result = await recordPayment("inv1", PAYMENT, actor);
    expect(insertOf("acc_documents")!("isTaxInvoice")).toBe(0);
    expect(result.receipt?.title).toBe("ใบเสร็จรับเงิน");
  });

  it("with an outside receipt number, issues no receipt and spends no number of ours", async () => {
    firstPayment();
    conn.query.mockImplementation(router([
      [/SELECT status, totalSatang, vatSatang/, () => [{ status: "issued", totalSatang: 2033000, vatSatang: 133000 }]],
      [/COALESCE\(SUM/, () => [{ paid: 2033000 }]],
      [/SELECT receiptId, externalReceiptNo FROM acc_payments/, () => [{ receiptId: null, externalReceiptNo: "เล่ม 3/45" }]],
    ]));
    const result = await recordPayment("inv1", { ...PAYMENT, externalReceiptNo: "เล่ม 3/45" }, actor);
    expect(allocateDocNo).not.toHaveBeenCalled();
    expect(insertOf("acc_documents")).toBeNull();
    expect(insertOf("acc_payments")!("receiptId")).toBeNull();
    expect(result.receipt).toBeNull();
    expect(vi.mocked(conn.query).mock.calls).toContainEqual(["UPDATE sales_records SET receiptRef = ? WHERE id = ?", ["เล่ม 3/45", "sale-1"]]);
    // ...nor needs our company set up
    expect(getSellerProfile).not.toHaveBeenCalled();
  });

  it("the payment that settles the invoice declares the VAT that is left, so the receipts add up to the invoice's", async () => {
    vi.mocked(getAccDocument).mockResolvedValue({ ...INVOICE, paidSatang: 1016500 } as never);
    conn.query.mockImplementation(router([
      [/SELECT status, totalSatang, vatSatang/, () => [{ status: "issued", totalSatang: 2033000, vatSatang: 133000 }]],
      [/COALESCE\(SUM/, () => [{ paid: 2033000 }]],
      [/SELECT id, amountSatang, receiptId FROM acc_payments/, () => [{ id: "p0", amountSatang: 1016500, receiptId: "re0" }]],
      [/SELECT id, vatSatang FROM acc_documents WHERE id IN/, () => [{ id: "re0", vatSatang: 66501 }]],
    ]));
    await recordPayment("inv1", { ...PAYMENT, amountSatang: 1016500, whtSatang: 28500 }, actor);
    expect(insertOf("acc_documents")!("vatSatang")).toBe(133000 - 66501);
    // Read with a lock: an earlier receipt committed while this one waited is not in the snapshot.
    expect(statements()).toContain("SELECT id, vatSatang FROM acc_documents WHERE id IN (?) FOR UPDATE");
  });

  it("refuses more than is owed when a payment landed meanwhile — checked again under the lock", async () => {
    firstPayment({ livePaid: 1000000 });
    await expect(recordPayment("inv1", PAYMENT, actor)).rejects.toMatchObject({ status: 409, message: "ยอดเกินยอดค้างชำระ — ตอนนี้ค้างอยู่ 10,330.00 บาท" });
    expect(insertOf("acc_payments")).toBeNull();
    expect(allocateDocNo).not.toHaveBeenCalled();
  });

  it("refuses a draft, a voided invoice, and a receipt, before opening a transaction", async () => {
    vi.mocked(getAccDocument).mockResolvedValue({ ...INVOICE, status: "draft" } as never);
    await expect(recordPayment("inv1", PAYMENT, actor)).rejects.toMatchObject({ status: 409, message: "ออกใบแจ้งหนี้ก่อนจึงจะรับชำระได้" });
    vi.mocked(getAccDocument).mockResolvedValue({ ...INVOICE, status: "void" } as never);
    await expect(recordPayment("inv1", PAYMENT, actor)).rejects.toMatchObject({ status: 409 });
    vi.mocked(getAccDocument).mockResolvedValue({ ...INVOICE, docType: "RE" } as never);
    await expect(recordPayment("inv1", PAYMENT, actor)).rejects.toMatchObject({ status: 404 });
    vi.mocked(getAccDocument).mockResolvedValue(null);
    await expect(recordPayment("inv1", PAYMENT, actor)).rejects.toMatchObject({ status: 404 });
    expect(withTransaction).not.toHaveBeenCalled();
  });

  it("refuses a problem in the payment, in Thai, before opening a transaction", async () => {
    await expect(recordPayment("inv1", { ...PAYMENT, paidDate: "2026-11-19" }, actor)).rejects.toMatchObject({ status: 400, message: "วันที่รับเงินต้องไม่เกินวันนี้" });
    await expect(recordPayment("inv1", { ...PAYMENT, amountSatang: 2033001 }, actor)).rejects.toMatchObject({ status: 400, message: "ยอดเกินยอดค้างชำระของใบนี้" });
    expect(withTransaction).not.toHaveBeenCalled();
  });

  it("refuses an account that is closed or gone", async () => {
    vi.mocked(query).mockImplementation(router([[/SELECT isActive FROM acc_bank_accounts/, () => [{ isActive: 0 }]]]) as never);
    await expect(recordPayment("inv1", PAYMENT, actor)).rejects.toMatchObject({ status: 400, message: "บัญชีธนาคารนี้ปิดใช้แล้ว — เลือกบัญชีอื่น" });
    vi.mocked(query).mockImplementation(router([]) as never);
    await expect(recordPayment("inv1", PAYMENT, actor)).rejects.toMatchObject({ status: 400 });
  });

  it("will not issue a receipt before our company is set up", async () => {
    vi.mocked(getSellerProfile).mockResolvedValue({ seller: {} as never, versionId: null });
    await expect(recordPayment("inv1", PAYMENT, actor)).rejects.toMatchObject({ status: 409 });
    expect(withTransaction).not.toHaveBeenCalled();
  });
});

describe("voidPayment", () => {
  function recorded(over: { voidedAt?: string | null; receiptStatus?: string } = {}) {
    conn.query.mockImplementation(router([
      [/SELECT documentId FROM acc_payments WHERE id = \?$/, () => [{ documentId: "inv1" }]],
      [/SELECT docNo, salesRecordId FROM acc_documents WHERE id = \? FOR UPDATE/, () => [{ docNo: "INV2026110001", salesRecordId: "sale-1" }]],
      [/SELECT id, receiptId, amountSatang, voidedAt FROM acc_payments WHERE id = \? FOR UPDATE/, () => [{ id: "p1", receiptId: "re1", amountSatang: 2033000, voidedAt: over.voidedAt ?? null }]],
      [/SELECT docNo, status FROM acc_documents WHERE id = \? FOR UPDATE/, () => [{ docNo: "RE2026110001", status: over.receiptStatus ?? "issued" }]],
      [/COALESCE\(SUM/, () => [{ paid: 0 }]],
      [/SELECT receiptId, externalReceiptNo FROM acc_payments/, () => []],
    ]));
  }

  it("needs a reason", async () => {
    await expect(voidPayment("p1", "   ", actor)).rejects.toMatchObject({ status: 400, message: "กรุณาบอกเหตุผลที่ยกเลิก" });
    expect(withTransaction).not.toHaveBeenCalled();
  });

  it("voids the payment and its receipt (the number stays), the invoice owes it again, the sale loses the receipt number", async () => {
    recorded();
    await voidPayment("p1", "บันทึกยอดผิด", actor);
    const calls = vi.mocked(conn.query).mock.calls;
    expect(calls).toContainEqual([
      "UPDATE acc_payments SET voidedAt = ?, voidedBy = ?, voidReason = ? WHERE id = ?",
      ["2026-11-18T05:00:00.000Z", "admin", "บันทึกยอดผิด", "p1"],
    ]);
    expect(statements().some((s) => s.startsWith("UPDATE acc_documents SET status = 'void'"))).toBe(true);
    expect(statements().some((s) => s.startsWith("DELETE"))).toBe(false);
    expect(calls).toContainEqual(["UPDATE acc_documents SET paidSatang = ? WHERE id = ?", [0, "inv1"]]);
    expect(calls).toContainEqual(["UPDATE sales_records SET receiptRef = ? WHERE id = ?", ["", "sale-1"]]);
    expect(writeAudit).toHaveBeenCalledWith(conn, expect.objectContaining({ action: "doc.void", docNo: "RE2026110001" }));
    expect(writeAudit).toHaveBeenCalledWith(conn, expect.objectContaining({ action: "payment.void", documentId: "inv1", detail: expect.stringContaining("บันทึกยอดผิด") }));
  });

  it("locks the invoice before the payment — the order recording takes", async () => {
    recorded();
    await voidPayment("p1", "ผิด", actor);
    const order = statements();
    expect(order.findIndex((s) => s.startsWith("SELECT docNo, salesRecordId FROM acc_documents"))).toBeLessThan(
      order.findIndex((s) => s.startsWith("SELECT id, receiptId, amountSatang, voidedAt FROM acc_payments"))
    );
  });

  it("refuses a payment voided already, and one that is not there", async () => {
    recorded({ voidedAt: "2026-11-17T00:00:00.000Z" });
    await expect(voidPayment("p1", "ผิด", actor)).rejects.toMatchObject({ status: 409 });
    conn.query.mockImplementation(router([]));
    await expect(voidPayment("p1", "ผิด", actor)).rejects.toMatchObject({ status: 404 });
  });
});

describe("updateCert50", () => {
  it("marks the 50 ทวิ received, with where it is kept, and logs it on the invoice", async () => {
    conn.query.mockImplementation(router([
      [/SELECT documentId, whtSatang, voidedAt FROM acc_payments/, () => [{ documentId: "inv1", whtSatang: 57000, voidedAt: null }]],
      [/SELECT docNo FROM acc_documents/, () => [{ docNo: "INV2026110001" }]],
    ]));
    await updateCert50("p1", { received: true, note: " แฟ้ม 50 ทวิ 2569 " }, actor);
    expect(vi.mocked(conn.query).mock.calls).toContainEqual(["UPDATE acc_payments SET cert50Received = ?, cert50Note = ? WHERE id = ?", [1, "แฟ้ม 50 ทวิ 2569", "p1"]]);
    expect(writeAudit).toHaveBeenCalledWith(conn, expect.objectContaining({ action: "payment.update", documentId: "inv1", detail: expect.stringContaining("แฟ้ม 50 ทวิ 2569") }));
  });

  it("refuses a voided payment, and one nothing was withheld from", async () => {
    conn.query.mockImplementation(router([[/FROM acc_payments/, () => [{ documentId: "inv1", whtSatang: 57000, voidedAt: "x" }]]]));
    await expect(updateCert50("p1", { received: true, note: "" }, actor)).rejects.toMatchObject({ status: 409 });
    conn.query.mockImplementation(router([[/FROM acc_payments/, () => [{ documentId: "inv1", whtSatang: 0, voidedAt: null }]]]));
    await expect(updateCert50("p1", { received: true, note: "" }, actor)).rejects.toMatchObject({ status: 409 });
  });
});

describe("paymentContext", () => {
  it("brings the customer's usual withholding, the service base, and which receipt it would issue", async () => {
    vi.mocked(query).mockImplementation(router([
      [/SELECT whtPercent FROM companies/, () => [{ whtPercent: "3.00" }]],
      [/FROM acc_payments p/, () => [PAYMENT_ROW]],
    ]) as never);
    const ctx = await paymentContext("inv1");
    expect(ctx).toMatchObject({ defaultWhtPercent: 3, serviceBaseSatang: 1900000, outstandingSatang: 2033000, receiptIsTaxInvoice: true });
    expect(ctx!.payments[0]).toMatchObject({ id: "p1", receiptNo: "RE2026110001", whtPercent: 3, netSatang: 2033000 - 57000 });
  });

  it("is null for anything but an invoice", async () => {
    vi.mocked(getAccDocument).mockResolvedValue({ ...INVOICE, docType: "RE" } as never);
    expect(await paymentContext("re1")).toBeNull();
  });
});

describe("receivables", () => {
  it("open invoices by customer and age, and the 50 ทวิ still to come in", async () => {
    vi.mocked(query).mockImplementation(router([
      [/FROM acc_documents\s+WHERE docType = 'INV'/, () => [
        { id: "inv1", docNo: "INV2026110001", source: "internal", issueDate: "2026-09-01", dueDate: "2026-10-01", companyId: "co1", buyerName: "บริษัท เอ", totalSatang: 2033000, paidSatang: 1000000 },
      ]],
      [/FROM acc_payments p\s+JOIN acc_documents d/, () => [
        { id: "p1", documentId: "inv1", paidDate: "2026-10-05", whtPercent: "3.00", whtSatang: 30000, externalReceiptNo: "", invoiceNo: "INV2026110001", buyerName: "บริษัท เอ", receiptNo: "RE2026100001" },
      ]],
    ]) as never);
    const r = await receivables("2026-11-18");
    expect(r.totals).toMatchObject({ all: 1033000, d31_60: 1033000 });
    expect(r.groups[0]).toMatchObject({ name: "บริษัท เอ", outstandingSatang: 1033000 });
    expect(r.missingCert50).toEqual([
      { paymentId: "p1", invoiceId: "inv1", invoiceNo: "INV2026110001", buyerName: "บริษัท เอ", paidDate: "2026-10-05", receiptNo: "RE2026100001", whtPercent: 3, whtSatang: 30000 },
    ]);
    expect(r.missingCert50Satang).toBe(30000);
  });
});

describe("the payment ledger", () => {
  it("re-sums live payments — never adds to the cached figure", async () => {
    conn.query.mockImplementation(router([[/COALESCE\(SUM/, () => [{ paid: "1500000" }]]]));
    expect(await recomputePaidSatang(conn as never, "inv1")).toBe(1500000);
    expect(statements()[0]).toContain("WHERE documentId = ? AND voidedAt IS NULL FOR UPDATE");
    expect(statements().some((s) => /paidSatang = paidSatang/.test(s))).toBe(false);
  });

  it("puts every live receipt number on the sale once, oldest first, cut to the column — read with locks", async () => {
    conn.query.mockImplementation(router([
      [/SELECT receiptId, externalReceiptNo FROM acc_payments/, () => [
        { receiptId: "re1", externalReceiptNo: "" },
        { receiptId: null, externalReceiptNo: "เล่ม 3/45" },
        { receiptId: "re1", externalReceiptNo: "" },
      ]],
      [/SELECT id, docNo FROM acc_documents WHERE id IN/, () => [{ id: "re1", docNo: "RE2026110001" }]],
    ]));
    await syncSaleReceiptRef(conn as never, "sale-1", "inv1");
    expect(vi.mocked(conn.query).mock.calls).toContainEqual(["UPDATE sales_records SET receiptRef = ? WHERE id = ?", ["RE2026110001, เล่ม 3/45", "sale-1"]]);
    expect(statements().filter((s) => s.startsWith("SELECT")).every((s) => s.endsWith("FOR UPDATE"))).toBe(true);

    conn.query.mockReset();
    const many = Array.from({ length: 30 }, (_, i) => `re${i}`);
    conn.query.mockImplementation(router([
      [/SELECT receiptId, externalReceiptNo FROM acc_payments/, () => many.map((id) => ({ receiptId: id, externalReceiptNo: "" }))],
      [/SELECT id, docNo FROM acc_documents WHERE id IN/, () => many.map((id, i) => ({ id, docNo: `RE20261100${String(i).padStart(2, "0")}` }))],
    ]));
    await syncSaleReceiptRef(conn as never, "sale-1", "inv1");
    const ref = vi.mocked(conn.query).mock.calls.find(([sql]) => String(sql).startsWith("UPDATE sales_records"))![1] as string[];
    expect(ref[0].length).toBe(255);
    expect(ref[0].endsWith("…")).toBe(true);
  });

  it("leaves the sales alone when the invoice has none", async () => {
    await syncSaleReceiptRef(conn as never, null, "inv1");
    expect(conn.query).not.toHaveBeenCalled();
  });
});

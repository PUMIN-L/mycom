// @vitest-environment node
/**
 * Billing notes (lib/accounting/billingNotes.ts):
 *  • made for ONE customer's open invoices, numbered at once (BN series),
 *    each invoice's amount what it owed then — read under its lock;
 *  • cancelled with a reason, not once money came in against it;
 *  • money received against it: one payment row per invoice (one group),
 *    under ONE receipt — two when goods and services mix, the services' being
 *    the tax invoice — each row with its own share of VAT; never more than the
 *    invoices owe now (checked again under the locks).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const conn = { query: vi.fn() };
vi.mock("@/app/lib/db", () => ({
  query: vi.fn(),
  withTransaction: vi.fn(async (fn: (c: typeof conn) => Promise<unknown>) => fn(conn)),
}));
import { query, withTransaction } from "@/app/lib/db";
vi.mock("@/app/lib/accounting/documents", () => ({
  getAccDocument: vi.fn(),
  likeEscape: (s: string) => s.replace(/[!%_]/g, (c) => `!${c}`),
}));
import { getAccDocument } from "@/app/lib/accounting/documents";
vi.mock("@/app/lib/accounting/settings", () => ({ getSellerProfile: vi.fn(async () => ({ seller: {}, versionId: "v1" })) }));
import { getSellerProfile } from "@/app/lib/accounting/settings";
vi.mock("@/app/lib/accounting/audit", () => ({ writeAudit: vi.fn(async () => {}) }));
import { writeAudit } from "@/app/lib/accounting/audit";
let seq = 0;
vi.mock("@/app/lib/accounting/numbering", () => ({ allocateDocNo: vi.fn(async (_c: unknown, type: string) => `${type}20261100${String(++seq).padStart(2, "0")}`) }));
import { allocateDocNo } from "@/app/lib/accounting/numbering";

import { billingNoteDetail, createBillingNote, listBillingNotes, openInvoicesFor, recordBillingPayment, voidBillingNote } from "@/app/lib/accounting/billingNotes";
import { suggestedBillingWhtSatang } from "@/app/lib/accounting/billingRules";
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
const inserts = (table: string) =>
  conn.query.mock.calls
    .filter(([sql]) => String(sql).startsWith(`INSERT INTO ${table}`))
    .map(([sql, values]) => {
      const cols = String(sql).match(/\(([^)]+)\) VALUES/)![1].split(", ");
      return (col: string) => (values as unknown[])[cols.indexOf(col)];
    });

/** A: goods 1,070.00 (the tax invoice already) · B: services 535.00 — both of บริษัท เอ, owing in full. */
const INV_ROWS = [
  { id: "A", docType: "INV", status: "issued", docNo: "INV2026110001", issueDate: "2026-11-01", dueDate: "2026-12-01", isTaxInvoice: 1, companyId: "co1", customerId: "c1", salespersonId: "", buyerName: "บริษัท เอ จำกัด", buyerAddress: "1 ถนนงามวงศ์วาน", buyerTaxId: "0107537000114", buyerBranch: "00000", vatRate: "7.00", totalSatang: 107000, vatSatang: 7000, vatBaseSatang: 100000, paidSatang: 0, salesRecordId: "sale-A" },
  { id: "B", docType: "INV", status: "issued", docNo: "INV2026110002", issueDate: "2026-11-05", dueDate: "2026-12-05", isTaxInvoice: 0, companyId: "co1", customerId: "c1", salespersonId: "", buyerName: "บริษัท เอ จำกัด", buyerAddress: "1 ถนนงามวงศ์วาน", buyerTaxId: "0107537000114", buyerBranch: "00000", vatRate: "7.00", totalSatang: 53500, vatSatang: 3500, vatBaseSatang: 50000, paidSatang: 0, salesRecordId: "sale-B" },
];
const LINES = [
  { documentId: "A", lineType: "goods", amountSatang: 100000 },
  { documentId: "B", lineType: "service", amountSatang: 50000 },
];
const BN = {
  id: "bn1", docType: "BN", docNo: "BN2026110001", status: "issued", issueDate: "2026-11-19", dueDate: "2026-11-30", companyId: "co1", customerId: "c1",
  salespersonId: "", buyerName: "บริษัท เอ จำกัด", buyerAddress: "1 ถนนงามวงศ์วาน", buyerTaxId: "0107537000114", buyerBranch: "00000", vatRate: 7,
  totalSatang: 160500, customerPoNo: "", projectName: "", lines: [],
};
const PAY: PaymentInput = {
  paidDate: "2026-11-19", method: "cheque", bankAccountId: "", amountSatang: 160500, whtPercent: 3, whtSatang: 1500, feeSatang: 0,
  cert50Received: false, cert50Note: "", externalReceiptNo: "", note: "เช็คกสิกร 123456",
};

beforeEach(() => {
  vi.clearAllMocks();
  seq = 0;
  conn.query.mockReset();
  vi.mocked(query).mockReset();
  vi.mocked(getSellerProfile).mockResolvedValue({ seller: {} as never, versionId: "v1" });
});

describe("openInvoicesFor", () => {
  it("lists a customer's invoices still owing, oldest first, with the open billing notes each is on", async () => {
    vi.mocked(query).mockImplementation(router([
      [/FROM acc_documents\s+WHERE docType = 'INV' AND status = 'issued' AND paidSatang \+ creditedSatang < totalSatang/, () => INV_ROWS],
      [/FROM acc_billing_items bi JOIN acc_documents b/, () => [{ invoiceId: "A", id: "bn0", docNo: "BN2026100003" }]],
    ]) as never);
    const rows = await openInvoicesFor({ companyId: "co1", buyerName: "" });
    expect(rows.map((r) => [r.id, r.outstandingSatang, r.billedOn.map((b) => b.docNo)])).toEqual([["A", 107000, ["BN2026100003"]], ["B", 53500, []]]);
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(String(sql)).toContain("companyId = ?");
    expect(String(sql)).toContain("ORDER BY issueDate ASC");
    expect(params).toEqual(["co1"]);
  });

  it("finds a customer typed by hand by name, whatever its case and spaces", async () => {
    vi.mocked(query).mockImplementation(router([]) as never);
    await openInvoicesFor({ companyId: "", buyerName: "  ร้าน บี  " });
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(String(sql)).toContain("LOWER(TRIM(buyerName)) = ?");
    expect(params).toEqual(["ร้าน บี"]);
  });
});

describe("createBillingNote", () => {
  const INPUT = { companyId: "co1", buyerName: "", invoiceIds: ["A", "B"], issueDate: "2026-11-19", dueDate: "2026-11-30", note: "นัดรับเช็ควันศุกร์" };
  const lockedDb = (rows = INV_ROWS) => conn.query.mockImplementation(router([[/FROM acc_documents WHERE id IN \(\?, \?\) FOR UPDATE/, () => rows]]));

  it("numbers it at once and lists each invoice with what it owes now — read under the invoices' locks", async () => {
    lockedDb([INV_ROWS[0], { ...INV_ROWS[1], paidSatang: 3500 }]);
    vi.mocked(getAccDocument).mockResolvedValue(BN as never);
    await createBillingNote(INPUT, actor);
    expect(statements()[0]).toContain("FOR UPDATE");
    expect(allocateDocNo).toHaveBeenCalledWith(conn, "BN", "2026-11-19");
    const [note] = inserts("acc_documents");
    expect(note("docType")).toBe("BN");
    expect(note("docNo")).toBe("BN2026110001");
    expect(note("status")).toBe("issued");
    expect(note("isTaxInvoice")).toBe(0);
    expect(note("dueDate")).toBe("2026-11-30");
    expect(note("totalSatang")).toBe(107000 + 50000);
    expect(note("sellerVersionId")).toBe("v1");
    expect(note("buyerName")).toBe("บริษัท เอ จำกัด");
    const items = conn.query.mock.calls.find(([sql]) => String(sql).startsWith("INSERT INTO acc_billing_items"))!;
    expect((items[1] as unknown[]).filter((_, i) => i % 5 >= 2)).toEqual(["A", 0, 107000, "B", 1, 50000]);
    expect(writeAudit).toHaveBeenCalledWith(conn, expect.objectContaining({ action: "doc.issue", docNo: "BN2026110001", detail: expect.stringContaining("2 ใบแจ้งหนี้") }));
  });

  it("is for one customer only, and only invoices still owing", async () => {
    lockedDb([INV_ROWS[0], { ...INV_ROWS[1], companyId: "co2" }]);
    await expect(createBillingNote(INPUT, actor)).rejects.toMatchObject({ status: 400, message: expect.stringContaining("ลูกค้ารายอื่น") });
    lockedDb([INV_ROWS[0], { ...INV_ROWS[1], paidSatang: 53500 }]);
    await expect(createBillingNote(INPUT, actor)).rejects.toMatchObject({ status: 409, message: expect.stringContaining("ชำระครบแล้ว") });
    lockedDb([INV_ROWS[0], { ...INV_ROWS[1], status: "draft" }]);
    await expect(createBillingNote(INPUT, actor)).rejects.toMatchObject({ status: 409 });
    lockedDb([INV_ROWS[0]]);
    await expect(createBillingNote(INPUT, actor)).rejects.toMatchObject({ status: 404 });
    expect(allocateDocNo).not.toHaveBeenCalled();
  });

  it("knows a customer typed by hand by name", async () => {
    const byName = INV_ROWS.map((r) => ({ ...r, companyId: "", buyerName: "ร้าน บี " }));
    lockedDb(byName);
    vi.mocked(getAccDocument).mockResolvedValue(BN as never);
    await createBillingNote({ ...INPUT, companyId: "", buyerName: "ร้าน บี" }, actor);
    expect(allocateDocNo).toHaveBeenCalled();
  });

  it("refuses a problem, or our company not set up, before opening a transaction", async () => {
    await expect(createBillingNote({ ...INPUT, invoiceIds: [] }, actor)).rejects.toMatchObject({ status: 400 });
    vi.mocked(getSellerProfile).mockResolvedValueOnce({ seller: {} as never, versionId: null });
    await expect(createBillingNote(INPUT, actor)).rejects.toMatchObject({ status: 409 });
    expect(withTransaction).not.toHaveBeenCalled();
  });
});

describe("voidBillingNote", () => {
  const noteDb = (live: number, status = "issued") =>
    conn.query.mockImplementation(router([
      [/SELECT docType, status, docNo FROM acc_documents WHERE id = \? FOR UPDATE/, () => [{ docType: "BN", status, docNo: "BN2026110001" }]],
      [/COUNT\(\*\) AS n FROM acc_payments WHERE billingNoteId = \?/, () => [{ n: live }]],
    ]));

  it("cancels it with the reason", async () => {
    noteDb(0);
    vi.mocked(getAccDocument).mockResolvedValue({ ...BN, status: "void" } as never);
    await voidBillingNote("bn1", " ลูกค้าขอวางบิลใหม่ ", actor);
    expect(conn.query).toHaveBeenCalledWith("UPDATE acc_documents SET status = 'void', voidReason = ?, voidedAt = ?, voidedBy = ?, updatedAt = ? WHERE id = ?", [
      "ลูกค้าขอวางบิลใหม่", expect.any(String), "admin", expect.any(String), "bn1",
    ]);
    expect(writeAudit).toHaveBeenCalledWith(conn, expect.objectContaining({ action: "doc.void", detail: "ยกเลิกใบวางบิล · เหตุผล: ลูกค้าขอวางบิลใหม่" }));
  });

  it("refuses once money came in against it, one cancelled already, and no reason", async () => {
    noteDb(1);
    await expect(voidBillingNote("bn1", "ผิด", actor)).rejects.toMatchObject({ status: 409, message: expect.stringContaining("มีการรับชำระแล้ว") });
    noteDb(0, "void");
    await expect(voidBillingNote("bn1", "ผิด", actor)).rejects.toMatchObject({ status: 409 });
    await expect(voidBillingNote("bn1", " ", actor)).rejects.toMatchObject({ status: 400 });
  });
});

describe("listBillingNotes", () => {
  it("says where each stands from its invoices now, and what they still owe", async () => {
    vi.mocked(query).mockImplementation(router([
      [/FROM acc_documents WHERE docType = 'BN'/, () => [BN]],
      [/FROM acc_billing_items bi JOIN acc_documents i/, () => [
        { billingNoteId: "bn1", invoiceId: "A", amountSatang: 107000, totalSatang: 107000, paidSatang: 107000, status: "issued" },
        { billingNoteId: "bn1", invoiceId: "B", amountSatang: 53500, totalSatang: 53500, paidSatang: 0, status: "issued" },
      ]],
    ]) as never);
    const [row] = await listBillingNotes({ q: "BN_1" });
    expect(row).toMatchObject({ docNo: "BN2026110001", billingStatus: "partial", outstandingSatang: 53500, invoiceCount: 2 });
    expect(vi.mocked(query).mock.calls[0][1]).toEqual(["%BN!_1%", "%BN!_1%"]);
  });
});

describe("recordBillingPayment", () => {
  /**
   * The note, its invoices, their lines — plainly read, and under the locks.
   * `paidB`: a payment on B that landed meanwhile — seen only under the lock.
   */
  function noteDb(paidB = 0) {
    const common: Handler[] = [
      [/SELECT invoiceId, amountSatang FROM acc_billing_items WHERE billingNoteId = \?/, () => [{ invoiceId: "A", amountSatang: 107000 }, { invoiceId: "B", amountSatang: 53500 }]],
      [/SELECT id, docNo, status, issueDate, dueDate, isTaxInvoice, totalSatang, vatSatang, vatBaseSatang, paidSatang, creditedSatang, creditedVatSatang\s+FROM acc_documents WHERE id IN/, () => INV_ROWS],
      [/SELECT documentId, lineType, amountSatang FROM acc_document_lines/, () => LINES],
    ];
    vi.mocked(getAccDocument).mockResolvedValue(BN as never);
    vi.mocked(query).mockImplementation(router([...common, [/SELECT whtPercent FROM companies/, () => [{ whtPercent: "3.00" }]]]) as never);
    conn.query.mockImplementation(router([
      [/SELECT status FROM acc_documents WHERE id = \? FOR UPDATE/, () => [{ status: "issued" }]],
      ...common,
      [/SELECT id, documentId, amountSatang, receiptId, vatSatang FROM acc_payments WHERE documentId IN/, () => (paidB ? [{ id: "p0", documentId: "B", amountSatang: paidB, receiptId: null, vatSatang: 0 }] : [])],
      [/COALESCE\(SUM\(amountSatang\), 0\) AS paid/, () => [{ paid: 0 }]],
      [/SELECT salesRecordId FROM acc_documents WHERE id = \?/, (p) => [{ salesRecordId: `sale-${p[0]}` }]],
    ]));
  }

  it("issues one receipt per kind — the goods' plain one, the services' tax invoice — and one payment per invoice under them", async () => {
    noteDb();
    const result = await recordBillingPayment("bn1", PAY, actor);
    // The note locked first, then its invoices.
    expect(statements()[0]).toBe("SELECT status FROM acc_documents WHERE id = ? FOR UPDATE");
    const [goods, services] = inserts("acc_documents");
    expect([goods("docType"), goods("isTaxInvoice"), goods("relatedDocId"), goods("totalSatang"), goods("vatSatang")]).toEqual(["RE", 0, "bn1", 107000, 7000]);
    expect([services("isTaxInvoice"), services("totalSatang"), services("vatSatang"), services("vatBaseSatang")]).toEqual([1, 53500, 3500, 50000]);
    const payments = inserts("acc_payments");
    expect(payments.map((p) => [p("documentId"), p("amountSatang"), p("whtSatang"), p("vatSatang"), p("billingNoteId")])).toEqual([
      ["A", 107000, 0, 7000, "bn1"],
      ["B", 53500, 1500, 3500, "bn1"],
    ]);
    expect(payments[0]("receiptId")).toBe(goods("id"));
    expect(payments[1]("receiptId")).toBe(services("id"));
    expect(payments[0]("groupId")).toBe(payments[1]("groupId"));
    expect(payments[0]("whtPercent")).toBe(0);
    expect(payments[1]("whtPercent")).toBe(3);
    expect(conn.query).toHaveBeenCalledWith("UPDATE acc_documents SET paidSatang = ? WHERE id = ?", [0, "A"]);
    expect(conn.query).toHaveBeenCalledWith("UPDATE acc_documents SET paidSatang = ? WHERE id = ?", [0, "B"]);
    expect(result.receipts.map((r) => r.title)).toEqual(["ใบเสร็จรับเงิน", "ใบเสร็จรับเงิน/ใบกำกับภาษี"]);
    expect(writeAudit).toHaveBeenCalledWith(conn, expect.objectContaining({ action: "payment.create", documentId: "bn1", detail: expect.stringContaining("2 ใบแจ้งหนี้") }));
  });

  it("issues ONE receipt when every invoice is of one kind", async () => {
    noteDb();
    await recordBillingPayment("bn1", { ...PAY, amountSatang: 100000, whtSatang: 0 }, actor);
    // 100,000 goes to A alone.
    expect(inserts("acc_documents")).toHaveLength(1);
    expect(inserts("acc_payments").map((p) => p("documentId"))).toEqual(["A"]);
  });

  it("issues no receipt of ours for one issued elsewhere — its number on each share", async () => {
    noteDb();
    await recordBillingPayment("bn1", { ...PAY, externalReceiptNo: "เล่ม 2/41" }, actor);
    expect(inserts("acc_documents")).toHaveLength(0);
    expect(inserts("acc_payments").every((p) => p("externalReceiptNo") === "เล่ม 2/41" && p("receiptId") === null)).toBe(true);
  });

  it("refuses more than the invoices owe now — a payment that came in meanwhile is seen under the lock", async () => {
    noteDb(50000);
    await expect(recordBillingPayment("bn1", { ...PAY, amountSatang: 160500, whtSatang: 0 }, actor)).rejects.toMatchObject({ status: 409, message: expect.stringContaining("ตอนนี้ค้างอยู่ 1,105.00 บาท") });
    expect(allocateDocNo).not.toHaveBeenCalled();
  });

  it("refuses a cancelled note, and more than it owes, before opening a transaction", async () => {
    vi.mocked(getAccDocument).mockResolvedValue({ ...BN, status: "void" } as never);
    vi.mocked(query).mockImplementation(router([]) as never);
    await expect(recordBillingPayment("bn1", PAY, actor)).rejects.toMatchObject({ status: 409 });
    noteDb();
    await expect(recordBillingPayment("bn1", { ...PAY, amountSatang: 160501 }, actor)).rejects.toMatchObject({ status: 400 });
    expect(withTransaction).not.toHaveBeenCalled();
  });
});

// Step 8 — an invoice on the note that a credit note took half off: B now 267.50, VAT 17.50, services 250.00.
describe("a billing note's invoice credited after it was billed", () => {
  const CREDITED_ROWS = [INV_ROWS[0], { ...INV_ROWS[1], creditedSatang: 26750, creditedVatSatang: 1750 }];
  const creditedDb = () => {
    const common: Handler[] = [
      [/SELECT invoiceId, amountSatang FROM acc_billing_items WHERE billingNoteId = \?/, () => [{ invoiceId: "A", amountSatang: 107000 }, { invoiceId: "B", amountSatang: 53500 }]],
      [/SELECT id, docNo, status, issueDate, dueDate, isTaxInvoice, totalSatang, vatSatang, vatBaseSatang, paidSatang, creditedSatang, creditedVatSatang\s+FROM acc_documents WHERE id IN/, () => CREDITED_ROWS],
      [/SELECT documentId, lineType, amountSatang FROM acc_document_lines/, () => LINES],
    ];
    vi.mocked(getAccDocument).mockResolvedValue(BN as never);
    vi.mocked(query).mockImplementation(router([...common, [/SELECT whtPercent FROM companies/, () => [{ whtPercent: "3.00" }]]]) as never);
    conn.query.mockImplementation(router([
      [/SELECT status FROM acc_documents WHERE id = \? FOR UPDATE/, () => [{ status: "issued" }]],
      ...common,
      [/COALESCE\(SUM\(amountSatang\), 0\) AS paid/, () => [{ paid: 0 }]],
      [/SELECT salesRecordId FROM acc_documents WHERE id = \?/, (p) => [{ salesRecordId: `sale-${p[0]}` }]],
    ]));
  };

  it("owes, and withholds on, what is left — its services shrinking with it", async () => {
    creditedDb();
    const detail = (await billingNoteDetail("bn1"))!;
    const b = detail.invoices.find((i) => i.id === "B")!;
    expect([b.totalSatang, b.vatSatang, b.outstandingSatang, b.serviceBaseSatang]).toEqual([26750, 1750, 26750, 25000]);
    expect(detail.outstandingSatang).toBe(107000 + 26750);
    // 3% of the 250.00 of services left — not of the 500.00 billed.
    expect(suggestedBillingWhtSatang(detail.invoices, 107000 + 26750, 3)).toBe(750);
  });

  it("the services' receipt declares the VAT left on it after the credit note", async () => {
    creditedDb();
    await recordBillingPayment("bn1", { ...PAY, amountSatang: 107000 + 26750, whtSatang: 750 }, actor);
    const [, services] = inserts("acc_documents");
    expect([services("isTaxInvoice"), services("totalSatang"), services("vatSatang")]).toEqual([1, 26750, 1750]);
    const payments = inserts("acc_payments");
    expect(payments.map((p) => [p("documentId"), p("amountSatang"), p("whtSatang"), p("vatSatang")])).toEqual([
      ["A", 107000, 0, 7000],
      ["B", 26750, 750, 1750],
    ]);
  });
});

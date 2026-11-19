// @vitest-environment node
/**
 * The invoice's life (lib/accounting/documents.ts):
 *  • a draft's totals are computed by the server, never taken from the browser;
 *  • issuing gives the number, locks the draft, and creates its /dashboard
 *    sale and machines in the SAME transaction — refused when the draft
 *    changed since it was checked, or our company is not set up;
 *  • the sale is the invoice ex VAT, the bill discount shared over its lines;
 *  • deleting an issued one takes its sale and history-free machines along,
 *    keeps machines with service history, and gives the latest number back.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const conn = { query: vi.fn() };
vi.mock("@/app/lib/db", () => ({
  query: vi.fn(),
  withTransaction: vi.fn(async (fn: (c: typeof conn) => Promise<unknown>) => fn(conn)),
}));
import { query, withTransaction } from "@/app/lib/db";

vi.mock("@/app/lib/salesDashboardStore", () => ({
  prepareSaleWithLineItems: vi.fn(async (input: { sale: Record<string, unknown>; items: unknown[]; equipments: unknown[] }) => ({
    v: { ...input.sale },
    itemsToPersist: input.items,
    equipments: input.equipments,
    sharedEquipment: {},
  })),
  insertPreparedSaleTx: vi.fn(async () => "sale-1"),
}));
import { insertPreparedSaleTx, prepareSaleWithLineItems } from "@/app/lib/salesDashboardStore";

vi.mock("@/app/lib/accounting/settings", () => ({
  getSellerProfile: vi.fn(async () => ({ seller: {}, versionId: "v1" })),
  getVatRate: vi.fn(async () => 7),
}));
import { getSellerProfile } from "@/app/lib/accounting/settings";

vi.mock("@/app/lib/accounting/audit", () => ({ writeAudit: vi.fn(async () => {}) }));
import { writeAudit } from "@/app/lib/accounting/audit";

vi.mock("@/app/lib/accounting/numbering", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/lib/accounting/numbering")>()),
  allocateDocNo: vi.fn(async () => "INV2026110001"),
  releaseDocNoIfLatest: vi.fn(async () => true),
}));
import { allocateDocNo, releaseDocNoIfLatest } from "@/app/lib/accounting/numbering";

import {
  createInvoiceDraft,
  deleteAccDocument,
  deletionImpact,
  issueInvoice,
  listAccDocuments,
  recordExternalInvoice,
  updateExternalReference,
  peekNextDocNo,
  saleInputFromInvoice,
  updateInvoiceDraft,
  warrantyEndOf,
  type AccDocument,
} from "@/app/lib/accounting/documents";
import type { InvoiceInput } from "@/app/lib/accounting/invoiceRules";

const actor = { userId: "admin-001", username: "admin" };

type Handler = [RegExp, (params: unknown[]) => unknown];
/** A query() stand-in that answers each statement by the first pattern it matches. */
function router(handlers: Handler[]) {
  return async (sql: string, params: unknown[] = []) => {
    for (const [pattern, answer] of handlers) if (pattern.test(sql)) return [answer(params), []];
    return [[], []];
  };
}
const statements = () => vi.mocked(conn.query).mock.calls.map(([sql]) => String(sql));

const INPUT: InvoiceInput = {
  issueDate: "2026-11-18", creditDays: 30, companyId: "co1", customerId: "c1", salespersonId: "sp1",
  buyerName: "บริษัท เอ จำกัด", buyerAddress: "1 ถนนงามวงศ์วาน", buyerTaxId: "0107537000114", buyerBranch: "00000",
  priceMode: "exclusive", discountSatang: 0, isTaxInvoice: true, customerPoNo: "PO-1", projectName: "", note: "",
  lines: [{ lineType: "goods", productId: "p1", name: "เครื่องชั่ง AND GR-200", qty: 1, unit: "เครื่อง", unitPriceSatang: 5800000, discountSatang: 0, isMachine: true, serials: "D42", warrantyMonths: 12 }],
};

const DOC_ROW = {
  id: "d1", docType: "INV", docNo: null, status: "draft", source: "internal", externalNote: "", isTaxInvoice: 1,
  issueDate: "2026-11-18", dueDate: "2026-12-18", creditDays: 30, companyId: "co1", customerId: "c1", salespersonId: "sp1",
  buyerName: "บริษัท เอ จำกัด", buyerAddress: "1 ถนนงามวงศ์วาน", buyerTaxId: "0107537000114", buyerBranch: "00000",
  sellerVersionId: null, priceMode: "exclusive", vatRate: "7.00", subtotalSatang: 5800000, discountSatang: 0, depositSatang: 0,
  vatBaseSatang: 5800000, vatSatang: 406000, totalSatang: 6206000, paidSatang: 0, customerPoNo: "PO-1", projectName: "", note: "",
  quotationId: null, salesOrderId: null, relatedDocId: null, salesRecordId: null, issuedAt: null, issuedBy: null,
  voidedAt: null, voidReason: null, createdAt: "2026-11-18T01:00:00.000Z", createdBy: "admin", updatedAt: "2026-11-18T01:00:00.000Z",
};
const LINE_ROW = {
  id: "l1", sortOrder: 0, lineType: "goods", productId: "p1", name: "เครื่องชั่ง AND GR-200", qty: "1.00", unit: "เครื่อง",
  unitPriceSatang: 5800000, discountSatang: 0, amountSatang: 5800000, isMachine: 1, serials: "D42", warrantyMonths: 12,
};

beforeEach(() => {
  vi.clearAllMocks();
  conn.query.mockReset();
  vi.mocked(query).mockReset();
  vi.mocked(getSellerProfile).mockResolvedValue({ seller: {} as never, versionId: "v1" });
});

describe("createInvoiceDraft", () => {
  it("computes the totals itself and writes the document, its lines and an audit line in one transaction", async () => {
    vi.mocked(query).mockImplementation(router([
      [/FROM acc_documents WHERE id/, () => [DOC_ROW]],
      [/FROM acc_document_lines/, () => [LINE_ROW]],
    ]) as never);
    conn.query.mockResolvedValue([{}, []]);
    await createInvoiceDraft(INPUT, actor);

    const insert = vi.mocked(conn.query).mock.calls.find(([sql]) => String(sql).startsWith("INSERT INTO acc_documents"))!;
    const cols = String(insert[0]).match(/\(([^)]+)\) VALUES/)![1].split(", ");
    const values = insert[1] as unknown[];
    const at = (col: string) => values[cols.indexOf(col)];
    expect(at("status")).toBe("draft");
    expect(at("totalSatang")).toBe(6206000);
    expect(at("vatSatang")).toBe(406000);
    expect(at("dueDate")).toBe("2026-12-18");
    expect(cols).not.toContain("docNo"); // no number before issuing
    expect(statements().some((s) => s.startsWith("INSERT INTO acc_document_lines"))).toBe(true);
    expect(writeAudit).toHaveBeenCalledWith(conn, expect.objectContaining({ action: "doc.create" }));
  });

  it("refuses a draft with a problem, in Thai, before opening a transaction", async () => {
    await expect(createInvoiceDraft({ ...INPUT, buyerName: "" }, actor)).rejects.toMatchObject({ status: 400, message: "กรุณาเลือกหรือกรอกชื่อลูกค้า" });
    expect(withTransaction).not.toHaveBeenCalled();
  });
});

describe("updateInvoiceDraft", () => {
  it("refuses to change an issued document", async () => {
    conn.query.mockImplementation(router([[/FOR UPDATE/, () => [{ status: "issued", updatedAt: "x" }]]]));
    await expect(updateInvoiceDraft("d1", INPUT, actor)).rejects.toMatchObject({ status: 409 });
  });

  it("refuses a save over a newer save from another tab", async () => {
    conn.query.mockImplementation(router([[/FOR UPDATE/, () => [{ status: "draft", updatedAt: "newer" }]]]));
    await expect(updateInvoiceDraft("d1", INPUT, actor, "older")).rejects.toMatchObject({ status: 409 });
    expect(statements().some((s) => s.startsWith("UPDATE acc_documents"))).toBe(false);
  });
});

describe("issueInvoice", () => {
  const loadDraft = () =>
    vi.mocked(query).mockImplementation(router([
      [/FROM acc_documents WHERE id/, () => [DOC_ROW]],
      [/FROM acc_document_lines/, () => [LINE_ROW]],
      [/FROM products WHERE id IN/, () => [{ id: "p1", categoryId: 4 }]],
    ]) as never);

  it("gives the number, creates the sale and machines, and locks the draft — in one transaction", async () => {
    loadDraft();
    conn.query.mockImplementation(router([[/FOR UPDATE/, () => [{ status: "draft", updatedAt: DOC_ROW.updatedAt }]]]));
    await issueInvoice("d1", actor, DOC_ROW.updatedAt);

    expect(allocateDocNo).toHaveBeenCalledWith(conn, "INV", "2026-11-18");
    const prepared = vi.mocked(insertPreparedSaleTx).mock.calls[0][1] as { v: Record<string, unknown> };
    expect(prepared.v.invoiceRef).toBe("INV2026110001");
    expect(prepared.v.note).toContain("INV2026110001");
    const saleInput = vi.mocked(prepareSaleWithLineItems).mock.calls[0][0];
    expect(saleInput.items[0]).toMatchObject({ productId: "p1", categoryId: 4, totalAmount: 58000, costAmount: 0 });
    expect(saleInput.equipments).toEqual([
      expect.objectContaining({ serialNumber: "D42", warrantyStartDate: "2026-11-18", warrantyEndDate: "2027-11-17", customerId: "c1" }),
    ]);
    const update = vi.mocked(conn.query).mock.calls.find(([sql]) => String(sql).startsWith("UPDATE acc_documents SET status = 'issued'"))!;
    expect((update[1] as unknown[]).slice(0, 3)).toEqual(["INV2026110001", "v1", "sale-1"]);
    expect(writeAudit).toHaveBeenCalledWith(conn, expect.objectContaining({ action: "doc.issue", docNo: "INV2026110001" }));
  });

  it("refuses while our company is not set up", async () => {
    loadDraft();
    vi.mocked(getSellerProfile).mockResolvedValue({ seller: {} as never, versionId: null });
    await expect(issueInvoice("d1", actor)).rejects.toMatchObject({ status: 409, message: expect.stringContaining("ตั้งค่าบัญชี") });
    expect(allocateDocNo).not.toHaveBeenCalled();
  });

  it("refuses when the draft changed after it was checked — no number is spent", async () => {
    loadDraft();
    conn.query.mockImplementation(router([[/FOR UPDATE/, () => [{ status: "draft", updatedAt: "changed-since" }]]]));
    await expect(issueInvoice("d1", actor)).rejects.toMatchObject({ status: 409 });
    expect(allocateDocNo).not.toHaveBeenCalled();
    expect(insertPreparedSaleTx).not.toHaveBeenCalled();
  });

  it("refuses an issued document", async () => {
    vi.mocked(query).mockImplementation(router([
      [/FROM acc_documents WHERE id/, () => [{ ...DOC_ROW, status: "issued" }]],
      [/FROM acc_document_lines/, () => [LINE_ROW]],
    ]) as never);
    await expect(issueInvoice("d1", actor)).rejects.toMatchObject({ status: 409 });
  });
});

describe("saleInputFromInvoice — the dashboard sale", () => {
  const doc = (over: Partial<AccDocument> = {}): AccDocument =>
    ({
      ...DOC_ROW,
      vatRate: 7,
      isTaxInvoice: true,
      lines: [
        { id: "a", sortOrder: 0, lineType: "goods", productId: "p1", name: "เครื่อง", qty: 2, unit: "", unitPriceSatang: 1000000, discountSatang: 0, amountSatang: 2000000, isMachine: true, serials: "A1", warrantyMonths: 12 },
        { id: "b", sortOrder: 1, lineType: "service", productId: "", name: "ติดตั้ง", qty: 1, unit: "", unitPriceSatang: 500000, discountSatang: 0, amountSatang: 500000, isMachine: false, serials: "", warrantyMonths: null },
      ],
      subtotalSatang: 2500000,
      discountSatang: 100000,
      vatBaseSatang: 2400000,
      ...over,
    }) as AccDocument;

  it("is the invoice ex VAT: the bill discount shared over the lines, adding up to the VAT base", () => {
    const { items, sale } = saleInputFromInvoice(doc(), new Map());
    expect(items.map((i) => i.totalAmount)).toEqual([19200, 4800]);
    expect(items[0]).toMatchObject({ qty: 2, unitPrice: 9600 });
    expect(sale).toMatchObject({ saleType: "equipment", saleDate: "2026-11-18", poRef: "PO-1", companyId: "co1" });
  });

  it("registers one machine per unit of a machine line, serials in order, blank for the rest", () => {
    const { equipments } = saleInputFromInvoice(doc(), new Map());
    expect(equipments.map((e) => e.serialNumber)).toEqual(["A1", ""]);
    expect(equipments[0].warrantyEndDate).toBe("2027-11-17");
  });

  it("is a service sale when nothing on it is goods", () => {
    const { sale, equipments } = saleInputFromInvoice(doc({ lines: [doc().lines[1]], subtotalSatang: 500000, discountSatang: 0, vatBaseSatang: 500000 }), new Map());
    expect(sale.saleType).toBe("service");
    expect(equipments).toEqual([]);
  });

  it("keeps what was sold when a deposit is deducted on the bill — the deposit paid for these same goods (step 6)", () => {
    // 24,000.00 sold; 10,000.00 of it paid ahead as a deposit → VAT base 14,000.00, the sale still 24,000.00
    const { items } = saleInputFromInvoice(doc({ depositSatang: 1000000, vatBaseSatang: 1400000 }), new Map());
    expect(items.map((i) => i.totalAmount)).toEqual([19200, 4800]);
  });
});

describe("warrantyEndOf", () => {
  it("is the start plus the months, less a day", () => {
    expect(warrantyEndOf("2026-11-18", 12)).toBe("2027-11-17");
    expect(warrantyEndOf("2026-01-31", 1)).toBe("2026-02-27");
    expect(warrantyEndOf("2026-11-18", 0)).toBeNull();
    expect(warrantyEndOf("2026-11-18", null)).toBeNull();
  });
});

describe("deleteAccDocument", () => {
  const issuedRow = { id: "d1", docType: "INV", status: "issued", docNo: "INV2026110005", salesRecordId: "sale-1", buyerName: "บริษัท เอ", totalSatang: 6206000 };

  it("deletes a draft with no password and no number to give back", async () => {
    conn.query.mockImplementation(router([[/FOR UPDATE/, () => [{ ...issuedRow, status: "draft", docNo: null, salesRecordId: null }]]]));
    const result = await deleteAccDocument("d1", actor, { passwordChecked: false });
    expect(result).toMatchObject({ releasedNumber: false, saleDeleted: false });
    expect(statements()).toContain("DELETE FROM acc_documents WHERE id = ?");
    expect(releaseDocNoIfLatest).not.toHaveBeenCalled();
  });

  it("will not delete an issued document without the password", async () => {
    conn.query.mockImplementation(router([[/FOR UPDATE/, () => [issuedRow]]]));
    await expect(deleteAccDocument("d1", actor, { passwordChecked: false })).rejects.toMatchObject({ status: 409 });
    expect(statements()).not.toContain("DELETE FROM acc_documents WHERE id = ?");
  });

  it("refuses while a payment is recorded against it", async () => {
    conn.query.mockImplementation(router([
      [/FROM acc_documents WHERE id = \? FOR UPDATE/, () => [issuedRow]],
      [/FROM acc_payments/, () => [{ n: 1 }]],
    ]));
    await expect(deleteAccDocument("d1", actor, { passwordChecked: true })).rejects.toMatchObject({ status: 409, message: expect.stringContaining("รับชำระ") });
  });

  it("counts payments and receipts with LOCKING reads — the snapshot would miss one committed while it waited", async () => {
    conn.query.mockImplementation(router([
      [/FROM acc_documents WHERE id = \? FOR UPDATE/, () => [issuedRow]],
      [/FROM acc_payments/, () => [{ n: 1 }]],
    ]));
    await expect(deleteAccDocument("d1", actor, { passwordChecked: true })).rejects.toMatchObject({ status: 409 });
    expect(statements()).toContain("SELECT COUNT(*) AS n FROM acc_payments WHERE documentId = ? AND voidedAt IS NULL FOR UPDATE");
    // Receipts / credit notes pointing at it, and — for a customer PO — the invoices delivered from it.
    expect(statements()).toContain("SELECT COUNT(*) AS n FROM acc_documents WHERE relatedDocId = ? OR salesOrderId = ? FOR UPDATE");
  });

  it("takes the sale and the history-free machines along, keeps the others, gives the number back", async () => {
    conn.query.mockImplementation(router([
      [/FROM acc_documents WHERE id = \? FOR UPDATE/, () => [issuedRow]],
      [/FROM acc_payments/, () => [{ n: 0 }]],
      [/WHERE relatedDocId/, () => [{ n: 0 }]],
      [/FROM acc_counters/, () => [{ lastNo: 5 }]],
      [/SELECT costAmount FROM sales_records/, () => [{ costAmount: "1200.00" }]],
      [/WHERE salesRecordId = \? AND id <>/, () => [{ n: 0 }]],
      [/FROM customer_equipments e/, () => [{ id: "m1", hasHistory: 0 }, { id: "m2", hasHistory: 1 }]],
    ]));
    const result = await deleteAccDocument("d1", actor, { passwordChecked: true });
    expect(result).toEqual({ docNo: "INV2026110005", releasedNumber: true, machinesDeleted: 1, machinesKept: 1, saleDeleted: true });
    const calls = vi.mocked(conn.query).mock.calls;
    expect(calls).toContainEqual(["DELETE FROM customer_equipments WHERE id = ?", ["m1"]]);
    expect(calls).toContainEqual(["UPDATE customer_equipments SET salesRecordId = '' WHERE id = ?", ["m2"]]);
    // Its lines and costs go first, by hand — orphans would only take space.
    const order = calls.map(([sql]) => String(sql));
    const saleAt = order.indexOf("DELETE FROM sales_records WHERE id = ?");
    expect(order.indexOf("DELETE FROM sales_record_items WHERE salesRecordId = ?")).toBeGreaterThan(-1);
    expect(order.indexOf("DELETE FROM sales_record_items WHERE salesRecordId = ?")).toBeLessThan(saleAt);
    expect(order.indexOf("DELETE FROM sale_cost_items WHERE salesRecordId = ?")).toBeLessThan(saleAt);
    expect(calls).toContainEqual(["DELETE FROM sales_records WHERE id = ?", ["sale-1"]]);
    expect(releaseDocNoIfLatest).toHaveBeenCalledWith(conn, "INV2026110005");
    expect(writeAudit).toHaveBeenCalledWith(conn, expect.objectContaining({ action: "doc.delete", detail: expect.stringContaining("คืนเลขเอกสาร") }));
  });

  it("takes the payments voided on an invoice along — dead rows of a document that is going", async () => {
    conn.query.mockImplementation(router([
      [/FROM acc_documents WHERE id = \? FOR UPDATE/, () => [{ ...issuedRow, salesRecordId: null }]],
      [/COUNT\(\*\) AS n FROM acc_payments/, () => [{ n: 0 }]],
      [/WHERE relatedDocId/, () => [{ n: 0 }]],
    ]));
    await deleteAccDocument("d1", actor, { passwordChecked: true });
    expect(vi.mocked(conn.query).mock.calls).toContainEqual(["DELETE FROM acc_payments WHERE documentId = ?", ["d1"]]);
  });

  // Step 4 — a receipt takes the payment it records along.
  describe("a receipt", () => {
    const receiptRow = { id: "re1", docType: "RE", status: "issued", docNo: "RE2026110003", salesRecordId: null, relatedDocId: "inv1", buyerName: "บริษัท เอ", totalSatang: 2033000 };
    function receiptDb() {
      conn.query.mockImplementation(router([
        [/SELECT docType, relatedDocId FROM acc_documents WHERE id = \?$/, () => [{ docType: "RE", relatedDocId: "inv1" }]],
        [/SELECT id, docType, docNo, salesRecordId, customerPoNo, vatRate FROM acc_documents WHERE id = \? FOR UPDATE/, () => [{ id: "inv1", docNo: "INV2026110001", salesRecordId: "sale-1" }]],
        [/SELECT id, docType, status, docNo, salesRecordId, relatedDocId, .*FROM acc_documents WHERE id = \? FOR UPDATE/, () => [receiptRow]],
        [/SELECT amountSatang, voidedAt, documentId FROM acc_payments WHERE receiptId/, () => [{ amountSatang: 2033000, voidedAt: null, documentId: "inv1" }]],
        [/SELECT docNo, docType, customerPoNo FROM acc_documents WHERE id = \?/, () => [{ docNo: "INV2026110001" }]],
        [/COUNT\(\*\) AS n FROM acc_payments/, () => [{ n: 0 }]],
        [/WHERE relatedDocId/, () => [{ n: 0 }]],
        [/FROM acc_counters/, () => [{ lastNo: 3 }]],
        [/COALESCE\(SUM\(amountSatang\), 0\) AS paid/, () => [{ paid: 0 }]],
        [/SELECT receiptId, externalReceiptNo FROM acc_payments/, () => []],
      ]));
    }

    it("deletes its payment, so the invoice owes that again, and the sale loses the receipt number — invoice locked first", async () => {
      receiptDb();
      const result = await deleteAccDocument("re1", actor, { passwordChecked: true });
      expect(result).toMatchObject({ docNo: "RE2026110003", releasedNumber: true, saleDeleted: false });
      const calls = vi.mocked(conn.query).mock.calls;
      expect(calls).toContainEqual(["DELETE FROM acc_payments WHERE receiptId = ?", ["re1"]]);
      expect(calls).toContainEqual(["UPDATE acc_documents SET paidSatang = ? WHERE id = ?", [0, "inv1"]]);
      expect(calls).toContainEqual(["UPDATE sales_records SET receiptRef = ? WHERE id = ?", ["", "sale-1"]]);
      expect(calls).toContainEqual(["DELETE FROM acc_documents WHERE id = ?", ["re1"]]);
      const order = statements();
      expect(order.findIndex((s) => s.startsWith("SELECT id, docType, docNo, salesRecordId, customerPoNo, vatRate FROM acc_documents"))).toBeLessThan(
        order.findIndex((s) => s.startsWith("SELECT id, docType, status"))
      );
      // The invoice's own history says what happened to its payment.
      expect(writeAudit).toHaveBeenCalledWith(conn, expect.objectContaining({ action: "doc.delete", documentId: "inv1", detail: expect.stringContaining("20,330.00") }));
      expect(writeAudit).toHaveBeenCalledWith(conn, expect.objectContaining({ action: "doc.delete", documentId: "re1", detail: expect.stringContaining("ลบรายการรับชำระของ INV2026110001") }));
    });

    it("says what goes with it before anything is deleted", async () => {
      vi.mocked(query).mockImplementation(router([
        [/SELECT id, docType, status, docNo, salesRecordId, relatedDocId, salesOrderId FROM acc_documents WHERE id = \?/, () => [receiptRow]],
        [/SELECT amountSatang, voidedAt, documentId FROM acc_payments WHERE receiptId/, () => [{ amountSatang: 2033000, voidedAt: null, documentId: "inv1" }]],
        [/SELECT docNo, docType, customerPoNo FROM acc_documents WHERE id = \?/, () => [{ docNo: "INV2026110001" }]],
        [/COUNT\(\*\) AS n/, () => [{ n: 0 }]],
        [/FROM acc_counters/, () => [{ lastNo: 3 }]],
      ]) as never);
      expect(await deletionImpact("re1")).toMatchObject({
        isLatestNumber: true,
        livePayments: 0,
        receiptPayment: { amountSatang: 2033000, voided: false, invoiceId: "inv1", invoiceNo: "INV2026110001" },
      });
    });
  });
});

describe("peekNextDocNo", () => {
  it("is past both the counter and the highest number on a document", async () => {
    vi.mocked(query).mockImplementation(router([
      [/FROM acc_counters/, () => [{ lastNo: 5 }]],
      [/MAX\(docNo\)/, () => [{ maxNo: "INV2026110007" }]],
    ]) as never);
    expect(await peekNextDocNo("INV", "2026-11-18")).toBe("INV2026110008");
  });
});

describe("listAccDocuments", () => {
  it("keeps to the type and range, searches with % and _ taken literally, newest first and by number within a day", async () => {
    vi.mocked(query).mockResolvedValue([[], []] as never);
    await listAccDocuments({ type: "INV", from: "2026-01-01", to: "2027-01-01", q: "50%_off" });
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(sql).toContain("ORDER BY issueDate DESC, docNo DESC");
    expect(sql).toContain("ESCAPE '!'");
    expect(params).toEqual(["INV", "2026-01-01", "2027-01-01", "%50!%!_off%", "%50!%!_off%", "%50!%!_off%", "%50!%!_off%"]);
  });

  it("names a receipt's invoice", async () => {
    vi.mocked(query).mockResolvedValue([[{ id: "re1", docType: "RE", docNo: "RE2026110001", status: "issued", relatedDocId: "inv1", relatedDocNo: "INV2026110001", totalSatang: 100 }], []] as never);
    const [row] = await listAccDocuments({ type: "RE" });
    expect(row).toMatchObject({ relatedDocId: "inv1", relatedDocNo: "INV2026110001" });
  });
});

// Step 3 — an invoice issued elsewhere, recorded here.
describe("recordExternalInvoice", () => {
  const FIELDS = { docNo: "IV-2569/0042", externalNote: "แฟ้มใบกำกับ 2569", vatSatangOverride: 406002 };
  const recorded = () =>
    vi.mocked(query).mockImplementation(router([
      [/WHERE docType = 'INV' AND docNo = \? LIMIT 1/, () => []],
      [/FROM products WHERE id IN/, () => []],
      [/FROM acc_documents WHERE id/, () => [{ ...DOC_ROW, status: "issued", source: "external", docNo: FIELDS.docNo }]],
      [/FROM acc_document_lines/, () => [LINE_ROW]],
    ]) as never);

  it("records it as issued, with its own number, where the paper is kept, the VAT as printed — and its sale", async () => {
    recorded();
    conn.query.mockResolvedValue([{}, []]);
    await recordExternalInvoice(INPUT, FIELDS, actor);

    const insert = vi.mocked(conn.query).mock.calls.find(([sql]) => String(sql).startsWith("INSERT INTO acc_documents"))!;
    const cols = String(insert[0]).match(/\(([^)]+)\) VALUES/)![1].split(", ");
    const at = (col: string) => (insert[1] as unknown[])[cols.indexOf(col)];
    expect(at("status")).toBe("issued");
    expect(at("source")).toBe("external");
    expect(at("docNo")).toBe("IV-2569/0042");
    expect(at("externalNote")).toBe("แฟ้มใบกำกับ 2569");
    expect(at("vatSatang")).toBe(406002);
    expect(at("totalSatang")).toBe(6206002);
    expect(allocateDocNo).not.toHaveBeenCalled(); // never one of our numbers
    const prepared = vi.mocked(insertPreparedSaleTx).mock.calls[0][1] as { v: Record<string, unknown> };
    expect(prepared.v.invoiceRef).toBe("IV-2569/0042");
    expect(writeAudit).toHaveBeenCalledWith(conn, expect.objectContaining({ action: "doc.issue", detail: expect.stringContaining("บันทึกเอกสารจากภายนอก") }));
  });

  it("refuses a number already recorded, before opening a transaction", async () => {
    vi.mocked(query).mockImplementation(router([[/WHERE docType = 'INV' AND docNo = \? LIMIT 1/, () => [{ id: "other" }]]]) as never);
    await expect(recordExternalInvoice(INPUT, FIELDS, actor)).rejects.toMatchObject({ status: 409, message: "เลขที่ IV-2569/0042 บันทึกไว้แล้ว" });
    expect(withTransaction).not.toHaveBeenCalled();
  });

  it("says so when the database refuses a number that arrived at the same moment", async () => {
    recorded();
    vi.mocked(withTransaction).mockRejectedValueOnce(Object.assign(new Error("dup"), { code: "ER_DUP_ENTRY" }));
    await expect(recordExternalInvoice(INPUT, FIELDS, actor)).rejects.toMatchObject({ status: 409 });
  });

  it("refuses a number shaped like ours, and a VAT a typo away from the system's", async () => {
    await expect(recordExternalInvoice(INPUT, { ...FIELDS, docNo: "INV2026110001" }, actor)).rejects.toMatchObject({ status: 400 });
    await expect(recordExternalInvoice(INPUT, { ...FIELDS, vatSatangOverride: 40600 }, actor)).rejects.toMatchObject({ status: 400 });
    expect(withTransaction).not.toHaveBeenCalled();
  });
});

describe("updateExternalReference", () => {
  it("fixes the number and the storage note, with the reason in the audit log — the sale's number follows", async () => {
    vi.mocked(query).mockImplementation(router([
      [/FROM acc_documents WHERE id/, () => [{ ...DOC_ROW, status: "issued", source: "external" }]],
      [/FROM acc_document_lines/, () => [LINE_ROW]],
    ]) as never);
    conn.query.mockImplementation(router([
      [/FOR UPDATE/, () => [{ source: "external", docNo: "IV-42", externalNote: "แฟ้ม", salesRecordId: "sale-1" }]],
      [/AND id <>/, () => []],
    ]));
    await updateExternalReference("d1", { docNo: "IV-0042", externalNote: "แฟ้ม", reason: "พิมพ์เลขผิด" }, actor);
    expect(vi.mocked(conn.query).mock.calls).toContainEqual(["UPDATE sales_records SET invoiceRef = ? WHERE id = ?", ["IV-0042", "sale-1"]]);
    expect(writeAudit).toHaveBeenCalledWith(conn, expect.objectContaining({ detail: "แก้ เลขที่ IV-42 → IV-0042 · เหตุผล: พิมพ์เลขผิด" }));
  });

  it("wants a reason, and only for an outside document", async () => {
    await expect(updateExternalReference("d1", { docNo: "IV-1", externalNote: "แฟ้ม", reason: " " }, actor)).rejects.toMatchObject({ status: 400 });
    conn.query.mockImplementation(router([[/FOR UPDATE/, () => [{ source: "internal", docNo: "INV2026110001", externalNote: "", salesRecordId: null }]]]));
    await expect(updateExternalReference("d1", { docNo: "IV-1", externalNote: "แฟ้ม", reason: "ผิด" }, actor)).rejects.toMatchObject({ status: 409 });
  });
});

// Step 5 — an invoice that delivers (part of) a customer PO.
describe("delivering from a customer PO", () => {
  const FROM_PO: InvoiceInput = { ...INPUT, salesOrderId: "so1", lines: [{ ...INPUT.lines[0], sourceLineId: "a" }] };
  const PO_LINES = [{ id: "a", name: "เครื่องชั่ง AND GR-200", unit: "เครื่อง", qty: "2.00" }];
  /**
   * PO so1: line a, 2 scales. `earlier`: what issued invoice inv0 already
   * delivered of it. `d1` — the invoice at hand — sends 1 and counts once it
   * is issued (not while it is the invoice being checked).
   */
  const poDb = (earlier: string | null, order: Record<string, unknown> = { docType: "SO", status: "issued" }): Handler[] => [
    [/SELECT docType, status, vatRate FROM acc_documents WHERE id = \?/, () => [order]],
    [/SELECT id, name, unit, qty FROM acc_document_lines WHERE documentId = \?/, () => PO_LINES],
    [/WHERE salesOrderId = \? AND docType = 'INV' AND status = 'issued'/, (params) => [
      ...(earlier ? [{ id: "inv0" }] : []),
      ...(params.length === 1 ? [{ id: "d1" }] : []),
    ]],
    [/SELECT sourceLineId, qty FROM acc_document_lines WHERE documentId IN/, (params) => [
      ...(earlier && params.includes("inv0") ? [{ sourceLineId: "a", qty: earlier }] : []),
      ...(params.includes("d1") ? [{ sourceLineId: "a", qty: "1.00" }] : []),
    ]],
  ];
  const insertOf = (table: string) => {
    const call = vi.mocked(conn.query).mock.calls.find(([sql]) => String(sql).startsWith(`INSERT INTO ${table}`))!;
    const cols = String(call[0]).match(/\(([^)]+)\) VALUES/)![1].split(", ");
    return (col: string) => (call[1] as unknown[])[cols.indexOf(col)];
  };

  it("a draft keeps its PO and the PO line each of its lines delivers", async () => {
    vi.mocked(query).mockImplementation(router([...poDb(null), [/FROM acc_documents WHERE id/, () => [DOC_ROW]], [/FROM acc_document_lines/, () => [LINE_ROW]]]) as never);
    conn.query.mockResolvedValue([{}, []]);
    await createInvoiceDraft(FROM_PO, actor);
    expect(insertOf("acc_documents")("salesOrderId")).toBe("so1");
    expect(insertOf("acc_document_lines")("sourceLineId")).toBe("a");
  });

  it("an invoice not from a PO drops any PO pointer it was sent", async () => {
    vi.mocked(query).mockImplementation(router([[/FROM acc_documents WHERE id/, () => [DOC_ROW]], [/FROM acc_document_lines/, () => [LINE_ROW]]]) as never);
    conn.query.mockResolvedValue([{}, []]);
    await createInvoiceDraft({ ...FROM_PO, salesOrderId: "" }, actor);
    expect(insertOf("acc_documents")("salesOrderId")).toBeNull();
    expect(insertOf("acc_document_lines")("sourceLineId")).toBeNull();
  });

  it("a draft that takes more than the PO still holds is refused before anything is written", async () => {
    vi.mocked(query).mockImplementation(router(poDb("2.00")) as never);
    await expect(createInvoiceDraft(FROM_PO, actor)).rejects.toMatchObject({ status: 409, message: '"เครื่องชั่ง AND GR-200" ใน PO นี้ส่งครบแล้ว' });
    expect(withTransaction).not.toHaveBeenCalled();
  });

  const loadDelivery = () =>
    vi.mocked(query).mockImplementation(router([
      [/FROM acc_documents WHERE id/, () => [{ ...DOC_ROW, salesOrderId: "so1" }]],
      [/FROM acc_document_lines/, () => [{ ...LINE_ROW, sourceLineId: "a" }]],
      [/FROM products WHERE id IN/, () => [{ id: "p1", categoryId: 4 }]],
    ]) as never);
  const draftLock: Handler = [/SELECT status, updatedAt FROM acc_documents WHERE id = \? FOR UPDATE/, () => [{ status: "draft", updatedAt: DOC_ROW.updatedAt }]];

  it("issuing locks the invoice, then the PO, checks it BEFORE the number is spent — then ties the sale to the PO's deal and re-sums what was delivered", async () => {
    loadDelivery();
    conn.query.mockImplementation(router([draftLock, ...poDb("0.50")]));
    await issueInvoice("d1", actor, DOC_ROW.updatedAt);

    const order = statements();
    const invoiceLock = order.indexOf("SELECT status, updatedAt FROM acc_documents WHERE id = ? FOR UPDATE");
    const orderLock = order.indexOf("SELECT docType, status, vatRate FROM acc_documents WHERE id = ? FOR UPDATE");
    expect(invoiceLock).toBeGreaterThan(-1);
    expect(orderLock).toBeGreaterThan(invoiceLock);
    expect(vi.mocked(conn.query).mock.invocationCallOrder[orderLock]).toBeLessThan(vi.mocked(allocateDocNo).mock.invocationCallOrder[0]);

    const calls = vi.mocked(conn.query).mock.calls;
    expect(calls).toContainEqual(["UPDATE sales_records SET dealId = ? WHERE id = ?", ["so1", "sale-1"]]);
    // 0.50 earlier + 1 now — a re-sum over the issued invoices, never `+ ?`.
    expect(calls).toContainEqual(["UPDATE acc_document_lines SET deliveredQty = ? WHERE id = ?", [1.5, "a"]]);
    expect(order.findIndex((s) => s.startsWith("UPDATE acc_document_lines SET deliveredQty"))).toBeGreaterThan(
      order.findIndex((s) => s.startsWith("UPDATE acc_documents SET status = 'issued'"))
    );
  });

  it("issuing more than the PO still holds is refused — no number spent, no sale", async () => {
    loadDelivery();
    conn.query.mockImplementation(router([draftLock, ...poDb("1.50")]));
    await expect(issueInvoice("d1", actor)).rejects.toMatchObject({ status: 409, message: 'ส่ง "เครื่องชั่ง AND GR-200" เกินจำนวนที่เหลือใน PO — เหลือ 0.5 เครื่อง' });
    expect(allocateDocNo).not.toHaveBeenCalled();
    expect(insertPreparedSaleTx).not.toHaveBeenCalled();
  });

  it("issuing from a PO cancelled since the draft was saved is refused", async () => {
    loadDelivery();
    conn.query.mockImplementation(router([draftLock, ...poDb(null, { docType: "SO", status: "void" })]));
    await expect(issueInvoice("d1", actor)).rejects.toMatchObject({ status: 409, message: "PO ลูกค้านี้ถูกยกเลิกแล้ว — ส่งของจาก PO นี้ไม่ได้" });
    expect(allocateDocNo).not.toHaveBeenCalled();
  });

  it("an invoice from elsewhere, recorded against a PO: checked without counting itself, tied to the deal", async () => {
    vi.mocked(query).mockImplementation(router([
      ...poDb(null),
      [/WHERE docType = 'INV' AND docNo = \? LIMIT 1/, () => []],
      [/FROM products WHERE id IN/, () => []],
      [/FROM acc_documents WHERE id/, () => [{ ...DOC_ROW, status: "issued", source: "external", docNo: "IV-1", salesOrderId: "so1" }]],
      [/FROM acc_document_lines/, () => [LINE_ROW]],
    ]) as never);
    conn.query.mockImplementation(router(poDb(null)));
    await recordExternalInvoice(FROM_PO, { docNo: "IV-1", externalNote: "แฟ้ม", vatSatangOverride: null }, actor);
    const newId = insertOf("acc_documents")("id");
    const check = vi.mocked(conn.query).mock.calls.find(([sql]) => String(sql).includes("status = 'issued' AND id <> ?"))!;
    expect(check[1]).toEqual(["so1", newId]);
    expect(vi.mocked(conn.query).mock.calls).toContainEqual(["UPDATE sales_records SET dealId = ? WHERE id = ?", ["so1", "sale-1"]]);
  });

  it("deleting a delivery locks the PO after the invoice and gives the quantity back", async () => {
    conn.query.mockImplementation(router([
      [/SELECT docType, relatedDocId FROM acc_documents WHERE id = \?$/, () => [{ docType: "INV", relatedDocId: null }]],
      [/SELECT id, docType, status, docNo, salesRecordId, relatedDocId, .*FROM acc_documents WHERE id = \? FOR UPDATE/, () => [{
        id: "d1", docType: "INV", status: "issued", docNo: "INV2026110005", salesRecordId: null, relatedDocId: null,
        salesOrderId: "so1", customerPoNo: "PO-1", buyerName: "บริษัท เอ", totalSatang: 6206000,
      }]],
      [/COUNT\(\*\) AS n/, () => [{ n: 0 }]],
      [/SELECT id FROM acc_documents WHERE id = \? FOR UPDATE/, () => [{ id: "so1" }]],
      [/FROM acc_counters/, () => [{ lastNo: 9 }]],
      [/SELECT id, name, unit, qty FROM acc_document_lines/, () => PO_LINES],
    ]));
    await deleteAccDocument("d1", actor, { passwordChecked: true });
    const order = statements();
    const invoiceLock = order.findIndex((s) => s.startsWith("SELECT id, docType, status"));
    const orderLock = order.indexOf("SELECT id FROM acc_documents WHERE id = ? FOR UPDATE");
    const deleted = order.indexOf("DELETE FROM acc_documents WHERE id = ?");
    expect(orderLock).toBeGreaterThan(invoiceLock);
    expect(orderLock).toBeLessThan(deleted);
    expect(vi.mocked(conn.query).mock.calls).toContainEqual(["UPDATE acc_document_lines SET deliveredQty = ? WHERE id = ?", [0, "a"]]);
    expect(order.findIndex((s) => s.startsWith("UPDATE acc_document_lines SET deliveredQty"))).toBeGreaterThan(deleted);
    expect(writeAudit).toHaveBeenCalledWith(conn, expect.objectContaining({ action: "doc.delete", detail: expect.stringContaining("คืนจำนวนที่ส่งให้ PO ลูกค้า") }));
  });

  it("before deleting a delivery, says which PO its quantities go back to — a draft took nothing, so gives nothing back", async () => {
    const delivery = { id: "d1", docType: "INV", status: "issued", docNo: "INV2026110005", salesRecordId: null, relatedDocId: null, salesOrderId: "so1" };
    const impactDb = (row: Record<string, unknown>) =>
      vi.mocked(query).mockImplementation(router([
        [/SELECT id, docType, status, docNo, salesRecordId, relatedDocId, salesOrderId FROM acc_documents WHERE id = \?/, () => [row]],
        [/SELECT customerPoNo FROM acc_documents WHERE id = \?/, () => [{ customerPoNo: "PO-6611" }]],
        [/COUNT\(\*\) AS n/, () => [{ n: 0 }]],
      ]) as never);
    impactDb(delivery);
    expect(await deletionImpact("d1")).toMatchObject({ fromOrder: { id: "so1", customerPoNo: "PO-6611" } });
    impactDb({ ...delivery, status: "draft", docNo: null });
    expect(await deletionImpact("d1")).toMatchObject({ fromOrder: null });
  });

  // Step 6 — a delivery deducting the PO's deposit, before VAT.
  describe("with a deposit", () => {
    /** One deposit of 32,100.00 (30,000.00 before VAT) on the PO; `deducted` by other issued invoices. */
    const depositDb = (deducted: number): Handler[] => [
      [/SELECT id, amountSatang, receiptId FROM acc_payments WHERE documentId = \? AND voidedAt IS NULL/, () => [{ id: "p1", amountSatang: 3210000, receiptId: "re1" }]],
      [/SELECT id, vatBaseSatang FROM acc_documents WHERE id IN/, () => [{ id: "re1", vatBaseSatang: 3000000 }]],
      [/COALESCE\(SUM\(depositSatang\), 0\) AS d/, () => [{ d: deducted }]],
    ];
    // 58,000.00 less a 10,000.00 deposit → base 48,000.00, VAT 3,360.00
    const withDeposit = { ...DOC_ROW, salesOrderId: "so1", depositSatang: 1000000, vatBaseSatang: 4800000, vatSatang: 336000, totalSatang: 5136000 };
    const loadDepositDelivery = () =>
      vi.mocked(query).mockImplementation(router([
        [/FROM acc_documents WHERE id/, () => [withDeposit]],
        [/FROM acc_document_lines/, () => [{ ...LINE_ROW, sourceLineId: "a" }]],
        [/FROM products WHERE id IN/, () => [{ id: "p1", categoryId: 4 }]],
      ]) as never);

    it("issuing checks the deduction against what is left of the deposits, under the PO's lock, before the number is spent — the sale keeps the full value", async () => {
      loadDepositDelivery();
      conn.query.mockImplementation(router([draftLock, ...depositDb(0), ...poDb(null)]));
      await issueInvoice("d1", actor, DOC_ROW.updatedAt);
      const order = statements();
      const orderLock = order.indexOf("SELECT docType, status, vatRate FROM acc_documents WHERE id = ? FOR UPDATE");
      const deposits = order.indexOf("SELECT id, amountSatang, receiptId FROM acc_payments WHERE documentId = ? AND voidedAt IS NULL FOR UPDATE");
      expect(deposits).toBeGreaterThan(orderLock);
      expect(vi.mocked(conn.query).mock.invocationCallOrder[deposits]).toBeLessThan(vi.mocked(allocateDocNo).mock.invocationCallOrder[0]);
      const saleInput = vi.mocked(prepareSaleWithLineItems).mock.calls[0][0];
      expect(saleInput.items[0]).toMatchObject({ totalAmount: 58000 });
    });

    it("refuses to deduct more than is left of the deposits — no number spent", async () => {
      loadDepositDelivery();
      conn.query.mockImplementation(router([draftLock, ...depositDb(2500000), ...poDb(null)]));
      await expect(issueInvoice("d1", actor)).rejects.toMatchObject({ status: 409, message: "หักมัดจำเกินมัดจำที่เหลือ — เหลือ 5,000.00 บาท (ก่อน VAT)" });
      expect(allocateDocNo).not.toHaveBeenCalled();
    });

    it("an invoice not from a PO deducts no deposit, whatever it was sent", async () => {
      vi.mocked(query).mockImplementation(router([[/FROM acc_documents WHERE id/, () => [DOC_ROW]], [/FROM acc_document_lines/, () => [LINE_ROW]]]) as never);
      conn.query.mockResolvedValue([{}, []]);
      await createInvoiceDraft({ ...INPUT, depositSatang: 1000000 }, actor);
      expect(insertOf("acc_documents")("depositSatang")).toBe(0);
      expect(insertOf("acc_documents")("vatBaseSatang")).toBe(5800000);
    });

    it("records an outside invoice paid in full by the deposit — it comes to nothing and is still recorded", async () => {
      vi.mocked(query).mockImplementation(router([
        ...poDb(null),
        ...depositDb(0),
        [/WHERE docType = 'INV' AND docNo = \? LIMIT 1/, () => []],
        [/FROM products WHERE id IN/, () => []],
        [/FROM acc_documents WHERE id/, () => [{ ...withDeposit, status: "issued", source: "external", docNo: "IV-9" }]],
        [/FROM acc_document_lines/, () => [LINE_ROW]],
      ]) as never);
      conn.query.mockImplementation(router([...depositDb(0), ...poDb(null)]));
      const paidAhead = { ...FROM_PO, lines: [{ ...FROM_PO.lines[0], unitPriceSatang: 3000000 }], depositSatang: 3000000 };
      await recordExternalInvoice(paidAhead, { docNo: "IV-9", externalNote: "แฟ้ม", vatSatangOverride: null }, actor);
      expect(insertOf("acc_documents")("totalSatang")).toBe(0);
      expect(insertOf("acc_documents")("depositSatang")).toBe(3000000);
    });
  });

  describe("a deposit's receipt", () => {
    const receiptDb = (deducted: number) =>
      conn.query.mockImplementation(router([
        [/SELECT docType, relatedDocId FROM acc_documents WHERE id = \?$/, () => [{ docType: "RE", relatedDocId: "so1" }]],
        [/SELECT id, docType, docNo, salesRecordId, customerPoNo, vatRate FROM acc_documents WHERE id = \? FOR UPDATE/, () => [{ id: "so1", docType: "SO", docNo: null, salesRecordId: null, customerPoNo: "PO-6611", vatRate: "7.00" }]],
        [/SELECT id, docType, status, docNo, salesRecordId, relatedDocId, .*FROM acc_documents WHERE id = \? FOR UPDATE/, () => [{
          id: "re1", docType: "RE", status: "issued", docNo: "RE2026110007", salesRecordId: null, relatedDocId: "so1", salesOrderId: null, customerPoNo: "PO-6611",
          buyerName: "บริษัท เอ", totalSatang: 3210000, vatBaseSatang: 3000000,
        }]],
        [/SELECT amountSatang, voidedAt, documentId FROM acc_payments WHERE receiptId/, () => [{ amountSatang: 3210000, voidedAt: null, documentId: "so1" }]],
        [/SELECT docNo, docType, customerPoNo FROM acc_documents WHERE id = \?/, () => [{ docNo: null, docType: "SO", customerPoNo: "PO-6611" }]],
        [/COUNT\(\*\) AS n/, () => [{ n: 0 }]],
        [/SELECT id, amountSatang, receiptId FROM acc_payments WHERE documentId = \? AND voidedAt IS NULL/, () => [{ id: "p1", amountSatang: 3210000, receiptId: "re1" }]],
        [/SELECT id, vatBaseSatang FROM acc_documents WHERE id IN/, () => [{ id: "re1", vatBaseSatang: 3000000 }]],
        [/COALESCE\(SUM\(depositSatang\), 0\) AS d/, () => [{ d: deducted }]],
        [/FROM acc_counters/, () => [{ lastNo: 7 }]],
        [/COALESCE\(SUM\(amountSatang\), 0\) AS paid/, () => [{ paid: 0 }]],
      ]));

    it("cannot be deleted while an invoice has deducted that deposit", async () => {
      receiptDb(1000000);
      await expect(deleteAccDocument("re1", actor, { passwordChecked: true })).rejects.toMatchObject({ status: 409, message: expect.stringContaining("ลบใบแจ้งหนี้ที่หักมัดจำก่อน") });
      expect(statements()).not.toContain("DELETE FROM acc_documents WHERE id = ?");
    });

    it("goes with its deposit otherwise — the PO's history says so", async () => {
      receiptDb(0);
      await deleteAccDocument("re1", actor, { passwordChecked: true });
      const calls = vi.mocked(conn.query).mock.calls;
      expect(calls).toContainEqual(["DELETE FROM acc_payments WHERE receiptId = ?", ["re1"]]);
      expect(calls).toContainEqual(["UPDATE acc_documents SET paidSatang = ? WHERE id = ?", [0, "so1"]]);
      expect(writeAudit).toHaveBeenCalledWith(conn, expect.objectContaining({ documentId: "so1", docNo: "PO-6611", detail: "ลบใบเสร็จมัดจำ RE2026110007 · เงินมัดจำ 32,100.00 บาท ถูกลบด้วย" }));
    });

    it("says before deleting that it is a deposit, of which PO", async () => {
      vi.mocked(query).mockImplementation(router([
        [/SELECT id, docType, status, docNo, salesRecordId, relatedDocId, salesOrderId FROM acc_documents WHERE id = \?/, () => [{ id: "re1", docType: "RE", status: "issued", docNo: "RE2026110007", salesRecordId: null, relatedDocId: "so1", salesOrderId: null }]],
        [/SELECT amountSatang, voidedAt, documentId FROM acc_payments WHERE receiptId/, () => [{ amountSatang: 3210000, voidedAt: null, documentId: "so1" }]],
        [/SELECT docNo, docType, customerPoNo FROM acc_documents WHERE id = \?/, () => [{ docNo: null, docType: "SO", customerPoNo: "PO-6611" }]],
        [/COUNT\(\*\) AS n/, () => [{ n: 0 }]],
      ]) as never);
      expect((await deletionImpact("re1"))!.receiptPayment).toEqual({ amountSatang: 3210000, voided: false, invoiceId: "so1", invoiceNo: "PO PO-6611", deposit: true, billing: false, invoiceIds: ["so1"] });
    });
  });

  describe("the customer PO itself", () => {
    const soRow = {
      id: "so1", docType: "SO", status: "issued", docNo: null, salesRecordId: null, relatedDocId: null, salesOrderId: null,
      customerPoNo: "PO-6611", buyerName: "บริษัท เอ", totalSatang: 10700000,
    };
    /** `invoices` delivered from it, `receipts` of its deposits (voided ones too), `deposits` live. */
    const soDb = (invoices: number, receipts = 0, deposits = 0) =>
      conn.query.mockImplementation(router([
        [/SELECT docType, relatedDocId FROM acc_documents WHERE id = \?$/, () => [{ docType: "SO", relatedDocId: null }]],
        [/SELECT id, docType, status, docNo, salesRecordId, relatedDocId, .*FROM acc_documents WHERE id = \? FOR UPDATE/, () => [soRow]],
        [/COUNT\(\*\) AS n FROM acc_payments/, () => [{ n: deposits }]],
        [/WHERE relatedDocId = \? OR salesOrderId = \?/, () => [{ n: invoices + receipts }]],
        [/COUNT\(\*\) AS n FROM acc_documents WHERE salesOrderId = \? FOR UPDATE/, () => [{ n: invoices }]],
      ]));

    it("cannot be deleted while an invoice delivers from it — cancelling is the way", async () => {
      soDb(1);
      await expect(deleteAccDocument("so1", actor, { passwordChecked: true })).rejects.toMatchObject({
        status: 409,
        message: "มีใบแจ้งหนี้ที่ส่งของจาก PO นี้แล้ว — ลบใบแจ้งหนี้นั้นก่อน หรือกด ยกเลิก PO แทน",
      });
      expect(statements()).not.toContain("DELETE FROM acc_documents WHERE id = ?");
    });

    it("cannot be deleted while it holds a deposit, or a deposit's receipt", async () => {
      soDb(0, 1, 1);
      await expect(deleteAccDocument("so1", actor, { passwordChecked: true })).rejects.toMatchObject({
        status: 409,
        message: "PO นี้มีเงินมัดจำแล้ว — ยกเลิกรายการมัดจำก่อนจึงจะลบได้",
      });
      soDb(0, 1, 0);
      await expect(deleteAccDocument("so1", actor, { passwordChecked: true })).rejects.toMatchObject({
        status: 409,
        message: expect.stringContaining("มีใบเสร็จมัดจำของ PO นี้"),
      });
    });

    it("goes with its lines and its plan otherwise, named by the customer's PO number — no number of ours to give back", async () => {
      soDb(0);
      const result = await deleteAccDocument("so1", actor, { passwordChecked: true });
      expect(result).toMatchObject({ releasedNumber: false, saleDeleted: false });
      expect(statements()).toContain("DELETE FROM acc_document_lines WHERE documentId = ?");
      expect(vi.mocked(conn.query).mock.calls).toContainEqual(["DELETE FROM acc_plan_items WHERE salesOrderId = ?", ["so1"]]);
      expect(releaseDocNoIfLatest).not.toHaveBeenCalled();
      expect(writeAudit).toHaveBeenCalledWith(conn, expect.objectContaining({ action: "doc.delete", docNo: "PO-6611", detail: expect.stringMatching(/^ลบ · PO ลูกค้า PO-6611 · /) }));
    });
  });
});

// Step 7 — billing notes.
describe("deleting around a billing note", () => {
  it("refuses to delete an invoice while an open billing note lists it", async () => {
    conn.query.mockImplementation(router([
      [/SELECT docType, relatedDocId FROM acc_documents WHERE id = \?$/, () => [{ docType: "INV", relatedDocId: null }]],
      [/SELECT id, docType, status, docNo, salesRecordId, relatedDocId, .*FROM acc_documents WHERE id = \? FOR UPDATE/, () => [{
        id: "d1", docType: "INV", status: "issued", docNo: "INV2026110005", salesRecordId: null, relatedDocId: null, salesOrderId: null, customerPoNo: "", buyerName: "บริษัท เอ", totalSatang: 6206000,
      }]],
      [/COUNT\(\*\) AS n/, () => [{ n: 0 }]],
      [/FROM acc_billing_items bi JOIN acc_documents b/, () => [{ docNo: "BN2026110001" }]],
    ]));
    await expect(deleteAccDocument("d1", actor, { passwordChecked: true })).rejects.toMatchObject({
      status: 409,
      message: "ใบนี้อยู่ในใบวางบิล BN2026110001 — ยกเลิกหรือลบใบวางบิลนั้นก่อน",
    });
  });

  const noteDb = (live: number, receipts = 0) =>
    conn.query.mockImplementation(router([
      [/SELECT docType, relatedDocId FROM acc_documents WHERE id = \?$/, () => [{ docType: "BN", relatedDocId: null }]],
      [/SELECT id, docType, status, docNo, salesRecordId, relatedDocId, .*FROM acc_documents WHERE id = \? FOR UPDATE/, () => [{
        id: "bn1", docType: "BN", status: "issued", docNo: "BN2026110001", salesRecordId: null, relatedDocId: null, salesOrderId: null, customerPoNo: "", buyerName: "บริษัท เอ", totalSatang: 160500,
      }]],
      [/COUNT\(\*\) AS n FROM acc_payments WHERE billingNoteId = \?/, () => [{ n: live }]],
      [/WHERE relatedDocId = \? OR salesOrderId = \?/, () => [{ n: receipts }]],
      [/FROM acc_counters/, () => [{ lastNo: 1 }]],
    ]));

  it("refuses to delete a billing note money came in against, or one with its receipts left", async () => {
    noteDb(2);
    await expect(deleteAccDocument("bn1", actor, { passwordChecked: true })).rejects.toMatchObject({ status: 409, message: expect.stringContaining("มีการรับชำระแล้ว") });
    noteDb(0, 1);
    await expect(deleteAccDocument("bn1", actor, { passwordChecked: true })).rejects.toMatchObject({ status: 409, message: expect.stringContaining("มีใบเสร็จตามใบวางบิลนี้") });
  });

  it("deletes a billing note with its list; the payments voided on it stop pointing at it; its number goes back", async () => {
    noteDb(0);
    const result = await deleteAccDocument("bn1", actor, { passwordChecked: true });
    const calls = vi.mocked(conn.query).mock.calls;
    expect(calls).toContainEqual(["DELETE FROM acc_billing_items WHERE billingNoteId = ?", ["bn1"]]);
    expect(calls).toContainEqual(["UPDATE acc_payments SET billingNoteId = NULL WHERE billingNoteId = ?", ["bn1"]]);
    expect(result.releasedNumber).toBe(true);
  });

  it("deleting a billing note's receipt gives each invoice it paid its share back", async () => {
    conn.query.mockImplementation(router([
      [/SELECT docType, relatedDocId FROM acc_documents WHERE id = \?$/, () => [{ docType: "RE", relatedDocId: "bn1" }]],
      [/SELECT id, docType, docNo, salesRecordId, customerPoNo, vatRate FROM acc_documents WHERE id = \? FOR UPDATE/, () => [{ id: "bn1", docType: "BN", docNo: "BN2026110001", salesRecordId: null, customerPoNo: "", vatRate: "7.00" }]],
      [/SELECT id, docType, status, docNo, salesRecordId, relatedDocId, .*FROM acc_documents WHERE id = \? FOR UPDATE/, () => [{
        id: "re1", docType: "RE", status: "issued", docNo: "RE2026110007", salesRecordId: null, relatedDocId: "bn1", salesOrderId: null, customerPoNo: "", buyerName: "บริษัท เอ", totalSatang: 160500, vatBaseSatang: 150000,
      }]],
      [/SELECT amountSatang, voidedAt, documentId FROM acc_payments WHERE receiptId = \?/, () => [
        { amountSatang: 107000, voidedAt: null, documentId: "A" },
        { amountSatang: 53500, voidedAt: null, documentId: "B" },
      ]],
      [/SELECT docNo, docType, customerPoNo FROM acc_documents WHERE id = \?/, () => [{ docNo: "BN2026110001", docType: "BN", customerPoNo: "" }]],
      [/COUNT\(\*\) AS n/, () => [{ n: 0 }]],
      [/FROM acc_counters/, () => [{ lastNo: 7 }]],
      [/COALESCE\(SUM\(amountSatang\), 0\) AS paid/, () => [{ paid: 0 }]],
      [/SELECT docNo, salesRecordId FROM acc_documents WHERE id = \? FOR UPDATE/, (p) => [{ docNo: p[0] === "A" ? "INV2026110001" : "INV2026110002", salesRecordId: null }]],
    ]));
    await deleteAccDocument("re1", actor, { passwordChecked: true });
    const calls = vi.mocked(conn.query).mock.calls;
    expect(calls).toContainEqual(["DELETE FROM acc_payments WHERE receiptId = ?", ["re1"]]);
    expect(calls).toContainEqual(["UPDATE acc_documents SET paidSatang = ? WHERE id = ?", [0, "A"]]);
    expect(calls).toContainEqual(["UPDATE acc_documents SET paidSatang = ? WHERE id = ?", [0, "B"]]);
    expect(writeAudit).toHaveBeenCalledWith(conn, expect.objectContaining({ documentId: "A", detail: expect.stringContaining("ตามใบวางบิล BN2026110001") }));
    expect(writeAudit).toHaveBeenCalledWith(conn, expect.objectContaining({ documentId: "bn1", detail: expect.stringContaining("1,605.00") }));
  });
});

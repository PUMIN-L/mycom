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
      [/FOR UPDATE/, () => [issuedRow]],
      [/FROM acc_payments/, () => [{ n: 1 }]],
    ]));
    await expect(deleteAccDocument("d1", actor, { passwordChecked: true })).rejects.toMatchObject({ status: 409, message: expect.stringContaining("รับชำระ") });
  });

  it("takes the sale and the history-free machines along, keeps the others, gives the number back", async () => {
    conn.query.mockImplementation(router([
      [/FOR UPDATE/, () => [issuedRow]],
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

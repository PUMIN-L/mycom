// @vitest-environment node
/**
 * What the accountant's workbook is read from (lib/accounting/exportData.ts):
 *  • the month's documents (not drafts) — the tax ones are the sales-tax report;
 *  • tax invoices issued ELSEWHERE for services paid in the month, one per
 *    receipt (a billing note's shares are one), live payments only;
 *  • the month's payments; receivables and deposits as at the month's end —
 *    only what was dated before the next month counts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/app/lib/db", () => ({ query: vi.fn() }));
import { query } from "@/app/lib/db";
vi.mock("@/app/lib/accounting/settings", () => ({
  getSellerProfile: vi.fn(async () => ({ seller: { name: "บริษัท โปรฟิน แล็บ จำกัด", address: "", taxId: "0107537000114", branchCode: "00000", phone: "", email: "" }, versionId: "v1" })),
}));

import { monthlyWorkbookData } from "@/app/lib/accounting/exportData";

type Handler = [RegExp, (params: unknown[]) => unknown];
function router(handlers: Handler[]) {
  return async (sql: string, params: unknown[] = []) => {
    for (const [pattern, answer] of handlers) if (pattern.test(sql)) return [answer(params), []];
    return [[], []];
  };
}
const sqlOf = (pattern: RegExp) => vi.mocked(query).mock.calls.find(([s]) => pattern.test(String(s)))!;

const DOC = {
  docType: "INV", docNo: "INV2026110002", status: "issued", source: "internal", externalNote: "", isTaxInvoice: 1, issueDate: "2026-11-05",
  buyerName: "บริษัท เอ จำกัด", buyerTaxId: "0107537000114", buyerBranch: "00000", vatBaseSatang: "200000", vatSatang: "14000", totalSatang: "214000",
  voidReason: null, relatedNo: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(query).mockReset();
  vi.mocked(query).mockImplementation(router([]) as never);
});

describe("monthlyWorkbookData", () => {
  it("refuses a month that is not one", async () => {
    await expect(monthlyWorkbookData("2026-13")).rejects.toMatchObject({ status: 400 });
    expect(query).not.toHaveBeenCalled();
  });

  it("reads the month's documents — the tax ones are the sales-tax report, the billing notes and plain invoices only the register", async () => {
    vi.mocked(query).mockImplementation(router([
      [/FROM acc_documents d LEFT JOIN acc_documents r ON r.id = d.relatedDocId/, () => [
        DOC,
        { ...DOC, docNo: "INV2026110003", isTaxInvoice: 0 },
        { ...DOC, docType: "BN", docNo: "BN2026110001", isTaxInvoice: 0 },
        { ...DOC, docType: "CN", docNo: "CN2026110001", relatedNo: "INV2026110002" },
        { ...DOC, docType: "RE", docNo: "RE2026110001", status: "void", voidReason: "ออกผิด", relatedNo: "PO PO-77", relatedType: "SO" },
      ]],
    ]) as never);
    const data = await monthlyWorkbookData("2026-11");
    expect(data.month).toBe("2026-11");
    expect(data.seller.name).toBe("บริษัท โปรฟิน แล็บ จำกัด");
    expect(data.register.map((d) => d.docNo)).toEqual(["INV2026110002", "INV2026110003", "BN2026110001", "CN2026110001", "RE2026110001"]);
    expect(data.salesTax.map((d) => d.docNo)).toEqual(["INV2026110002", "CN2026110001", "RE2026110001"]);
    expect(data.register[0]).toMatchObject({ isTaxInvoice: true, vatBaseSatang: 200000, vatSatang: 14000, totalSatang: 214000, relatedNo: null });
    expect(data.register[4]).toMatchObject({ status: "void", voidReason: "ออกผิด", relatedNo: "PO PO-77", relatedType: "SO" });
    const [sql, params] = sqlOf(/FROM acc_documents d LEFT JOIN acc_documents r/);
    expect(String(sql)).toContain("d.status <> 'draft'");
    expect(String(sql)).toContain("d.docType IN ('INV', 'RE', 'BN', 'CN')");
    // A deposit's receipt names the customer PO it was for.
    expect(String(sql)).toContain("CONCAT('PO ', r.customerPoNo)");
    expect(params).toEqual(["2026-11-01", "2026-12-01"]);
  });

  it("finds tax invoices issued elsewhere: one per receipt — a billing note's shares are one — older payments' VAT worked out", async () => {
    vi.mocked(query).mockImplementation(router([
      [/WHERE p.externalReceiptNo <> ''/, () => [
        { id: "p1", groupId: "g1", paidDate: "2026-11-15", externalReceiptNo: "เล่ม 2/41", amountSatang: 53500, vatSatang: 3500, docNo: "INV2026110005", buyerName: "ร้าน บี", buyerTaxId: "", buyerBranch: "", vatRate: "7.00" },
        { id: "p2", groupId: "g1", paidDate: "2026-11-15", externalReceiptNo: "เล่ม 2/41", amountSatang: 107000, vatSatang: 7000, docNo: "INV2026110006", buyerName: "ร้าน บี", buyerTaxId: "", buyerBranch: "", vatRate: "7.00" },
        // Before v53 a payment kept no VAT of its own: the VAT inside 1,070.00 at 7%.
        { id: "p3", groupId: null, paidDate: "2026-11-16", externalReceiptNo: "เล่ม 2/42", amountSatang: 107000, vatSatang: null, docNo: "INV2026100001", buyerName: "ร้าน ซี", buyerTaxId: "", buyerBranch: "", vatRate: "7.00" },
      ]],
    ]) as never);
    const data = await monthlyWorkbookData("2026-11");
    expect(data.externalReceipts).toEqual([
      { paidDate: "2026-11-15", receiptNo: "เล่ม 2/41", buyerName: "ร้าน บี", buyerTaxId: "", buyerBranch: "", amountSatang: 160500, vatSatang: 10500, invoiceNos: ["INV2026110005", "INV2026110006"] },
      { paidDate: "2026-11-16", receiptNo: "เล่ม 2/42", buyerName: "ร้าน ซี", buyerTaxId: "", buyerBranch: "", amountSatang: 107000, vatSatang: 7000, invoiceNos: ["INV2026100001"] },
    ]);
    // Live payments on invoices that are NOT the tax invoice — their receipt was.
    const [sql] = sqlOf(/WHERE p.externalReceiptNo <> ''/);
    expect(String(sql)).toContain("p.voidedAt IS NULL");
    expect(String(sql)).toContain("d.isTaxInvoice = 0");
  });

  it("reads the month's payments, voided ones too, each with its document, billing note, receipt and account", async () => {
    vi.mocked(query).mockImplementation(router([
      [/LEFT JOIN acc_bank_accounts a ON a.id = p.bankAccountId/, () => [
        { paidDate: "2026-11-18", method: "transfer", amountSatang: "2033000", whtPercent: "3.00", whtSatang: "57000", feeSatang: "0", externalReceiptNo: "", cert50Received: 1, cert50Note: "แฟ้ม", note: "", voidedAt: null, voidReason: null, docType: "INV", docNo: "INV2026110001", buyerName: "บริษัท เอ จำกัด", buyerTaxId: "0107537000114", billingNo: "BN2026110001", receiptNo: "RE2026110001", bankName: "กสิกรไทย", accountNo: "123-4-56789-0" },
        { paidDate: "2026-11-19", method: "cash", amountSatang: "-107000", whtPercent: "0", whtSatang: "0", feeSatang: "0", externalReceiptNo: "", cert50Received: 0, cert50Note: "", note: "คืนเงินลูกค้า", voidedAt: "2026-11-20T00:00:00.000Z", voidReason: "ผิด", docType: "INV", docNo: "INV2026110001", buyerName: "บริษัท เอ จำกัด", buyerTaxId: "", billingNo: null, receiptNo: null, bankName: null, accountNo: null },
      ]],
    ]) as never);
    const data = await monthlyWorkbookData("2026-11");
    expect(data.payments[0]).toEqual({
      paidDate: "2026-11-18", docType: "INV", docNo: "INV2026110001", billingNo: "BN2026110001", buyerName: "บริษัท เอ จำกัด", buyerTaxId: "0107537000114",
      method: "transfer", bankLabel: "กสิกรไทย 123-4-56789-0", amountSatang: 2033000, whtPercent: 3, whtSatang: 57000, feeSatang: 0, receiptNo: "RE2026110001",
      externalReceiptNo: "", cert50Received: true, cert50Note: "แฟ้ม", note: "", voidedAt: null, voidReason: null,
    });
    expect(data.payments[1]).toMatchObject({ amountSatang: -107000, bankLabel: "", voidedAt: "2026-11-20T00:00:00.000Z", voidReason: "ผิด", cert50Received: false });
    const [sql, params] = sqlOf(/LEFT JOIN acc_bank_accounts/);
    expect(String(sql)).not.toContain("voidedAt IS NULL");
    // A deposit pays a customer PO — named by the customer's number.
    expect(String(sql)).toContain("COALESCE(d.docNo, CONCAT('PO ', d.customerPoNo)) AS docNo");
    expect(params).toEqual(["2026-11-01", "2026-12-01"]);
  });

  it("receivables as at the month's end: credit notes and live payments dated before the next month", async () => {
    vi.mocked(query).mockImplementation(router([
      [/AS creditedSatang/, () => [
        { id: "A", docNo: "INV2026110001", source: "internal", issueDate: "2026-11-01", dueDate: "2026-11-15", companyId: "co1", buyerName: "บริษัท เอ จำกัด", totalSatang: "214000", creditedSatang: "107000", paidSatang: "0" },
      ]],
    ]) as never);
    const data = await monthlyWorkbookData("2026-11");
    expect(data.receivables).toEqual([
      { id: "A", docNo: "INV2026110001", source: "internal", issueDate: "2026-11-01", dueDate: "2026-11-15", companyId: "co1", buyerName: "บริษัท เอ จำกัด", totalSatang: 214000, creditedSatang: 107000, paidSatang: 0 },
    ]);
    const [sql, params] = sqlOf(/AS creditedSatang/);
    expect(String(sql)).toContain("c.docType = 'CN' AND c.status = 'issued' AND c.issueDate < ?");
    expect(String(sql)).toContain("p.voidedAt IS NULL AND p.paidDate < ?");
    expect(String(sql)).toContain("d.docType = 'INV' AND d.status = 'issued' AND d.issueDate < ?");
    expect(params).toEqual(["2026-12-01", "2026-12-01", "2026-12-01"]);
  });

  it("deposits as at the month's end: received (the receipt's value before VAT) less what delivery invoices deducted — a PO with none left out", async () => {
    vi.mocked(query).mockImplementation(router([
      [/SELECT id, customerPoNo, buyerName, vatRate FROM acc_documents WHERE docType = 'SO'/, () => [
        { id: "so1", customerPoNo: "PO-1", buyerName: "บริษัท เอ จำกัด", vatRate: "7.00" },
        { id: "so2", customerPoNo: "PO-2", buyerName: "ร้าน บี", vatRate: "7.00" },
        { id: "so3", customerPoNo: "PO-3", buyerName: "ร้าน ซี", vatRate: "7.00" },
      ]],
      [/SELECT p.documentId, p.amountSatang, r.vatBaseSatang AS receiptBase/, () => [
        { documentId: "so1", amountSatang: "214000", receiptBase: "200000" },
        { documentId: "so1", amountSatang: "107000", receiptBase: "100000" },
        // No receipt to read: the VAT inside the amount comes off.
        { documentId: "so2", amountSatang: "107000", receiptBase: null },
      ]],
      [/SELECT salesOrderId, COALESCE\(SUM\(depositSatang\), 0\) AS d/, () => [{ salesOrderId: "so1", d: "100000" }]],
    ]) as never);
    const data = await monthlyWorkbookData("2026-11");
    expect(data.deposits).toEqual([
      { customerPoNo: "PO-1", buyerName: "บริษัท เอ จำกัด", receivedSatang: 321000, receivedExVatSatang: 300000, deductedSatang: 100000 },
      { customerPoNo: "PO-2", buyerName: "ร้าน บี", receivedSatang: 107000, receivedExVatSatang: 100000, deductedSatang: 0 },
    ]);
    const [receivedSql, receivedParams] = sqlOf(/AS receiptBase/);
    expect(String(receivedSql)).toContain("p.voidedAt IS NULL AND p.paidDate < ?");
    expect(receivedParams).toEqual(["2026-12-01"]);
    const [deductedSql] = sqlOf(/AS d FROM acc_documents/);
    expect(String(deductedSql)).toContain("status = 'issued' AND issueDate < ?");
  });

  it("reads no deposits at all when there is no customer PO", async () => {
    const data = await monthlyWorkbookData("2026-11");
    expect(data.deposits).toEqual([]);
    expect(vi.mocked(query).mock.calls.some(([s]) => String(s).includes("AS receiptBase"))).toBe(false);
  });
});

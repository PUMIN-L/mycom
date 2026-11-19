import "server-only";
import type { RowDataPacket } from "mysql2";
import { query } from "../db";
import { ApiError } from "../apiHelpers";
import { getSellerProfile } from "./settings";
import { vatInsideSatang } from "./depositRules";
import {
  monthRange,
  type DepositAsAt,
  type ExternalTaxReceipt,
  type PaymentEntry,
  type ReceivableAsAt,
  type RegisterDoc,
  type WorkbookData,
} from "./exportRules";

// What the accountant's monthly workbook is made of (step 9) — read on
// demand, nothing stored. Plain reads: a report, not a decision. The sheets
// themselves are built by exportRules.ts.

const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const strOrNull = (v: unknown) => (v === null || v === undefined || v === "" ? null : String(v));
const num = (v: unknown) => Number(v) || 0;

async function run(sql: string, params: unknown[]): Promise<RowDataPacket[]> {
  const [rows] = await query<RowDataPacket[]>(sql, params);
  return rows;
}

/** Everything the month's workbook needs. `month` is "YYYY-MM". */
export async function monthlyWorkbookData(month: string): Promise<WorkbookData> {
  const range = monthRange(month);
  if (!range) throw new ApiError(400, "กรุณาเลือกเดือน");
  const { seller } = await getSellerProfile();

  // Our documents dated in the month — the register; the tax documents among them are the sales-tax report.
  const docRows = await run(
    `SELECT d.docType, d.docNo, d.status, d.source, d.externalNote, d.isTaxInvoice, d.issueDate, d.buyerName, d.buyerTaxId, d.buyerBranch,
            d.vatBaseSatang, d.vatSatang, d.totalSatang, d.voidReason, r.docType AS relatedType,
            COALESCE(r.docNo, CASE WHEN r.docType = 'SO' THEN CONCAT('PO ', r.customerPoNo) END) AS relatedNo
       FROM acc_documents d LEFT JOIN acc_documents r ON r.id = d.relatedDocId
      WHERE d.docType IN ('INV', 'RE', 'BN', 'CN') AND d.status <> 'draft' AND d.issueDate >= ? AND d.issueDate < ?
      ORDER BY d.issueDate ASC, d.docNo ASC`,
    [range.from, range.to]
  );
  const register: RegisterDoc[] = docRows.map((r) => ({
    docType: str(r.docType),
    docNo: strOrNull(r.docNo),
    status: str(r.status),
    source: str(r.source),
    externalNote: str(r.externalNote),
    isTaxInvoice: Number(r.isTaxInvoice) === 1,
    issueDate: str(r.issueDate),
    buyerName: str(r.buyerName),
    buyerTaxId: str(r.buyerTaxId),
    buyerBranch: str(r.buyerBranch),
    vatBaseSatang: num(r.vatBaseSatang),
    vatSatang: num(r.vatSatang),
    totalSatang: num(r.totalSatang),
    relatedNo: strOrNull(r.relatedNo),
    relatedType: strOrNull(r.relatedType),
    voidReason: strOrNull(r.voidReason),
  }));
  const salesTax = register.filter((d) => d.isTaxInvoice && (d.docType === "INV" || d.docType === "RE" || d.docType === "CN"));

  // Tax invoices issued ELSEWHERE for money received in the month: a services
  // invoice (not the tax invoice itself) paid against a receipt from another
  // book — one per receipt (a billing note's shares are one receipt).
  const externalRows = await run(
    `SELECT p.id, p.groupId, p.paidDate, p.externalReceiptNo, p.amountSatang, p.vatSatang, d.docNo, d.buyerName, d.buyerTaxId, d.buyerBranch, d.vatRate
       FROM acc_payments p JOIN acc_documents d ON d.id = p.documentId
      WHERE p.externalReceiptNo <> '' AND p.voidedAt IS NULL AND d.docType = 'INV' AND d.isTaxInvoice = 0
        AND p.paidDate >= ? AND p.paidDate < ?
      ORDER BY p.paidDate ASC, p.createdAt ASC`,
    [range.from, range.to]
  );
  const external = new Map<string, ExternalTaxReceipt>();
  for (const r of externalRows) {
    const key = `${str(r.paidDate)}|${str(r.externalReceiptNo)}|${str(r.groupId) || str(r.id)}`;
    const amount = num(r.amountSatang);
    // Older payments kept no VAT of their own: the VAT inside the amount.
    const vat = r.vatSatang === null || r.vatSatang === undefined ? vatInsideSatang(amount, num(r.vatRate)) : num(r.vatSatang);
    const entry = external.get(key) ?? {
      paidDate: str(r.paidDate),
      receiptNo: str(r.externalReceiptNo),
      buyerName: str(r.buyerName),
      buyerTaxId: str(r.buyerTaxId),
      buyerBranch: str(r.buyerBranch),
      amountSatang: 0,
      vatSatang: 0,
      invoiceNos: [],
    };
    entry.amountSatang += amount;
    entry.vatSatang += vat;
    if (r.docNo) entry.invoiceNos.push(str(r.docNo));
    external.set(key, entry);
  }

  // Money received in the month, voided ones too.
  const paymentRows = await run(
    `SELECT p.paidDate, p.method, p.amountSatang, p.whtPercent, p.whtSatang, p.feeSatang, p.externalReceiptNo, p.cert50Received, p.cert50Note,
            p.note, p.voidedAt, p.voidReason, d.docType, COALESCE(d.docNo, CONCAT('PO ', d.customerPoNo)) AS docNo, d.buyerName, d.buyerTaxId,
            b.docNo AS billingNo, r.docNo AS receiptNo, a.bankName, a.accountNo
       FROM acc_payments p
       JOIN acc_documents d ON d.id = p.documentId
       LEFT JOIN acc_documents b ON b.id = p.billingNoteId
       LEFT JOIN acc_documents r ON r.id = p.receiptId
       LEFT JOIN acc_bank_accounts a ON a.id = p.bankAccountId
      WHERE p.paidDate >= ? AND p.paidDate < ?
      ORDER BY p.paidDate ASC, p.createdAt ASC`,
    [range.from, range.to]
  );
  const payments: PaymentEntry[] = paymentRows.map((r) => ({
    paidDate: str(r.paidDate),
    docType: str(r.docType),
    docNo: strOrNull(r.docNo),
    billingNo: strOrNull(r.billingNo),
    buyerName: str(r.buyerName),
    buyerTaxId: str(r.buyerTaxId),
    method: str(r.method),
    bankLabel: r.bankName ? `${str(r.bankName)} ${str(r.accountNo)}` : "",
    amountSatang: num(r.amountSatang),
    whtPercent: num(r.whtPercent),
    whtSatang: num(r.whtSatang),
    feeSatang: num(r.feeSatang),
    receiptNo: strOrNull(r.receiptNo),
    externalReceiptNo: str(r.externalReceiptNo),
    cert50Received: Number(r.cert50Received) === 1,
    cert50Note: str(r.cert50Note),
    note: str(r.note),
    voidedAt: strOrNull(r.voidedAt),
    voidReason: strOrNull(r.voidReason),
  }));

  // What was owed at the month's end: each issued invoice dated by then, less
  // the credit notes and live payments dated by then.
  const owedRows = await run(
    `SELECT d.id, d.docNo, d.source, d.issueDate, d.dueDate, d.companyId, d.buyerName, d.totalSatang,
            COALESCE((SELECT SUM(c.totalSatang) FROM acc_documents c
                       WHERE c.relatedDocId = d.id AND c.docType = 'CN' AND c.status = 'issued' AND c.issueDate < ?), 0) AS creditedSatang,
            COALESCE((SELECT SUM(p.amountSatang) FROM acc_payments p
                       WHERE p.documentId = d.id AND p.voidedAt IS NULL AND p.paidDate < ?), 0) AS paidSatang
       FROM acc_documents d
      WHERE d.docType = 'INV' AND d.status = 'issued' AND d.issueDate < ?`,
    [range.to, range.to, range.to]
  );
  const receivables: ReceivableAsAt[] = owedRows.map((r) => ({
    id: String(r.id),
    docNo: strOrNull(r.docNo),
    source: str(r.source),
    issueDate: str(r.issueDate),
    dueDate: strOrNull(r.dueDate),
    companyId: str(r.companyId),
    buyerName: str(r.buyerName),
    totalSatang: num(r.totalSatang),
    creditedSatang: num(r.creditedSatang),
    paidSatang: num(r.paidSatang),
  }));

  // The deposits held at the month's end, as the PO's own ledger counts them:
  // received (its receipt's value before VAT), less what delivery invoices deducted.
  const orders = await run("SELECT id, customerPoNo, buyerName, vatRate FROM acc_documents WHERE docType = 'SO'", []);
  const deposits: DepositAsAt[] = [];
  if (orders.length > 0) {
    const received = await run(
      `SELECT p.documentId, p.amountSatang, r.vatBaseSatang AS receiptBase
         FROM acc_payments p
         JOIN acc_documents s ON s.id = p.documentId AND s.docType = 'SO'
         LEFT JOIN acc_documents r ON r.id = p.receiptId
        WHERE p.voidedAt IS NULL AND p.paidDate < ?`,
      [range.to]
    );
    const deducted = await run(
      `SELECT salesOrderId, COALESCE(SUM(depositSatang), 0) AS d FROM acc_documents
        WHERE docType = 'INV' AND status = 'issued' AND issueDate < ? AND salesOrderId IS NOT NULL AND depositSatang > 0
        GROUP BY salesOrderId`,
      [range.to]
    );
    const deductedOf = new Map(deducted.map((r) => [String(r.salesOrderId), num(r.d)]));
    const byOrder = new Map(orders.map((o) => [String(o.id), { customerPoNo: str(o.customerPoNo), buyerName: str(o.buyerName), vatRate: num(o.vatRate), receivedSatang: 0, receivedExVatSatang: 0 }]));
    for (const p of received) {
      const o = byOrder.get(String(p.documentId));
      if (!o) continue;
      const amount = num(p.amountSatang);
      o.receivedSatang += amount;
      o.receivedExVatSatang += p.receiptBase === null || p.receiptBase === undefined ? amount - vatInsideSatang(amount, o.vatRate) : num(p.receiptBase);
    }
    for (const [id, o] of byOrder) {
      if (o.receivedSatang === 0 && !deductedOf.has(id)) continue;
      deposits.push({ customerPoNo: o.customerPoNo, buyerName: o.buyerName, receivedSatang: o.receivedSatang, receivedExVatSatang: o.receivedExVatSatang, deductedSatang: deductedOf.get(id) ?? 0 });
    }
  }

  return { month, seller, salesTax, externalReceipts: [...external.values()], register, payments, receivables, deposits };
}

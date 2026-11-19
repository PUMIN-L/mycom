import "server-only";
import type { RowDataPacket } from "mysql2";
import type { PoolConnection } from "mysql2/promise";
import { query, withTransaction } from "../db";
import { ApiError } from "../apiHelpers";
import { bangkokDateString, formatDisplayDate } from "../dateFormat";
import { allocateDocNo } from "./numbering";
import { writeAudit } from "./audit";
import { getSellerProfile } from "./settings";
import { formatSatang } from "./money";
import { getAccDocument, type AccDocument } from "./documents";
import { recomputePaidSatang, syncSaleReceiptRef } from "./paymentLedger";
import { assertDepositNotDeductedTx } from "./depositLedger";
import { vatInsideSatang } from "./depositRules";
import {
  PAYMENT_LIMITS,
  firstPaymentProblem,
  groupReceivables,
  methodLabel,
  paymentProblems,
  receiptTitle,
  receiptVatSatang,
  serviceBaseSatang,
  vatShareSatang,
  type PaymentInput,
  type PaymentMethod,
  type ReceivableGroup,
  type AgeingBucket,
} from "./paymentRules";

// Money received against an invoice (step 4, ARCHITECTURE.md §8g).
//
// Recording a payment, in ONE transaction: the payment row, the receipt it
// gets (RE + month + running number — a ใบเสร็จรับเงิน/ใบกำกับภาษี when the
// invoice was not the tax invoice, i.e. services, whose VAT falls due on
// payment), the invoice's `paidSatang` re-summed, and the dashboard sale's
// เลขที่ใบเสร็จ. With an outside receipt number typed, no receipt is issued.
//
// A payment is never edited and never deleted on its own: a mistake is
// VOIDED (with a reason, the password again) — its receipt is voided with it,
// keeping its number in the register — and recorded again. Deleting the
// RECEIPT (documents.ts, for test data / a paper never handed over) takes its
// payment along.
//
// Locks are always taken invoice first, then its payments / receipts — the
// same order as deleting a receipt — so two of these cannot deadlock each other.

interface Actor {
  userId: string;
  username: string;
}

export interface AccPayment {
  id: string;
  /** The invoice it pays. */
  documentId: string;
  receiptId: string | null;
  /** The receipt's number (ours), when it has one. */
  receiptNo: string | null;
  receiptStatus: string | null;
  paidDate: string;
  method: PaymentMethod;
  bankAccountId: string | null;
  /** "กสิกรไทย 123-4-56789-0" — empty for cash, or an account since removed. */
  bankLabel: string;
  amountSatang: number;
  whtPercent: number;
  whtSatang: number;
  feeSatang: number;
  netSatang: number;
  cert50Received: boolean;
  cert50Note: string;
  externalReceiptNo: string;
  note: string;
  voidedAt: string | null;
  voidedBy: string | null;
  voidReason: string | null;
  createdAt: string;
  createdBy: string;
  /** Received against a billing note (step 7) — with the other payments of `groupId`, under the same receipt(s). */
  billingNoteId: string | null;
  groupId: string | null;
  /** The number of the document it pays (an invoice's; a PO's customer number for a deposit). */
  documentNo: string | null;
}

const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const strOrNull = (v: unknown) => (v === null || v === undefined || v === "" ? null : String(v));
const num = (v: unknown) => Number(v) || 0;

type Exec = Pick<PoolConnection, "query"> | null;
async function run(conn: Exec, sql: string, params: unknown[]): Promise<RowDataPacket[]> {
  const [rows] = conn ? await conn.query<RowDataPacket[]>(sql, params) : await query<RowDataPacket[]>(sql, params);
  return rows;
}

const PAYMENT_SELECT = `SELECT p.*, r.docNo AS receiptNo, r.status AS receiptStatus, b.bankName, b.accountNo, d.docNo AS documentNo
  FROM acc_payments p
  LEFT JOIN acc_documents r ON r.id = p.receiptId
  LEFT JOIN acc_bank_accounts b ON b.id = p.bankAccountId
  LEFT JOIN acc_documents d ON d.id = p.documentId`;

function rowToPayment(r: RowDataPacket): AccPayment {
  const amount = num(r.amountSatang);
  const wht = num(r.whtSatang);
  const fee = num(r.feeSatang);
  return {
    id: String(r.id),
    documentId: String(r.documentId),
    receiptId: strOrNull(r.receiptId),
    receiptNo: strOrNull(r.receiptNo),
    receiptStatus: strOrNull(r.receiptStatus),
    paidDate: str(r.paidDate),
    method: (["transfer", "cash", "cheque"].includes(String(r.method)) ? String(r.method) : "transfer") as PaymentMethod,
    bankAccountId: strOrNull(r.bankAccountId),
    bankLabel: r.bankName ? `${str(r.bankName)} ${str(r.accountNo)}`.trim() : "",
    amountSatang: amount,
    whtPercent: num(r.whtPercent),
    whtSatang: wht,
    feeSatang: fee,
    netSatang: amount - wht - fee,
    cert50Received: Number(r.cert50Received) === 1,
    cert50Note: str(r.cert50Note),
    externalReceiptNo: str(r.externalReceiptNo),
    note: str(r.note),
    voidedAt: strOrNull(r.voidedAt),
    voidedBy: strOrNull(r.voidedBy),
    voidReason: strOrNull(r.voidReason),
    createdAt: str(r.createdAt),
    createdBy: str(r.createdBy),
    billingNoteId: strOrNull(r.billingNoteId),
    groupId: strOrNull(r.groupId),
    documentNo: strOrNull(r.documentNo),
  };
}

/** Payments matching `where` (on `p`), voided ones too, oldest first. */
export async function listPaymentsWhere(where: string, params: unknown[]): Promise<AccPayment[]> {
  const rows = await run(null, `${PAYMENT_SELECT} WHERE ${where} ORDER BY p.paidDate ASC, p.createdAt ASC`, params);
  return rows.map(rowToPayment);
}

/** An invoice's payments, voided ones too (the history shows them struck through), oldest first. */
export function listPayments(invoiceId: string): Promise<AccPayment[]> {
  return listPaymentsWhere("p.documentId = ?", [invoiceId]);
}

export async function getPayment(id: string): Promise<AccPayment | null> {
  const [row] = await run(null, `${PAYMENT_SELECT} WHERE p.id = ? LIMIT 1`, [id]);
  return row ? rowToPayment(row) : null;
}

export interface PaymentContext {
  payments: AccPayment[];
  outstandingSatang: number;
  /** The invoice's services before VAT — what withholding is computed on. */
  serviceBaseSatang: number;
  /** The customer's usual withholding (set on the customer), 0 when none. */
  defaultWhtPercent: number;
  /** What the system would issue: true → ใบเสร็จรับเงิน/ใบกำกับภาษี. */
  receiptIsTaxInvoice: boolean;
}

/** Everything the payment dialog and the invoice's payment panel need. Null when there is no such invoice. */
export async function paymentContext(invoiceId: string): Promise<PaymentContext | null> {
  const doc = await getAccDocument(invoiceId);
  if (!doc || doc.docType !== "INV") return null;
  let defaultWhtPercent = 0;
  if (doc.companyId) {
    const [company] = await run(null, "SELECT whtPercent FROM companies WHERE id = ? LIMIT 1", [doc.companyId]);
    defaultWhtPercent = num(company?.whtPercent);
  }
  return {
    payments: await listPayments(invoiceId),
    outstandingSatang: Math.max(0, doc.totalSatang - doc.paidSatang),
    serviceBaseSatang: serviceBaseSatang(doc),
    defaultWhtPercent,
    receiptIsTaxInvoice: !doc.isTaxInvoice,
  };
}

/**
 * The VAT already declared on an invoice's live payments. Each payment knows
 * its own share since v53 (`vatSatang` — a receipt may cover several invoices,
 * step 7); an older one has its receipt's, or its share where the receipt is
 * an outside one.
 */
export async function vatOnLivePayments(
  conn: Exec,
  live: RowDataPacket[],
  invoice: { totalSatang: number; vatSatang: number }
): Promise<number> {
  const own = (p: RowDataPacket) => p.vatSatang !== null && p.vatSatang !== undefined;
  const receiptIds = live.filter((p) => !own(p)).map((p) => strOrNull(p.receiptId)).filter((id): id is string => Boolean(id));
  let vat = 0;
  if (receiptIds.length > 0) {
    // A locking (current) read: the receipt of a payment committed while this
    // one waited for the invoice's lock is not in the transaction's snapshot.
    const rows = await run(conn, `SELECT id, vatSatang FROM acc_documents WHERE id IN (${receiptIds.map(() => "?").join(", ")}) FOR UPDATE`, receiptIds);
    const byId = new Map(rows.map((r) => [String(r.id), num(r.vatSatang)]));
    for (const id of receiptIds) vat += byId.get(id) ?? 0;
  }
  for (const p of live) {
    if (own(p)) vat += num(p.vatSatang);
    else if (!p.receiptId) vat += vatShareSatang(num(p.amountSatang), invoice);
  }
  return vat;
}

export interface RecordedPayment {
  payment: AccPayment;
  receipt: { id: string; docNo: string; title: string } | null;
  paidSatang: number;
}

/** The document a receipt pays — its buyer is copied onto the receipt as printed. */
type ReceiptFor = Pick<
  AccDocument,
  "companyId" | "customerId" | "salespersonId" | "buyerName" | "buyerAddress" | "buyerTaxId" | "buyerBranch" | "vatRate" | "customerPoNo" | "projectName"
>;

/**
 * Issues a receipt (RE, our next number in the month of `paidDate`) for money
 * received against `relatedDocId` — an invoice, or a customer PO for a
 * deposit — inside the caller's transaction. No lines: the paper prints what it
 * pays for from the document it points at.
 */
export async function insertReceiptTx(
  conn: PoolConnection,
  r: { pays: ReceiptFor; relatedDocId: string; paidDate: string; amountSatang: number; vatSatang: number; isTaxInvoice: boolean; versionId: string; actor: Actor; now: string }
): Promise<{ id: string; docNo: string }> {
  const docNo = await allocateDocNo(conn, "RE", r.paidDate);
  const id = crypto.randomUUID();
  const row: Record<string, unknown> = {
    id,
    docType: "RE",
    docNo,
    status: "issued",
    source: "internal",
    isTaxInvoice: r.isTaxInvoice ? 1 : 0,
    issueDate: r.paidDate,
    creditDays: 0,
    companyId: r.pays.companyId || null,
    customerId: r.pays.customerId || null,
    salespersonId: r.pays.salespersonId || null,
    buyerName: r.pays.buyerName,
    buyerAddress: r.pays.buyerAddress,
    buyerTaxId: r.pays.buyerTaxId,
    buyerBranch: r.pays.buyerBranch,
    sellerVersionId: r.versionId,
    priceMode: "exclusive",
    vatRate: r.pays.vatRate,
    subtotalSatang: r.amountSatang - r.vatSatang,
    vatBaseSatang: r.amountSatang - r.vatSatang,
    vatSatang: r.vatSatang,
    totalSatang: r.amountSatang,
    // A receipt is money already received.
    paidSatang: r.amountSatang,
    customerPoNo: r.pays.customerPoNo,
    projectName: r.pays.projectName,
    relatedDocId: r.relatedDocId,
    issuedAt: r.now,
    issuedBy: r.actor.username,
    createdAt: r.now,
    createdBy: r.actor.username,
    updatedAt: r.now,
  };
  const keys = Object.keys(row);
  await conn.query(`INSERT INTO acc_documents (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`, Object.values(row));
  return { id, docNo };
}

/** Writes the payment row — against an invoice, or a customer PO for a deposit — inside the caller's transaction. */
export async function insertPaymentTx(
  conn: PoolConnection,
  p: {
    documentId: string;
    receiptId: string | null;
    input: PaymentInput;
    actor: Actor;
    now: string;
    /** Its share of the VAT — what its receipt declares for it. */
    vatSatang: number;
    /** Received against a billing note, with the other payments it came with (step 7). */
    billingNoteId?: string | null;
    groupId?: string | null;
  }
): Promise<string> {
  const { input } = p;
  const paymentId = crypto.randomUUID();
  const payment: Record<string, unknown> = {
    id: paymentId,
    documentId: p.documentId,
    receiptId: p.receiptId,
    paidDate: input.paidDate,
    method: input.method,
    bankAccountId: input.bankAccountId || null,
    amountSatang: input.amountSatang,
    whtPercent: input.whtSatang > 0 ? input.whtPercent : 0,
    whtSatang: input.whtSatang,
    feeSatang: input.feeSatang,
    cert50Received: input.whtSatang > 0 && input.cert50Received ? 1 : 0,
    cert50Note: input.whtSatang > 0 ? input.cert50Note : "",
    externalReceiptNo: input.externalReceiptNo,
    note: input.note,
    vatSatang: p.vatSatang,
    billingNoteId: p.billingNoteId ?? null,
    groupId: p.groupId ?? null,
    createdAt: p.now,
    createdBy: p.actor.username,
  };
  const keys = Object.keys(payment);
  await conn.query(`INSERT INTO acc_payments (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`, Object.values(payment));
  return paymentId;
}

/** Refuses (400) a bank account that is not there or was closed. */
export async function assertBankAccountUsable(bankAccountId: string): Promise<void> {
  if (!bankAccountId) return;
  const [bank] = await run(null, "SELECT isActive FROM acc_bank_accounts WHERE id = ?", [bankAccountId]);
  if (!bank) throw new ApiError(400, "ไม่พบบัญชีธนาคารที่เลือก — เลือกใหม่อีกครั้ง");
  if (Number(bank.isActive) !== 1) throw new ApiError(400, "บัญชีธนาคารนี้ปิดใช้แล้ว — เลือกบัญชีอื่น");
}

/**
 * Records money received against an ISSUED invoice — and issues its receipt
 * (unless `externalReceiptNo` says one was issued elsewhere). Refused for more
 * than is still owed, checked again under the invoice's lock.
 */
export async function recordPayment(invoiceId: string, input: PaymentInput, actor: Actor): Promise<RecordedPayment> {
  const doc = await getAccDocument(invoiceId);
  if (!doc || doc.docType !== "INV") throw new ApiError(404, "ไม่พบใบแจ้งหนี้นี้");
  if (doc.status === "draft") throw new ApiError(409, "ออกใบแจ้งหนี้ก่อนจึงจะรับชำระได้");
  if (doc.status !== "issued") throw new ApiError(409, "ใบแจ้งหนี้นี้ถูกยกเลิกแล้ว — รับชำระไม่ได้");
  const problem = firstPaymentProblem(
    paymentProblems(input, { outstandingSatang: doc.totalSatang - doc.paidSatang, today: bangkokDateString(new Date()) })
  );
  if (problem) throw new ApiError(400, problem);
  await assertBankAccountUsable(input.bankAccountId);
  const issuing = !input.externalReceiptNo;
  const versionId = issuing ? (await getSellerProfile()).versionId : null;
  if (issuing && !versionId) throw new ApiError(409, "ยังไม่ได้ตั้งข้อมูลบริษัทสำหรับพิมพ์บนใบเสร็จ — ไปที่ ตั้งค่าบัญชี ก่อน");
  const receiptIsTaxInvoice = !doc.isTaxInvoice;

  const done = await withTransaction(async (conn) => {
    const [inv] = await run(conn, "SELECT status, totalSatang, vatSatang FROM acc_documents WHERE id = ? FOR UPDATE", [invoiceId]);
    if (!inv || inv.status !== "issued") throw new ApiError(409, "ใบแจ้งหนี้นี้เปลี่ยนไปแล้ว — กรุณาเปิดหน้านี้ใหม่");
    const invoice = { totalSatang: num(inv.totalSatang), vatSatang: num(inv.vatSatang) };
    const live = await run(conn, "SELECT id, amountSatang, receiptId, vatSatang FROM acc_payments WHERE documentId = ? AND voidedAt IS NULL FOR UPDATE", [invoiceId]);
    const paidBefore = live.reduce((sum, p) => sum + num(p.amountSatang), 0);
    const owed = invoice.totalSatang - paidBefore;
    if (input.amountSatang > owed) {
      throw new ApiError(409, owed > 0 ? `ยอดเกินยอดค้างชำระ — ตอนนี้ค้างอยู่ ${formatSatang(owed)} บาท` : "ใบนี้ไม่มียอดค้างชำระแล้ว");
    }
    const now = new Date().toISOString();

    // Its share of the invoice's VAT (the settling payment takes what is left) —
    // on its receipt, and kept on the payment itself.
    const vatBefore = await vatOnLivePayments(conn, live, invoice);
    const vat = receiptVatSatang(input.amountSatang, invoice, { paidSatang: paidBefore, vatSatang: vatBefore });
    let receipt: RecordedPayment["receipt"] = null;
    if (issuing) {
      const { id, docNo } = await insertReceiptTx(conn, {
        pays: doc,
        relatedDocId: invoiceId,
        paidDate: input.paidDate,
        amountSatang: input.amountSatang,
        vatSatang: vat,
        isTaxInvoice: receiptIsTaxInvoice,
        versionId: versionId!,
        actor,
        now,
      });
      const title = receiptTitle(receiptIsTaxInvoice);
      receipt = { id, docNo, title };
      await writeAudit(conn, {
        ...actor,
        action: "doc.issue",
        documentId: id,
        docNo,
        detail: `ออก${title} · ${doc.buyerName} · ${formatSatang(input.amountSatang)} บาท · ตามใบแจ้งหนี้ ${doc.docNo}`,
      });
    }

    const paymentId = await insertPaymentTx(conn, { documentId: invoiceId, receiptId: receipt?.id ?? null, input, actor, now, vatSatang: vat });
    const paid = await recomputePaidSatang(conn, invoiceId);
    await syncSaleReceiptRef(conn, doc.salesRecordId, invoiceId);

    const parts = [
      `รับชำระ ${formatSatang(input.amountSatang)} บาท (${methodLabel(input.method)} ${formatDisplayDate(input.paidDate)})`,
      input.whtSatang > 0 ? `หัก ณ ที่จ่าย ${input.whtPercent}% ${formatSatang(input.whtSatang)}` : null,
      input.feeSatang > 0 ? `ค่าธรรมเนียม ${formatSatang(input.feeSatang)}` : null,
      receipt ? `ใบเสร็จ ${receipt.docNo}` : `ใบเสร็จจากที่อื่น ${input.externalReceiptNo}`,
    ].filter(Boolean);
    await writeAudit(conn, { ...actor, action: "payment.create", documentId: invoiceId, docNo: doc.docNo, detail: parts.join(" · ") });
    return { paymentId, receipt, paid };
  });

  return { payment: (await getPayment(done.paymentId))!, receipt: done.receipt, paidSatang: done.paid };
}

/**
 * Voids a payment recorded by mistake — with a reason — and its receipt with
 * it (the number stays used, marked ยกเลิก: the paper may be with the customer).
 * What the invoice owes goes back up. The route asks for the password first.
 */
export async function voidPayment(paymentId: string, reasonText: string, actor: Actor): Promise<AccPayment> {
  const reason = String(reasonText ?? "").trim();
  if (!reason) throw new ApiError(400, "กรุณาบอกเหตุผลที่ยกเลิก");
  if (reason.length > PAYMENT_LIMITS.voidReason) throw new ApiError(400, `เหตุผลยาวเกิน ${PAYMENT_LIMITS.voidReason} ตัวอักษร`);

  await withTransaction(async (conn) => {
    const [peek] = await run(conn, "SELECT documentId, groupId, billingNoteId FROM acc_payments WHERE id = ?", [paymentId]);
    if (!peek) throw new ApiError(404, "ไม่พบรายการรับชำระนี้");
    // Received against a billing note: it goes as it came — every invoice's share, and the receipt(s).
    if (peek.groupId) {
      await voidGroupTx(conn, String(peek.groupId), strOrNull(peek.billingNoteId), reason, actor);
      return;
    }
    const invoiceId = String(peek.documentId);
    // Invoice (or, for a deposit, the customer PO) first, then the payment —
    // the order every payment change takes.
    const [inv] = await run(conn, "SELECT docType, docNo, salesRecordId, customerPoNo, vatRate FROM acc_documents WHERE id = ? FOR UPDATE", [invoiceId]);
    const [p] = await run(conn, "SELECT id, receiptId, amountSatang, voidedAt FROM acc_payments WHERE id = ? FOR UPDATE", [paymentId]);
    if (!p) throw new ApiError(404, "ไม่พบรายการรับชำระนี้");
    if (p.voidedAt) throw new ApiError(409, "รายการนี้ถูกยกเลิกไปแล้ว");
    const deposit = inv?.docType === "SO";
    if (deposit) {
      // A deposit the delivery invoices have deducted cannot go from under them.
      const [re] = p.receiptId ? await run(conn, "SELECT vatBaseSatang FROM acc_documents WHERE id = ? FOR UPDATE", [p.receiptId]) : [];
      const vatRate = num(inv.vatRate);
      const exVat = re ? num(re.vatBaseSatang) : num(p.amountSatang) - vatInsideSatang(num(p.amountSatang), vatRate);
      await assertDepositNotDeductedTx(conn, invoiceId, vatRate, exVat);
    }
    const now = new Date().toISOString();
    await conn.query("UPDATE acc_payments SET voidedAt = ?, voidedBy = ?, voidReason = ? WHERE id = ?", [now, actor.username, reason, paymentId]);

    let receiptNo: string | null = null;
    if (p.receiptId) {
      const [re] = await run(conn, "SELECT docNo, status FROM acc_documents WHERE id = ? FOR UPDATE", [p.receiptId]);
      if (re && re.status !== "void") {
        receiptNo = strOrNull(re.docNo);
        await conn.query(
          "UPDATE acc_documents SET status = 'void', voidedAt = ?, voidedBy = ?, voidReason = ?, updatedAt = ? WHERE id = ?",
          [now, actor.username, reason, now, p.receiptId]
        );
        await writeAudit(conn, { ...actor, action: "doc.void", documentId: String(p.receiptId), docNo: receiptNo, detail: `ยกเลิกใบเสร็จ · เหตุผล: ${reason}` });
      }
    }
    if (inv) {
      await recomputePaidSatang(conn, invoiceId);
      await syncSaleReceiptRef(conn, strOrNull(inv.salesRecordId), invoiceId);
    }
    await writeAudit(conn, {
      ...actor,
      action: "payment.void",
      documentId: invoiceId,
      docNo: inv ? strOrNull(deposit ? inv.customerPoNo : inv.docNo) : null,
      detail: `ยกเลิก${deposit ? "เงินมัดจำ" : "รายการรับชำระ"} ${formatSatang(num(p.amountSatang))} บาท${receiptNo ? ` (ใบเสร็จ ${receiptNo})` : ""} · เหตุผล: ${reason}`,
    });
  });
  return (await getPayment(paymentId))!;
}

/**
 * Voids what was received against a billing note in one go: every invoice's
 * share and the receipt(s) they got (numbers kept, marked ยกเลิก). The note
 * first, then its invoices, then the payments and receipts — the order
 * receiving against it takes.
 */
async function voidGroupTx(conn: PoolConnection, groupId: string, billingNoteId: string | null, reason: string, actor: Actor): Promise<void> {
  const [bn] = billingNoteId ? await run(conn, "SELECT docNo FROM acc_documents WHERE id = ? FOR UPDATE", [billingNoteId]) : [];
  const members = await run(conn, "SELECT id, documentId FROM acc_payments WHERE groupId = ?", [groupId]);
  const invoiceIds = [...new Set(members.map((m) => String(m.documentId)))];
  const invoices = invoiceIds.length
    ? await run(conn, `SELECT id, docNo, salesRecordId FROM acc_documents WHERE id IN (${invoiceIds.map(() => "?").join(", ")}) FOR UPDATE`, invoiceIds)
    : [];
  const rows = await run(conn, "SELECT id, documentId, receiptId, amountSatang, voidedAt FROM acc_payments WHERE groupId = ? FOR UPDATE", [groupId]);
  const live = rows.filter((r) => !r.voidedAt);
  if (live.length === 0) throw new ApiError(409, "รายการนี้ถูกยกเลิกไปแล้ว");
  const now = new Date().toISOString();
  await conn.query("UPDATE acc_payments SET voidedAt = ?, voidedBy = ?, voidReason = ? WHERE groupId = ? AND voidedAt IS NULL", [now, actor.username, reason, groupId]);
  const receiptNos: string[] = [];
  for (const receiptId of [...new Set(live.map((r) => strOrNull(r.receiptId)).filter((id): id is string => Boolean(id)))]) {
    const [re] = await run(conn, "SELECT docNo, status FROM acc_documents WHERE id = ? FOR UPDATE", [receiptId]);
    if (!re || re.status === "void") continue;
    receiptNos.push(str(re.docNo));
    await conn.query("UPDATE acc_documents SET status = 'void', voidedAt = ?, voidedBy = ?, voidReason = ?, updatedAt = ? WHERE id = ?", [now, actor.username, reason, now, receiptId]);
    await writeAudit(conn, { ...actor, action: "doc.void", documentId: receiptId, docNo: strOrNull(re.docNo), detail: `ยกเลิกใบเสร็จ · เหตุผล: ${reason}` });
  }
  const receiptsText = receiptNos.length > 0 ? ` (ใบเสร็จ ${receiptNos.join(", ")})` : "";
  const noteText = bn ? ` ตามใบวางบิล ${str(bn.docNo)}` : "";
  for (const inv of invoices) {
    const invoiceId = String(inv.id);
    await recomputePaidSatang(conn, invoiceId);
    await syncSaleReceiptRef(conn, strOrNull(inv.salesRecordId), invoiceId);
    const amount = live.filter((r) => String(r.documentId) === invoiceId).reduce((s, r) => s + num(r.amountSatang), 0);
    await writeAudit(conn, {
      ...actor,
      action: "payment.void",
      documentId: invoiceId,
      docNo: strOrNull(inv.docNo),
      detail: `ยกเลิกรายการรับชำระ ${formatSatang(amount)} บาท${noteText}${receiptsText} · เหตุผล: ${reason}`,
    });
  }
  if (billingNoteId) {
    const total = live.reduce((s, r) => s + num(r.amountSatang), 0);
    await writeAudit(conn, {
      ...actor,
      action: "payment.void",
      documentId: billingNoteId,
      docNo: bn ? strOrNull(bn.docNo) : null,
      detail: `ยกเลิกรายการรับชำระ ${formatSatang(total)} บาท · ${invoices.length} ใบแจ้งหนี้${receiptsText} · เหตุผล: ${reason}`,
    });
  }
}

/** Marks a payment's 50 ทวิ certificate as received (and where it is kept), or not yet — for a billing note's payment, the one certificate of all its shares. */
export async function updateCert50(paymentId: string, change: { received: boolean; note: string }, actor: Actor): Promise<AccPayment> {
  const note = change.received ? String(change.note ?? "").trim() : "";
  if (note.length > PAYMENT_LIMITS.cert50Note) throw new ApiError(400, `ที่เก็บยาวเกิน ${PAYMENT_LIMITS.cert50Note} ตัวอักษร`);
  await withTransaction(async (conn) => {
    const [p] = await run(conn, "SELECT documentId, whtSatang, voidedAt, groupId, billingNoteId FROM acc_payments WHERE id = ? FOR UPDATE", [paymentId]);
    if (!p) throw new ApiError(404, "ไม่พบรายการรับชำระนี้");
    if (p.voidedAt) throw new ApiError(409, "รายการนี้ถูกยกเลิกแล้ว");
    const group = strOrNull(p.groupId);
    const withheld = group
      ? num((await run(conn, "SELECT COALESCE(SUM(whtSatang), 0) AS w FROM acc_payments WHERE groupId = ? AND voidedAt IS NULL FOR UPDATE", [group]))[0]?.w)
      : num(p.whtSatang);
    if (withheld <= 0) throw new ApiError(409, "รายการนี้ไม่ได้ถูกหัก ณ ที่จ่าย — ไม่มี 50 ทวิ");
    if (group) {
      await conn.query("UPDATE acc_payments SET cert50Received = ?, cert50Note = ? WHERE groupId = ? AND whtSatang > 0", [change.received ? 1 : 0, note, group]);
    } else {
      await conn.query("UPDATE acc_payments SET cert50Received = ?, cert50Note = ? WHERE id = ?", [change.received ? 1 : 0, note, paymentId]);
    }
    const documentId = group && p.billingNoteId ? String(p.billingNoteId) : String(p.documentId);
    const [doc] = await run(conn, "SELECT docNo FROM acc_documents WHERE id = ?", [documentId]);
    await writeAudit(conn, {
      ...actor,
      action: "payment.update",
      documentId,
      docNo: doc ? strOrNull(doc.docNo) : null,
      detail: change.received ? `ได้รับ 50 ทวิ แล้ว (หัก ${formatSatang(withheld)} บาท)${note ? ` · เก็บที่ ${note}` : ""}` : "50 ทวิ: กลับเป็นยังไม่ได้รับ",
    });
  });
  return (await getPayment(paymentId))!;
}

// ── A receipt, for its page ─────────────────────────────────────────────────

export interface ReceiptInvoiceRef {
  id: string;
  /** "INV" — or "SO": a deposit's receipt pays a customer PO. */
  docType: string;
  docNo: string | null;
  issueDate: string;
  totalSatang: number;
  paidSatang: number;
  lines: { name: string; qty: number; unit: string; lineType: string }[];
}

/** A billing note's receipt (step 7): the note, and each invoice it pays with how much of it. */
export interface ReceiptBillingRef {
  id: string;
  docNo: string | null;
  issueDate: string;
  invoices: { id: string; docNo: string | null; issueDate: string; amountSatang: number }[];
}

/**
 * The payment a receipt is for and the invoice it pays — the receipt prints
 * both. A billing note's receipt covers several invoices: its payment is their
 * shares added up, and `billing` lists them.
 */
export async function receiptDetail(
  receiptId: string,
  relatedDocId: string | null
): Promise<{ payment: AccPayment | null; invoice: ReceiptInvoiceRef | null; billing?: ReceiptBillingRef }> {
  const rows = (await run(null, `${PAYMENT_SELECT} WHERE p.receiptId = ? ORDER BY p.createdAt ASC`, [receiptId])).map(rowToPayment);
  const invoice = relatedDocId ? await getAccDocument(relatedDocId) : null;
  if (invoice?.docType === "BN") {
    const ids = [...new Set(rows.map((p) => p.documentId))];
    const docs = ids.length ? await run(null, `SELECT id, docNo, issueDate FROM acc_documents WHERE id IN (${ids.map(() => "?").join(", ")})`, ids) : [];
    const byId = new Map(docs.map((d) => [String(d.id), d]));
    const first = rows[0] ?? null;
    const sum = (k: "amountSatang" | "whtSatang" | "feeSatang" | "netSatang") => rows.reduce((s, p) => s + p[k], 0);
    return {
      payment: first ? { ...first, amountSatang: sum("amountSatang"), whtSatang: sum("whtSatang"), feeSatang: sum("feeSatang"), netSatang: sum("netSatang") } : null,
      invoice: null,
      billing: {
        id: invoice.id,
        docNo: invoice.docNo,
        issueDate: invoice.issueDate,
        invoices: ids.map((id) => ({
          id,
          docNo: strOrNull(byId.get(id)?.docNo),
          issueDate: str(byId.get(id)?.issueDate),
          amountSatang: rows.filter((p) => p.documentId === id).reduce((s, p) => s + p.amountSatang, 0),
        })),
      },
    };
  }
  const row = rows[0];
  return {
    payment: row ?? null,
    invoice: invoice
      ? {
          id: invoice.id,
          docType: invoice.docType,
          docNo: invoice.docNo,
          issueDate: invoice.issueDate,
          totalSatang: invoice.totalSatang,
          paidSatang: invoice.paidSatang,
          lines: invoice.lines.map((l) => ({ name: l.name, qty: l.qty, unit: l.unit, lineType: l.lineType })),
        }
      : null,
  };
}

// ── Receivables ──────────────────────────────────────────────────────────────

export interface MissingCert50 {
  paymentId: string;
  /** What it was paid against: an invoice — or, for a deposit, the customer PO (`deposit`). */
  invoiceId: string;
  invoiceNo: string | null;
  deposit: boolean;
  /** Received against a billing note: `invoiceId` / `invoiceNo` are the note's. */
  billing: boolean;
  buyerName: string;
  paidDate: string;
  receiptNo: string;
  whtPercent: number;
  whtSatang: number;
}

export interface Receivables {
  today: string;
  groups: ReceivableGroup[];
  totals: Record<AgeingBucket, number> & { all: number };
  missingCert50: MissingCert50[];
  missingCert50Satang: number;
}

/** Who owes what, by age — and the withholding certificates still to come in. */
export async function receivables(today: string): Promise<Receivables> {
  const rows = await run(
    null,
    `SELECT id, docNo, source, issueDate, dueDate, companyId, buyerName, totalSatang, paidSatang
       FROM acc_documents
      WHERE docType = 'INV' AND status = 'issued' AND paidSatang < totalSatang
      ORDER BY issueDate ASC LIMIT 5000`,
    []
  );
  const { groups, totals } = groupReceivables(
    rows.map((r) => ({
      id: String(r.id),
      docNo: strOrNull(r.docNo),
      source: str(r.source),
      issueDate: str(r.issueDate),
      dueDate: strOrNull(r.dueDate),
      companyId: str(r.companyId),
      buyerName: str(r.buyerName),
      totalSatang: num(r.totalSatang),
      paidSatang: num(r.paidSatang),
    })),
    today
  );
  const certRows = await run(
    null,
    // A deposit's withholding counts too — named by its customer PO (it has no invoice number).
    `SELECT p.id, p.documentId, p.paidDate, p.whtPercent, p.whtSatang, p.externalReceiptNo,
            COALESCE(d.docNo, CONCAT('PO ', d.customerPoNo)) AS invoiceNo, d.docType, d.buyerName, r.docNo AS receiptNo,
            p.groupId, p.billingNoteId, bn.docNo AS billingNo
       FROM acc_payments p
       JOIN acc_documents d ON d.id = p.documentId
       LEFT JOIN acc_documents r ON r.id = p.receiptId
       LEFT JOIN acc_documents bn ON bn.id = p.billingNoteId
      WHERE p.voidedAt IS NULL AND p.whtSatang > 0 AND p.cert50Received = 0
      ORDER BY p.paidDate ASC, p.createdAt ASC LIMIT 1000`,
    []
  );
  // A billing note's payment is one certificate for all its invoices' shares — one line, named by the note.
  const missingCert50: MissingCert50[] = [];
  const byGroup = new Map<string, MissingCert50>();
  for (const r of certRows) {
    const receiptNo = str(r.receiptNo) || str(r.externalReceiptNo);
    const group = strOrNull(r.groupId);
    const known = group ? byGroup.get(group) : undefined;
    if (known) {
      known.whtSatang += num(r.whtSatang);
      if (receiptNo && !known.receiptNo.split(", ").includes(receiptNo)) known.receiptNo = [known.receiptNo, receiptNo].filter(Boolean).join(", ");
      continue;
    }
    const billing = Boolean(group && r.billingNoteId);
    const line: MissingCert50 = {
      paymentId: String(r.id),
      invoiceId: billing ? String(r.billingNoteId) : String(r.documentId),
      invoiceNo: billing ? strOrNull(r.billingNo) : strOrNull(r.invoiceNo),
      deposit: r.docType === "SO",
      billing,
      buyerName: str(r.buyerName),
      paidDate: str(r.paidDate),
      receiptNo,
      whtPercent: num(r.whtPercent),
      whtSatang: num(r.whtSatang),
    };
    missingCert50.push(line);
    if (group) byGroup.set(group, line);
  }
  return { today, groups, totals, missingCert50, missingCert50Satang: missingCert50.reduce((s, m) => s + m.whtSatang, 0) };
}

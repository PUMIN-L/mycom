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
import { getAccDocument } from "./documents";
import { recomputePaidSatang, syncSaleReceiptRef } from "./paymentLedger";
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
}

const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const strOrNull = (v: unknown) => (v === null || v === undefined || v === "" ? null : String(v));
const num = (v: unknown) => Number(v) || 0;

type Exec = Pick<PoolConnection, "query"> | null;
async function run(conn: Exec, sql: string, params: unknown[]): Promise<RowDataPacket[]> {
  const [rows] = conn ? await conn.query<RowDataPacket[]>(sql, params) : await query<RowDataPacket[]>(sql, params);
  return rows;
}

const PAYMENT_SELECT = `SELECT p.*, r.docNo AS receiptNo, r.status AS receiptStatus, b.bankName, b.accountNo
  FROM acc_payments p
  LEFT JOIN acc_documents r ON r.id = p.receiptId
  LEFT JOIN acc_bank_accounts b ON b.id = p.bankAccountId`;

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
  };
}

/** An invoice's payments, voided ones too (the history shows them struck through), oldest first. */
export async function listPayments(invoiceId: string): Promise<AccPayment[]> {
  const rows = await run(null, `${PAYMENT_SELECT} WHERE p.documentId = ? ORDER BY p.paidDate ASC, p.createdAt ASC`, [invoiceId]);
  return rows.map(rowToPayment);
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

/** The VAT already declared on an invoice's live payments: their receipts', or their share where the receipt is an outside one. */
async function vatOnLivePayments(
  conn: Exec,
  live: RowDataPacket[],
  invoice: { totalSatang: number; vatSatang: number }
): Promise<number> {
  const receiptIds = live.map((p) => strOrNull(p.receiptId)).filter((id): id is string => Boolean(id));
  let vat = 0;
  if (receiptIds.length > 0) {
    // A locking (current) read: the receipt of a payment committed while this
    // one waited for the invoice's lock is not in the transaction's snapshot.
    const rows = await run(conn, `SELECT id, vatSatang FROM acc_documents WHERE id IN (${receiptIds.map(() => "?").join(", ")}) FOR UPDATE`, receiptIds);
    const byId = new Map(rows.map((r) => [String(r.id), num(r.vatSatang)]));
    for (const id of receiptIds) vat += byId.get(id) ?? 0;
  }
  for (const p of live) if (!p.receiptId) vat += vatShareSatang(num(p.amountSatang), invoice);
  return vat;
}

export interface RecordedPayment {
  payment: AccPayment;
  receipt: { id: string; docNo: string; title: string } | null;
  paidSatang: number;
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
  if (input.bankAccountId) {
    const [bank] = await run(null, "SELECT isActive FROM acc_bank_accounts WHERE id = ?", [input.bankAccountId]);
    if (!bank) throw new ApiError(400, "ไม่พบบัญชีธนาคารที่เลือก — เลือกใหม่อีกครั้ง");
    if (Number(bank.isActive) !== 1) throw new ApiError(400, "บัญชีธนาคารนี้ปิดใช้แล้ว — เลือกบัญชีอื่น");
  }
  const issuing = !input.externalReceiptNo;
  const versionId = issuing ? (await getSellerProfile()).versionId : null;
  if (issuing && !versionId) throw new ApiError(409, "ยังไม่ได้ตั้งข้อมูลบริษัทสำหรับพิมพ์บนใบเสร็จ — ไปที่ ตั้งค่าบัญชี ก่อน");
  const receiptIsTaxInvoice = !doc.isTaxInvoice;

  const done = await withTransaction(async (conn) => {
    const [inv] = await run(conn, "SELECT status, totalSatang, vatSatang FROM acc_documents WHERE id = ? FOR UPDATE", [invoiceId]);
    if (!inv || inv.status !== "issued") throw new ApiError(409, "ใบแจ้งหนี้นี้เปลี่ยนไปแล้ว — กรุณาเปิดหน้านี้ใหม่");
    const invoice = { totalSatang: num(inv.totalSatang), vatSatang: num(inv.vatSatang) };
    const live = await run(conn, "SELECT id, amountSatang, receiptId FROM acc_payments WHERE documentId = ? AND voidedAt IS NULL FOR UPDATE", [invoiceId]);
    const paidBefore = live.reduce((sum, p) => sum + num(p.amountSatang), 0);
    const owed = invoice.totalSatang - paidBefore;
    if (input.amountSatang > owed) {
      throw new ApiError(409, owed > 0 ? `ยอดเกินยอดค้างชำระ — ตอนนี้ค้างอยู่ ${formatSatang(owed)} บาท` : "ใบนี้ไม่มียอดค้างชำระแล้ว");
    }
    const now = new Date().toISOString();

    let receipt: RecordedPayment["receipt"] = null;
    if (issuing) {
      const vatBefore = await vatOnLivePayments(conn, live, invoice);
      const vat = receiptVatSatang(input.amountSatang, invoice, { paidSatang: paidBefore, vatSatang: vatBefore });
      const docNo = await allocateDocNo(conn, "RE", input.paidDate);
      const id = crypto.randomUUID();
      const row: Record<string, unknown> = {
        id,
        docType: "RE",
        docNo,
        status: "issued",
        source: "internal",
        isTaxInvoice: receiptIsTaxInvoice ? 1 : 0,
        issueDate: input.paidDate,
        creditDays: 0,
        companyId: doc.companyId || null,
        customerId: doc.customerId || null,
        salespersonId: doc.salespersonId || null,
        buyerName: doc.buyerName,
        buyerAddress: doc.buyerAddress,
        buyerTaxId: doc.buyerTaxId,
        buyerBranch: doc.buyerBranch,
        sellerVersionId: versionId,
        priceMode: "exclusive",
        vatRate: doc.vatRate,
        subtotalSatang: input.amountSatang - vat,
        vatBaseSatang: input.amountSatang - vat,
        vatSatang: vat,
        totalSatang: input.amountSatang,
        // A receipt is money already received.
        paidSatang: input.amountSatang,
        customerPoNo: doc.customerPoNo,
        projectName: doc.projectName,
        relatedDocId: invoiceId,
        issuedAt: now,
        issuedBy: actor.username,
        createdAt: now,
        createdBy: actor.username,
        updatedAt: now,
      };
      const keys = Object.keys(row);
      await conn.query(`INSERT INTO acc_documents (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`, Object.values(row));
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

    const paymentId = crypto.randomUUID();
    const payment: Record<string, unknown> = {
      id: paymentId,
      documentId: invoiceId,
      receiptId: receipt?.id ?? null,
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
      createdAt: now,
      createdBy: actor.username,
    };
    const keys = Object.keys(payment);
    await conn.query(`INSERT INTO acc_payments (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`, Object.values(payment));
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
    const [peek] = await run(conn, "SELECT documentId FROM acc_payments WHERE id = ?", [paymentId]);
    if (!peek) throw new ApiError(404, "ไม่พบรายการรับชำระนี้");
    const invoiceId = String(peek.documentId);
    // Invoice first, then the payment — the order every payment change takes.
    const [inv] = await run(conn, "SELECT docNo, salesRecordId FROM acc_documents WHERE id = ? FOR UPDATE", [invoiceId]);
    const [p] = await run(conn, "SELECT id, receiptId, amountSatang, voidedAt FROM acc_payments WHERE id = ? FOR UPDATE", [paymentId]);
    if (!p) throw new ApiError(404, "ไม่พบรายการรับชำระนี้");
    if (p.voidedAt) throw new ApiError(409, "รายการนี้ถูกยกเลิกไปแล้ว");
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
      docNo: inv ? strOrNull(inv.docNo) : null,
      detail: `ยกเลิกรายการรับชำระ ${formatSatang(num(p.amountSatang))} บาท${receiptNo ? ` (ใบเสร็จ ${receiptNo})` : ""} · เหตุผล: ${reason}`,
    });
  });
  return (await getPayment(paymentId))!;
}

/** Marks a payment's 50 ทวิ certificate as received (and where it is kept), or not yet. */
export async function updateCert50(paymentId: string, change: { received: boolean; note: string }, actor: Actor): Promise<AccPayment> {
  const note = change.received ? String(change.note ?? "").trim() : "";
  if (note.length > PAYMENT_LIMITS.cert50Note) throw new ApiError(400, `ที่เก็บยาวเกิน ${PAYMENT_LIMITS.cert50Note} ตัวอักษร`);
  await withTransaction(async (conn) => {
    const [p] = await run(conn, "SELECT documentId, whtSatang, voidedAt FROM acc_payments WHERE id = ? FOR UPDATE", [paymentId]);
    if (!p) throw new ApiError(404, "ไม่พบรายการรับชำระนี้");
    if (p.voidedAt) throw new ApiError(409, "รายการนี้ถูกยกเลิกแล้ว");
    if (num(p.whtSatang) <= 0) throw new ApiError(409, "รายการนี้ไม่ได้ถูกหัก ณ ที่จ่าย — ไม่มี 50 ทวิ");
    await conn.query("UPDATE acc_payments SET cert50Received = ?, cert50Note = ? WHERE id = ?", [change.received ? 1 : 0, note, paymentId]);
    const [inv] = await run(conn, "SELECT docNo FROM acc_documents WHERE id = ?", [p.documentId]);
    await writeAudit(conn, {
      ...actor,
      action: "payment.update",
      documentId: String(p.documentId),
      docNo: inv ? strOrNull(inv.docNo) : null,
      detail: change.received ? `ได้รับ 50 ทวิ แล้ว (หัก ${formatSatang(num(p.whtSatang))} บาท)${note ? ` · เก็บที่ ${note}` : ""}` : "50 ทวิ: กลับเป็นยังไม่ได้รับ",
    });
  });
  return (await getPayment(paymentId))!;
}

// ── A receipt, for its page ─────────────────────────────────────────────────

export interface ReceiptInvoiceRef {
  id: string;
  docNo: string | null;
  issueDate: string;
  totalSatang: number;
  paidSatang: number;
  lines: { name: string; qty: number; unit: string; lineType: string }[];
}

/** The payment a receipt is for and the invoice it pays — the receipt prints both. */
export async function receiptDetail(receiptId: string, relatedDocId: string | null): Promise<{ payment: AccPayment | null; invoice: ReceiptInvoiceRef | null }> {
  const [row] = await run(null, `${PAYMENT_SELECT} WHERE p.receiptId = ? LIMIT 1`, [receiptId]);
  const invoice = relatedDocId ? await getAccDocument(relatedDocId) : null;
  return {
    payment: row ? rowToPayment(row) : null,
    invoice: invoice
      ? {
          id: invoice.id,
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
  invoiceId: string;
  invoiceNo: string | null;
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
    `SELECT p.id, p.documentId, p.paidDate, p.whtPercent, p.whtSatang, p.externalReceiptNo, d.docNo AS invoiceNo, d.buyerName, r.docNo AS receiptNo
       FROM acc_payments p
       JOIN acc_documents d ON d.id = p.documentId
       LEFT JOIN acc_documents r ON r.id = p.receiptId
      WHERE p.voidedAt IS NULL AND p.whtSatang > 0 AND p.cert50Received = 0
      ORDER BY p.paidDate ASC, p.createdAt ASC LIMIT 1000`,
    []
  );
  const missingCert50 = certRows.map((r) => ({
    paymentId: String(r.id),
    invoiceId: String(r.documentId),
    invoiceNo: strOrNull(r.invoiceNo),
    buyerName: str(r.buyerName),
    paidDate: str(r.paidDate),
    receiptNo: str(r.receiptNo) || str(r.externalReceiptNo),
    whtPercent: num(r.whtPercent),
    whtSatang: num(r.whtSatang),
  }));
  return { today, groups, totals, missingCert50, missingCert50Satang: missingCert50.reduce((s, m) => s + m.whtSatang, 0) };
}

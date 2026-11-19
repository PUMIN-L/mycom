import "server-only";
import type { RowDataPacket } from "mysql2";
import type { PoolConnection } from "mysql2/promise";
import { query, withTransaction } from "../db";
import { ApiError } from "../apiHelpers";
import { bangkokDateString, formatDisplayDate } from "../dateFormat";
import { insertCreditSaleTx } from "../salesDashboardStore";
import { allocateDocNo } from "./numbering";
import { writeAudit } from "./audit";
import { getSellerProfile } from "./settings";
import { allocateProportionally, formatSatang, satangToBaht } from "./money";
import { getAccDocument, likeEscape, replaceLines, type AccDocument } from "./documents";
import { recomputePaidSatang } from "./paymentLedger";
import { creditedOf, recomputeCreditedTx } from "./creditLedger";
import { assertBankAccountUsable, insertPaymentTx } from "./payments";
import { creditNoteProblems, creditReturnsGoods, creditTotals, refundDueSatang, type CreditInvoice, type CreditNoteInput, CREDIT_LIMITS } from "./creditRules";
import { methodLabel, PAYMENT_LIMITS, type PaymentMethod } from "./paymentRules";

// Credit notes (ใบลดหนี้, docType CN) and refunds — step 8, ARCHITECTURE.md §8g.
//
// A credit note is issued at once (CN + month + running number), against an
// issued invoice (`relatedDocId`), a tax document when the invoice was the tax
// invoice. The invoice keeps what its issued credit notes took off it
// (`creditedSatang` / `creditedVatSatang`) — a cache with one writer
// (`recomputeCreditedTx`), re-summed like paidSatang — and everything that
// asks what an invoice owes takes it off (total − credited − paid). The
// dashboard's sales go down in the credit note's own month: a sale of
// negative amounts in the same deal (`insertCreditSaleTx`).
//
// A credit note beyond what is still owed leaves the customer having paid too
// much: a REFUND hands it back — a payment row of a negative amount (no
// receipt), so what the invoice was paid stays the sum of its live payments.
//
// Locks: the invoice first, then its credit notes / payments — the order every
// payment change takes.

interface Actor {
  userId: string;
  username: string;
}

const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const strOrNull = (v: unknown) => (v === null || v === undefined || v === "" ? null : String(v));
const num = (v: unknown) => Number(v) || 0;

type Exec = Pick<PoolConnection, "query"> | null;
async function run(conn: Exec, sql: string, params: unknown[]): Promise<RowDataPacket[]> {
  const [rows] = conn ? await conn.query<RowDataPacket[]>(sql, params) : await query<RowDataPacket[]>(sql, params);
  return rows;
}

/** The invoice a credit note is set against, as the rules want it. */
function creditInvoiceOf(inv: Pick<AccDocument, "issueDate" | "isTaxInvoice" | "priceMode" | "vatRate" | "totalSatang" | "vatSatang" | "vatBaseSatang" | "paidSatang">, credited: { totalSatang: number; baseSatang: number }): CreditInvoice {
  return {
    issueDate: inv.issueDate,
    isTaxInvoice: inv.isTaxInvoice,
    priceMode: inv.priceMode,
    vatRate: inv.vatRate,
    totalSatang: inv.totalSatang,
    vatSatang: inv.vatSatang,
    vatBaseSatang: inv.vatBaseSatang,
    creditedSatang: credited.totalSatang,
    creditedBaseSatang: credited.baseSatang,
    paidSatang: inv.paidSatang,
  };
}

export interface CreditContext {
  invoice: AccDocument;
  credit: CreditInvoice;
  /** Its credit notes, voided ones too, oldest first. */
  creditNotes: { id: string; docNo: string | null; status: string; issueDate: string; totalSatang: number }[];
  refundDueSatang: number;
}

/**
 * What the credit-note editor and the invoice page need. Null for anything but
 * an issued invoice. `loaded`: the invoice when the caller has read it already.
 */
export async function creditContext(invoiceId: string, loaded?: AccDocument): Promise<CreditContext | null> {
  const invoice = loaded ?? (await getAccDocument(invoiceId));
  if (!invoice || invoice.docType !== "INV" || invoice.status === "draft") return null;
  const credited = await creditedOf(null, invoiceId);
  const notes = await run(
    null,
    "SELECT id, docNo, status, issueDate, totalSatang FROM acc_documents WHERE relatedDocId = ? AND docType = 'CN' ORDER BY issueDate ASC, docNo ASC",
    [invoiceId]
  );
  return {
    invoice,
    credit: creditInvoiceOf(invoice, credited),
    creditNotes: notes.map((r) => ({ id: String(r.id), docNo: strOrNull(r.docNo), status: str(r.status), issueDate: str(r.issueDate), totalSatang: num(r.totalSatang) })),
    refundDueSatang: refundDueSatang({ totalSatang: invoice.totalSatang, creditedSatang: credited.totalSatang, paidSatang: invoice.paidSatang }),
  };
}

/**
 * The credit note's lines as negative sale lines, ex VAT — its base shared over
 * them as an invoice's sale is. Goods taken back take their quantity off what
 * was sold; a price cut takes value only (quantity 0).
 */
async function creditSaleLines(input: CreditNoteInput, baseSatang: number) {
  const amounts = input.lines.map((l) => Math.max(0, Math.round((Math.round(l.qty * 100) * l.unitPriceSatang) / 100) - l.discountSatang));
  const shares = allocateProportionally(amounts, baseSatang);
  const ids = [...new Set(input.lines.map((l) => l.productId).filter(Boolean))];
  const categories = new Map<string, number>();
  if (ids.length > 0) {
    const rows = await run(null, `SELECT id, categoryId FROM products WHERE id IN (${ids.map(() => "?").join(", ")})`, ids);
    for (const r of rows) if (r.categoryId !== null && r.categoryId !== undefined) categories.set(String(r.id), Number(r.categoryId));
  }
  const returns = creditReturnsGoods(input.reason);
  return input.lines.map((l, i) => ({
    productId: l.productId,
    productName: l.name,
    categoryId: categories.get(l.productId) ?? null,
    qty: returns && l.lineType === "goods" ? -Math.round(l.qty) || 0 : 0,
    totalAmount: -satangToBaht(shares[i]),
  }));
}

/**
 * Issues a credit note against an issued invoice, in ONE transaction: its
 * number, the invoice's credited figures re-summed, and the dashboard's sales
 * lowered in the credit note's month (a negative sale in the invoice sale's
 * deal). Checked again under the invoice's lock.
 */
export async function issueCreditNote(input: CreditNoteInput, actor: Actor): Promise<AccDocument> {
  const invoice = await getAccDocument(input.invoiceId);
  if (!invoice || invoice.docType !== "INV") throw new ApiError(404, "ไม่พบใบแจ้งหนี้นี้");
  if (invoice.status !== "issued") throw new ApiError(409, invoice.status === "void" ? "ใบแจ้งหนี้นี้ถูกยกเลิกแล้ว — ออกใบลดหนี้ไม่ได้" : "ออกใบแจ้งหนี้ก่อนจึงจะลดหนี้ได้");
  const before = creditNoteProblems(input, creditInvoiceOf(invoice, await creditedOf(null, invoice.id)));
  if (before.first) throw new ApiError(400, before.first);
  const { versionId } = await getSellerProfile();
  if (!versionId) throw new ApiError(409, "ยังไม่ได้ตั้งข้อมูลบริษัทสำหรับพิมพ์บนเอกสาร — ไปที่ ตั้งค่าบัญชี ก่อน");
  const totals = creditTotals(input, invoice);
  const saleLines = await creditSaleLines(input, totals.vatBaseSatang);

  const id = await withTransaction(async (conn) => {
    const [inv] = await run(conn, "SELECT status, totalSatang, paidSatang, salesRecordId FROM acc_documents WHERE id = ? FOR UPDATE", [invoice.id]);
    if (!inv || inv.status !== "issued") throw new ApiError(409, "ใบแจ้งหนี้นี้เปลี่ยนไปแล้ว — กรุณาเปิดหน้านี้ใหม่");
    const credited = await creditedOf(conn, invoice.id);
    const [paid] = await run(conn, "SELECT COALESCE(SUM(amountSatang), 0) AS p FROM acc_payments WHERE documentId = ? AND voidedAt IS NULL FOR UPDATE", [invoice.id]);
    const now_ = creditNoteProblems(input, creditInvoiceOf({ ...invoice, paidSatang: num(paid?.p) }, credited));
    if (now_.first) throw new ApiError(409, now_.first);

    const docNo = await allocateDocNo(conn, "CN", input.issueDate);
    const docId = crypto.randomUUID();
    const now = new Date().toISOString();
    const row: Record<string, unknown> = {
      id: docId,
      docType: "CN",
      docNo,
      status: "issued",
      source: "internal",
      isTaxInvoice: invoice.isTaxInvoice ? 1 : 0,
      issueDate: input.issueDate,
      creditDays: 0,
      companyId: invoice.companyId || null,
      customerId: invoice.customerId || null,
      salespersonId: invoice.salespersonId || null,
      buyerName: invoice.buyerName,
      buyerAddress: invoice.buyerAddress,
      buyerTaxId: invoice.buyerTaxId,
      buyerBranch: invoice.buyerBranch,
      sellerVersionId: versionId,
      priceMode: invoice.priceMode,
      vatRate: invoice.vatRate,
      subtotalSatang: totals.subtotalSatang,
      vatBaseSatang: totals.vatBaseSatang,
      vatSatang: totals.vatSatang,
      totalSatang: totals.totalSatang,
      // What it was set against, as printed: the invoice's value less earlier credit notes.
      refValueSatang: invoice.vatBaseSatang - credited.baseSatang,
      customerPoNo: invoice.customerPoNo,
      projectName: invoice.projectName,
      note: input.reason,
      relatedDocId: invoice.id,
      issuedAt: now,
      issuedBy: actor.username,
      createdAt: now,
      createdBy: actor.username,
      updatedAt: now,
    };
    const keys = Object.keys(row);
    await conn.query(`INSERT INTO acc_documents (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`, Object.values(row));
    await replaceLines(conn as PoolConnection, docId, input.lines);

    // The dashboard: less sold, in this month, in the same deal — when the invoice's sale is still there.
    const saleId = strOrNull(inv.salesRecordId);
    const [sale] = saleId ? await run(conn, "SELECT id, dealId FROM sales_records WHERE id = ?", [saleId]) : [];
    if (sale) {
      const creditSaleId = await insertCreditSaleTx(conn as PoolConnection, {
        saleDate: input.issueDate,
        dealId: str(sale.dealId) || String(sale.id),
        salespersonId: invoice.salespersonId,
        customerId: invoice.customerId,
        companyId: invoice.companyId,
        saleType: invoice.lines.some((l) => l.lineType === "goods") ? "equipment" : "service",
        poRef: invoice.customerPoNo,
        invoiceRef: docNo,
        note: `ใบลดหนี้ ${docNo} ของใบแจ้งหนี้ ${invoice.docNo}`,
        lines: saleLines,
      });
      await conn.query("UPDATE acc_documents SET salesRecordId = ? WHERE id = ?", [creditSaleId, docId]);
    }
    await recomputeCreditedTx(conn, invoice.id);
    await writeAudit(conn, {
      ...actor,
      action: "doc.issue",
      documentId: docId,
      docNo,
      detail: `ออกใบลดหนี้ · ${invoice.buyerName} · ${formatSatang(totals.totalSatang)} บาท · ของใบแจ้งหนี้ ${invoice.docNo} · ${input.reason}`,
    });
    await writeAudit(conn, {
      ...actor,
      action: "doc.update",
      documentId: invoice.id,
      docNo: invoice.docNo,
      detail: `ลดหนี้ ${formatSatang(totals.totalSatang)} บาท (ใบลดหนี้ ${docNo})`,
    });
    return docId;
  });
  return (await getAccDocument(id))!;
}

/**
 * Voids a credit note (reason; the route asks the password): its number stays,
 * marked ยกเลิก; the invoice owes it again; its negative sale goes.
 */
export async function voidCreditNote(id: string, reasonText: string, actor: Actor): Promise<AccDocument> {
  const reason = String(reasonText ?? "").trim();
  if (!reason) throw new ApiError(400, "กรุณาบอกเหตุผลที่ยกเลิก");
  if (reason.length > CREDIT_LIMITS.voidReason) throw new ApiError(400, `เหตุผลยาวเกิน ${CREDIT_LIMITS.voidReason} ตัวอักษร`);
  await withTransaction(async (conn) => {
    const [peek] = await run(conn, "SELECT relatedDocId FROM acc_documents WHERE id = ?", [id]);
    if (!peek?.relatedDocId) throw new ApiError(404, "ไม่พบใบลดหนี้นี้");
    // The invoice first, then the credit note.
    const [inv] = await run(conn, "SELECT id, docNo FROM acc_documents WHERE id = ? FOR UPDATE", [peek.relatedDocId]);
    const [cn] = await run(conn, "SELECT docType, status, docNo, salesRecordId, totalSatang FROM acc_documents WHERE id = ? FOR UPDATE", [id]);
    if (!cn || cn.docType !== "CN") throw new ApiError(404, "ไม่พบใบลดหนี้นี้");
    if (cn.status !== "issued") throw new ApiError(409, "ใบลดหนี้นี้ถูกยกเลิกไปแล้ว");
    const now = new Date().toISOString();
    await conn.query("UPDATE acc_documents SET status = 'void', voidReason = ?, voidedAt = ?, voidedBy = ?, updatedAt = ?, salesRecordId = NULL WHERE id = ?", [
      reason,
      now,
      actor.username,
      now,
      id,
    ]);
    const saleId = strOrNull(cn.salesRecordId);
    if (saleId) {
      await conn.query("DELETE FROM sales_record_items WHERE salesRecordId = ?", [saleId]);
      await conn.query("DELETE FROM sales_records WHERE id = ?", [saleId]);
    }
    if (inv) await recomputeCreditedTx(conn, String(inv.id));
    await writeAudit(conn, { ...actor, action: "doc.void", documentId: id, docNo: strOrNull(cn.docNo), detail: `ยกเลิกใบลดหนี้ · เหตุผล: ${reason}` });
    if (inv) {
      await writeAudit(conn, {
        ...actor,
        action: "doc.update",
        documentId: String(inv.id),
        docNo: strOrNull(inv.docNo),
        detail: `ยกเลิกใบลดหนี้ ${str(cn.docNo)} — ${formatSatang(num(cn.totalSatang))} บาท กลับเป็นยอดของใบนี้ · เหตุผล: ${reason}`,
      });
    }
  });
  return (await getAccDocument(id))!;
}

// ── Listing ──────────────────────────────────────────────────────────────────

export interface CreditNoteRow {
  id: string;
  docNo: string | null;
  status: string;
  issueDate: string;
  buyerName: string;
  totalSatang: number;
  invoiceId: string | null;
  invoiceNo: string | null;
  reason: string;
}

/** Credit notes, newest first — in [from, to) when given, matching `q` (number, customer, invoice). */
export async function listCreditNotes(opts: { from?: string; to?: string; q?: string }): Promise<CreditNoteRow[]> {
  const where = ["d.docType = 'CN'"];
  const params: unknown[] = [];
  if (opts.from) {
    where.push("d.issueDate >= ?");
    params.push(opts.from);
  }
  if (opts.to) {
    where.push("d.issueDate < ?");
    params.push(opts.to);
  }
  const q = (opts.q ?? "").trim();
  if (q) {
    const like = `%${likeEscape(q)}%`;
    where.push("(d.docNo LIKE ? ESCAPE '!' OR d.buyerName LIKE ? ESCAPE '!' OR i.docNo LIKE ? ESCAPE '!')");
    params.push(like, like, like);
  }
  const rows = await run(
    null,
    `SELECT d.id, d.docNo, d.status, d.issueDate, d.buyerName, d.totalSatang, d.relatedDocId, d.note, i.docNo AS invoiceNo
       FROM acc_documents d LEFT JOIN acc_documents i ON i.id = d.relatedDocId
      WHERE ${where.join(" AND ")} ORDER BY d.issueDate DESC, d.docNo DESC LIMIT 1000`,
    params
  );
  return rows.map((r) => ({
    id: String(r.id),
    docNo: strOrNull(r.docNo),
    status: str(r.status),
    issueDate: str(r.issueDate),
    buyerName: str(r.buyerName),
    totalSatang: num(r.totalSatang),
    invoiceId: strOrNull(r.relatedDocId),
    invoiceNo: strOrNull(r.invoiceNo),
    reason: str(r.note),
  }));
}

// ── Refunds ──────────────────────────────────────────────────────────────────

export interface RefundInput {
  paidDate: string;
  method: PaymentMethod;
  bankAccountId: string;
  amountSatang: number;
  note: string;
}

/**
 * Hands back what the customer paid beyond what the invoice now comes to (a
 * credit note took off more than was still owed): a payment row of a NEGATIVE
 * amount — no receipt, no VAT (the credit note already took that off) — so
 * the invoice's paid figure stays the sum of its live payments. Voided like any
 * payment. Never more than is due back, checked again under the lock.
 */
export async function recordRefund(invoiceId: string, input: RefundInput, actor: Actor): Promise<void> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.paidDate) || input.paidDate > bangkokDateString(new Date())) throw new ApiError(400, "วันที่คืนเงินไม่ถูกต้อง");
  if (!Number.isSafeInteger(input.amountSatang) || input.amountSatang <= 0) throw new ApiError(400, "กรุณากรอกยอดที่คืน");
  if (input.note.length > PAYMENT_LIMITS.note) throw new ApiError(400, `หมายเหตุยาวเกิน ${PAYMENT_LIMITS.note} ตัวอักษร`);
  await assertBankAccountUsable(input.bankAccountId);
  await withTransaction(async (conn) => {
    const [inv] = await run(conn, "SELECT docType, status, docNo, totalSatang, creditedSatang FROM acc_documents WHERE id = ? FOR UPDATE", [invoiceId]);
    if (!inv || inv.docType !== "INV") throw new ApiError(404, "ไม่พบใบแจ้งหนี้นี้");
    const [paid] = await run(conn, "SELECT COALESCE(SUM(amountSatang), 0) AS p FROM acc_payments WHERE documentId = ? AND voidedAt IS NULL FOR UPDATE", [invoiceId]);
    const due = refundDueSatang({ totalSatang: num(inv.totalSatang), creditedSatang: num(inv.creditedSatang), paidSatang: num(paid?.p) });
    if (input.amountSatang > due) {
      throw new ApiError(409, due > 0 ? `คืนเงินเกินยอดที่ต้องคืน — ต้องคืน ${formatSatang(due)} บาท` : "ใบนี้ไม่มียอดที่ต้องคืนเงินลูกค้า");
    }
    const now = new Date().toISOString();
    await insertPaymentTx(conn as PoolConnection, {
      documentId: invoiceId,
      receiptId: null,
      input: {
        paidDate: input.paidDate,
        method: input.method,
        bankAccountId: input.method === "cash" ? "" : input.bankAccountId,
        amountSatang: -input.amountSatang,
        whtPercent: 0,
        whtSatang: 0,
        feeSatang: 0,
        cert50Received: false,
        cert50Note: "",
        externalReceiptNo: "",
        note: input.note || "คืนเงินลูกค้า",
      },
      actor,
      now,
      vatSatang: 0,
    });
    await recomputePaidSatang(conn, invoiceId);
    await writeAudit(conn, {
      ...actor,
      action: "payment.create",
      documentId: invoiceId,
      docNo: strOrNull(inv.docNo),
      detail: `คืนเงินลูกค้า ${formatSatang(input.amountSatang)} บาท (${methodLabel(input.method)} ${formatDisplayDate(input.paidDate)})${input.note ? ` · ${input.note}` : ""}`,
    });
  });
}

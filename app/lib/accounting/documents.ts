import "server-only";
import type { RowDataPacket } from "mysql2";
import type { PoolConnection } from "mysql2/promise";
import { query, withTransaction } from "../db";
import { ApiError } from "../apiHelpers";
import { addDaysToDateString, addMonthsToDateString, formatDisplayDate, isValidDateString } from "../dateFormat";
import { insertPreparedSaleTx, prepareSaleWithLineItems } from "../salesDashboardStore";
import type { EquipmentRowInput } from "../crmStore";
import { allocateDocNo, docPeriod, formatDocNo, parseDocNo, releaseDocNoIfLatest } from "./numbering";
import type { NumberedDocType } from "./types";
import { writeAudit } from "./audit";
import { recomputePaidSatang, syncSaleReceiptRef } from "./paymentLedger";
import { checkDeliveryTx, draftDeliveryProblem, lockOrderTx, recomputeDeliveredTx } from "./orderDelivery";
import { assertDepositNotDeductedTx } from "./depositLedger";
import { recomputeCreditedTx } from "./creditLedger";
import { getSellerProfile, getVatRate } from "./settings";
import { allocateProportionally, computeTotals, formatSatang, lineAmountSatang, satangToBaht, withVatOverride, type DocTotals } from "./money";
import {
  dueDateOf,
  externalProblems,
  invoiceProblems,
  issueProblems,
  splitSerials,
  type DocLineInput,
  type ExternalFields,
  type InvoiceInput,
} from "./invoiceRules";
import type { AccDocSource, AccDocStatus, AccDocType } from "./types";
import { commissionKindOf, type CommissionKind } from "./commission";

// Documents of the accounting module (ARCHITECTURE.md §8g). This file: the
// invoice's life — draft (no number, editable, deletable), issue (number,
// locked, its sale and machines created in the SAME transaction), delete
// (an issued one too, with what it created — the owner's choice; the audit
// log keeps a line).

interface Actor {
  userId: string;
  username: string;
}

export interface AccDocumentLine extends DocLineInput {
  id: string;
  sortOrder: number;
  amountSatang: number;
  /** A customer PO's line: how much of it issued invoices have delivered (a cache — orderDelivery.ts). */
  deliveredQty: number;
  sourceLineId: string;
}

export interface AccDocument {
  id: string;
  docType: AccDocType;
  docNo: string | null;
  status: AccDocStatus;
  source: AccDocSource;
  externalNote: string;
  isTaxInvoice: boolean;
  issueDate: string;
  dueDate: string | null;
  creditDays: number;
  companyId: string;
  customerId: string;
  salespersonId: string;
  buyerName: string;
  buyerAddress: string;
  buyerTaxId: string;
  buyerBranch: string;
  sellerVersionId: string | null;
  priceMode: "exclusive" | "inclusive";
  vatRate: number;
  subtotalSatang: number;
  discountSatang: number;
  depositSatang: number;
  vatBaseSatang: number;
  vatSatang: number;
  totalSatang: number;
  paidSatang: number;
  /** An invoice: what its issued credit notes took off it — VAT included, and its VAT (a cache, step 8). */
  creditedSatang: number;
  creditedVatSatang: number;
  /** A credit note: the value it was set against, before VAT, as printed. */
  refValueSatang: number | null;
  customerPoNo: string;
  projectName: string;
  note: string;
  quotationId: string | null;
  salesOrderId: string | null;
  relatedDocId: string | null;
  salesRecordId: string | null;
  /** A customer PO: when the customer expects the goods. */
  expectedDeliveryDate: string | null;
  /** An invoice: วันวางบิล, the day its bill is handed to the customer — internal, never printed (v56). */
  billingDate: string | null;
  /** A customer PO: whose commission it is — ลูกค้าฟอร์ด / ลูกค้าพี่ต่อ, chosen by hand (v58, §8h); null until chosen. */
  commissionOf: CommissionKind | null;
  issuedAt: string | null;
  issuedBy: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  lines: AccDocumentLine[];
}

/** A row of a document list — what the table and its totals need, nothing more. */
export interface AccListRow {
  id: string;
  docType: AccDocType;
  docNo: string | null;
  status: AccDocStatus;
  source: AccDocSource;
  isTaxInvoice: boolean;
  issueDate: string;
  dueDate: string | null;
  buyerName: string;
  projectName: string;
  customerPoNo: string;
  totalSatang: number;
  paidSatang: number;
  /** What its issued credit notes took off it (step 8). */
  creditedSatang: number;
  /** A receipt's invoice (RE → INV). */
  relatedDocId: string | null;
  relatedDocNo: string | null;
  /** "INV" — or "SO" for a deposit's receipt. */
  relatedDocType: string | null;
  /** An invoice: an ISSUED billing note carries it (the list's ออกใบวางบิลแล้ว — the rule billingNotesOf reads). */
  onBillingNote: boolean;
}

const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const strOrNull = (v: unknown) => (v === null || v === undefined || v === "" ? null : String(v));
const num = (v: unknown) => Number(v) || 0;

function rowToLine(r: RowDataPacket): AccDocumentLine {
  return {
    id: String(r.id),
    sortOrder: num(r.sortOrder),
    lineType: r.lineType === "service" ? "service" : "goods",
    productId: str(r.productId),
    name: str(r.name),
    qty: num(r.qty),
    unit: str(r.unit),
    unitPriceSatang: num(r.unitPriceSatang),
    discountSatang: num(r.discountSatang),
    amountSatang: num(r.amountSatang),
    isMachine: Number(r.isMachine) === 1,
    serials: str(r.serials),
    warrantyMonths: r.warrantyMonths === null || r.warrantyMonths === undefined ? null : num(r.warrantyMonths),
    deliveredQty: num(r.deliveredQty),
    sourceLineId: str(r.sourceLineId),
  };
}

function rowToDoc(r: RowDataPacket, lines: AccDocumentLine[]): AccDocument {
  return {
    id: String(r.id),
    docType: String(r.docType) as AccDocType,
    docNo: strOrNull(r.docNo),
    status: String(r.status) as AccDocStatus,
    source: r.source === "external" ? "external" : "internal",
    externalNote: str(r.externalNote),
    isTaxInvoice: Number(r.isTaxInvoice) === 1,
    issueDate: str(r.issueDate),
    dueDate: strOrNull(r.dueDate),
    creditDays: num(r.creditDays),
    companyId: str(r.companyId),
    customerId: str(r.customerId),
    salespersonId: str(r.salespersonId),
    buyerName: str(r.buyerName),
    buyerAddress: str(r.buyerAddress),
    buyerTaxId: str(r.buyerTaxId),
    buyerBranch: str(r.buyerBranch),
    sellerVersionId: strOrNull(r.sellerVersionId),
    priceMode: r.priceMode === "inclusive" ? "inclusive" : "exclusive",
    vatRate: num(r.vatRate),
    subtotalSatang: num(r.subtotalSatang),
    discountSatang: num(r.discountSatang),
    depositSatang: num(r.depositSatang),
    vatBaseSatang: num(r.vatBaseSatang),
    vatSatang: num(r.vatSatang),
    totalSatang: num(r.totalSatang),
    paidSatang: num(r.paidSatang),
    creditedSatang: num(r.creditedSatang),
    creditedVatSatang: num(r.creditedVatSatang),
    refValueSatang: r.refValueSatang === null || r.refValueSatang === undefined ? null : num(r.refValueSatang),
    customerPoNo: str(r.customerPoNo),
    projectName: str(r.projectName),
    note: str(r.note),
    quotationId: strOrNull(r.quotationId),
    salesOrderId: strOrNull(r.salesOrderId),
    relatedDocId: strOrNull(r.relatedDocId),
    salesRecordId: strOrNull(r.salesRecordId),
    expectedDeliveryDate: strOrNull(r.expectedDeliveryDate),
    billingDate: strOrNull(r.billingDate),
    commissionOf: commissionKindOf(r.commissionOf),
    issuedAt: strOrNull(r.issuedAt),
    issuedBy: strOrNull(r.issuedBy),
    voidedAt: strOrNull(r.voidedAt),
    voidReason: strOrNull(r.voidReason),
    createdAt: str(r.createdAt),
    createdBy: str(r.createdBy),
    updatedAt: str(r.updatedAt),
    lines,
  };
}

export async function getAccDocument(id: string): Promise<AccDocument | null> {
  const [rows] = await query<RowDataPacket[]>("SELECT * FROM acc_documents WHERE id = ? LIMIT 1", [id]);
  if (!rows[0]) return null;
  const [lineRows] = await query<RowDataPacket[]>(
    "SELECT * FROM acc_document_lines WHERE documentId = ? ORDER BY sortOrder ASC",
    [id]
  );
  return rowToDoc(rows[0], lineRows.map(rowToLine));
}

/**
 * วันวางบิล — the day an invoice's bill is to be handed to the customer (the
 * owner, 2026-11-23). Internal: never printed. The CRM alert "วางบิล" opens
 * BILLING_REMINDER_LEAD_DAYS before it. Changeable on any invoice not
 * cancelled, never before its own date; null clears it; each change is in the
 * history. It is not the document's content, so its `updatedAt` — what a
 * draft's save checks — is left alone.
 */
export async function setInvoiceBillingDate(id: string, billingDate: string | null, actor: Actor): Promise<AccDocument> {
  if (billingDate !== null && !isValidDateString(billingDate)) throw new ApiError(400, "วันวางบิลไม่ถูกต้อง");
  await withTransaction(async (conn) => {
    const [rows] = await conn.query<RowDataPacket[]>(
      "SELECT id, docType, status, docNo, issueDate, billingDate FROM acc_documents WHERE id = ? LIMIT 1 FOR UPDATE",
      [id]
    );
    const row = rows[0];
    if (!row || row.docType !== "INV") throw new ApiError(404, "ไม่พบใบแจ้งหนี้");
    if (row.status === "void") throw new ApiError(409, "ใบแจ้งหนี้นี้ยกเลิกแล้ว");
    if (billingDate !== null && billingDate < str(row.issueDate)) throw new ApiError(400, "วันวางบิลต้องไม่ก่อนวันที่ของใบแจ้งหนี้");
    const was = strOrNull(row.billingDate);
    if (was === billingDate) return;
    await conn.query("UPDATE acc_documents SET billingDate = ? WHERE id = ?", [billingDate, id]);
    await writeAudit(conn, {
      ...actor,
      action: "doc.update",
      documentId: id,
      docNo: strOrNull(row.docNo),
      detail: `วันวางบิล ${was ? formatDisplayDate(was) : "—"} → ${billingDate ? formatDisplayDate(billingDate) : "—"}`,
    });
  });
  return (await getAccDocument(id))!;
}

/** The billing notes an invoice is on (not cancelled), oldest first. */
export async function billingNotesOf(invoiceId: string): Promise<{ id: string; docNo: string | null; issueDate: string }[]> {
  const [rows] = await query<RowDataPacket[]>(
    `SELECT b.id, b.docNo, b.issueDate FROM acc_billing_items bi JOIN acc_documents b ON b.id = bi.billingNoteId
      WHERE bi.invoiceId = ? AND b.status = 'issued' ORDER BY b.issueDate ASC`,
    [invoiceId]
  );
  return rows.map((r) => ({ id: String(r.id), docNo: strOrNull(r.docNo), issueDate: str(r.issueDate) }));
}

const LIST_LIMIT = 1000;

/** `%`, `_` and the escape itself, made literal for LIKE … ESCAPE '!'. */
export const likeEscape = (s: string) => s.replace(/[!%_]/g, (c) => `!${c}`);

/** A document type's list, newest first: in [from, to) when given, matching `q` (number, customer, PO, project). */
export async function listAccDocuments(opts: { type: AccDocType; from?: string; to?: string; q?: string }): Promise<AccListRow[]> {
  const where = ["docType = ?"];
  const params: unknown[] = [opts.type];
  if (opts.from) {
    where.push("issueDate >= ?");
    params.push(opts.from);
  }
  if (opts.to) {
    where.push("issueDate < ?");
    params.push(opts.to);
  }
  const q = (opts.q ?? "").trim();
  if (q) {
    const like = `%${likeEscape(q)}%`;
    where.push("(docNo LIKE ? ESCAPE '!' OR buyerName LIKE ? ESCAPE '!' OR customerPoNo LIKE ? ESCAPE '!' OR projectName LIKE ? ESCAPE '!')");
    params.push(like, like, like, like);
  }
  const [rows] = await query<RowDataPacket[]>(
    `SELECT id, docType, docNo, status, source, isTaxInvoice, issueDate, dueDate, buyerName, projectName, customerPoNo, totalSatang, paidSatang, creditedSatang,
            relatedDocId,
            (SELECT COALESCE(rel.docNo, CONCAT('PO ', rel.customerPoNo)) FROM acc_documents rel WHERE rel.id = d.relatedDocId) AS relatedDocNo,
            (SELECT rel.docType FROM acc_documents rel WHERE rel.id = d.relatedDocId) AS relatedDocType,
            EXISTS (SELECT 1 FROM acc_billing_items bi JOIN acc_documents bn ON bn.id = bi.billingNoteId WHERE bi.invoiceId = d.id AND bn.status = 'issued') AS onBillingNote
       FROM acc_documents d WHERE ${where.join(" AND ")}
      ORDER BY issueDate DESC, docNo DESC, createdAt DESC LIMIT ${LIST_LIMIT}`,
    params
  );
  return rows.map((r) => ({
    id: String(r.id),
    docType: String(r.docType) as AccDocType,
    docNo: strOrNull(r.docNo),
    status: String(r.status) as AccDocStatus,
    source: r.source === "external" ? "external" : "internal",
    isTaxInvoice: Number(r.isTaxInvoice) === 1,
    issueDate: str(r.issueDate),
    dueDate: strOrNull(r.dueDate),
    buyerName: str(r.buyerName),
    projectName: str(r.projectName),
    customerPoNo: str(r.customerPoNo),
    totalSatang: num(r.totalSatang),
    paidSatang: num(r.paidSatang),
    creditedSatang: num(r.creditedSatang),
    relatedDocId: strOrNull(r.relatedDocId),
    relatedDocNo: strOrNull(r.relatedDocNo),
    relatedDocType: strOrNull(r.relatedDocType),
    onBillingNote: Number(r.onBillingNote) === 1,
  }));
}

export interface DocumentSummary {
  outstandingSatang: number;
  outstandingCount: number;
  overdueSatang: number;
  overdueCount: number;
  issuedInMonthSatang: number;
}

/** What is still owed across every issued invoice (whatever the list's filter), and what was issued in [monthStart, monthEnd). */
export async function documentSummary(today: string, monthStart: string, monthEnd: string): Promise<DocumentSummary> {
  // What is owed takes the credit notes off (step 8).
  const owed = "status = 'issued' AND paidSatang + creditedSatang < totalSatang";
  const [rows] = await query<RowDataPacket[]>(
    `SELECT
       COALESCE(SUM(CASE WHEN ${owed} THEN totalSatang - creditedSatang - paidSatang END), 0) AS outstanding,
       COALESCE(SUM(CASE WHEN ${owed} THEN 1 ELSE 0 END), 0) AS outstandingCount,
       COALESCE(SUM(CASE WHEN ${owed} AND dueDate IS NOT NULL AND dueDate < ? THEN totalSatang - creditedSatang - paidSatang END), 0) AS overdue,
       COALESCE(SUM(CASE WHEN ${owed} AND dueDate IS NOT NULL AND dueDate < ? THEN 1 ELSE 0 END), 0) AS overdueCount,
       COALESCE(SUM(CASE WHEN status = 'issued' AND issueDate >= ? AND issueDate < ? THEN totalSatang END), 0) AS issuedInMonth
     FROM acc_documents WHERE docType = 'INV'`,
    [today, today, monthStart, monthEnd]
  );
  const r = rows[0] ?? {};
  return {
    outstandingSatang: num(r.outstanding),
    outstandingCount: num(r.outstandingCount),
    overdueSatang: num(r.overdue),
    overdueCount: num(r.overdueCount),
    issuedInMonthSatang: num(r.issuedInMonth),
  };
}

/**
 * The number issuing on `issueDate` would give now — for the confirm dialog
 * ("จะได้เลขที่ …"). A preview only: nothing is reserved, and the number is
 * handed out for real (under the lock) when the document is issued.
 */
export async function peekNextDocNo(type: NumberedDocType, issueDate: string): Promise<string> {
  const period = docPeriod(issueDate);
  const [counter] = await run(null, "SELECT lastNo FROM acc_counters WHERE docType = ? AND period = ?", [type, period]);
  const [max] = await run(
    null,
    "SELECT MAX(docNo) AS maxNo FROM acc_documents WHERE docType = ? AND source = 'internal' AND docNo LIKE ?",
    [type, `${type}${period}%`]
  );
  return formatDocNo(type, period, Math.max(num(counter?.lastNo), parseDocNo(max?.maxNo)?.seq ?? 0) + 1);
}

// ── Draft: create / update ──────────────────────────────────────────────────

/**
 * A line points at a customer-PO line — and a deposit is deducted — only on an
 * invoice that delivers from that PO; anywhere else both are dropped.
 */
function withOrderLink(input: InvoiceInput): InvoiceInput {
  if (input.salesOrderId) return { ...input, depositSatang: input.depositSatang ?? 0 };
  return { ...input, salesOrderId: "", depositSatang: 0, lines: input.lines.map((l) => ({ ...l, sourceLineId: "" })) };
}

/** An invoice's totals — its deposit deducted before VAT. */
const totalsOf = (input: InvoiceInput, vatRate: number) =>
  computeTotals({ lines: input.lines, discountSatang: input.discountSatang, depositSatang: input.depositSatang ?? 0, priceMode: input.priceMode, vatRate });

/** The columns a draft save writes, with values — totals computed HERE, never taken from the browser. */
async function draftColumns(rawInput: InvoiceInput, invoiceId: string | null) {
  const input = withOrderLink(rawInput);
  const vatRate = await getVatRate();
  const problems = invoiceProblems(input, vatRate);
  if (problems.first) throw new ApiError(400, problems.first);
  if (input.salesOrderId) {
    const problem = await draftDeliveryProblem(input.salesOrderId, input.lines, invoiceId, input.depositSatang ?? 0);
    if (problem) throw new ApiError(409, problem);
  }
  return { columns: columnsOf(input, totalsOf(input, vatRate), vatRate), lines: input.lines };
}

/** A document's header columns for `input` with these totals. */
export function columnsOf(input: InvoiceInput, totals: DocTotals, vatRate: number) {
  return {
      isTaxInvoice: input.isTaxInvoice ? 1 : 0,
      issueDate: input.issueDate,
      dueDate: dueDateOf(input.issueDate, input.creditDays),
      creditDays: input.creditDays,
      companyId: input.companyId || null,
      customerId: input.customerId || null,
      salespersonId: input.salespersonId || null,
      buyerName: input.buyerName,
      buyerAddress: input.buyerAddress,
      buyerTaxId: input.buyerTaxId,
      buyerBranch: input.buyerBranch,
      priceMode: input.priceMode,
      vatRate,
      subtotalSatang: totals.subtotalSatang,
      discountSatang: totals.discountSatang,
      depositSatang: totals.depositSatang,
      vatBaseSatang: totals.vatBaseSatang,
      vatSatang: totals.vatSatang,
      totalSatang: totals.totalSatang,
      customerPoNo: input.customerPoNo,
      projectName: input.projectName,
      note: input.note,
      salesOrderId: input.salesOrderId || null,
  };
}

/** Writes a document's lines over whatever it had (a draft's, a PO's before any delivery). */
export async function replaceLines(conn: PoolConnection, documentId: string, lines: readonly DocLineInput[]): Promise<void> {
  await conn.query("DELETE FROM acc_document_lines WHERE documentId = ?", [documentId]);
  if (lines.length === 0) return;
  const cols = [
    "id", "documentId", "sortOrder", "lineType", "productId", "name", "qty", "unit",
    "unitPriceSatang", "discountSatang", "amountSatang", "isMachine", "serials", "warrantyMonths", "sourceLineId",
  ];
  const values = lines.flatMap((l, i) => [
    crypto.randomUUID(), documentId, i, l.lineType, l.productId, l.name, l.qty, l.unit,
    l.unitPriceSatang, l.discountSatang, lineAmountSatang(l), l.isMachine ? 1 : 0,
    l.isMachine ? l.serials : "", l.isMachine ? l.warrantyMonths : null, l.sourceLineId || null,
  ]);
  await conn.query(
    `INSERT INTO acc_document_lines (${cols.join(", ")}) VALUES ${lines.map(() => `(${cols.map(() => "?").join(", ")})`).join(", ")}`,
    values
  );
}

export async function createInvoiceDraft(input: InvoiceInput, actor: Actor): Promise<AccDocument> {
  const { columns, lines } = await draftColumns(input, null);
  const id = await withTransaction(async (conn) => {
    const docId = crypto.randomUUID();
    const now = new Date().toISOString();
    const row: Record<string, unknown> = {
      id: docId,
      docType: "INV",
      status: "draft",
      source: "internal",
      ...columns,
      createdAt: now,
      createdBy: actor.username,
      updatedAt: now,
    };
    const keys = Object.keys(row);
    await conn.query(`INSERT INTO acc_documents (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`, Object.values(row));
    await replaceLines(conn, docId, lines);
    await writeAudit(conn, { ...actor, action: "doc.create", documentId: docId, detail: `ร่างใบแจ้งหนี้ · ${input.buyerName} · ${formatSatang(columns.totalSatang)} บาท` });
    return docId;
  });
  return (await getAccDocument(id))!;
}

/**
 * Saves over a draft. `expectedUpdatedAt` (what the editor opened) turns a
 * save over someone else's newer save — another tab — into a 409 instead of
 * silently undoing it.
 */
export async function updateInvoiceDraft(id: string, input: InvoiceInput, actor: Actor, expectedUpdatedAt?: string): Promise<AccDocument> {
  const { columns, lines } = await draftColumns(input, id);
  await withTransaction(async (conn) => {
    const [rows] = await conn.query<RowDataPacket[]>("SELECT status, updatedAt FROM acc_documents WHERE id = ? FOR UPDATE", [id]);
    if (!rows[0]) throw new ApiError(404, "ไม่พบเอกสารนี้");
    if (rows[0].status !== "draft") throw new ApiError(409, "เอกสารที่ออกแล้วแก้ไขไม่ได้ — ถ้าข้อมูลผิด ให้ลบหรือยกเลิกแล้วออกใบใหม่");
    if (expectedUpdatedAt && String(rows[0].updatedAt) !== expectedUpdatedAt) {
      throw new ApiError(409, "ร่างนี้ถูกแก้จากที่อื่นหลังจากเปิดหน้านี้ — กรุณาเปิดใหม่ก่อนบันทึก");
    }
    const row: Record<string, unknown> = { ...columns, updatedAt: new Date().toISOString() };
    const keys = Object.keys(row);
    await conn.query(`UPDATE acc_documents SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`, [...Object.values(row), id]);
    await replaceLines(conn, id, lines);
    await writeAudit(conn, { ...actor, action: "doc.update", documentId: id, detail: `แก้ร่าง · ${formatSatang(columns.totalSatang)} บาท` });
  });
  return (await getAccDocument(id))!;
}

// ── Issue ────────────────────────────────────────────────────────────────────

/** Category of each catalog product — the dashboard's category chart reads it off the sale's lines. */
async function categoriesOf(productIds: string[]): Promise<Map<string, number>> {
  const ids = [...new Set(productIds.filter(Boolean))];
  if (ids.length === 0) return new Map();
  const [rows] = await query<RowDataPacket[]>(
    `SELECT id, categoryId FROM products WHERE id IN (${ids.map(() => "?").join(", ")})`,
    ids
  );
  return new Map(rows.filter((r) => r.categoryId !== null && r.categoryId !== undefined).map((r) => [String(r.id), Number(r.categoryId)]));
}

/** Warranty's last day: start + months − 1 day (18 Nov 2026 + 12 → 17 Nov 2027). */
export function warrantyEndOf(start: string, months: number | null): string | null {
  if (!months || months <= 0) return null;
  return addDaysToDateString(addMonthsToDateString(start, months), -1);
}

/**
 * The /dashboard sale an invoice becomes: one line per invoice line, ex VAT,
 * the bill discount (and VAT out of inclusive prices) shared over the lines so
 * they add up to the VAT base; no cost yet (the dashboard flags that); one
 * machine per unit of every line marked as a machine.
 */
export function saleInputFromInvoice(doc: AccDocument, categories: Map<string, number>) {
  // What was SOLD, ex VAT: a deposit deducted on the bill (before VAT) was
  // paid ahead for these same goods — it is part of this sale, not less of it.
  const shares = allocateProportionally(doc.lines.map((l) => l.amountSatang), doc.vatBaseSatang + Math.max(0, doc.depositSatang || 0));
  const items = doc.lines.map((l, i) => {
    const qty = Math.max(1, Math.round(l.qty));
    const total = satangToBaht(shares[i]);
    return {
      productId: l.productId,
      productName: l.name,
      categoryId: categories.get(l.productId) ?? null,
      qty,
      unitPrice: Math.round((total / qty) * 100) / 100,
      totalAmount: total,
      costAmount: 0,
      sortOrder: i,
    };
  });
  const equipments: EquipmentRowInput[] = doc.lines.flatMap((l) => {
    if (!l.isMachine) return [];
    const serials = splitSerials(l.serials);
    return Array.from({ length: Math.max(1, Math.round(l.qty)) }, (_, k) => ({
      serialNumber: serials[k] ?? "",
      productId: l.productId || undefined,
      productName: l.name,
      warrantyStartDate: doc.issueDate,
      warrantyEndDate: warrantyEndOf(doc.issueDate, l.warrantyMonths),
      customerId: doc.customerId || undefined,
    }));
  });
  return {
    sale: {
      saleType: doc.lines.some((l) => l.lineType === "goods") ? "equipment" : "service",
      salespersonId: doc.salespersonId,
      customerId: doc.customerId,
      companyId: doc.companyId,
      saleDate: doc.issueDate,
      quotationId: doc.quotationId,
      poRef: doc.customerPoNo,
      invoiceRef: "",
      note: "",
    },
    items,
    equipments,
  };
}

/** The draft's input again, for the issue checks (what it would save as). */
function inputOf(doc: AccDocument): InvoiceInput {
  return {
    issueDate: doc.issueDate,
    creditDays: doc.creditDays,
    companyId: doc.companyId,
    customerId: doc.customerId,
    salespersonId: doc.salespersonId,
    buyerName: doc.buyerName,
    buyerAddress: doc.buyerAddress,
    buyerTaxId: doc.buyerTaxId,
    buyerBranch: doc.buyerBranch,
    priceMode: doc.priceMode,
    discountSatang: doc.discountSatang,
    isTaxInvoice: doc.isTaxInvoice,
    customerPoNo: doc.customerPoNo,
    projectName: doc.projectName,
    note: doc.note,
    lines: doc.lines,
    salesOrderId: doc.salesOrderId ?? "",
    depositSatang: doc.depositSatang,
  };
}

/**
 * A delivery from a customer PO, inside the transaction that issues the
 * invoice: the PO locked and checked (nothing more than it still holds, no
 * more deposit deducted than is left of it), the sale marked as that PO's deal
 * (one PO = one deal on the dashboard, however many deliveries), the PO's
 * delivered quantities re-summed — or nothing, for an invoice not from a PO.
 */
async function deliverFromOrderTx(
  conn: PoolConnection,
  order: { salesOrderId: string | null | undefined; lines: readonly DocLineInput[]; invoiceId: string | null; depositSatang: number },
  saleId: string,
  phase: "check" | "after"
): Promise<void> {
  if (!order.salesOrderId) return;
  if (phase === "check") {
    await checkDeliveryTx(conn, order.salesOrderId, order.lines, order.invoiceId, order.depositSatang);
    return;
  }
  await conn.query("UPDATE sales_records SET dealId = ? WHERE id = ?", [order.salesOrderId, saleId]);
  await recomputeDeliveredTx(conn, order.salesOrderId);
}

/**
 * Issues a draft: gives it its number, locks it, points it at our company's
 * current version, and creates its /dashboard sale and machines — all in ONE
 * transaction, so there is never an issued invoice without its sale, or a
 * number spent on a document that did not land. A delivery from a customer
 * PO takes its quantities off the PO in the same transaction.
 */
export async function issueInvoice(id: string, actor: Actor, expectedUpdatedAt?: string): Promise<AccDocument> {
  const doc = await getAccDocument(id);
  if (!doc || doc.docType !== "INV") throw new ApiError(404, "ไม่พบเอกสารนี้");
  if (doc.status !== "draft") throw new ApiError(409, "เอกสารนี้ออกไปแล้ว");
  const { versionId } = await getSellerProfile();
  if (!versionId) throw new ApiError(409, "ยังไม่ได้ตั้งข้อมูลบริษัทสำหรับพิมพ์บนเอกสาร — ไปที่ ตั้งค่าบัญชี ก่อน");
  const input = inputOf(doc);
  const problems = invoiceProblems(input, doc.vatRate);
  if (problems.first) throw new ApiError(400, problems.first);
  const issueIssues = issueProblems(input, {
    subtotalSatang: doc.subtotalSatang,
    discountSatang: doc.discountSatang,
    depositSatang: doc.depositSatang,
    vatBaseSatang: doc.vatBaseSatang,
    vatSatang: doc.vatSatang,
    totalSatang: doc.totalSatang,
  });
  if (issueIssues.length > 0) throw new ApiError(400, issueIssues[0]);

  // Reads before the transaction, writes inside it (as createSaleWithLineItems does).
  const prepared = await prepareSaleWithLineItems(saleInputFromInvoice(doc, await categoriesOf(doc.lines.map((l) => l.productId))));

  await withTransaction(async (conn) => {
    const [rows] = await conn.query<RowDataPacket[]>("SELECT status, updatedAt FROM acc_documents WHERE id = ? FOR UPDATE", [id]);
    if (!rows[0]) throw new ApiError(404, "ไม่พบเอกสารนี้");
    if (rows[0].status !== "draft") throw new ApiError(409, "เอกสารนี้ออกไปแล้ว");
    // What was checked and prepared above must still be the draft.
    if (String(rows[0].updatedAt) !== doc.updatedAt || (expectedUpdatedAt && expectedUpdatedAt !== doc.updatedAt)) {
      throw new ApiError(409, "ร่างนี้ถูกแก้หลังจากเปิดหน้านี้ — กรุณาเปิดใหม่แล้วตรวจอีกครั้งก่อนออกเอกสาร");
    }
    const delivery = { salesOrderId: doc.salesOrderId, lines: doc.lines, invoiceId: id, depositSatang: doc.depositSatang };
    await deliverFromOrderTx(conn, delivery, "", "check");
    const docNo = await allocateDocNo(conn, "INV", doc.issueDate);
    prepared.v.invoiceRef = docNo;
    prepared.v.note = `สร้างอัตโนมัติจากใบแจ้งหนี้ ${docNo}`;
    const saleId = await insertPreparedSaleTx(conn, prepared);
    const now = new Date().toISOString();
    await conn.query(
      "UPDATE acc_documents SET status = 'issued', docNo = ?, sellerVersionId = ?, salesRecordId = ?, issuedAt = ?, issuedBy = ?, updatedAt = ? WHERE id = ?",
      [docNo, versionId, saleId, now, actor.username, now, id]
    );
    await deliverFromOrderTx(conn, delivery, saleId, "after");
    await writeAudit(conn, {
      ...actor,
      action: "doc.issue",
      documentId: id,
      docNo,
      detail: `ออกใบแจ้งหนี้ · ${doc.buyerName} · ${formatSatang(doc.totalSatang)} บาท`,
    });
  });
  return (await getAccDocument(id))!;
}

// ── Delete ───────────────────────────────────────────────────────────────────

export interface DeletionImpact {
  status: AccDocStatus;
  docNo: string | null;
  /** Its number goes back to the counter (the next document takes it). */
  isLatestNumber: boolean;
  livePayments: number;
  /** Receipts / credit notes that point at it — or, for a customer PO, the invoices delivered from it. */
  dependentDocs: number;
  /** Why it cannot be deleted, in Thai — null when it can. */
  blockedReason: string | null;
  /** The /dashboard sale it created, and what deleting would take with it. */
  sale: { id: string; costSatang: number; sharedWithOtherDocs: boolean } | null;
  machines: { total: number; withHistory: number };
  /** A receipt: the payment it records, which goes with it, and the invoice that then owes it again. */
  receiptPayment: {
    amountSatang: number;
    voided: boolean;
    /** What it pays — an invoice, a customer PO (a deposit) or a billing note. */
    invoiceId: string;
    invoiceNo: string | null;
    deposit: boolean;
    /** A billing note's receipt: it pays `invoiceIds`, each of which owes its share again once it goes. */
    billing?: boolean;
    invoiceIds?: string[];
  } | null;
  /** An issued delivery from a customer PO: the PO its quantities go back to. */
  fromOrder: { id: string; customerPoNo: string } | null;
}

type Exec = { query: PoolConnection["query"] } | null;
async function run(conn: Exec, sql: string, params: unknown[]): Promise<RowDataPacket[]> {
  const [rows] = conn ? await conn.query<RowDataPacket[]>(sql, params) : await query<RowDataPacket[]>(sql, params);
  return rows;
}

async function impactOf(
  conn: Exec,
  doc: {
    id: string;
    docType: string;
    status: AccDocStatus;
    docNo: string | null;
    salesRecordId: string | null;
    relatedDocId: string | null;
    salesOrderId: string | null;
  }
): Promise<DeletionImpact> {
  // Inside the delete's transaction these are LOCKING reads: a plain SELECT
  // reads the snapshot the transaction began with (TiDB), which misses a
  // payment — or its receipt — committed while the delete waited for its
  // lock, and the invoice would go with a live payment hanging off it.
  const current = conn ? " FOR UPDATE" : "";
  let receiptPayment: DeletionImpact["receiptPayment"] = null;
  if (doc.docType === "RE") {
    // Every payment it records — a billing note's receipt records one per invoice.
    const ps = await run(conn, `SELECT amountSatang, voidedAt, documentId FROM acc_payments WHERE receiptId = ?${current}`, [doc.id]);
    const relatedId = doc.relatedDocId ?? (ps[0] ? String(ps[0].documentId) : null);
    if (ps.length > 0 && relatedId) {
      // What it paid: an invoice — a customer PO, for a deposit — or a billing note's invoices.
      const [inv] = await run(conn, "SELECT docNo, docType, customerPoNo FROM acc_documents WHERE id = ?", [relatedId]);
      const deposit = inv?.docType === "SO";
      receiptPayment = {
        amountSatang: ps.reduce((s, p) => s + num(p.amountSatang), 0),
        voided: ps.every((p) => Boolean(p.voidedAt)),
        invoiceId: relatedId,
        invoiceNo: deposit ? `PO ${str(inv.customerPoNo)}` : strOrNull(inv?.docNo),
        deposit,
        billing: inv?.docType === "BN",
        invoiceIds: [...new Set(ps.map((p) => String(p.documentId)))],
      };
    }
  }
  // A billing note's payments are on its invoices — counted by the note they came through.
  const [payments] = await run(
    conn,
    `SELECT COUNT(*) AS n FROM acc_payments WHERE ${doc.docType === "BN" ? "billingNoteId" : "documentId"} = ? AND voidedAt IS NULL${current}`,
    [doc.id]
  );
  const [dependents] = await run(conn, `SELECT COUNT(*) AS n FROM acc_documents WHERE relatedDocId = ? OR salesOrderId = ?${current}`, [doc.id, doc.id]);
  const livePayments = num(payments?.n);
  const dependentDocs = num(dependents?.n);
  // An invoice on an open billing note: the note printed it — it goes first.
  const billedOn =
    doc.docType === "INV" && doc.status !== "draft"
      ? (
          await run(
            conn,
            `SELECT b.docNo FROM acc_billing_items bi JOIN acc_documents b ON b.id = bi.billingNoteId WHERE bi.invoiceId = ? AND b.status = 'issued'${current}`,
            [doc.id]
          )
        ).map((r) => str(r.docNo))
      : [];
  let blockedReason: string | null = null;
  if (doc.docType === "BN") {
    blockedReason =
      livePayments > 0
        ? "ใบวางบิลนี้มีการรับชำระแล้ว — ยกเลิกรายการรับชำระก่อนจึงจะลบได้"
        : dependentDocs > 0
          ? "มีใบเสร็จตามใบวางบิลนี้ (ที่ยกเลิกแล้ว) — ลบใบเสร็จนั้นก่อน"
          : null;
  } else if (doc.docType === "SO") {
    // A PO's dependents: the invoices delivered from it, and its deposits' receipts.
    const deliveries = dependentDocs > 0 ? num((await run(conn, `SELECT COUNT(*) AS n FROM acc_documents WHERE salesOrderId = ?${current}`, [doc.id]))[0]?.n) : 0;
    // A commission marked paid on it (undone ones too) keeps it: the marks are its history (§8h).
    const payouts = num((await run(conn, `SELECT COUNT(*) AS n FROM acc_commission_payouts WHERE salesOrderId = ?${current}`, [doc.id]))[0]?.n);
    blockedReason =
      livePayments > 0
        ? "PO นี้มีเงินมัดจำแล้ว — ยกเลิกรายการมัดจำก่อนจึงจะลบได้"
        : deliveries > 0
          ? "มีใบแจ้งหนี้ที่ส่งของจาก PO นี้แล้ว — ลบใบแจ้งหนี้นั้นก่อน หรือกด ยกเลิก PO แทน"
          : dependentDocs > 0
            ? "มีใบเสร็จมัดจำของ PO นี้ (ที่ยกเลิกแล้ว) — ลบใบเสร็จนั้นก่อน หรือกด ยกเลิก PO แทน"
            : payouts > 0
              ? "มีประวัติการจ่ายค่าคอมของ PO นี้ — ลบไม่ได้ กด ยกเลิก PO แทน"
              : null;
  } else {
    blockedReason =
      livePayments > 0
        ? "ใบนี้มีรายการรับชำระแล้ว — ยกเลิกรายการรับชำระก่อนจึงจะลบได้"
        : dependentDocs > 0
          ? "มีเอกสารอื่นอ้างถึงใบนี้ (ใบเสร็จ / ใบลดหนี้) — ลบเอกสารนั้นก่อน"
          : billedOn.length > 0
            ? `ใบนี้อยู่ในใบวางบิล ${billedOn.join(", ")} — ยกเลิกหรือลบใบวางบิลนั้นก่อน`
            : null;
  }
  let isLatestNumber = false;
  const parsed = parseDocNo(doc.docNo);
  if (doc.status !== "draft" && parsed) {
    const [counter] = await run(conn, "SELECT lastNo FROM acc_counters WHERE docType = ? AND period = ?", [parsed.type, parsed.period]);
    isLatestNumber = Number(counter?.lastNo) === parsed.seq;
  }
  let sale: DeletionImpact["sale"] = null;
  const machines = { total: 0, withHistory: 0 };
  if (doc.salesRecordId) {
    const [costRow] = await run(conn, "SELECT costAmount FROM sales_records WHERE id = ?", [doc.salesRecordId]);
    if (costRow) {
      const [others] = await run(conn, "SELECT COUNT(*) AS n FROM acc_documents WHERE salesRecordId = ? AND id <> ?", [doc.salesRecordId, doc.id]);
      sale = { id: doc.salesRecordId, costSatang: Math.round(num(costRow.costAmount) * 100), sharedWithOtherDocs: num(others?.n) > 0 };
      const units = await machinesOf(conn, doc.salesRecordId);
      machines.total = units.length;
      machines.withHistory = units.filter((u) => u.hasHistory).length;
    }
  }
  let fromOrder: DeletionImpact["fromOrder"] = null;
  if (doc.docType === "INV" && doc.status !== "draft" && doc.salesOrderId) {
    // A label only — the delete itself locks the PO before giving anything back.
    const [order] = await run(conn, "SELECT customerPoNo FROM acc_documents WHERE id = ?", [doc.salesOrderId]);
    if (order) fromOrder = { id: doc.salesOrderId, customerPoNo: String(order.customerPoNo ?? "") };
  }
  return { status: doc.status, docNo: doc.docNo, isLatestNumber, livePayments, dependentDocs, blockedReason, sale, machines, receiptPayment, fromOrder };
}

/** The sale's machines, and whether anything has been recorded against each (a schedule, a service log, a job sheet). */
async function machinesOf(conn: Exec, salesRecordId: string): Promise<{ id: string; hasHistory: boolean }[]> {
  const rows = await run(
    conn,
    `SELECT e.id,
            (EXISTS (SELECT 1 FROM service_schedules s WHERE s.equipmentId = e.id)
             OR EXISTS (SELECT 1 FROM service_logs l WHERE l.equipmentId = e.id)
             OR EXISTS (SELECT 1 FROM service_job_equipments j WHERE j.equipmentId = e.id)) AS hasHistory
       FROM customer_equipments e WHERE e.salesRecordId = ?`,
    [salesRecordId]
  );
  return rows.map((r) => ({ id: String(r.id), hasHistory: Number(r.hasHistory) === 1 }));
}

/** What deleting would do — for the dialog, before anything is deleted. Null when there is no such document. */
export async function deletionImpact(id: string): Promise<DeletionImpact | null> {
  const [row] = await run(null, "SELECT id, docType, status, docNo, salesRecordId, relatedDocId, salesOrderId FROM acc_documents WHERE id = ?", [id]);
  if (!row) return null;
  return impactOf(null, {
    id: String(row.id),
    docType: String(row.docType),
    status: String(row.status) as AccDocStatus,
    docNo: strOrNull(row.docNo),
    salesRecordId: strOrNull(row.salesRecordId),
    relatedDocId: strOrNull(row.relatedDocId),
    salesOrderId: strOrNull(row.salesOrderId),
  });
}

export interface DeletionResult {
  docNo: string | null;
  releasedNumber: boolean;
  machinesDeleted: number;
  machinesKept: number;
  saleDeleted: boolean;
}

/**
 * Deletes a document — a draft, or an issued one together with what issuing
 * created: its sale (and the costs typed into it) and the machines no service
 * has been recorded against (the others are kept, unlinked). Refused while
 * payments or other documents hang off it. The latest number of its series
 * goes back to the counter. The audit log keeps a line.
 *
 * A RECEIPT takes the payment it records along (the invoice owes that again);
 * an invoice takes the payments voided on it (a live one refuses the delete).
 */
export async function deleteAccDocument(id: string, actor: Actor, opts: { passwordChecked: boolean }): Promise<DeletionResult> {
  return withTransaction(async (conn) => {
    // A receipt's invoice is locked BEFORE the receipt: the order every
    // payment change takes (payments.ts), so the two cannot deadlock.
    const [peek] = await run(conn, "SELECT docType, relatedDocId FROM acc_documents WHERE id = ?", [id]);
    // A receipt's — or a credit note's — invoice is locked BEFORE it, the order every change to what an invoice owes takes.
    const paidInvoiceId = peek?.docType === "RE" || peek?.docType === "CN" ? strOrNull(peek.relatedDocId) : null;
    const creditedInvoice = peek?.docType === "CN";
    // What a receipt pays: an invoice — or, for a deposit, the customer PO.
    const [paidInvoice] = paidInvoiceId
      ? await run(conn, "SELECT id, docType, docNo, salesRecordId, customerPoNo, vatRate FROM acc_documents WHERE id = ? FOR UPDATE", [paidInvoiceId])
      : [];
    const depositOf = paidInvoice?.docType === "SO" ? String(paidInvoice.id) : null;
    const [row] = await run(
      conn,
      "SELECT id, docType, status, docNo, salesRecordId, relatedDocId, salesOrderId, customerPoNo, buyerName, totalSatang, vatBaseSatang FROM acc_documents WHERE id = ? FOR UPDATE",
      [id]
    );
    if (!row) throw new ApiError(404, "ไม่พบเอกสารนี้");
    const doc = {
      id,
      docType: String(row.docType),
      status: String(row.status) as AccDocStatus,
      docNo: strOrNull(row.docNo),
      salesRecordId: strOrNull(row.salesRecordId),
      relatedDocId: strOrNull(row.relatedDocId),
      salesOrderId: strOrNull(row.salesOrderId),
    };
    // Checked again under the lock: a draft issued in another tab since the
    // route looked must not be deleted without the password an issued one needs.
    if (doc.status !== "draft" && !opts.passwordChecked) {
      throw new ApiError(409, "เอกสารนี้เพิ่งถูกออกเป็นเอกสารจริง — กดลบอีกครั้ง (ต้องยืนยันรหัสผ่าน)");
    }
    const impact = await impactOf(conn, doc);
    if (impact.blockedReason) throw new ApiError(409, impact.blockedReason);
    // A delivery from a customer PO: the PO locked now (after the invoice —
    // the order issuing takes), its quantities given back below.
    const deliveredFrom = doc.docType === "INV" ? strOrNull(row.salesOrderId) : null;
    const orderLocked = deliveredFrom ? await lockOrderTx(conn, deliveredFrom) : false;
    // A deposit's receipt cannot go while the invoices still lean on that deposit.
    if (depositOf && impact.receiptPayment && !impact.receiptPayment.voided) {
      await assertDepositNotDeductedTx(conn, depositOf, num(paidInvoice.vatRate), num(row.vatBaseSatang));
    }

    if (doc.docType === "RE") {
      await conn.query("DELETE FROM acc_payments WHERE receiptId = ?", [id]);
    } else if (doc.docType === "SO") {
      // Only voided deposits can be left (a live one refused above), and its plan goes with it.
      await conn.query("DELETE FROM acc_payments WHERE documentId = ?", [id]);
      await conn.query("DELETE FROM acc_plan_items WHERE salesOrderId = ?", [id]);
    } else if (doc.docType === "BN") {
      // Its list goes; the payments voided on it stay on their invoices, no longer pointing at it.
      await conn.query("DELETE FROM acc_billing_items WHERE billingNoteId = ?", [id]);
      await conn.query("UPDATE acc_payments SET billingNoteId = NULL WHERE billingNoteId = ?", [id]);
    } else {
      // Only VOIDED payments can be left here (a live one refused above):
      // dead rows of a document that is going — kept, they would only take space.
      await conn.query("DELETE FROM acc_payments WHERE documentId = ?", [id]);
      // A cancelled billing note's line for it goes too (an open one refused above).
      await conn.query("DELETE FROM acc_billing_items WHERE invoiceId = ?", [id]);
    }

    let machinesDeleted = 0;
    let machinesKept = 0;
    let saleDeleted = false;
    if (impact.sale && !impact.sale.sharedWithOtherDocs) {
      for (const unit of await machinesOf(conn, impact.sale.id)) {
        if (unit.hasHistory) {
          await conn.query("UPDATE customer_equipments SET salesRecordId = '' WHERE id = ?", [unit.id]);
          machinesKept += 1;
        } else {
          await conn.query("DELETE FROM customer_equipments WHERE id = ?", [unit.id]);
          machinesDeleted += 1;
        }
      }
      // Its line items and cost items first, by hand: the FKs cascade only
      // where the database enforces them, and orphans would sit in the
      // tables taking space for nothing.
      await conn.query("DELETE FROM sales_record_items WHERE salesRecordId = ?", [impact.sale.id]);
      await conn.query("DELETE FROM sale_cost_items WHERE salesRecordId = ?", [impact.sale.id]);
      await conn.query("DELETE FROM sales_records WHERE id = ?", [impact.sale.id]);
      saleDeleted = true;
    }
    const releasedNumber = doc.docNo && doc.status !== "draft" ? await releaseDocNoIfLatest(conn, doc.docNo) : false;
    await conn.query("DELETE FROM acc_document_lines WHERE documentId = ?", [id]);
    await conn.query("DELETE FROM acc_documents WHERE id = ?", [id]);
    if (deliveredFrom && orderLocked) await recomputeDeliveredTx(conn, deliveredFrom);

    const livePayment = impact.receiptPayment && !impact.receiptPayment.voided ? impact.receiptPayment : null;
    if (creditedInvoice && paidInvoice) {
      // A credit note: what it took off goes back on its invoice.
      await recomputeCreditedTx(conn, String(paidInvoice.id));
      await writeAudit(conn, {
        ...actor,
        action: "doc.delete",
        documentId: String(paidInvoice.id),
        docNo: strOrNull(paidInvoice.docNo),
        detail: `ลบใบลดหนี้ ${doc.docNo ?? ""} — ${formatSatang(num(row.totalSatang))} บาท กลับเป็นยอดของใบนี้`,
      });
    } else if (paidInvoice && paidInvoice.docType === "BN") {
      // A billing note's receipt: each invoice it paid owes its share again.
      for (const invoiceId of impact.receiptPayment?.invoiceIds ?? []) {
        await recomputePaidSatang(conn, invoiceId);
        const [inv] = await run(conn, "SELECT docNo, salesRecordId FROM acc_documents WHERE id = ? FOR UPDATE", [invoiceId]);
        await syncSaleReceiptRef(conn, strOrNull(inv?.salesRecordId), invoiceId);
        await writeAudit(conn, {
          ...actor,
          action: "doc.delete",
          documentId: invoiceId,
          docNo: strOrNull(inv?.docNo),
          detail: `ลบใบเสร็จ ${doc.docNo ?? ""} (ตามใบวางบิล ${str(paidInvoice.docNo)})${livePayment ? " · รายการรับชำระของใบนี้ถูกลบด้วย (กลับเป็นยอดค้าง)" : ""}`,
        });
      }
      await writeAudit(conn, {
        ...actor,
        action: "doc.delete",
        documentId: String(paidInvoice.id),
        docNo: strOrNull(paidInvoice.docNo),
        detail: `ลบใบเสร็จ ${doc.docNo ?? ""}${livePayment ? ` · รายการรับชำระ ${formatSatang(livePayment.amountSatang)} บาท ถูกลบด้วย` : ""}`,
      });
    } else if (paidInvoice) {
      const invoiceId = String(paidInvoice.id);
      await recomputePaidSatang(conn, invoiceId);
      await syncSaleReceiptRef(conn, strOrNull(paidInvoice.salesRecordId), invoiceId);
      await writeAudit(conn, {
        ...actor,
        action: "doc.delete",
        documentId: invoiceId,
        docNo: depositOf ? strOrNull(paidInvoice.customerPoNo) : strOrNull(paidInvoice.docNo),
        detail: depositOf
          ? `ลบใบเสร็จมัดจำ ${doc.docNo ?? ""}${livePayment ? ` · เงินมัดจำ ${formatSatang(livePayment.amountSatang)} บาท ถูกลบด้วย` : ""}`
          : `ลบใบเสร็จ ${doc.docNo ?? ""}${livePayment ? ` · รายการรับชำระ ${formatSatang(livePayment.amountSatang)} บาท ถูกลบด้วย (กลับเป็นยอดค้าง)` : ""}`,
      });
    }

    // A customer PO has no number of ours — the customer's names it.
    const isOrder = doc.docType === "SO";
    const label = isOrder ? `PO ลูกค้า ${String(row.customerPoNo ?? "")}` : doc.docNo ?? "ร่าง";
    const parts = [
      label,
      String(row.buyerName ?? ""),
      `${formatSatang(num(row.totalSatang))} บาท`,
      livePayment ? `ลบรายการรับชำระของ ${livePayment.invoiceNo ?? "ใบแจ้งหนี้"}` : null,
      saleDeleted ? "ลบรายการขายใน dashboard" : null,
      machinesDeleted ? `ลบเครื่อง ${machinesDeleted} เครื่อง` : null,
      machinesKept ? `เก็บเครื่องที่มีประวัติไว้ ${machinesKept} เครื่อง` : null,
      releasedNumber ? "คืนเลขเอกสาร" : null,
      deliveredFrom && orderLocked && doc.status !== "draft" ? "คืนจำนวนที่ส่งให้ PO ลูกค้า" : null,
    ].filter(Boolean);
    await writeAudit(conn, {
      ...actor,
      action: "doc.delete",
      documentId: id,
      docNo: isOrder ? strOrNull(row.customerPoNo) : doc.docNo,
      detail: `ลบ · ${parts.join(" · ")}`,
    });
    return { docNo: doc.docNo, releasedNumber, machinesDeleted, machinesKept, saleDeleted };
  });
}

// ── Void an issued invoice (step 8) ─────────────────────────────────────────

export const INVOICE_VOID_REASON_MAX = 300;

/**
 * Voids an issued invoice — for one handed to the customer and wrong (a test
 * one is deleted instead): its number stays, marked ยกเลิก with the reason;
 * what issuing created goes — its sale (and the costs typed into it; the
 * dialog says so first) and the machines no service was recorded against
 * (the others kept, unlinked); a delivery's quantities go back to its PO, its
 * deposit deduction with them. Refused while money is recorded on it, a credit
 * note still stands on it, or an open billing note lists it. The route asks
 * for the password first.
 */
export async function voidInvoice(id: string, reasonText: string, actor: Actor): Promise<AccDocument> {
  const reason = String(reasonText ?? "").trim();
  if (!reason) throw new ApiError(400, "กรุณาบอกเหตุผลที่ยกเลิก");
  if (reason.length > INVOICE_VOID_REASON_MAX) throw new ApiError(400, `เหตุผลยาวเกิน ${INVOICE_VOID_REASON_MAX} ตัวอักษร`);
  await withTransaction(async (conn) => {
    const [row] = await run(conn, "SELECT docType, status, docNo, salesRecordId, salesOrderId, buyerName, totalSatang FROM acc_documents WHERE id = ? FOR UPDATE", [id]);
    if (!row || row.docType !== "INV") throw new ApiError(404, "ไม่พบใบแจ้งหนี้นี้");
    if (row.status === "draft") throw new ApiError(409, "ร่างยังไม่ใช่เอกสาร — ลบร่างได้เลย ไม่ต้องยกเลิก");
    if (row.status !== "issued") throw new ApiError(409, "ใบแจ้งหนี้นี้ถูกยกเลิกไปแล้ว");
    // Locking reads, as for a delete: a payment or credit note committed while this waited counts.
    const [live] = await run(conn, "SELECT COUNT(*) AS n FROM acc_payments WHERE documentId = ? AND voidedAt IS NULL FOR UPDATE", [id]);
    if (num(live?.n) > 0) throw new ApiError(409, "ใบนี้มีรายการรับชำระแล้ว — ยกเลิกรายการรับชำระก่อนจึงจะยกเลิกใบแจ้งหนี้ได้");
    const [notes] = await run(conn, "SELECT COUNT(*) AS n FROM acc_documents WHERE relatedDocId = ? AND docType = 'CN' AND status = 'issued' FOR UPDATE", [id]);
    if (num(notes?.n) > 0) throw new ApiError(409, "มีใบลดหนี้ของใบนี้ — ยกเลิกใบลดหนี้ก่อนจึงจะยกเลิกใบแจ้งหนี้ได้");
    const billedOn = await run(
      conn,
      "SELECT b.docNo FROM acc_billing_items bi JOIN acc_documents b ON b.id = bi.billingNoteId WHERE bi.invoiceId = ? AND b.status = 'issued' FOR UPDATE",
      [id]
    );
    if (billedOn.length > 0) throw new ApiError(409, `ใบนี้อยู่ในใบวางบิล ${billedOn.map((b) => str(b.docNo)).join(", ")} — ยกเลิกใบวางบิลนั้นก่อน`);
    // A delivery: its PO locked now (after the invoice), its quantities given back below.
    const deliveredFrom = strOrNull(row.salesOrderId);
    const orderLocked = deliveredFrom ? await lockOrderTx(conn, deliveredFrom) : false;

    const now = new Date().toISOString();
    await conn.query("UPDATE acc_documents SET status = 'void', voidReason = ?, voidedAt = ?, voidedBy = ?, updatedAt = ?, salesRecordId = NULL WHERE id = ?", [
      reason,
      now,
      actor.username,
      now,
      id,
    ]);
    let machinesDeleted = 0;
    let machinesKept = 0;
    let saleDeleted = false;
    const saleId = strOrNull(row.salesRecordId);
    const [sale] = saleId ? await run(conn, "SELECT id FROM sales_records WHERE id = ?", [saleId]) : [];
    if (sale) {
      for (const unit of await machinesOf(conn, String(sale.id))) {
        if (unit.hasHistory) {
          await conn.query("UPDATE customer_equipments SET salesRecordId = '' WHERE id = ?", [unit.id]);
          machinesKept += 1;
        } else {
          await conn.query("DELETE FROM customer_equipments WHERE id = ?", [unit.id]);
          machinesDeleted += 1;
        }
      }
      await conn.query("DELETE FROM sales_record_items WHERE salesRecordId = ?", [sale.id]);
      await conn.query("DELETE FROM sale_cost_items WHERE salesRecordId = ?", [sale.id]);
      await conn.query("DELETE FROM sales_records WHERE id = ?", [sale.id]);
      saleDeleted = true;
    }
    if (deliveredFrom && orderLocked) await recomputeDeliveredTx(conn, deliveredFrom);
    const parts = [
      `ยกเลิกใบแจ้งหนี้ · ${str(row.buyerName)} · ${formatSatang(num(row.totalSatang))} บาท`,
      saleDeleted ? "ลบรายการขายใน dashboard" : null,
      machinesDeleted ? `ลบเครื่อง ${machinesDeleted} เครื่อง` : null,
      machinesKept ? `เก็บเครื่องที่มีประวัติไว้ ${machinesKept} เครื่อง` : null,
      deliveredFrom && orderLocked ? "คืนจำนวนที่ส่งให้ PO ลูกค้า" : null,
      `เหตุผล: ${reason}`,
    ].filter(Boolean);
    await writeAudit(conn, { ...actor, action: "doc.void", documentId: id, docNo: strOrNull(row.docNo), detail: parts.join(" · ") });
  });
  return (await getAccDocument(id))!;
}

// ── A document issued elsewhere, recorded here (step 3) ─────────────────────

/** "Duplicate entry" from the unique (docType, docNo) index. */
const isDuplicateKey = (error: unknown) => (error as { code?: string } | null)?.code === "ER_DUP_ENTRY";

/**
 * Records an invoice issued ELSEWHERE (another program, a hand-written book):
 * the number as printed, where the paper is kept — no file — and its lines,
 * so it counts in receivables and on the dashboard exactly as one issued
 * here. It is "issued" at once (the paper already exists), with its sale and
 * machines in the same transaction. It never takes one of our numbers, and a
 * number shaped like ours is refused (the two series could collide).
 */
export async function recordExternalInvoice(rawInput: InvoiceInput, fields: ExternalFields, actor: Actor): Promise<AccDocument> {
  const input = withOrderLink(rawInput);
  const vatRate = await getVatRate();
  const problems = invoiceProblems(input, vatRate);
  if (problems.first) throw new ApiError(400, problems.first);
  if (input.salesOrderId) {
    const problem = await draftDeliveryProblem(input.salesOrderId, input.lines, null, input.depositSatang ?? 0);
    if (problem) throw new ApiError(409, problem);
  }
  const computed = totalsOf(input, vatRate);
  const external = Object.values(externalProblems(fields, computed.vatSatang)).find(Boolean);
  if (external) throw new ApiError(400, external);
  const totals = withVatOverride(computed, fields.vatSatangOverride, input.priceMode);
  // A delivery paid in full by its deposit comes to nothing — and is still recorded.
  if (totals.totalSatang < 0 || (totals.totalSatang === 0 && !(totals.depositSatang > 0))) throw new ApiError(400, "ยอดรวมต้องมากกว่า 0 บาท");
  if (input.lines.some((l) => l.isMachine) && !input.customerId) {
    throw new ApiError(400, "มีเครื่องที่ต้องลงทะเบียน — กรุณาเลือกผู้ติดต่อของลูกค้าที่จะผูกเครื่องไว้");
  }
  const [taken] = await run(null, "SELECT id FROM acc_documents WHERE docType = 'INV' AND docNo = ? LIMIT 1", [fields.docNo]);
  if (taken) throw new ApiError(409, `เลขที่ ${fields.docNo} บันทึกไว้แล้ว`);

  const columns = columnsOf(input, totals, vatRate);
  const lines = input.lines.map((l, i) => ({ ...l, id: "", sortOrder: i, amountSatang: lineAmountSatang(l), deliveredQty: 0, sourceLineId: l.sourceLineId ?? "" }));
  const asIssued = { ...(columns as unknown as AccDocument), ...input, vatBaseSatang: totals.vatBaseSatang, quotationId: null, lines };
  const prepared = await prepareSaleWithLineItems(saleInputFromInvoice(asIssued, await categoriesOf(input.lines.map((l) => l.productId))));
  const { versionId } = await getSellerProfile();

  let id: string;
  try {
    id = await withTransaction(async (conn) => {
      const docId = crypto.randomUUID();
      const now = new Date().toISOString();
      const row: Record<string, unknown> = {
        id: docId,
        docType: "INV",
        docNo: fields.docNo,
        status: "issued",
        source: "external",
        externalNote: fields.externalNote,
        ...columns,
        sellerVersionId: versionId,
        issuedAt: now,
        issuedBy: actor.username,
        createdAt: now,
        createdBy: actor.username,
        updatedAt: now,
      };
      const keys = Object.keys(row);
      await conn.query(`INSERT INTO acc_documents (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`, Object.values(row));
      await replaceLines(conn, docId, input.lines);
      const delivery = { salesOrderId: input.salesOrderId, lines: input.lines, invoiceId: docId, depositSatang: input.depositSatang ?? 0 };
      await deliverFromOrderTx(conn, delivery, "", "check");
      prepared.v.invoiceRef = fields.docNo;
      prepared.v.note = `บันทึกจากเอกสารภายนอก ${fields.docNo}`;
      const saleId = await insertPreparedSaleTx(conn, prepared);
      await conn.query("UPDATE acc_documents SET salesRecordId = ? WHERE id = ?", [saleId, docId]);
      await deliverFromOrderTx(conn, delivery, saleId, "after");
      await writeAudit(conn, {
        ...actor,
        action: "doc.issue",
        documentId: docId,
        docNo: fields.docNo,
        detail: `บันทึกเอกสารจากภายนอก · ${input.buyerName} · ${formatSatang(totals.totalSatang)} บาท · เก็บที่ ${fields.externalNote}`,
      });
      return docId;
    });
  } catch (error) {
    if (isDuplicateKey(error)) throw new ApiError(409, `เลขที่ ${fields.docNo} บันทึกไว้แล้ว`);
    throw error;
  }
  return (await getAccDocument(id))!;
}

export const REFERENCE_REASON_MAX = 300;

/**
 * Fixes the number or the storage note of an outside document — a typo,
 * not an amount (an amount that is wrong is deleted and recorded again). The
 * reason goes in the audit log; the dashboard sale's invoice number follows.
 */
export async function updateExternalReference(
  id: string,
  change: { docNo: string; externalNote: string; reason: string },
  actor: Actor
): Promise<AccDocument> {
  const reason = change.reason.trim();
  const problem = Object.values(externalProblems({ docNo: change.docNo, externalNote: change.externalNote, vatSatangOverride: null }, 0)).find(Boolean);
  if (problem) throw new ApiError(400, problem);
  if (!reason) throw new ApiError(400, "กรุณาบอกเหตุผลที่แก้");
  if (reason.length > REFERENCE_REASON_MAX) throw new ApiError(400, `เหตุผลยาวเกิน ${REFERENCE_REASON_MAX} ตัวอักษร`);
  try {
    await withTransaction(async (conn) => {
      const [row] = await run(conn, "SELECT source, docNo, externalNote, salesRecordId FROM acc_documents WHERE id = ? FOR UPDATE", [id]);
      if (!row) throw new ApiError(404, "ไม่พบเอกสารนี้");
      if (row.source !== "external") throw new ApiError(409, "แก้เลขที่ได้เฉพาะเอกสารที่บันทึกจากภายนอก");
      const [taken] = await run(conn, "SELECT id FROM acc_documents WHERE docType = 'INV' AND docNo = ? AND id <> ? LIMIT 1", [change.docNo, id]);
      if (taken) throw new ApiError(409, `เลขที่ ${change.docNo} บันทึกไว้แล้ว`);
      await conn.query("UPDATE acc_documents SET docNo = ?, externalNote = ?, updatedAt = ? WHERE id = ?", [
        change.docNo,
        change.externalNote,
        new Date().toISOString(),
        id,
      ]);
      if (row.salesRecordId) {
        await conn.query("UPDATE sales_records SET invoiceRef = ? WHERE id = ?", [change.docNo, row.salesRecordId]);
      }
      const what = [
        row.docNo !== change.docNo ? `เลขที่ ${row.docNo} → ${change.docNo}` : null,
        row.externalNote !== change.externalNote ? `ที่เก็บ → ${change.externalNote}` : null,
      ].filter(Boolean);
      await writeAudit(conn, { ...actor, action: "doc.update", documentId: id, docNo: change.docNo, detail: `แก้ ${what.join(", ") || "ไม่มีการเปลี่ยน"} · เหตุผล: ${reason}` });
    });
  } catch (error) {
    if (isDuplicateKey(error)) throw new ApiError(409, `เลขที่ ${change.docNo} บันทึกไว้แล้ว`);
    throw error;
  }
  return (await getAccDocument(id))!;
}

/** Where outside papers were kept lately — the storage field suggests them. */
export async function recentExternalNotes(): Promise<string[]> {
  const rows = await run(
    null,
    `SELECT externalNote, MAX(createdAt) AS lastUsed FROM acc_documents
      WHERE source = 'external' AND externalNote <> ''
      GROUP BY externalNote ORDER BY lastUsed DESC LIMIT 20`,
    []
  );
  return rows.map((r) => String(r.externalNote));
}

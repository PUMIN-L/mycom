import "server-only";
import type { RowDataPacket } from "mysql2";
import type { PoolConnection } from "mysql2/promise";
import { query, withTransaction } from "../db";
import { ApiError } from "../apiHelpers";
import { addDaysToDateString, addMonthsToDateString } from "../dateFormat";
import { insertPreparedSaleTx, prepareSaleWithLineItems } from "../salesDashboardStore";
import type { EquipmentRowInput } from "../crmStore";
import { allocateDocNo, docPeriod, formatDocNo, parseDocNo, releaseDocNoIfLatest } from "./numbering";
import type { NumberedDocType } from "./types";
import { writeAudit } from "./audit";
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
  customerPoNo: string;
  projectName: string;
  note: string;
  quotationId: string | null;
  salesOrderId: string | null;
  relatedDocId: string | null;
  salesRecordId: string | null;
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
    customerPoNo: str(r.customerPoNo),
    projectName: str(r.projectName),
    note: str(r.note),
    quotationId: strOrNull(r.quotationId),
    salesOrderId: strOrNull(r.salesOrderId),
    relatedDocId: strOrNull(r.relatedDocId),
    salesRecordId: strOrNull(r.salesRecordId),
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

const LIST_LIMIT = 1000;

/** `%`, `_` and the escape itself, made literal for LIKE … ESCAPE '!'. */
const likeEscape = (s: string) => s.replace(/[!%_]/g, (c) => `!${c}`);

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
    `SELECT id, docType, docNo, status, source, isTaxInvoice, issueDate, dueDate, buyerName, projectName, customerPoNo, totalSatang, paidSatang
       FROM acc_documents WHERE ${where.join(" AND ")}
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
  const owed = "status = 'issued' AND paidSatang < totalSatang";
  const [rows] = await query<RowDataPacket[]>(
    `SELECT
       COALESCE(SUM(CASE WHEN ${owed} THEN totalSatang - paidSatang END), 0) AS outstanding,
       COALESCE(SUM(CASE WHEN ${owed} THEN 1 ELSE 0 END), 0) AS outstandingCount,
       COALESCE(SUM(CASE WHEN ${owed} AND dueDate IS NOT NULL AND dueDate < ? THEN totalSatang - paidSatang END), 0) AS overdue,
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

/** The columns a draft save writes, with values — totals computed HERE, never taken from the browser. */
async function draftColumns(input: InvoiceInput) {
  const vatRate = await getVatRate();
  const problems = invoiceProblems(input, vatRate);
  if (problems.first) throw new ApiError(400, problems.first);
  const totals = computeTotals({ lines: input.lines, discountSatang: input.discountSatang, priceMode: input.priceMode, vatRate });
  return { columns: columnsOf(input, totals, vatRate), lines: input.lines };
}

/** A document's header columns for `input` with these totals. */
function columnsOf(input: InvoiceInput, totals: DocTotals, vatRate: number) {
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
  };
}

async function replaceLines(conn: PoolConnection, documentId: string, lines: readonly DocLineInput[]): Promise<void> {
  await conn.query("DELETE FROM acc_document_lines WHERE documentId = ?", [documentId]);
  if (lines.length === 0) return;
  const cols = [
    "id", "documentId", "sortOrder", "lineType", "productId", "name", "qty", "unit",
    "unitPriceSatang", "discountSatang", "amountSatang", "isMachine", "serials", "warrantyMonths",
  ];
  const values = lines.flatMap((l, i) => [
    crypto.randomUUID(), documentId, i, l.lineType, l.productId, l.name, l.qty, l.unit,
    l.unitPriceSatang, l.discountSatang, lineAmountSatang(l), l.isMachine ? 1 : 0,
    l.isMachine ? l.serials : "", l.isMachine ? l.warrantyMonths : null,
  ]);
  await conn.query(
    `INSERT INTO acc_document_lines (${cols.join(", ")}) VALUES ${lines.map(() => `(${cols.map(() => "?").join(", ")})`).join(", ")}`,
    values
  );
}

export async function createInvoiceDraft(input: InvoiceInput, actor: Actor): Promise<AccDocument> {
  const { columns, lines } = await draftColumns(input);
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
  const { columns, lines } = await draftColumns(input);
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
  const shares = allocateProportionally(doc.lines.map((l) => l.amountSatang), doc.vatBaseSatang);
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
  };
}

/**
 * Issues a draft: gives it its number, locks it, points it at our company's
 * current version, and creates its /dashboard sale and machines — all in ONE
 * transaction, so there is never an issued invoice without its sale, or a
 * number spent on a document that did not land.
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
    const docNo = await allocateDocNo(conn, "INV", doc.issueDate);
    prepared.v.invoiceRef = docNo;
    prepared.v.note = `สร้างอัตโนมัติจากใบแจ้งหนี้ ${docNo}`;
    const saleId = await insertPreparedSaleTx(conn, prepared);
    const now = new Date().toISOString();
    await conn.query(
      "UPDATE acc_documents SET status = 'issued', docNo = ?, sellerVersionId = ?, salesRecordId = ?, issuedAt = ?, issuedBy = ?, updatedAt = ? WHERE id = ?",
      [docNo, versionId, saleId, now, actor.username, now, id]
    );
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
  /** Receipts / credit notes that point at it. */
  dependentDocs: number;
  /** The /dashboard sale it created, and what deleting would take with it. */
  sale: { id: string; costSatang: number; sharedWithOtherDocs: boolean } | null;
  machines: { total: number; withHistory: number };
}

type Exec = { query: PoolConnection["query"] } | null;
async function run(conn: Exec, sql: string, params: unknown[]): Promise<RowDataPacket[]> {
  const [rows] = conn ? await conn.query<RowDataPacket[]>(sql, params) : await query<RowDataPacket[]>(sql, params);
  return rows;
}

async function impactOf(conn: Exec, doc: { id: string; status: AccDocStatus; docNo: string | null; salesRecordId: string | null }): Promise<DeletionImpact> {
  const [payments] = await run(conn, "SELECT COUNT(*) AS n FROM acc_payments WHERE documentId = ? AND voidedAt IS NULL", [doc.id]);
  const [dependents] = await run(conn, "SELECT COUNT(*) AS n FROM acc_documents WHERE relatedDocId = ?", [doc.id]);
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
  return { status: doc.status, docNo: doc.docNo, isLatestNumber, livePayments: num(payments?.n), dependentDocs: num(dependents?.n), sale, machines };
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
  const [row] = await run(null, "SELECT id, status, docNo, salesRecordId FROM acc_documents WHERE id = ?", [id]);
  if (!row) return null;
  return impactOf(null, { id: String(row.id), status: String(row.status) as AccDocStatus, docNo: strOrNull(row.docNo), salesRecordId: strOrNull(row.salesRecordId) });
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
 */
export async function deleteAccDocument(id: string, actor: Actor, opts: { passwordChecked: boolean }): Promise<DeletionResult> {
  return withTransaction(async (conn) => {
    const [row] = await run(conn, "SELECT id, docType, status, docNo, salesRecordId, buyerName, totalSatang FROM acc_documents WHERE id = ? FOR UPDATE", [id]);
    if (!row) throw new ApiError(404, "ไม่พบเอกสารนี้");
    const doc = { id, status: String(row.status) as AccDocStatus, docNo: strOrNull(row.docNo), salesRecordId: strOrNull(row.salesRecordId) };
    // Checked again under the lock: a draft issued in another tab since the
    // route looked must not be deleted without the password an issued one needs.
    if (doc.status !== "draft" && !opts.passwordChecked) {
      throw new ApiError(409, "เอกสารนี้เพิ่งถูกออกเป็นเอกสารจริง — กดลบอีกครั้ง (ต้องยืนยันรหัสผ่าน)");
    }
    const impact = await impactOf(conn, doc);
    if (impact.livePayments > 0) throw new ApiError(409, "ใบนี้มีรายการรับชำระแล้ว — ยกเลิกรายการรับชำระก่อนจึงจะลบได้");
    if (impact.dependentDocs > 0) throw new ApiError(409, "มีเอกสารอื่นอ้างถึงใบนี้ (ใบเสร็จ / ใบลดหนี้) — ลบเอกสารนั้นก่อน");

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

    const parts = [
      doc.docNo ?? "ร่าง",
      String(row.buyerName ?? ""),
      `${formatSatang(num(row.totalSatang))} บาท`,
      saleDeleted ? "ลบรายการขายใน dashboard" : null,
      machinesDeleted ? `ลบเครื่อง ${machinesDeleted} เครื่อง` : null,
      machinesKept ? `เก็บเครื่องที่มีประวัติไว้ ${machinesKept} เครื่อง` : null,
      releasedNumber ? "คืนเลขเอกสาร" : null,
    ].filter(Boolean);
    await writeAudit(conn, { ...actor, action: "doc.delete", documentId: id, docNo: doc.docNo, detail: `ลบ · ${parts.join(" · ")}` });
    return { docNo: doc.docNo, releasedNumber, machinesDeleted, machinesKept, saleDeleted };
  });
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
export async function recordExternalInvoice(input: InvoiceInput, fields: ExternalFields, actor: Actor): Promise<AccDocument> {
  const vatRate = await getVatRate();
  const problems = invoiceProblems(input, vatRate);
  if (problems.first) throw new ApiError(400, problems.first);
  const computed = computeTotals({ lines: input.lines, discountSatang: input.discountSatang, priceMode: input.priceMode, vatRate });
  const external = Object.values(externalProblems(fields, computed.vatSatang)).find(Boolean);
  if (external) throw new ApiError(400, external);
  const totals = withVatOverride(computed, fields.vatSatangOverride, input.priceMode);
  if (totals.totalSatang <= 0) throw new ApiError(400, "ยอดรวมต้องมากกว่า 0 บาท");
  if (input.lines.some((l) => l.isMachine) && !input.customerId) {
    throw new ApiError(400, "มีเครื่องที่ต้องลงทะเบียน — กรุณาเลือกผู้ติดต่อของลูกค้าที่จะผูกเครื่องไว้");
  }
  const [taken] = await run(null, "SELECT id FROM acc_documents WHERE docType = 'INV' AND docNo = ? LIMIT 1", [fields.docNo]);
  if (taken) throw new ApiError(409, `เลขที่ ${fields.docNo} บันทึกไว้แล้ว`);

  const columns = columnsOf(input, totals, vatRate);
  const lines = input.lines.map((l, i) => ({ ...l, id: "", sortOrder: i, amountSatang: lineAmountSatang(l) }));
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
      prepared.v.invoiceRef = fields.docNo;
      prepared.v.note = `บันทึกจากเอกสารภายนอก ${fields.docNo}`;
      const saleId = await insertPreparedSaleTx(conn, prepared);
      await conn.query("UPDATE acc_documents SET salesRecordId = ? WHERE id = ?", [saleId, docId]);
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

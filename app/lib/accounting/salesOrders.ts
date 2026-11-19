import "server-only";
import type { RowDataPacket } from "mysql2";
import type { PoolConnection } from "mysql2/promise";
import { query, withTransaction } from "../db";
import { ApiError } from "../apiHelpers";
import { formatDisplayDate, isValidDateString } from "../dateFormat";
import { writeAudit } from "./audit";
import { getVatRate } from "./settings";
import { computeTotals, formatSatang } from "./money";
import { columnsOf, getAccDocument, likeEscape, replaceLines, type AccDocument } from "./documents";
import {
  ORDER_LIMITS,
  backlogSatang,
  isOrderLate,
  orderProblems,
  orderStatusOf,
  remainingQty,
  type OrderInput,
  type OrderStatus,
} from "./orderRules";

// Customer POs ("PO ลูกค้า", docType SO — step 5, ARCHITECTURE.md §8g): what
// a customer has ordered and we have not delivered yet. Not a sale and not a
// tax document: no number of ours (the customer's PO number is
// `customerPoNo`), no VAT point, nothing on the dashboard's sales figures — it
// shows in its own "ยอดรอส่งของ" section until delivered, delivery by delivery,
// through invoices (documents.ts + orderDelivery.ts).
//
// Kept small: the customer's PO paper is not stored — `externalNote` says
// where it is kept; no copy of the quotation, only its lines as ordered.

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

const NOT_FOUND = "ไม่พบ PO ลูกค้านี้";

/** The PO's header columns: an invoice's, less what only an invoice has. */
async function orderColumns(input: OrderInput) {
  const vatRate = await getVatRate();
  const problems = orderProblems(input, vatRate);
  if (problems.first) throw new ApiError(400, problems.first);
  const totals = computeTotals({ lines: input.lines, discountSatang: input.discountSatang, priceMode: input.priceMode, vatRate });
  if (totals.totalSatang <= 0) throw new ApiError(400, "ยอดรวมต้องมากกว่า 0 บาท");
  return {
    ...columnsOf(input, totals, vatRate),
    isTaxInvoice: 0,
    dueDate: null,
    salesOrderId: null,
    expectedDeliveryDate: input.expectedDeliveryDate || null,
    externalNote: input.storageNote,
  };
}

/** The same PO number of the same customer, recorded already (and not cancelled) — a PO typed in twice. */
async function duplicateOf(conn: Exec, input: OrderInput, exceptId: string | null): Promise<string | null> {
  const byCompany = Boolean(input.companyId);
  const rows = await run(
    conn,
    `SELECT id FROM acc_documents
      WHERE docType = 'SO' AND status <> 'void' AND customerPoNo = ? AND ${byCompany ? "companyId = ?" : "buyerName = ?"}${exceptId ? " AND id <> ?" : ""}
      LIMIT 1`,
    [input.customerPoNo, byCompany ? input.companyId : input.buyerName, ...(exceptId ? [exceptId] : [])]
  );
  return rows[0] ? String(rows[0].id) : null;
}

export async function createSalesOrder(input: OrderInput, actor: Actor): Promise<AccDocument> {
  const columns = await orderColumns(input);
  if (await duplicateOf(null, input, null)) throw new ApiError(409, `PO เลขที่ ${input.customerPoNo} ของลูกค้านี้บันทึกไว้แล้ว`);
  const id = await withTransaction(async (conn) => {
    const docId = crypto.randomUUID();
    const now = new Date().toISOString();
    const row: Record<string, unknown> = {
      id: docId,
      docType: "SO",
      status: "issued",
      source: "internal",
      ...columns,
      issuedAt: now,
      issuedBy: actor.username,
      createdAt: now,
      createdBy: actor.username,
      updatedAt: now,
    };
    const keys = Object.keys(row);
    await conn.query(`INSERT INTO acc_documents (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`, Object.values(row));
    await replaceLines(conn, docId, input.lines);
    await writeAudit(conn, {
      ...actor,
      action: "doc.create",
      documentId: docId,
      docNo: input.customerPoNo,
      detail: `รับ PO ลูกค้า ${input.customerPoNo} · ${input.buyerName} · ${formatSatang(columns.totalSatang)} บาท`,
    });
    return docId;
  });
  return (await getAccDocument(id))!;
}

/** Locks a PO for a change; refuses what is not one, or one cancelled. */
async function lockOrder(conn: PoolConnection, id: string): Promise<RowDataPacket> {
  const [row] = await run(
    conn,
    "SELECT id, docType, status, updatedAt, customerPoNo, issueDate, expectedDeliveryDate FROM acc_documents WHERE id = ? FOR UPDATE",
    [id]
  );
  if (!row || row.docType !== "SO") throw new ApiError(404, NOT_FOUND);
  if (row.status === "void") throw new ApiError(409, "PO นี้ถูกยกเลิกแล้ว");
  return row;
}

/** How many invoices (drafts too) deliver from a PO — read with a lock, inside a transaction. */
async function invoicesFrom(conn: PoolConnection, id: string): Promise<number> {
  const [row] = await run(conn, "SELECT COUNT(*) AS n FROM acc_documents WHERE salesOrderId = ? FOR UPDATE", [id]);
  return num(row?.n);
}

/**
 * Saves over a PO — lines and all — while nothing has been invoiced from it
 * (a delivery's lines point at the PO's). After that, only its schedule and
 * notes change (`updateSalesOrderSchedule`).
 */
export async function updateSalesOrder(id: string, input: OrderInput, actor: Actor, expectedUpdatedAt?: string): Promise<AccDocument> {
  const columns = await orderColumns(input);
  await withTransaction(async (conn) => {
    const row = await lockOrder(conn, id);
    if (expectedUpdatedAt && String(row.updatedAt) !== expectedUpdatedAt) {
      throw new ApiError(409, "PO นี้ถูกแก้จากที่อื่นหลังจากเปิดหน้านี้ — กรุณาเปิดใหม่ก่อนบันทึก");
    }
    if ((await invoicesFrom(conn, id)) > 0) {
      throw new ApiError(409, "PO นี้มีใบแจ้งหนี้แล้ว — แก้รายการไม่ได้ แก้ได้เฉพาะกำหนดส่งและหมายเหตุ");
    }
    if (await duplicateOf(conn, input, id)) throw new ApiError(409, `PO เลขที่ ${input.customerPoNo} ของลูกค้านี้บันทึกไว้แล้ว`);
    const values: Record<string, unknown> = { ...columns, updatedAt: new Date().toISOString() };
    const keys = Object.keys(values);
    await conn.query(`UPDATE acc_documents SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`, [...Object.values(values), id]);
    await replaceLines(conn, id, input.lines);
    await writeAudit(conn, { ...actor, action: "doc.update", documentId: id, docNo: input.customerPoNo, detail: `แก้ PO ลูกค้า · ${formatSatang(columns.totalSatang)} บาท` });
  });
  return (await getAccDocument(id))!;
}

export interface OrderSchedule {
  expectedDeliveryDate: string;
  storageNote: string;
  note: string;
}

/** The delivery date, where the paper is kept, the note — changeable for any PO not cancelled. */
export async function updateSalesOrderSchedule(id: string, change: OrderSchedule, actor: Actor): Promise<AccDocument> {
  const expected = change.expectedDeliveryDate.trim();
  if (expected && !isValidDateString(expected)) throw new ApiError(400, "กำหนดส่งไม่ถูกต้อง");
  const storageNote = change.storageNote.trim();
  if (storageNote.length > ORDER_LIMITS.storageNote) throw new ApiError(400, `ที่เก็บ PO ยาวเกิน ${ORDER_LIMITS.storageNote} ตัวอักษร`);
  const note = change.note.trim().slice(0, 1000);
  await withTransaction(async (conn) => {
    const row = await lockOrder(conn, id);
    if (expected && expected < String(row.issueDate)) throw new ApiError(400, "กำหนดส่งต้องไม่ก่อนวันที่ของ PO");
    await conn.query("UPDATE acc_documents SET expectedDeliveryDate = ?, externalNote = ?, note = ?, updatedAt = ? WHERE id = ?", [
      expected || null,
      storageNote,
      note,
      new Date().toISOString(),
      id,
    ]);
    const was = strOrNull(row.expectedDeliveryDate);
    await writeAudit(conn, {
      ...actor,
      action: "doc.update",
      documentId: id,
      docNo: str(row.customerPoNo),
      detail:
        was !== (expected || null)
          ? `เลื่อนกำหนดส่ง ${was ? formatDisplayDate(was) : "—"} → ${expected ? formatDisplayDate(expected) : "—"}`
          : "แก้หมายเหตุ / ที่เก็บ PO",
    });
  });
  return (await getAccDocument(id))!;
}

export const CANCEL_REASON_MAX = 300;

/**
 * The customer cancelled (what is left of) the PO: it leaves the backlog, with
 * the reason. What was delivered stays delivered — its invoices are untouched.
 */
export async function cancelSalesOrder(id: string, reasonText: string, actor: Actor): Promise<AccDocument> {
  const reason = String(reasonText ?? "").trim();
  if (!reason) throw new ApiError(400, "กรุณาบอกเหตุผลที่ยกเลิก");
  if (reason.length > CANCEL_REASON_MAX) throw new ApiError(400, `เหตุผลยาวเกิน ${CANCEL_REASON_MAX} ตัวอักษร`);
  await withTransaction(async (conn) => {
    const row = await lockOrder(conn, id);
    const lines = (await run(conn, "SELECT qty, deliveredQty FROM acc_document_lines WHERE documentId = ? FOR UPDATE", [id])).map((l) => ({
      qty: num(l.qty),
      deliveredQty: num(l.deliveredQty),
    }));
    // Delivered in full, there is nothing left to cancel — and "ยกเลิก" would hide that it was all sent.
    if (lines.length > 0 && lines.every((l) => remainingQty(l) <= 0)) throw new ApiError(409, "PO นี้ส่งครบแล้ว — ไม่มีส่วนที่เหลือให้ยกเลิก");
    const delivered = lines.some((l) => l.deliveredQty > 0);
    const now = new Date().toISOString();
    await conn.query("UPDATE acc_documents SET status = 'void', voidReason = ?, voidedAt = ?, voidedBy = ?, updatedAt = ? WHERE id = ?", [
      reason,
      now,
      actor.username,
      now,
      id,
    ]);
    await writeAudit(conn, {
      ...actor,
      action: "doc.void",
      documentId: id,
      docNo: str(row.customerPoNo),
      detail: `ยกเลิก PO ลูกค้า${delivered ? " (ส่วนที่ยังไม่ส่ง — ที่ส่งแล้วยังอยู่)" : ""} · เหตุผล: ${reason}`,
    });
  });
  return (await getAccDocument(id))!;
}

// ── Reading ──────────────────────────────────────────────────────────────────

export interface SalesOrderRow {
  id: string;
  customerPoNo: string;
  issueDate: string;
  expectedDeliveryDate: string | null;
  companyId: string;
  buyerName: string;
  projectName: string;
  status: string;
  orderStatus: OrderStatus;
  totalSatang: number;
  vatBaseSatang: number;
  /** What it still holds, ex VAT. */
  backlogSatang: number;
  late: boolean;
}

const ORDER_COLUMNS = "id, customerPoNo, issueDate, expectedDeliveryDate, companyId, buyerName, projectName, status, totalSatang, vatBaseSatang";

/** The rows, each with what it still holds (its lines read in one go). */
async function withProgress(rows: RowDataPacket[], today: string): Promise<SalesOrderRow[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => String(r.id));
  const lineRows = await run(
    null,
    `SELECT documentId, qty, deliveredQty, amountSatang FROM acc_document_lines WHERE documentId IN (${ids.map(() => "?").join(", ")})`,
    ids
  );
  const linesOf = new Map<string, { qty: number; deliveredQty: number; amountSatang: number }[]>();
  for (const l of lineRows) {
    const key = String(l.documentId);
    if (!linesOf.has(key)) linesOf.set(key, []);
    linesOf.get(key)!.push({ qty: num(l.qty), deliveredQty: num(l.deliveredQty), amountSatang: num(l.amountSatang) });
  }
  return rows.map((r) => {
    const lines = linesOf.get(String(r.id)) ?? [];
    const order = { status: str(r.status), vatBaseSatang: num(r.vatBaseSatang), lines, expectedDeliveryDate: strOrNull(r.expectedDeliveryDate) };
    const backlog = backlogSatang(order);
    return {
      id: String(r.id),
      customerPoNo: str(r.customerPoNo),
      issueDate: str(r.issueDate),
      expectedDeliveryDate: order.expectedDeliveryDate,
      companyId: str(r.companyId),
      buyerName: str(r.buyerName),
      projectName: str(r.projectName),
      status: order.status,
      orderStatus: orderStatusOf(order),
      totalSatang: num(r.totalSatang),
      vatBaseSatang: order.vatBaseSatang,
      backlogSatang: backlog,
      late: isOrderLate(order, backlog, today),
    };
  });
}

/** Customer POs, newest first: in [from, to) by PO date when given, matching `q` (PO number, customer, project). */
export async function listSalesOrders(opts: { from?: string; to?: string; q?: string; today: string }): Promise<SalesOrderRow[]> {
  const where = ["docType = 'SO'"];
  const params: unknown[] = [];
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
    where.push("(customerPoNo LIKE ? ESCAPE '!' OR buyerName LIKE ? ESCAPE '!' OR projectName LIKE ? ESCAPE '!')");
    params.push(like, like, like);
  }
  const rows = await run(null, `SELECT ${ORDER_COLUMNS} FROM acc_documents WHERE ${where.join(" AND ")} ORDER BY issueDate DESC, createdAt DESC LIMIT 1000`, params);
  return withProgress(rows, opts.today);
}

export interface OrderBacklog {
  today: string;
  rows: SalesOrderRow[];
  totals: { backlogSatang: number; count: number; lateSatang: number; lateCount: number };
}

/**
 * The dashboard's "ยอดรอส่งของ (ณ วันนี้)": every PO not cancelled that still
 * holds something, whatever its date — the soonest due first, late ones on top.
 */
export async function orderBacklog(today: string): Promise<OrderBacklog> {
  const rows = (await withProgress(await run(null, `SELECT ${ORDER_COLUMNS} FROM acc_documents WHERE docType = 'SO' AND status = 'issued' LIMIT 2000`, []), today)).filter(
    (r) => r.backlogSatang > 0
  );
  rows.sort(
    (a, b) =>
      Number(b.late) - Number(a.late) ||
      (a.expectedDeliveryDate ?? "9999").localeCompare(b.expectedDeliveryDate ?? "9999") ||
      a.issueDate.localeCompare(b.issueDate)
  );
  const totals = { backlogSatang: 0, count: rows.length, lateSatang: 0, lateCount: 0 };
  for (const r of rows) {
    totals.backlogSatang += r.backlogSatang;
    if (r.late) {
      totals.lateSatang += r.backlogSatang;
      totals.lateCount += 1;
    }
  }
  return { today, rows, totals };
}

export interface OrderDelivery {
  id: string;
  docNo: string | null;
  status: string;
  source: string;
  issueDate: string;
  totalSatang: number;
}

export interface SalesOrderDetail {
  order: AccDocument;
  orderStatus: OrderStatus;
  backlogSatang: number;
  /** Its invoices, drafts too, oldest first. */
  deliveries: OrderDelivery[];
  /** Discounts its ISSUED invoices already carry — per PO line, and on the bill — so the next delivery takes only what is left. */
  invoicedLineDiscounts: Record<string, number>;
  invoicedBillDiscountSatang: number;
}

export async function salesOrderDetail(id: string): Promise<SalesOrderDetail | null> {
  const order = await getAccDocument(id);
  if (!order || order.docType !== "SO") return null;
  const invoiceRows = await run(
    null,
    "SELECT id, docNo, status, source, issueDate, totalSatang, discountSatang FROM acc_documents WHERE salesOrderId = ? AND docType = 'INV' ORDER BY issueDate ASC, createdAt ASC",
    [id]
  );
  const issued = invoiceRows.filter((r) => r.status === "issued");
  const invoicedLineDiscounts: Record<string, number> = {};
  if (issued.length > 0) {
    const ids = issued.map((r) => String(r.id));
    const lines = await run(
      null,
      `SELECT sourceLineId, discountSatang FROM acc_document_lines WHERE documentId IN (${ids.map(() => "?").join(", ")}) AND sourceLineId IS NOT NULL`,
      ids
    );
    for (const l of lines) {
      const key = str(l.sourceLineId);
      if (key) invoicedLineDiscounts[key] = (invoicedLineDiscounts[key] ?? 0) + num(l.discountSatang);
    }
  }
  return {
    order,
    orderStatus: orderStatusOf(order),
    backlogSatang: backlogSatang(order),
    deliveries: invoiceRows.map((r) => ({
      id: String(r.id),
      docNo: strOrNull(r.docNo),
      status: str(r.status),
      source: str(r.source),
      issueDate: str(r.issueDate),
      totalSatang: num(r.totalSatang),
    })),
    invoicedLineDiscounts,
    invoicedBillDiscountSatang: issued.reduce((s, r) => s + num(r.discountSatang), 0),
  };
}

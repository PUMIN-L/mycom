import "server-only";
import type { RowDataPacket } from "mysql2";
import type { PoolConnection } from "mysql2/promise";
import { query, withTransaction } from "../db";
import { ApiError } from "../apiHelpers";
import { bangkokDateString, formatDisplayDate, isValidDateString } from "../dateFormat";
import { writeAudit } from "./audit";
import { getVatRate } from "./settings";
import { computeTotals, formatSatang } from "./money";
import { columnsOf, getAccDocument, likeEscape, replaceLines, type AccDocument } from "./documents";
import { depositLedgerOf } from "./depositLedger";
import type { OrderDay } from "./orderChart";
import {
  depositLeftSatang,
  planProblems,
  planProgress,
  vatInsideSatang,
  type PlanItemInput,
  type PlanItemProgress,
} from "./depositRules";
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
    "SELECT id, docType, status, updatedAt, customerPoNo, issueDate, expectedDeliveryDate, totalSatang, vatRate FROM acc_documents WHERE id = ? FOR UPDATE",
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
    // Its deposits are a part of what it is worth — it cannot be made worth less than them.
    const deposits = await depositLedgerOf(conn, id, num(row.vatRate));
    if (columns.vatBaseSatang < deposits.receivedExVatSatang) {
      throw new ApiError(409, `PO นี้รับมัดจำแล้ว ${formatSatang(deposits.receivedExVatSatang)} บาท (ก่อน VAT) — ยอด PO ต้องไม่น้อยกว่านั้น`);
    }
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
    // A deposit not yet deducted stays on record — it is handed back (a credit note) or kept, by agreement.
    const depositLeft = depositLeftSatang(await depositLedgerOf(conn, id, num(row.vatRate)));
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
      detail: `ยกเลิก PO ลูกค้า${delivered ? " (ส่วนที่ยังไม่ส่ง — ที่ส่งแล้วยังอยู่)" : ""}${depositLeft > 0 ? ` · มีมัดจำที่ยังไม่ได้หัก ${formatSatang(depositLeft)} บาท (ก่อน VAT)` : ""} · เหตุผล: ${reason}`,
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
  /** Deposits received and not yet deducted by its invoices, ex VAT. */
  depositLeftSatang: number;
  late: boolean;
}

const ORDER_COLUMNS = "id, customerPoNo, issueDate, expectedDeliveryDate, companyId, buyerName, projectName, status, totalSatang, vatBaseSatang, vatRate";

/** Deposits not yet deducted, ex VAT, for each of `ids` — read in one go (live deposits, issued deductions). */
async function depositsLeftOf(ids: string[], vatRateOf: Map<string, number>): Promise<Map<string, number>> {
  const marks = ids.map(() => "?").join(", ");
  const received = await run(
    null,
    `SELECT p.documentId, p.amountSatang, r.vatBaseSatang FROM acc_payments p LEFT JOIN acc_documents r ON r.id = p.receiptId
      WHERE p.documentId IN (${marks}) AND p.voidedAt IS NULL`,
    ids
  );
  const deducted = await run(
    null,
    `SELECT salesOrderId, COALESCE(SUM(depositSatang), 0) AS d FROM acc_documents
      WHERE salesOrderId IN (${marks}) AND docType = 'INV' AND status = 'issued' GROUP BY salesOrderId`,
    ids
  );
  const left = new Map<string, number>();
  for (const p of received) {
    const id = String(p.documentId);
    const amount = num(p.amountSatang);
    const exVat = p.vatBaseSatang === null || p.vatBaseSatang === undefined ? amount - vatInsideSatang(amount, vatRateOf.get(id) ?? 0) : num(p.vatBaseSatang);
    left.set(id, (left.get(id) ?? 0) + exVat);
  }
  for (const d of deducted) {
    const id = String(d.salesOrderId);
    left.set(id, (left.get(id) ?? 0) - num(d.d));
  }
  return left;
}

/** The rows, each with what it still holds and its deposit left (their lines and deposits read in one go). */
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
  const deposits = await depositsLeftOf(ids, new Map(rows.map((r) => [String(r.id), num(r.vatRate)])));
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
      depositLeftSatang: Math.max(0, deposits.get(String(r.id)) ?? 0),
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

/**
 * The dashboard's "ยอดตาม PO ลูกค้า": the open customer POs received each day
 * of [from, to), by their own PO date — counted as soon as one is recorded,
 * whatever has been delivered or paid since; a cancelled one (void) is not.
 * Ex VAT, like every sales figure on the dashboard.
 */
export async function ordersByIssueDate(from: string, to: string): Promise<OrderDay[]> {
  const rows = await run(
    null,
    `SELECT issueDate, COUNT(*) AS n, COALESCE(SUM(vatBaseSatang), 0) AS exVat
       FROM acc_documents
      WHERE docType = 'SO' AND status = 'issued' AND issueDate >= ? AND issueDate < ?
      GROUP BY issueDate ORDER BY issueDate`,
    [from, to]
  );
  return rows.map((r) => ({ date: str(r.issueDate).slice(0, 10), count: num(r.n), exVatSatang: num(r.exVat) }));
}

export interface OrderBacklog {
  today: string;
  rows: SalesOrderRow[];
  /** `depositLeftSatang`: deposits received against these POs, not yet deducted — ex VAT, as the backlog. */
  totals: { backlogSatang: number; count: number; lateSatang: number; lateCount: number; depositLeftSatang: number };
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
  const totals = { backlogSatang: 0, count: rows.length, lateSatang: 0, lateCount: 0, depositLeftSatang: 0 };
  for (const r of rows) {
    totals.backlogSatang += r.backlogSatang;
    totals.depositLeftSatang += r.depositLeftSatang;
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
  /** Received on it so far (its own payments). */
  paidSatang: number;
  /** What its credit notes took off it (step 8). */
  creditedSatang: number;
  /** The PO's deposit it deducts, ex VAT. */
  depositSatang: number;
}

export interface PlanItemView extends PlanItemInput, PlanItemProgress {
  id: string;
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
  /** Its deposits: received (VAT included, and before VAT), deducted by issued invoices, left to deduct (before VAT). */
  deposits: { receivedSatang: number; receivedExVatSatang: number; deductedSatang: number; leftSatang: number };
  /** The payment plan, each item with where it stands (from the money that came in). */
  plan: PlanItemView[];
}

/** A PO's plan as stored, in order. */
async function planOf(id: string): Promise<(PlanItemInput & { id: string })[]> {
  const rows = await run(null, "SELECT id, label, stage, amountSatang, dueDate FROM acc_plan_items WHERE salesOrderId = ? ORDER BY sortOrder ASC", [id]);
  return rows.map((r) => ({
    id: String(r.id),
    label: str(r.label),
    stage: r.stage === "deposit" ? "deposit" : "invoice",
    amountSatang: num(r.amountSatang),
    dueDate: str(r.dueDate),
  }));
}

export async function salesOrderDetail(id: string, today: string = bangkokDateString(new Date())): Promise<SalesOrderDetail | null> {
  const order = await getAccDocument(id);
  if (!order || order.docType !== "SO") return null;
  const invoiceRows = await run(
    null,
    "SELECT id, docNo, status, source, issueDate, totalSatang, paidSatang, creditedSatang, discountSatang, depositSatang FROM acc_documents WHERE salesOrderId = ? AND docType = 'INV' ORDER BY issueDate ASC, createdAt ASC",
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
  const ledger = await depositLedgerOf(null, id, order.vatRate);
  const plan = await planOf(id);
  const progress = planProgress(
    plan,
    { depositSatang: ledger.receivedSatang, invoiceSatang: issued.reduce((s, r) => s + num(r.paidSatang), 0) },
    today
  );
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
      paidSatang: num(r.paidSatang),
      creditedSatang: num(r.creditedSatang),
      depositSatang: num(r.depositSatang),
    })),
    invoicedLineDiscounts,
    invoicedBillDiscountSatang: issued.reduce((s, r) => s + num(r.discountSatang), 0),
    deposits: { ...ledger, leftSatang: depositLeftSatang(ledger) },
    plan: plan.map((p, i) => ({ ...p, ...progress[i] })),
  };
}

/**
 * Saves a PO's payment plan over the one it had — what the customer is to pay
 * and when, as a deposit or on the invoices. Any time before it is cancelled;
 * never more in all than the PO (VAT included).
 */
export async function saveSalesOrderPlan(id: string, items: PlanItemInput[], actor: Actor): Promise<PlanItemView[]> {
  await withTransaction(async (conn) => {
    const row = await lockOrder(conn, id);
    const problems = planProblems(items, num(row.totalSatang));
    if (problems.first) throw new ApiError(400, problems.first);
    await conn.query("DELETE FROM acc_plan_items WHERE salesOrderId = ?", [id]);
    if (items.length > 0) {
      const cols = ["id", "salesOrderId", "sortOrder", "label", "stage", "amountSatang", "dueDate"];
      await conn.query(
        `INSERT INTO acc_plan_items (${cols.join(", ")}) VALUES ${items.map(() => `(${cols.map(() => "?").join(", ")})`).join(", ")}`,
        items.flatMap((it, i) => [crypto.randomUUID(), id, i, it.label, it.stage, it.amountSatang, it.dueDate || null])
      );
    }
    await writeAudit(conn, {
      ...actor,
      action: "doc.update",
      documentId: id,
      docNo: str(row.customerPoNo),
      detail:
        items.length > 0
          ? `แผนเก็บเงิน ${items.length} งวด · รวม ${formatSatang(items.reduce((s, it) => s + it.amountSatang, 0))} บาท`
          : "ล้างแผนเก็บเงิน",
    });
  });
  return (await salesOrderDetail(id))?.plan ?? [];
}

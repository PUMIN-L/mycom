import "server-only";
import type { RowDataPacket } from "mysql2";
import type { PoolConnection } from "mysql2/promise";
import { query } from "../db";
import { ApiError } from "../apiHelpers";
import { qtyHundredths } from "./money";
import { depositDeductionProblem } from "./depositLedger";
import type { DocLineInput } from "./invoiceRules";

// Deliveries against a customer PO (step 5): what an invoice may take from it,
// and the PO lines' `deliveredQty` — a CACHE with one writer
// (`recomputeDeliveredTx`): a full re-sum of the issued invoices' lines that
// point at each PO line, in the transaction that issued or deleted one. Never
// `deliveredQty + ?` (the same rule as paidSatang).
//
// ⚠️ Locks: the invoice first, then the PO — issuing and deleting both take
// that order. Reads that decide anything are LOCKING reads: a plain SELECT in
// a TiDB transaction reads the snapshot it began with and would miss a
// delivery committed while it waited.

type Conn = Pick<PoolConnection, "query">;
type Exec = Conn | null;

async function run(conn: Exec, sql: string, params: unknown[]): Promise<RowDataPacket[]> {
  const [rows] = conn ? await conn.query<RowDataPacket[]>(sql, params) : await query<RowDataPacket[]>(sql, params);
  return rows;
}

const qtyText = (hundredths: number) => (hundredths / 100).toLocaleString("en-US", { maximumFractionDigits: 2 });

/** Delivered so far per PO line, in hundredths — over ISSUED invoices only (a draft takes nothing yet). */
async function deliveredByLine(conn: Exec, salesOrderId: string, exceptInvoiceId: string | null): Promise<Map<string, number>> {
  const lock = conn ? " FOR UPDATE" : "";
  const invoices = await run(
    conn,
    `SELECT id FROM acc_documents WHERE salesOrderId = ? AND docType = 'INV' AND status = 'issued'${exceptInvoiceId ? " AND id <> ?" : ""}${lock}`,
    exceptInvoiceId ? [salesOrderId, exceptInvoiceId] : [salesOrderId]
  );
  const delivered = new Map<string, number>();
  if (invoices.length === 0) return delivered;
  const ids = invoices.map((r) => String(r.id));
  const lines = await run(
    conn,
    `SELECT sourceLineId, qty FROM acc_document_lines WHERE documentId IN (${ids.map(() => "?").join(", ")}) AND sourceLineId IS NOT NULL${lock}`,
    ids
  );
  for (const l of lines) {
    const key = String(l.sourceLineId ?? "");
    if (!key) continue;
    delivered.set(key, (delivered.get(key) ?? 0) + qtyHundredths(Number(l.qty) || 0));
  }
  return delivered;
}

interface OrderLineRow {
  id: string;
  name: string;
  unit: string;
  qtyHundredths: number;
}

async function orderLines(conn: Exec, salesOrderId: string): Promise<OrderLineRow[]> {
  const rows = await run(
    conn,
    `SELECT id, name, unit, qty FROM acc_document_lines WHERE documentId = ? ORDER BY sortOrder ASC${conn ? " FOR UPDATE" : ""}`,
    [salesOrderId]
  );
  return rows.map((r) => ({ id: String(r.id), name: String(r.name ?? ""), unit: String(r.unit ?? ""), qtyHundredths: qtyHundredths(Number(r.qty) || 0) }));
}

/**
 * What is wrong with an invoice taking `lines` from PO `salesOrderId` — and
 * deducting `depositSatang` of its deposits — in Thai, or null. With `conn`
 * (the issuing transaction) the PO is LOCKED first and its deliveries and
 * deposits read with locks; without, a plain check for a draft being saved
 * (the issue checks again, for real).
 */
async function deliveryProblem(
  conn: Exec,
  salesOrderId: string,
  lines: readonly DocLineInput[],
  invoiceId: string | null,
  depositSatang: number
): Promise<string | null> {
  const [order] = await run(conn, `SELECT docType, status, vatRate FROM acc_documents WHERE id = ?${conn ? " FOR UPDATE" : ""}`, [salesOrderId]);
  if (!order || order.docType !== "SO") return "ไม่พบ PO ลูกค้าที่ใบนี้ส่งของ — อาจถูกลบไปแล้ว";
  if (order.status === "void") return "PO ลูกค้านี้ถูกยกเลิกแล้ว — ส่งของจาก PO นี้ไม่ได้";
  const sourced = lines.filter((l) => l.sourceLineId);
  if (sourced.length > 0) {
    const byId = new Map((await orderLines(conn, salesOrderId)).map((l) => [l.id, l]));
    const delivered = await deliveredByLine(conn, salesOrderId, invoiceId);
    const sending = new Map<string, number>();
    for (const l of sourced) {
      const ol = byId.get(String(l.sourceLineId));
      if (!ol) return `รายการ "${l.name}" ไม่อยู่ใน PO นี้แล้ว (PO ถูกแก้ไข) — สร้างใบแจ้งหนี้จาก PO ใหม่`;
      sending.set(ol.id, (sending.get(ol.id) ?? 0) + qtyHundredths(l.qty));
    }
    for (const [lineId, sent] of sending) {
      const ol = byId.get(lineId)!;
      const left = Math.max(0, ol.qtyHundredths - (delivered.get(lineId) ?? 0));
      if (sent > left) {
        return left > 0
          ? `ส่ง "${ol.name}" เกินจำนวนที่เหลือใน PO — เหลือ ${qtyText(left)}${ol.unit ? ` ${ol.unit}` : ""}`
          : `"${ol.name}" ใน PO นี้ส่งครบแล้ว`;
      }
    }
  }
  return depositDeductionProblem(conn, salesOrderId, Number(order.vatRate) || 0, depositSatang, invoiceId);
}

/** For a draft being saved: plain reads, nothing locked. */
export function draftDeliveryProblem(salesOrderId: string, lines: readonly DocLineInput[], invoiceId: string | null, depositSatang = 0): Promise<string | null> {
  return deliveryProblem(null, salesOrderId, lines, invoiceId, depositSatang);
}

/** Inside the transaction that issues the invoice: locks the PO, refuses (409) what it cannot take. */
export async function checkDeliveryTx(
  conn: Conn,
  salesOrderId: string,
  lines: readonly DocLineInput[],
  invoiceId: string | null,
  depositSatang = 0
): Promise<void> {
  const problem = await deliveryProblem(conn, salesOrderId, lines, invoiceId, depositSatang);
  if (problem) throw new ApiError(409, problem);
}

/** Re-sums each PO line's `deliveredQty` from its issued invoices. The caller has locked the PO. */
export async function recomputeDeliveredTx(conn: Conn, salesOrderId: string): Promise<void> {
  const lines = await orderLines(conn, salesOrderId);
  if (lines.length === 0) return;
  const delivered = await deliveredByLine(conn, salesOrderId, null);
  for (const l of lines) {
    await conn.query("UPDATE acc_document_lines SET deliveredQty = ? WHERE id = ?", [(delivered.get(l.id) ?? 0) / 100, l.id]);
  }
}

/** Locks the PO row — before a recompute that is not preceded by checkDeliveryTx (a delete). */
export async function lockOrderTx(conn: Conn, salesOrderId: string): Promise<boolean> {
  const [row] = await run(conn, "SELECT id FROM acc_documents WHERE id = ? FOR UPDATE", [salesOrderId]);
  return Boolean(row);
}

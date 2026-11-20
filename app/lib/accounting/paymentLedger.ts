import "server-only";
import type { RowDataPacket } from "mysql2";
import type { PoolConnection } from "mysql2/promise";

// The two caches a payment change must refresh, in the SAME transaction as
// the change — shared by the payments store and document deletion.
//
// ⚠️ `acc_documents.paidSatang` is only ever a full re-sum of the invoice's
// LIVE payments: idempotent and
// self-healing, where `paidSatang = paidSatang + ?` would drift for good the
// first time a transaction is retried. The caller holds the invoice's row
// lock (SELECT … FOR UPDATE) — that is what makes two payments recorded at
// once each count the other.

type Conn = Pick<PoolConnection, "query">;

/** Re-sums the invoice's live payments into its `paidSatang`. The caller has locked the invoice row. */
export async function recomputePaidSatang(conn: Conn, invoiceId: string): Promise<number> {
  const [rows] = await conn.query<RowDataPacket[]>(
    "SELECT COALESCE(SUM(amountSatang), 0) AS paid FROM acc_payments WHERE documentId = ? AND voidedAt IS NULL FOR UPDATE",
    [invoiceId]
  );
  const paid = Number(rows[0]?.paid) || 0;
  await conn.query("UPDATE acc_documents SET paidSatang = ? WHERE id = ?", [paid, invoiceId]);
  return paid;
}

/** sales_records.receiptRef is VARCHAR(255). */
const RECEIPT_REF_MAX = 255;

/**
 * The /dashboard sale's เลขที่ใบเสร็จ follows the invoice's live payments: their
 * receipt numbers (ours, or the outside one typed), oldest first. The sale was
 * created from the invoice, so its references belong to the accounting
 * module — this is what clears the dashboard's "ขาดใบเสร็จ" alert.
 */
export async function syncSaleReceiptRef(conn: Conn, salesRecordId: string | null, invoiceId: string): Promise<void> {
  if (!salesRecordId) return;
  // Locking (current) reads, like the re-sum: the snapshot would miss a
  // payment committed while this transaction waited for the invoice's lock.
  const [payments] = await conn.query<RowDataPacket[]>(
    `SELECT receiptId, externalReceiptNo FROM acc_payments
      WHERE documentId = ? AND voidedAt IS NULL
      ORDER BY paidDate ASC, createdAt ASC FOR UPDATE`,
    [invoiceId]
  );
  const receiptIds = payments.map((p) => String(p.receiptId ?? "")).filter(Boolean);
  const numbers = new Map<string, string>();
  if (receiptIds.length > 0) {
    const [docs] = await conn.query<RowDataPacket[]>(
      `SELECT id, docNo FROM acc_documents WHERE id IN (${receiptIds.map(() => "?").join(", ")}) FOR UPDATE`,
      receiptIds
    );
    for (const d of docs) numbers.set(String(d.id), String(d.docNo ?? ""));
  }
  const refs = [
    ...new Set(payments.map((p) => (p.receiptId ? numbers.get(String(p.receiptId)) ?? "" : "") || String(p.externalReceiptNo ?? "")).filter(Boolean)),
  ];
  let ref = refs.join(", ");
  if (ref.length > RECEIPT_REF_MAX) ref = `${ref.slice(0, RECEIPT_REF_MAX - 1)}…`;
  await conn.query("UPDATE sales_records SET receiptRef = ? WHERE id = ?", [ref, salesRecordId]);
}

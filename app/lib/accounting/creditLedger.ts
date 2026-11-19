import "server-only";
import type { RowDataPacket } from "mysql2";
import type { PoolConnection } from "mysql2/promise";
import { query } from "../db";

// What an invoice's issued credit notes took off it (step 8) — and the one
// writer of its cache (`creditedSatang` / `creditedVatSatang`): a full re-sum,
// never `+ amount`, like paidSatang. Imports nothing of the module, so
// documents.ts (deleting a credit note) and creditNotes.ts can both use it
// without an import cycle. With `conn` the reads lock.

type Exec = Pick<PoolConnection, "query"> | null;

const num = (v: unknown) => Number(v) || 0;

export async function creditedOf(conn: Exec, invoiceId: string): Promise<{ totalSatang: number; vatSatang: number; baseSatang: number }> {
  const sql = `SELECT COALESCE(SUM(totalSatang), 0) AS t, COALESCE(SUM(vatSatang), 0) AS v, COALESCE(SUM(vatBaseSatang), 0) AS b
       FROM acc_documents WHERE relatedDocId = ? AND docType = 'CN' AND status = 'issued'${conn ? " FOR UPDATE" : ""}`;
  const [rows] = conn ? await conn.query<RowDataPacket[]>(sql, [invoiceId]) : await query<RowDataPacket[]>(sql, [invoiceId]);
  const r = rows[0];
  return { totalSatang: num(r?.t), vatSatang: num(r?.v), baseSatang: num(r?.b) };
}

/** Re-sums what an invoice's issued credit notes took off it. The caller holds the invoice's lock. */
export async function recomputeCreditedTx(conn: Pick<PoolConnection, "query">, invoiceId: string): Promise<void> {
  const credited = await creditedOf(conn, invoiceId);
  await conn.query("UPDATE acc_documents SET creditedSatang = ?, creditedVatSatang = ? WHERE id = ?", [credited.totalSatang, credited.vatSatang, invoiceId]);
}

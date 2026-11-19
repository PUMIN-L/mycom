import "server-only";
import type { RowDataPacket } from "mysql2";
import type { PoolConnection } from "mysql2/promise";
import { query } from "../db";
import { ApiError } from "../apiHelpers";
import { formatSatang } from "./money";
import { depositLeftSatang, vatInsideSatang, type DepositBalance } from "./depositRules";

// A customer PO's deposits, as the ledger has them (step 6): what came in
// before VAT — each deposit's receipt says — and what issued delivery invoices
// have deducted (`depositSatang`). Both are SUMS over what is there, never a
// running figure kept somewhere, so a voided deposit or a deleted invoice
// cannot leave them wrong. With `conn` (a transaction holding the PO's lock)
// every read is a LOCKING read: TiDB's snapshot would miss a deposit or a
// delivery committed while it waited.
//
// It imports nothing of the module but the pure rules, so documents.ts,
// payments.ts and orderDelivery.ts can all use it without an import cycle.

type Exec = Pick<PoolConnection, "query"> | null;

async function run(conn: Exec, sql: string, params: unknown[]): Promise<RowDataPacket[]> {
  const [rows] = conn ? await conn.query<RowDataPacket[]>(sql, params) : await query<RowDataPacket[]>(sql, params);
  return rows;
}

const num = (v: unknown) => Number(v) || 0;

export interface DepositLedger extends DepositBalance {
  /** VAT included — what the customer paid as deposits (live ones). */
  receivedSatang: number;
}

/**
 * The PO's live deposits and what issued invoices deducted from them —
 * `exceptInvoiceId` left out (the invoice being checked is not yet one of them).
 */
export async function depositLedgerOf(conn: Exec, salesOrderId: string, vatRate: number, exceptInvoiceId: string | null = null): Promise<DepositLedger> {
  const lock = conn ? " FOR UPDATE" : "";
  const live = await run(conn, `SELECT id, amountSatang, receiptId FROM acc_payments WHERE documentId = ? AND voidedAt IS NULL${lock}`, [salesOrderId]);
  const receiptIds = live.map((p) => (p.receiptId ? String(p.receiptId) : "")).filter(Boolean);
  const exVatOf = new Map<string, number>();
  if (receiptIds.length > 0) {
    const receipts = await run(
      conn,
      `SELECT id, vatBaseSatang FROM acc_documents WHERE id IN (${receiptIds.map(() => "?").join(", ")})${lock}`,
      receiptIds
    );
    for (const r of receipts) exVatOf.set(String(r.id), num(r.vatBaseSatang));
  }
  let receivedSatang = 0;
  let receivedExVatSatang = 0;
  for (const p of live) {
    const amount = num(p.amountSatang);
    receivedSatang += amount;
    const receiptId = p.receiptId ? String(p.receiptId) : "";
    receivedExVatSatang += exVatOf.has(receiptId) ? exVatOf.get(receiptId)! : amount - vatInsideSatang(amount, vatRate);
  }
  const [deducted] = await run(
    conn,
    `SELECT COALESCE(SUM(depositSatang), 0) AS d FROM acc_documents WHERE salesOrderId = ? AND docType = 'INV' AND status = 'issued'${exceptInvoiceId ? " AND id <> ?" : ""}${lock}`,
    exceptInvoiceId ? [salesOrderId, exceptInvoiceId] : [salesOrderId]
  );
  return { receivedSatang, receivedExVatSatang, deductedSatang: num(deducted?.d) };
}

/**
 * Refuses (409) to let a deposit go — voided, or its receipt deleted — while
 * the invoices need it: what they deducted must stay covered by the deposits
 * that remain. The caller holds the PO's lock.
 */
export async function assertDepositNotDeductedTx(conn: Exec, salesOrderId: string, vatRate: number, goingExVatSatang: number): Promise<void> {
  const ledger = await depositLedgerOf(conn, salesOrderId, vatRate);
  if (ledger.receivedExVatSatang - goingExVatSatang < ledger.deductedSatang) {
    throw new ApiError(
      409,
      `มัดจำนี้ถูกหักในใบแจ้งหนี้แล้ว (หักไป ${formatSatang(ledger.deductedSatang)} บาท ก่อน VAT) — ลบใบแจ้งหนี้ที่หักมัดจำก่อน`
    );
  }
}

/** Says why an invoice cannot deduct `depositSatang` from the PO's deposits — or null. */
export async function depositDeductionProblem(
  conn: Exec,
  salesOrderId: string,
  vatRate: number,
  depositSatang: number,
  invoiceId: string | null
): Promise<string | null> {
  if (!(depositSatang > 0)) return null;
  const left = depositLeftSatang(await depositLedgerOf(conn, salesOrderId, vatRate, invoiceId));
  if (depositSatang <= left) return null;
  return left > 0 ? `หักมัดจำเกินมัดจำที่เหลือ — เหลือ ${formatSatang(left)} บาท (ก่อน VAT)` : "PO นี้ไม่มีมัดจำเหลือให้หักแล้ว";
}

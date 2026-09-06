import { query, withTransaction } from "./db";
import type { RowDataPacket } from "mysql2";
import type { PoolConnection } from "mysql2/promise";

/**
 * การรับชำระเงิน — payments recorded against a billing document.
 *
 * `billing_payments` is the TRUTH; `billing_documents.paidAmount` is a cache
 * with exactly one writer, and that writer is `recomputePaidAmount` below.
 *
 * ── THE INVARIANT, AND WHY IT IS SHAPED THIS WAY ────────────────────────────
 * `paidAmount` is ONLY ever recomputed as a full
 * `COALESCE(SUM(amount), 0) ... WHERE voidedAt IS NULL`, inside the SAME
 * transaction as the INSERT or void that changed it. Never
 * `paidAmount = paidAmount + ?`. The two look equivalent and are not: a re-sum
 * is idempotent and self-healing, so a retried request, a replayed transaction
 * or a repair pass all converge on the right number, while an increment becomes
 * permanent, unexplainable drift the first time any of those happens — on
 * money, where "the ledger is off by ฿30,000 and nobody knows why" is the worst
 * possible outcome.
 *
 * ── NOTHING IS EVER DELETED ─────────────────────────────────────────────────
 * A payment is a financial record. A mistyped amount is corrected by VOIDING
 * the row (`voidedAt` + `voidReason`, which drops it out of the SUM and renders
 * it struck through in the history) and adding a corrected one. There is no
 * DELETE in this file, and `deleteBillingDocument` refuses to remove a document
 * that has live payments — the payments table has no FOREIGN KEY (house rule:
 * this app hard-deletes documents), so that ban is what stops financial records
 * being orphaned.
 */

export interface BillingPaymentRecord {
  id: string;
  billingDocumentId: string;
  amount: number;
  /** "YYYY-MM-DD" — lexically sortable, like every other date column here. */
  paidDate: string;
  method: string;
  ref: string;
  note: string | null;
  /** The ใบเสร็จรับเงิน issued for this payment, when it came from one. */
  receiptDocId: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  createdAt: string;
}

function rowToPayment(row: RowDataPacket): BillingPaymentRecord {
  return {
    id: row.id,
    billingDocumentId: row.billingDocumentId,
    // DECIMAL comes back from mysql2 as a STRING. Number() here, once, so no
    // caller ever does string arithmetic on money.
    amount: Number(row.amount) || 0,
    paidDate: row.paidDate ?? "",
    method: row.method ?? "",
    ref: row.ref ?? "",
    note: row.note ?? null,
    receiptDocId: row.receiptDocId ?? null,
    voidedAt: row.voidedAt ?? null,
    voidReason: row.voidReason ?? null,
    createdAt: row.createdAt,
  };
}

/** A connection inside a transaction, or the module-level `query` helper. */
type Queryable = Pick<PoolConnection, "query">;

/**
 * The void reasons this module writes ITSELF, as opposed to a reason an admin
 * typed. They are matched on when a void has to be UNDONE, so that un-cancelling
 * a receipt restores only the payment the cancel itself took out and never
 * resurrects one a human deliberately voided.
 */
export const RECEIPT_UNLINKED_VOID_REASON = "ยกเลิกการผูกใบเสร็จกับใบแจ้งหนี้";
export const RECEIPT_CANCELLED_VOID_REASON = "ยกเลิกใบเสร็จรับเงิน";

/**
 * Re-sum a document's LIVE payments and write the result to its cached
 * `paidAmount`. Always called on the transaction connection that just changed
 * those payments, never on its own.
 */
export async function recomputePaidAmount(
  conn: Queryable,
  billingDocumentId: string
): Promise<number> {
  const [rows] = await conn.query<RowDataPacket[]>(
    `SELECT COALESCE(SUM(amount), 0) AS paid
       FROM billing_payments
      WHERE billingDocumentId = ? AND voidedAt IS NULL`,
    [billingDocumentId]
  );
  const paid = Number(rows[0]?.paid) || 0;
  await conn.query(
    "UPDATE billing_documents SET paidAmount = ? WHERE id = ?",
    [paid, billingDocumentId]
  );
  return paid;
}

export interface NewBillingPayment {
  id: string;
  billingDocumentId: string;
  amount: number;
  paidDate: string;
  method: string;
  ref?: string;
  note?: string | null;
  receiptDocId?: string | null;
  createdAt: string;
}

/**
 * Record one payment and refresh the cache, atomically.
 *
 * Returns the document's new paid total so the caller can render
 * "ชำระแล้ว ฿A จาก ฿B" without a second read.
 */
export async function addBillingPayment(
  payment: NewBillingPayment
): Promise<{ paidAmount: number }> {
  return withTransaction(async (conn) => {
    await conn.query(
      `INSERT INTO billing_payments
         (id, billingDocumentId, amount, paidDate, method, ref, note, receiptDocId, voidedAt, voidReason, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)`,
      [
        payment.id,
        payment.billingDocumentId,
        payment.amount,
        payment.paidDate,
        payment.method,
        payment.ref ?? "",
        payment.note ?? null,
        payment.receiptDocId ?? null,
        payment.createdAt,
      ]
    );
    const paidAmount = await recomputePaidAmount(conn, payment.billingDocumentId);
    return { paidAmount };
  });
}

/** Thrown when a void targets a payment that does not exist, or one that has
 *  already been voided (voiding twice must not silently "succeed" and leave the
 *  admin thinking a second correction was applied). */
export class BillingPaymentNotVoidableError extends Error {
  constructor(public readonly paymentId: string) {
    super(`payment ${paymentId} is missing or already voided`);
    this.name = "BillingPaymentNotVoidableError";
  }
}

/**
 * Void one payment — the ONLY correction path. The row stays, struck through in
 * the history with its reason, and drops out of the SUM.
 */
export async function voidBillingPayment(
  paymentId: string,
  reason: string,
  voidedAt: string
): Promise<{ billingDocumentId: string; paidAmount: number }> {
  return withTransaction(async (conn) => {
    const [rows] = await conn.query<RowDataPacket[]>(
      "SELECT billingDocumentId, voidedAt FROM billing_payments WHERE id = ? FOR UPDATE",
      [paymentId]
    );
    if (rows.length === 0 || rows[0].voidedAt) {
      throw new BillingPaymentNotVoidableError(paymentId);
    }
    const billingDocumentId = String(rows[0].billingDocumentId);
    await conn.query(
      "UPDATE billing_payments SET voidedAt = ?, voidReason = ? WHERE id = ?",
      [voidedAt, reason.slice(0, 255), paymentId]
    );
    const paidAmount = await recomputePaidAmount(conn, billingDocumentId);
    return { billingDocumentId, paidAmount };
  });
}

/** Full history for one document, voided rows included — the disclosure on the
 *  ledger row shows them struck through, so they must not be filtered out. */
export async function listBillingPayments(
  billingDocumentId: string
): Promise<BillingPaymentRecord[]> {
  const [rows] = await query<RowDataPacket[]>(
    `SELECT * FROM billing_payments
      WHERE billingDocumentId = ?
      ORDER BY paidDate ASC, createdAt ASC`,
    [billingDocumentId]
  );
  return rows.map(rowToPayment);
}

/** How many LIVE payments a document carries. Used by the delete ban and by the
 *  "ประวัติการรับชำระ (N)" disclosure, which only appears past 1 — the second
 *  payment is what reveals the ledger, so the one-payment case never pays for
 *  the two-payment case. */
export async function countLiveBillingPayments(
  billingDocumentId: string
): Promise<number> {
  const [rows] = await query<RowDataPacket[]>(
    `SELECT COUNT(*) AS cnt FROM billing_payments
      WHERE billingDocumentId = ? AND voidedAt IS NULL`,
    [billingDocumentId]
  );
  return Number(rows[0]?.cnt) || 0;
}

/**
 * Keep the payment implied by an ใบเสร็จรับเงิน in step with that receipt,
 * inside the receipt's OWN save transaction — so issuing a receipt and
 * recording the payment stay ONE action for the admin.
 *
 * The payment row's id IS the receipt's id. That makes the whole thing
 * idempotent: re-saving the same receipt rewrites the same row instead of
 * minting a second payment for money that only arrived once.
 *
 * Three cases, all of which the data can really produce:
 *  - receipt now names an invoice           → upsert the payment onto it;
 *  - receipt was re-pointed at another one  → the row moves, and BOTH the old
 *    and the new invoice are re-summed (missing the old one would leave it
 *    permanently over-credited);
 *  - the link was cleared                   → the payment is VOIDED, never
 *    deleted, because it may be the only record that the money arrived.
 *
 * A CANCELLED receipt (`receipt.cancelled`) takes the same void path as a
 * cleared link, under RECEIPT_CANCELLED_VOID_REASON. Without that, re-saving a
 * cancelled receipt — which /billing does on every PDF download — would walk
 * straight into the `voidedAt = NULL` below and silently re-credit the invoice
 * from a document the admin had already withdrawn.
 */
export async function syncReceiptPayment(
  conn: Queryable,
  receipt: {
    id: string;
    settlesDocId: string | null;
    amount: number;
    paidDate: string;
    method: string;
    ref: string;
    createdAt: string;
    /** The receipt row carries `cancelledAt`: it settles nothing any more. */
    cancelled?: boolean;
  }
): Promise<void> {
  const [existingRows] = await conn.query<RowDataPacket[]>(
    "SELECT billingDocumentId, voidedAt FROM billing_payments WHERE id = ?",
    [receipt.id]
  );
  const previousDocId: string | null = existingRows.length
    ? String(existingRows[0].billingDocumentId)
    : null;

  if (!receipt.settlesDocId || receipt.cancelled) {
    // Nothing to settle. Void any payment this receipt used to imply rather
    // than dropping it, then correct the invoice it was credited against.
    if (previousDocId && !existingRows[0].voidedAt) {
      await conn.query(
        "UPDATE billing_payments SET voidedAt = ?, voidReason = ? WHERE id = ?",
        [
          receipt.createdAt,
          receipt.cancelled
            ? RECEIPT_CANCELLED_VOID_REASON
            : RECEIPT_UNLINKED_VOID_REASON,
          receipt.id,
        ]
      );
      await recomputePaidAmount(conn, previousDocId);
    }
    return;
  }

  await conn.query(
    `INSERT INTO billing_payments
       (id, billingDocumentId, amount, paidDate, method, ref, note, receiptDocId, voidedAt, voidReason, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, NULL, ?, NULL, NULL, ?)
     ON DUPLICATE KEY UPDATE
       billingDocumentId = VALUES(billingDocumentId),
       amount = VALUES(amount),
       paidDate = VALUES(paidDate),
       method = VALUES(method),
       ref = VALUES(ref),
       receiptDocId = VALUES(receiptDocId),
       voidedAt = NULL,
       voidReason = NULL`,
    [
      receipt.id,
      receipt.settlesDocId,
      receipt.amount,
      receipt.paidDate,
      receipt.method,
      receipt.ref,
      receipt.id,
      receipt.createdAt,
    ]
  );

  if (previousDocId && previousDocId !== receipt.settlesDocId) {
    await recomputePaidAmount(conn, previousDocId);
  }
  await recomputePaidAmount(conn, receipt.settlesDocId);
}

/**
 * Keep an ใบเสร็จรับเงิน's implied payment in step with the receipt being
 * CANCELLED or un-cancelled, inside that action's own transaction.
 *
 * Without this, ยกเลิกเอกสาร on a receipt takes the receipt out of the ledger
 * but leaves the `billing_payments` row it minted alive — so the invoice stays
 * credited by a document the admin has withdrawn, and the receivables report
 * reads ฿0 owed on a debt that was never settled. That is precisely the quietly
 * wrong number the ledger exists to prevent.
 *
 * The payment is VOIDED, never deleted (it is a financial record), and it is
 * voided under RECEIPT_CANCELLED_VOID_REASON so an un-cancel can restore
 * exactly what the cancel took out — and nothing else. A payment a human voided
 * from the history for his own reason is left voided, because un-cancelling the
 * receipt is not a statement about that correction.
 *
 * `receiptId` is the payment's own id (syncReceiptPayment mints them equal), so
 * this is a primary-key lookup that finds nothing for any other document type.
 * Calling it for an invoice is therefore a cheap no-op rather than a special
 * case the caller has to remember.
 */
export async function syncCancelledReceiptPayment(
  conn: Queryable,
  receiptId: string,
  cancelledAt: string | null
): Promise<void> {
  const [rows] = await conn.query<RowDataPacket[]>(
    "SELECT billingDocumentId, voidedAt, voidReason FROM billing_payments WHERE id = ?",
    [receiptId]
  );
  if (rows.length === 0) return;
  const billingDocumentId = String(rows[0].billingDocumentId);
  const voidedAt = rows[0].voidedAt ?? null;

  if (cancelledAt) {
    if (voidedAt) return; // already out of the SUM — nothing to correct
    await conn.query(
      "UPDATE billing_payments SET voidedAt = ?, voidReason = ? WHERE id = ?",
      [cancelledAt, RECEIPT_CANCELLED_VOID_REASON, receiptId]
    );
  } else {
    // Restore ONLY a void this cancel wrote.
    if (!voidedAt || rows[0].voidReason !== RECEIPT_CANCELLED_VOID_REASON) return;
    await conn.query(
      "UPDATE billing_payments SET voidedAt = NULL, voidReason = NULL WHERE id = ?",
      [receiptId]
    );
  }
  await recomputePaidAmount(conn, billingDocumentId);
}

/**
 * Repair path for the cache: re-sum every document that has payment rows.
 * Bounded and idempotent, so it is safe to run at any time — the point of
 * `paidAmount` being a pure re-sum is that drift is fixable without a
 * hand-written UPDATE against production.
 */
export async function repairPaidAmounts(limit = 500): Promise<number> {
  const [rows] = await query<RowDataPacket[]>(
    `SELECT DISTINCT billingDocumentId FROM billing_payments LIMIT ${Math.max(1, Math.trunc(limit))}`
  );
  let repaired = 0;
  for (const row of rows) {
    await withTransaction(async (conn) => {
      await recomputePaidAmount(conn, String(row.billingDocumentId));
    });
    repaired += 1;
  }
  return repaired;
}

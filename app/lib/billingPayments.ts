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
 *
 * ── THE STATE MACHINE. READ THIS BEFORE TOUCHING `voidedAt` ─────────────────
 * A payment row minted by an ใบเสร็จรับเงิน (its id IS the receipt's id) is
 * pushed around by THREE INDEPENDENT LIFECYCLES, and treating them as one is
 * what credited invoices twice and resurrected voided money:
 *
 *   1. THE DOCUMENT'S CONTENT — saving the receipt (syncReceiptPayment). Note
 *      that /billing re-saves a document on EVERY ดาวน์โหลด PDF, by anyone
 *      merely LOOKING at it. A re-save is therefore NOT a decision.
 *   2. A HUMAN — ยกเลิกรายการ in the payment history (voidBillingPayment),
 *      with a reason he typed.
 *   3. THE DOCUMENT'S LIFECYCLE — ยกเลิกเอกสาร (syncCancelledReceiptPayment)
 *      and แก้ไข (New Ver.) (voidSupersededReceiptPayment), which replace the
 *      receipt with a newer one that mints its OWN payment.
 *
 * WHO MAY SET voidedAt: all three. First void wins — an already-voided row is
 * never re-stamped with a second reason, because the reason is what says who
 * may take it back.
 *
 * WHO MAY CLEAR voidedAt: ONLY the exact inverse of the machine-written void
 * that set it, and NOTHING ELSE:
 *   • RECEIPT_CANCELLED_VOID_REASON  → cleared by un-cancelling THAT receipt
 *     (and only while no live newer version has taken its place).
 *   • RECEIPT_UNLINKED_VOID_REASON   → cleared by a save that names an invoice
 *     again, because re-pointing ชำระให้ใบแจ้งหนี้ is itself the human edit.
 *   • RECEIPT_SUPERSEDED_VOID_REASON → cleared by NOTHING. The newer version
 *     carries the money now; if that version is cancelled the debt reappears on
 *     the invoice, which is the visible, actionable direction to be wrong in.
 *   • a HUMAN void (any other reason) → cleared by NOTHING. A void performed by
 *     a person is a decision and must survive anything that is not an equally
 *     explicit decision to reverse it. Pressing ดาวน์โหลด PDF is not that. The
 *     correction path is to ADD a corrected payment, never to un-void.
 *
 * Which is why the receipt upsert below does NOT list `voidedAt` in its
 * ON DUPLICATE KEY UPDATE: the SQL is deliberately incapable of resurrecting a
 * payment, and the one legitimate un-void is a separate, explicit statement.
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
export const RECEIPT_SUPERSEDED_VOID_REASON = "ถูกแทนที่ด้วยใบเสร็จเวอร์ชันใหม่";

/** A void whose reason is NOT one of the three above was written by a HUMAN
 *  from the payment history, and nothing in this module may ever clear it —
 *  see THE STATE MACHINE at the top of the file. Every un-void below therefore
 *  matches on the ONE reason it is the inverse of, never on "is it voided". */

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

/** How many LIVE payments a document carries — the delete ban's test, and the
 *  (N) in the "ประวัติการรับชำระ (N)" disclosure.
 *
 *  That disclosure used to be HIDDEN until a document had two live payments, on
 *  the theory that one payment is not a ledger worth reading. It now opens on
 *  the first payment of any kind, because it holds the only ยกเลิกรายการ button
 *  in the app: hiding it left the commonest mistake of all — one payment typed
 *  with an extra zero — with no correction path at all. */
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
 * minting a second payment for money that only arrived once — and a replayed
 * `withTransaction` attempt converges on exactly the same row and the same sum.
 *
 * Cases, all of which the data can really produce:
 *  - receipt now names an invoice           → upsert the payment onto it;
 *  - receipt was re-pointed at another one  → the row moves, and BOTH the old
 *    and the new invoice are re-summed (missing the old one would leave it
 *    permanently over-credited);
 *  - the link was cleared                   → the payment is VOIDED, never
 *    deleted, because it may be the only record that the money arrived;
 *  - the receipt is CANCELLED or SUPERSEDED → the same void path, under its own
 *    reason. Neither state settles anything any more, and /billing re-saves the
 *    document on every PDF download, so both have to be read back from the row
 *    rather than trusted from the request.
 *
 * WHAT THIS FUNCTION MAY NOT DO is clear a void it did not write. See THE STATE
 * MACHINE at the top of this file: the upsert lists no `voidedAt`, and the ONE
 * un-void below is the exact inverse of the unlink that wrote it.
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
    /** A LIVE newer version has replaced this receipt ("แก้ไข (New Ver.)").
     *  That version mints its own payment, so this one must not also credit. */
    superseded?: boolean;
  }
): Promise<void> {
  const [existingRows] = await conn.query<RowDataPacket[]>(
    "SELECT billingDocumentId, voidedAt, voidReason FROM billing_payments WHERE id = ?",
    [receipt.id]
  );
  const existing = existingRows[0] ?? null;
  const previousDocId: string | null = existing
    ? String(existing.billingDocumentId)
    : null;
  const existingVoidedAt = existing?.voidedAt ?? null;
  const existingVoidReason = existing?.voidReason ?? null;

  // Why this receipt settles nothing, if it doesn't. Superseded is checked
  // FIRST: it is the state no action in this app reverses, so it must not be
  // overwritten by a reason (cancelled/unlinked) that un-cancelling or
  // re-linking would later take back — that is how the money gets credited
  // twice again.
  const settlesDocId = receipt.settlesDocId;
  const withdrawnReason = receipt.superseded
    ? RECEIPT_SUPERSEDED_VOID_REASON
    : receipt.cancelled
      ? RECEIPT_CANCELLED_VOID_REASON
      : !settlesDocId
        ? RECEIPT_UNLINKED_VOID_REASON
        : null;

  if (withdrawnReason) {
    // Void any payment this receipt used to imply rather than dropping it, then
    // correct the invoice it was credited against. An already-voided row is
    // left exactly as it is: first void wins, and its reason is what decides
    // who is allowed to take it back.
    if (previousDocId && !existingVoidedAt) {
      await conn.query(
        "UPDATE billing_payments SET voidedAt = ?, voidReason = ? WHERE id = ?",
        [receipt.createdAt, withdrawnReason, receipt.id]
      );
      await recomputePaidAmount(conn, previousDocId);
    }
    return;
  }
  // The unlinked case is already handled above; this restates it for the
  // compiler, which cannot see the narrowing through that ternary.
  if (!settlesDocId) return;

  // NOTE the columns this statement does NOT touch: `voidedAt` and
  // `voidReason`. A re-save — which anyone pressing ดาวน์โหลด PDF performs —
  // may correct the money on the row, but it may never bring a voided payment
  // back to life. That single `voidedAt = NULL` re-credited invoices from
  // payments an admin had deliberately voided, with nothing on screen to say so.
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
       receiptDocId = VALUES(receiptDocId)`,
    [
      receipt.id,
      settlesDocId,
      receipt.amount,
      receipt.paidDate,
      receipt.method,
      receipt.ref,
      receipt.id,
      receipt.createdAt,
    ]
  );

  // THE ONE UN-VOID A SAVE MAY PERFORM. The row was voided because the receipt
  // named no invoice; this save names one again, which is the admin editing
  // ชำระให้ใบแจ้งหนี้ — the exact inverse of the unlink that wrote the void.
  // Every other reason (a human's, a cancel's, a supersede's) is left alone.
  if (existingVoidedAt && existingVoidReason === RECEIPT_UNLINKED_VOID_REASON) {
    await conn.query(
      "UPDATE billing_payments SET voidedAt = NULL, voidReason = NULL WHERE id = ?",
      [receipt.id]
    );
  }

  if (previousDocId && previousDocId !== settlesDocId) {
    await recomputePaidAmount(conn, previousDocId);
  }
  await recomputePaidAmount(conn, settlesDocId);
}

/**
 * "แก้ไข (New Ver.)" on an ใบเสร็จรับเงิน — void the payment the SUPERSEDED
 * receipt minted, in the same transaction that saves the new version.
 *
 * The clone keeps `settlesDocId`, so its own save mints a payment for the same
 * money under a new id. Without this, BOTH rows stayed live, `recomputePaidAmount`
 * summed them, and an invoice for ฿100,000 read "ชำระเกิน ฿100,000" with ฿0
 * owed — twice over — from money that arrived once. The old receipt could not
 * even be deleted to undo it, because a document with a live payment is
 * undeletable by design.
 *
 * `supersededDocId` is the payment's own id (syncReceiptPayment mints them
 * equal), so this is a primary-key lookup that finds nothing for any other kind
 * of document. Superseding an INVOICE is therefore a no-op here — an invoice's
 * own payments (a deposit) belong to the invoice, not to a receipt, and are
 * never touched by this.
 *
 * An already-voided row is left alone, whoever voided it: a human's void
 * outlives this, and a second supersede has nothing left to take out.
 */
export async function voidSupersededReceiptPayment(
  conn: Queryable,
  supersededDocId: string,
  voidedAt: string
): Promise<void> {
  const [rows] = await conn.query<RowDataPacket[]>(
    "SELECT billingDocumentId, voidedAt FROM billing_payments WHERE id = ?",
    [supersededDocId]
  );
  if (!rows?.length || rows[0].voidedAt) return;
  await conn.query(
    "UPDATE billing_payments SET voidedAt = ?, voidReason = ? WHERE id = ?",
    [voidedAt, RECEIPT_SUPERSEDED_VOID_REASON, supersededDocId]
  );
  await recomputePaidAmount(conn, String(rows[0].billingDocumentId));
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
 *
 * CANCELLING A RECEIPT THAT A NEWER VERSION ALREADY REPLACED changes nothing:
 * its payment is already voided as ถูกแทนที่ and the first void wins.
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
    // Restore ONLY a void this cancel wrote. A human's void, an unlink's and a
    // supersede's all stay exactly where they are.
    if (!voidedAt || rows[0].voidReason !== RECEIPT_CANCELLED_VOID_REASON) return;
    // ...AND ONLY WHILE NOTHING LIVE HAS TAKEN THIS RECEIPT'S PLACE. Un-cancelling
    // a receipt that a newer version has replaced would put the money back
    // alongside the payment that version already minted — the same double credit,
    // by the other door. "Superseded" means superseded BY A ROW THAT IS STILL
    // ALIVE, exactly as the receivables ledger reads it: if the newer version
    // was itself cancelled it carries nothing, and this restore is correct.
    const [docRows] = await conn.query<RowDataPacket[]>(
      `SELECT newer.id AS liveSuccessorId
         FROM billing_documents doc
         JOIN billing_documents newer ON newer.id = doc.supersededById
        WHERE doc.id = ? AND newer.cancelledAt IS NULL`,
      [receiptId]
    );
    if (docRows.length > 0) return;
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

import { query, withTransaction } from "./db";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { computeQuoteTotals, round2 } from "./quotationTotals";
import type { BillingDocType } from "./billingNumber";
import { isValidDateString, addDaysToDateString } from "./dateFormat";
import {
  syncReceiptPayment,
  syncCancelledReceiptPayment,
  voidSupersededReceiptPayment,
} from "./billingPayments";
import type { ReceivableRow } from "./receivables";
import { sqlNotSupersededByLiveRow } from "./receivables";

// Persisted billing documents (Invoice / Billing Note / Receipt).
// `data` is the opaque client state (same shape as QuoteState, stored as JSON).
export interface BillingDocumentRecord {
  id: string;
  docType: BillingDocType;
  docNo: string;
  linkedQuotationId: string | null;
  data: unknown;
  paymentMethod: string | null;
  paymentDate: string | null;
  paymentRef: string | null;
  createdAt: string;
  // ── ลูกหนี้ค้างชำระ (v37) ───────────────────────────────────────────────
  /** "ครบกำหนดชำระ", stamped once at save. NULL = no term was ever agreed, and
   *  NULL IS NEVER OVERDUE — that is what keeps documents saved before this
   *  feature out of the alert feed until a human opts them in. */
  dueDate?: string | null;
  /** The invoice this ใบเสร็จรับเงิน settles. Only meaningful on a receipt. */
  settlesDocId?: string | null;
  /** Set on the row this save REPLACES (the "แก้ไข (New Ver.)" clone flow). */
  supersedesId?: string | null;
  // Read back from the row; never written by the document save itself.
  docDate?: string | null;
  totalAmount?: number;
  paidAmount?: number;
  customerName?: string;
  customerPhone?: string;
  receivableOverride?: number | null;
  supersededById?: string | null;
  cancelledAt?: string | null;
}

// mysql2 may return JSON columns already parsed (object) or as a string.
function parseJson<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return value as T;
}

function rowToBillingDocument(row: RowDataPacket): BillingDocumentRecord {
  return {
    id: row.id,
    docType: row.docType ?? "invoice",
    docNo: row.docNo ?? "",
    linkedQuotationId: row.linkedQuotationId ?? null,
    data: parseJson(row.data, {}),
    paymentMethod: row.paymentMethod ?? null,
    paymentDate: row.paymentDate ?? null,
    paymentRef: row.paymentRef ?? null,
    createdAt: row.createdAt,
    docDate: row.docDate ?? null,
    dueDate: row.dueDate ?? null,
    // DECIMAL columns arrive as strings from mysql2 — normalise once, here.
    totalAmount: Number(row.totalAmount) || 0,
    paidAmount: Number(row.paidAmount) || 0,
    customerName: row.customerName ?? "",
    customerPhone: row.customerPhone ?? "",
    receivableOverride:
      row.receivableOverride == null ? null : Number(row.receivableOverride),
    settlesDocId: row.settlesDocId ?? null,
    supersededById: row.supersededById ?? null,
    cancelledAt: row.cancelledAt ?? null,
  };
}

/** Thrown by saveBillingDocumentAtomic when the docNo is owned by a different document. */
export class BillingDocNoConflictError extends Error {
  constructor(public readonly docNo: string) {
    super(`docNo ${docNo} is already reserved by another document`);
    this.name = "BillingDocNoConflictError";
  }
}

/** Thrown by deleteBillingDocument when the document carries live payments. */
export class BillingDocumentHasPaymentsError extends Error {
  constructor(public readonly id: string) {
    super(`billing document ${id} has payments and cannot be deleted`);
    this.name = "BillingDocumentHasPaymentsError";
  }
}

/** The blob fields the derived columns are read out of. */
interface DataLite {
  items?: Array<{ qty?: number; unitPrice?: number; discount?: number; discountType?: "amount" | "percent" }>;
  discount?: number;
  discountType?: "amount" | "percent";
  vatEnabled?: boolean;
  customerCompany?: string;
  customerContact?: string;
  customerPhone?: string;
  docDate?: string;
}

/**
 * The denormalised columns, computed from the SAME blob and the SAME
 * `computeQuoteTotals` call that the printed sheet and the saved list use.
 *
 * They are derived HERE, inside the store's only writer, rather than being
 * accepted from the request — a client that could post its own `totalAmount`
 * would be a second source of truth for money the moment anything about the
 * discount order changed.
 *
 * `grandTotal` is deliberately settled to the satang with `round2` before it
 * lands in DECIMAL(12,2): VAT at 7% on an odd base leaves float dust
 * (…0000001), and DECIMAL would round it anyway — doing it here means the
 * number the ledger compares against is the number that was stored, with no
 * silent re-rounding in between.
 */
export function deriveBillingColumns(data: unknown): {
  docDate: string | null;
  totalAmount: number;
  customerName: string;
  customerPhone: string;
} {
  const d = parseJson<DataLite>(data, {});
  const rawDocDate = String(d.docDate ?? "").trim();
  return {
    // Validated before it reaches a VARCHAR date column that is compared
    // LEXICALLY: one malformed value silently breaks every range query.
    docDate: isValidDateString(rawDocDate) ? rawDocDate : null,
    totalAmount: round2(computeQuoteTotals(d).grandTotal),
    // The same expression summarize() uses for the saved list, so the ledger
    // and the list can never name the same document's customer differently.
    customerName: (d.customerCompany || d.customerContact || "-").slice(0, 255),
    // Chasing money means phoning someone — this earns its column on the card.
    customerPhone: String(d.customerPhone ?? "").slice(0, 50),
  };
}

/**
 * Save a billing document AND reserve its docNo atomically, in one transaction.
 * Reuses the same `used_docnos` ledger as quotations (prefixes don't collide).
 *
 * Claims the docNo via an INSERT (whose PRIMARY KEY on `docNo` is a real,
 * always-enforced constraint) rather than a `SELECT ... FOR UPDATE` check —
 * TiDB does not take a gap lock on a row that doesn't exist yet, so locking
 * before checking is a no-op for a brand-new docNo and lets two concurrent
 * saves of the same number both pass. Only once the row is known to exist
 * (a duplicate-key error) does `FOR UPDATE` reliably lock it, so the
 * ownership check on that path is race-safe. See saveQuotationAtomic in
 * quotationStore.ts for the identical reasoning.
 *
 * ── THE DERIVED COLUMNS (v37) ───────────────────────────────────────────────
 * This function is the ONLY code that writes `billing_documents`, and every
 * write is a full upsert of `data`. The receivables columns are therefore
 * computed from `rec.data` HERE, in the same statement that stores the blob,
 * from the same computeQuoteTotals call — they cannot be written apart, so they
 * cannot drift apart.
 *
 * FOUR COLUMNS ARE DELIBERATELY NOT IN THIS STATEMENT: `paidAmount` (owned by
 * billingPayments.recomputePaidAmount), `receivableOverride`, `cancelledAt` and
 * `supersededById` (owned by the ledger's explicit admin actions). They are
 * absent from the INSERT column list, so a fresh row takes the table defaults,
 * and absent from the ON DUPLICATE KEY UPDATE list, so merely re-saving a
 * document — which /billing does on every PDF download — can never wipe a
 * payment total or un-cancel a cancelled invoice.
 */
export async function saveBillingDocumentAtomic(
  rec: BillingDocumentRecord
): Promise<void> {
  const derived = deriveBillingColumns(rec.data);
  const dueDate =
    rec.dueDate && isValidDateString(String(rec.dueDate)) ? String(rec.dueDate) : null;
  // A receipt that names ITSELF would mint a payment against itself — money
  // credited to a document that carries no debt, and invisible everywhere. The
  // same guard `supersedesId` already carries, for the same reason.
  const settlesDocId =
    rec.docType === "receipt" && rec.settlesDocId && rec.settlesDocId !== rec.id
      ? rec.settlesDocId
      : null;

  await withTransaction(async (conn) => {
    if (rec.docNo) {
      try {
        await conn.query(
          "INSERT INTO used_docnos (docNo, quotationId, createdAt) VALUES (?, ?, ?)",
          [rec.docNo, rec.id, rec.createdAt]
        );
      } catch (err) {
        if ((err as { code?: string })?.code !== "ER_DUP_ENTRY") throw err;
        const [rows] = await conn.query<RowDataPacket[]>(
          "SELECT quotationId FROM used_docnos WHERE docNo = ? FOR UPDATE",
          [rec.docNo]
        );
        if (rows.length === 0 || String(rows[0].quotationId) !== rec.id) {
          throw new BillingDocNoConflictError(rec.docNo);
        }
        await conn.query(
          "UPDATE used_docnos SET createdAt = ? WHERE docNo = ?",
          [rec.createdAt, rec.docNo]
        );
      }
    }
    await conn.query(
      `INSERT INTO billing_documents (id, docType, docNo, linkedQuotationId, data, paymentMethod, paymentDate, paymentRef, createdAt, docDate, dueDate, totalAmount, customerName, customerPhone, settlesDocId)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         docType = VALUES(docType), docNo = VALUES(docNo),
         linkedQuotationId = VALUES(linkedQuotationId), data = VALUES(data),
         paymentMethod = VALUES(paymentMethod), paymentDate = VALUES(paymentDate),
         paymentRef = VALUES(paymentRef), createdAt = VALUES(createdAt),
         docDate = VALUES(docDate), dueDate = VALUES(dueDate),
         totalAmount = VALUES(totalAmount), customerName = VALUES(customerName),
         customerPhone = VALUES(customerPhone), settlesDocId = VALUES(settlesDocId)`,
      [
        rec.id,
        rec.docType,
        rec.docNo,
        rec.linkedQuotationId,
        JSON.stringify(rec.data),
        rec.paymentMethod,
        rec.paymentDate,
        rec.paymentRef,
        rec.createdAt,
        derived.docDate,
        dueDate,
        derived.totalAmount,
        derived.customerName,
        derived.customerPhone,
        settlesDocId,
      ]
    );

    // "แก้ไข (New Ver.)" mints a NEW uuid and a NEW docNo and saves a SECOND
    // row; the original was never deleted or flagged, so both rows carried the
    // same debt and every corrected invoice was billed twice. Stamping the
    // source here is what closes that — the clone already knows the id it came
    // from. Self-reference is refused so a mis-sent id cannot make a document
    // supersede itself and vanish from the ledger.
    //
    // ── AND THE MONEY HAS TO MOVE WITH IT ─────────────────────────────────
    // แก้ไข (New Ver.) is offered for ใบเสร็จรับเงิน too, and the clone carries
    // `settlesDocId` forward — so its own save (below) mints a SECOND payment
    // for money that arrived once. Stamping `supersededById` hid the old
    // DOCUMENT from the ledger but left its PAYMENT live, and both were summed:
    // a ฿100,000 invoice read "ชำระเกิน ฿100,000" with ฿0 owed, and the old
    // receipt could not even be deleted to undo it (a document with a live
    // payment is undeletable by design). The void travels in the SAME
    // transaction as the stamp, under ถูกแทนที่ด้วยใบเสร็จเวอร์ชันใหม่, and it
    // is a primary-key no-op for every document type that is not a receipt.
    if (rec.supersedesId && rec.supersedesId !== rec.id) {
      await conn.query(
        "UPDATE billing_documents SET supersededById = ? WHERE id = ?",
        [rec.id, rec.supersedesId]
      );
      await voidSupersededReceiptPayment(conn, rec.supersedesId, rec.createdAt);
    }

    // An ใบเสร็จรับเงิน that names the invoice it settles records the payment in
    // the SAME transaction, so issuing a receipt stays one action.
    if (rec.docType === "receipt") {
      // The save never writes `cancelledAt` or `supersededById` (see above), so
      // a receipt the admin has already cancelled — or that a newer version has
      // already replaced — comes through this path unchanged, and /billing
      // re-saves on every PDF download. BOTH flags are therefore read back
      // inside the same transaction: without them a mere download would put a
      // withdrawn receipt's credit back on the invoice.
      const [stateRows] = await conn.query<RowDataPacket[]>(
        "SELECT cancelledAt, supersededById FROM billing_documents WHERE id = ?",
        [rec.id]
      );
      const supersededById = stateRows?.[0]?.supersededById ?? null;
      // "Superseded" means SUPERSEDED BY A ROW THAT IS STILL ALIVE — the same
      // definition the receivables ledger uses. A newer version that was itself
      // cancelled carries nothing, so it cannot silence this receipt. A
      // successor that cannot be found is treated as alive: that is the
      // direction that under-credits rather than over-credits.
      let supersededByLiveRow = false;
      if (supersededById) {
        const [successorRows] = await conn.query<RowDataPacket[]>(
          "SELECT cancelledAt FROM billing_documents WHERE id = ?",
          [supersededById]
        );
        supersededByLiveRow =
          successorRows.length === 0 || !successorRows[0].cancelledAt;
      }
      await syncReceiptPayment(conn, {
        id: rec.id,
        settlesDocId,
        cancelled: Boolean(stateRows?.[0]?.cancelledAt),
        superseded: supersededByLiveRow,
        amount: derived.totalAmount,
        paidDate:
          rec.paymentDate && isValidDateString(String(rec.paymentDate))
            ? String(rec.paymentDate)
            : derived.docDate ?? rec.createdAt.slice(0, 10),
        method: rec.paymentMethod ?? "",
        ref: rec.paymentRef ?? "",
        createdAt: rec.createdAt,
      });
    }
  });
}

// ── Get / List / Delete ──────────────────────────────────────────────────────

export async function getBillingDocument(
  id: string
): Promise<BillingDocumentRecord | null> {
  const [rows] = await query<RowDataPacket[]>(
    "SELECT * FROM billing_documents WHERE id = ?",
    [id]
  );
  return rows.length > 0 ? rowToBillingDocument(rows[0]) : null;
}

export interface BillingSummary {
  id: string;
  docType: BillingDocType;
  docNo: string;
  linkedQuotationId: string | null;
  createdAt: string;
  customer: string;
  total: number;
}

function summarize(data: DataLite): { customer: string; total: number } {
  return {
    customer: data.customerCompany || data.customerContact || "-",
    total: computeQuoteTotals(data).grandTotal,
  };
}

/**
 * The saved-documents list. Deliberately STILL computes its totals from the
 * blob rather than reading the new `totalAmount` column.
 *
 * That is the read-side safety net, not an oversight: if a derived column is
 * ever stale, this list keeps showing the truth from the blob while the ledger
 * shows the column, and the discrepancy is VISIBLE rather than silent. Making
 * this read the column would remove the only alarm there is.
 */
export async function listBillingDocuments(
  docType?: BillingDocType
): Promise<BillingSummary[]> {
  let sql = "SELECT id, docType, docNo, linkedQuotationId, data, createdAt FROM billing_documents";
  const params: string[] = [];
  if (docType) {
    sql += " WHERE docType = ?";
    params.push(docType);
  }
  // Unlike quotations, billing documents are NEVER auto-purged (see the note
  // above deleteBillingDocument) — this list only grows, so this LIMIT is the
  // real bound, not just a safety cap. 2000 is generous for how many
  // invoices/billing notes/receipts a business like this issues; revisit
  // with real pagination if that volume is ever actually approached.
  sql += " ORDER BY createdAt DESC LIMIT 2000";

  const [rows] = await query<RowDataPacket[]>(sql, params);
  return rows.map((r) => {
    const { customer, total } = summarize(parseJson<DataLite>(r.data, {}));
    return {
      id: r.id,
      docType: r.docType ?? "invoice",
      docNo: r.docNo ?? "",
      linkedQuotationId: r.linkedQuotationId ?? null,
      createdAt: r.createdAt,
      customer,
      total,
    };
  });
}

// Deliberately no bulk/expiry-based purge for billing documents: unlike
// quotation drafts, invoices/billing notes/receipts are real financial and
// tax records that must be retained, not auto-deleted after N days.
// deleteBillingDocument (single-record, admin-triggered) is the only way
// one of these is ever removed.
//
// ── AND IT NOW REFUSES WHEN MONEY IS ATTACHED (v37) ─────────────────────────
// `billing_payments` deliberately has no FOREIGN KEY (house rule, db.ts), so
// nothing at the database level stops this DELETE from orphaning financial
// records. The ban is that stop. An admin who wants the document out of the way
// cancels it instead (`cancelBillingDocument`), which keeps the payment history
// and the reserved docNo — which is the entire reason `cancelledAt` exists.
//
// TWO WAYS a document can have money attached, and both are checked:
//  • `billingDocumentId = id` — payments recorded AGAINST this document (an
//    invoice with a deposit).
//  • `id = id` — the payment an ใบเสร็จรับเงิน MINTED. syncReceiptPayment gives
//    that row the receipt's own id, and points it at the INVOICE, so a receipt
//    matches nothing under the first clause. Checking only that one let a
//    receipt be deleted while its payment lived on: the invoice stayed credited
//    by a document that no longer existed, and the ledger reported ฿0 owed on a
//    debt nobody had paid.
// ── AND THE CHECK AND THE DELETE ARE ONE TRANSACTION ────────────────────────
// The count and the DELETE used to be two separate pool queries, so a receipt
// saved in the gap between them was orphaned by the very ban above: A counts
// zero payments, B's `syncReceiptPayment` inserts one against this invoice, A
// deletes the invoice, and the payment row survives forever pointing at a
// document that no longer exists — invisible on every screen, with no FOREIGN
// KEY to refuse it.
//
// Counting under `FOR UPDATE` would NOT have closed that: TiDB takes no gap
// lock on rows that do not exist yet (the same fact `saveQuotationAtomic`
// documents), so a count of zero locks nothing and the concurrent INSERT
// proceeds. The lock has to be on a row that DOES exist and that both sides
// touch — the billing document itself. `syncReceiptPayment` takes the same
// lock on the invoice it is about to credit, so the two serialise: whichever
// transaction arrives second sees the first one's result rather than a stale
// read of it.
export async function deleteBillingDocument(id: string): Promise<boolean> {
  return withTransaction(async (conn) => {
    // Idempotent under `withTransaction`'s replay: a retry after a lost commit
    // ack re-runs lock → count → DELETE against a row that is already gone and
    // returns false. The caller reports "ไม่พบเอกสาร" for a delete that did in
    // fact happen, which is a worse message but the same true end state — and
    // the alternative, assuming success, would claim a deletion that never ran.
    const [docRows] = await conn.query<RowDataPacket[]>(
      "SELECT id FROM billing_documents WHERE id = ? FOR UPDATE",
      [id]
    );
    if (docRows.length === 0) return false;

    const [paymentRows] = await conn.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS cnt FROM billing_payments
        WHERE (billingDocumentId = ? OR id = ?) AND voidedAt IS NULL`,
      [id, id]
    );
    if ((Number(paymentRows[0]?.cnt) || 0) > 0) {
      throw new BillingDocumentHasPaymentsError(id);
    }
    const [res] = await conn.query<ResultSetHeader>(
      "DELETE FROM billing_documents WHERE id = ?",
      [id]
    );
    return (res.affectedRows ?? 0) > 0;
  });
}

/**
 * ยกเลิกเอกสาร — the non-destructive alternative to the 🗑️ button.
 *
 * Nothing is removed: the payment history stays readable, the docNo stays
 * reserved in `used_docnos` (that ledger is never purged), and the row simply
 * stops being a receivable. Passing `null` un-cancels, because an admin who
 * cancelled the wrong invoice must be able to say so.
 *
 * ── AND IT MUST CARRY THE RECEIPT'S PAYMENT WITH IT ─────────────────────────
 * Cancelling an INVOICE is self-contained: the row goes terminal and its
 * payments stay attached to it, where they belong. Cancelling an ใบเสร็จรับเงิน
 * is not: the payment that receipt minted lives on the INVOICE, so withdrawing
 * the receipt while leaving that credit in place tells the owner an unpaid
 * invoice is settled. The void travels in the SAME transaction as the cancel
 * (syncCancelledReceiptPayment), and un-cancelling restores exactly the void
 * the cancel wrote — never one a human made from the payment history.
 */
export async function cancelBillingDocument(
  id: string,
  cancelledAt: string | null
): Promise<boolean> {
  return withTransaction(async (conn) => {
    const [res] = await conn.query<ResultSetHeader>(
      "UPDATE billing_documents SET cancelledAt = ? WHERE id = ?",
      [cancelledAt, id]
    );
    if ((res.affectedRows ?? 0) === 0) return false;
    await syncCancelledReceiptPayment(conn, id, cancelledAt);
    return true;
  });
}

// ── Receivables ──────────────────────────────────────────────────────────────

/**
 * Every row the ledger classifies, WITHOUT the `data` blob.
 *
 * All of it — the ageing buckets, the per-customer subtotals, the nudge lists —
 * is computed in JS by `buildReceivablesLedger`, from these columns. Volume is
 * bounded by the same LIMIT 2000 the saved list already lives under, so a
 * second aggregate query would buy nothing, and one bucketing rule in one
 * tested function beats a CASE WHEN in SQL that drifts from the row badge.
 *
 * Rows of EVERY docType are returned, not just invoices: the ledger needs the
 * ใบวางบิล that no invoice covers (the nudge list) and it needs every docNo to
 * detect versions superseded before the `supersededById` column existed.
 */
export async function listReceivableRows(): Promise<ReceivableRow[]> {
  const [rows] = await query<RowDataPacket[]>(
    `SELECT id, docNo, docType, docDate, dueDate, customerName, customerPhone,
            linkedQuotationId, totalAmount, paidAmount, receivableOverride,
            cancelledAt, supersededById, settlesDocId, createdAt
       FROM billing_documents
      ORDER BY createdAt DESC
      LIMIT 2000`
  );
  return rows.map((r) => ({
    id: r.id,
    docNo: r.docNo ?? "",
    docType: r.docType ?? "invoice",
    docDate: r.docDate ?? null,
    dueDate: r.dueDate ?? null,
    customerName: r.customerName ?? "",
    customerPhone: r.customerPhone ?? "",
    linkedQuotationId: r.linkedQuotationId ?? null,
    totalAmount: Number(r.totalAmount) || 0,
    paidAmount: Number(r.paidAmount) || 0,
    receivableOverride:
      r.receivableOverride == null ? null : Number(r.receivableOverride),
    cancelledAt: r.cancelledAt ?? null,
    supersededById: r.supersededById ?? null,
    settlesDocId: r.settlesDocId ?? null,
    createdAt: r.createdAt,
  }));
}

/** Open invoices for the receipt builder's "ชำระให้ใบแจ้งหนี้" dropdown, and
 *  for the nudge that links an unattached receipt to the debt it discharges.
 *
 *  "ถูกแทนที่" is asked through `sqlNotSupersededByLiveRow`, the one SQL
 *  spelling of the rule `buildReceivablesLedger` applies. Writing it out here
 *  went wrong twice: a `supersededById IS NULL` test made an invoice whose
 *  newer version was later CANCELLED unpickable forever, and a stamp-only test
 *  offered pre-v37 corrected invoices that the ledger screen hides — so a
 *  receipt could credit a row the ledger never shows, while the live version
 *  went on reading as fully unpaid. */
export async function listOpenInvoices(): Promise<
  { id: string; docNo: string; customerName: string; dueDate: string | null; outstanding: number }[]
> {
  const [rows] = await query<RowDataPacket[]>(
    `SELECT id, docNo, customerName, dueDate, totalAmount, paidAmount
       FROM billing_documents
      WHERE cancelledAt IS NULL
        AND ${sqlNotSupersededByLiveRow("billing_documents")}
        AND (receivableOverride = 1 OR (receivableOverride IS NULL AND docType = 'invoice'))
        AND totalAmount - paidAmount > 0.005
      ORDER BY dueDate IS NULL, dueDate ASC
      LIMIT 500`
  );
  return rows.map((r) => ({
    id: r.id,
    docNo: r.docNo ?? "",
    customerName: r.customerName ?? "",
    dueDate: r.dueDate ?? null,
    outstanding: (Number(r.totalAmount) || 0) - (Number(r.paidAmount) || 0),
  }));
}

/** Stamp (or clear) one document's ครบกำหนดชำระ. The caller validates the date
 *  string first — these VARCHAR columns are compared lexically. */
export async function setBillingDueDate(
  id: string,
  dueDate: string | null
): Promise<boolean> {
  const [res] = await query<ResultSetHeader>(
    "UPDATE billing_documents SET dueDate = ? WHERE id = ?",
    [dueDate, id]
  );
  return (res.affectedRows ?? 0) > 0;
}

/**
 * "ตั้งให้ทุกใบที่ยังไม่กำหนด" — give every eligible receivable that has no due
 * date one, `docDate + term`.
 *
 * `docDate`, never `createdAt`: the upsert above writes
 * `createdAt = VALUES(createdAt)` on EVERY save, and /billing POSTs the
 * document before generating its PDF — so merely opening an old invoice and
 * downloading it resets its createdAt to today. Ageing anything on that would
 * silently un-age every invoice the owner looks at.
 *
 * Rows whose `docDate` is still NULL (blob had none, backfill has not reached
 * them) are skipped rather than given an invented date.
 *
 * The dates are computed in JS with `addDaysToDateString`, NOT with SQL's
 * DATE_ADD: the ConfirmDialog in front of this action states the resulting date
 * range, and one definition of "+N days" is what makes the range the owner
 * approved the range that is actually written.
 */
export async function listUndatedReceivables(): Promise<
  { id: string; docNo: string; customerName: string; docDate: string }[]
> {
  const [rows] = await query<RowDataPacket[]>(
    `SELECT id, docNo, customerName, docDate
       FROM billing_documents
      WHERE dueDate IS NULL
        AND docDate IS NOT NULL
        AND cancelledAt IS NULL
        AND ${sqlNotSupersededByLiveRow("billing_documents")}
        AND (receivableOverride = 1 OR (receivableOverride IS NULL AND docType = 'invoice'))
        AND totalAmount > 0
        AND totalAmount - paidAmount > 0.005
      ORDER BY docDate ASC
      LIMIT 2000`
  );
  return rows.map((r) => ({
    id: r.id,
    docNo: r.docNo ?? "",
    customerName: r.customerName ?? "",
    docDate: String(r.docDate),
  }));
}

/**
 * Returns HOW MANY ROWS WERE ACTUALLY WRITTEN, not how many were attempted.
 *
 * The UPDATE carries `AND dueDate IS NULL` precisely because another admin (or
 * the ledger's per-row "ตั้งวันครบกำหนด") can stamp a date between the read and
 * the write; when that happens the statement matches ZERO rows on purpose. The
 * count was being incremented regardless, so two admins pressing
 * "ตั้งให้ทุกใบที่ยังไม่กำหนด" at the same moment both saw "อัปเดต 40 ใบ" while
 * the second changed nothing — a toast that reports work that did not happen.
 *
 * The counter lives INSIDE the transaction callback, never outside it:
 * `withTransaction` replays its callback on a transient connection loss, and a
 * counter captured outside would keep the rolled-back attempt's tally and
 * report double.
 */
export async function setDueDatesForUndatedReceivables(
  termDays: number
): Promise<number> {
  const targets = await listUndatedReceivables();
  if (targets.length === 0) return 0;
  const term = Math.max(0, Math.trunc(termDays));
  return withTransaction(async (conn) => {
    let updated = 0;
    for (const target of targets) {
      const dueDate = addDaysToDateString(target.docDate, term);
      if (!isValidDateString(dueDate)) continue;
      const [res] = await conn.query<ResultSetHeader>(
        "UPDATE billing_documents SET dueDate = ? WHERE id = ? AND dueDate IS NULL",
        [dueDate, target.id]
      );
      if ((res?.affectedRows ?? 0) > 0) updated += 1;
    }
    return updated;
  });
}

/**
 * "นับเป็นลูกหนี้" / "ไม่นับ" — the tri-state override.
 *
 * `null` means "apply the default rule for this docType", which is what every
 * row already in production silently means, so the migration needed no
 * backfill. 1 forces an ใบวางบิล that no invoice covers into the ledger; 0
 * takes a document out of it. It is always ONE CLICK BY THE ADMIN: a
 * customer+total heuristic on financial data is exactly how a wrong ยอดค้าง
 * nobody can explain gets produced.
 */
export async function setReceivableOverride(
  id: string,
  value: 0 | 1 | null
): Promise<boolean> {
  const [res] = await query<ResultSetHeader>(
    "UPDATE billing_documents SET receivableOverride = ? WHERE id = ?",
    [value, id]
  );
  return (res.affectedRows ?? 0) > 0;
}

// ── Backfill of the derived columns ──────────────────────────────────────────

/** Marks the backfill finished, so it stops asking. A `settings` row, the same
 *  mechanism `schema_version` itself uses. */
export const BILLING_BACKFILL_SETTING = "billing_derived_backfill";
export const BILLING_BACKFILL_VERSION = "37";

/**
 * Fill `docDate` / `totalAmount` / `customerName` / `customerPhone` on rows that
 * predate those columns, in bounded batches.
 *
 * NOT SQL, and NOT part of `bootstrapSchemaOnce`:
 *  - `totalAmount` cannot be computed in SQL. It needs per-line discount
 *    capping, the document discount applied AFTER the line discounts, and VAT —
 *    i.e. computeQuoteTotals, which SQL could only reproduce by becoming a
 *    second, drifting source of truth for money.
 *  - the bootstrap is DDL-only and returns early on Vercel PREVIEW deploys
 *    (db.ts), which share the production database — a backfill placed there
 *    would never run against the environment that matters.
 * So it is triggered lazily from the receivables API on first load.
 *
 * It deliberately does NOT invent a `dueDate` and does NOT touch `paidAmount`.
 * Auto-stamping a credit term onto a two-year-old invoice would invent an
 * overdue debt nobody ever agreed to, and inferring payment from the existing
 * `paymentDate` column would mark essentially every invoice in the database as
 * settled (see the header note on those columns in the API route).
 *
 * Idempotent and re-runnable: it selects only rows still missing `docDate`, and
 * terminates on the settings row above so a blob that genuinely carries no
 * docDate cannot make it loop forever.
 */
export async function backfillBillingDerivedColumns(
  batchSize = 200
): Promise<{ scanned: number; updated: number; done: boolean }> {
  const [rows] = await query<RowDataPacket[]>(
    `SELECT id, data, createdAt FROM billing_documents
      WHERE docDate IS NULL
      ORDER BY createdAt DESC
      LIMIT ${Math.max(1, Math.min(1000, Math.trunc(batchSize)))}`
  );
  if (rows.length === 0) return { scanned: 0, updated: 0, done: true };

  // INSIDE the callback, never outside it — the same rule
  // `setDueDatesForUndatedReceivables` spells out. `withTransaction` replays on
  // a transient connection loss, so a counter captured outside keeps the tally
  // of the attempt that was rolled back: a 200-row batch that died after 150
  // writes and then succeeded reported 350 rows written. That number is not
  // only shown to the owner, it feeds `done: ... || updated === 0`, so an
  // inflated count can also decide the queue is not drained when it is.
  const updated = await withTransaction(async (conn) => {
    let written = 0;
    for (const row of rows) {
      const derived = deriveBillingColumns(row.data);
      // A blob with no docDate of its own falls back to the day the row was
      // first written. That is the only date such a document has, and leaving
      // docDate NULL would make the row un-backfillable forever.
      const docDate = derived.docDate ?? String(row.createdAt ?? "").slice(0, 10);
      if (!isValidDateString(docDate)) continue;
      await conn.query(
        `UPDATE billing_documents
            SET docDate = ?, totalAmount = ?, customerName = ?, customerPhone = ?
          WHERE id = ?`,
        [
          docDate,
          derived.totalAmount,
          derived.customerName,
          derived.customerPhone,
          row.id,
        ]
      );
      written += 1;
    }
    return written;
  });

  // Fewer rows than asked for means the queue is drained; a batch where nothing
  // could be written (every blob unusable) also stops, so this cannot spin.
  return { scanned: rows.length, updated, done: rows.length < batchSize || updated === 0 };
}

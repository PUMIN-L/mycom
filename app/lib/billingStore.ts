import { query, withTransaction } from "./db";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { computeQuoteTotals } from "./quotationTotals";
import type { BillingDocType } from "./billingNumber";

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
  };
}

/** Thrown by saveBillingDocumentAtomic when the docNo is owned by a different document. */
export class BillingDocNoConflictError extends Error {
  constructor(public readonly docNo: string) {
    super(`docNo ${docNo} is already reserved by another document`);
    this.name = "BillingDocNoConflictError";
  }
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
 */
export async function saveBillingDocumentAtomic(
  rec: BillingDocumentRecord
): Promise<void> {
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
      `INSERT INTO billing_documents (id, docType, docNo, linkedQuotationId, data, paymentMethod, paymentDate, paymentRef, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         docType = VALUES(docType), docNo = VALUES(docNo),
         linkedQuotationId = VALUES(linkedQuotationId), data = VALUES(data),
         paymentMethod = VALUES(paymentMethod), paymentDate = VALUES(paymentDate),
         paymentRef = VALUES(paymentRef), createdAt = VALUES(createdAt)`,
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
      ]
    );
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

interface DataLite {
  items?: Array<{ qty?: number; unitPrice?: number }>;
  discount?: number;
  discountType?: "amount" | "percent";
  vatEnabled?: boolean;
  customerCompany?: string;
  customerContact?: string;
}

function summarize(data: DataLite): { customer: string; total: number } {
  return {
    customer: data.customerCompany || data.customerContact || "-",
    total: computeQuoteTotals(data).grandTotal,
  };
}

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
export async function deleteBillingDocument(id: string): Promise<boolean> {
  const [res] = await query<ResultSetHeader>(
    "DELETE FROM billing_documents WHERE id = ?",
    [id]
  );
  return (res.affectedRows ?? 0) > 0;
}

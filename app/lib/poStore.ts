import { query, withTransaction } from "./db";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { computeQuoteTotals } from "./quotationTotals";

// Persisted purchase orders. `data` is the opaque client-side PO state (items,
// supplier snapshot, terms — see app/purchase-order/page.tsx), stored as JSON,
// the same "one blob per document" shape `quotations` uses.
//
// UNLIKE quotations, a PO is never edited in place once saved: there is no
// `updatePurchaseOrder`, and this file has no function that rewrites `data`
// for an id that already has a row. The only ways to change what a PO says
// after it exists are `cancelPurchaseOrder` (stops it counting, keeps the
// row) and `supersedePurchaseOrder` (issues a brand-new PO with a brand-new
// number and stamps the old row's `supersededById`) — the same rigor
// `billing_documents` applies to invoices, because a PO is a commitment
// already sent to a supplier.
export interface PurchaseOrderRecord {
  id: string;
  docNo: string;
  data: unknown;
  supersededById: string | null;
  cancelledAt: string | null;
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

function rowToPurchaseOrder(row: RowDataPacket): PurchaseOrderRecord {
  return {
    id: row.id,
    docNo: row.docNo ?? "",
    data: parseJson(row.data, {}),
    supersededById: row.supersededById ?? null,
    cancelledAt: row.cancelledAt ?? null,
    createdAt: row.createdAt,
  };
}

/** Thrown by createPurchaseOrder when the docNo is owned by a different PO. */
export class PoDocNoConflictError extends Error {
  constructor(public readonly docNo: string) {
    super(`docNo ${docNo} is already reserved by another purchase order`);
    this.name = "PoDocNoConflictError";
  }
}

export class PurchaseOrderNotFoundError extends Error {
  constructor(public readonly id: string) {
    super(`purchase order ${id} not found`);
    this.name = "PurchaseOrderNotFoundError";
  }
}

/** Thrown by cancelPurchaseOrder/supersedePurchaseOrder when the row is
 *  already in a terminal state (cancelled or superseded) — both actions
 *  refuse a repeat, so a PO's history stays a single unambiguous chain. */
export class PurchaseOrderFinalizedError extends Error {
  constructor(public readonly id: string, public readonly reason: "cancelled" | "superseded") {
    super(`purchase order ${id} is already ${reason}`);
    this.name = "PurchaseOrderFinalizedError";
  }
}

/**
 * Create a purchase order AND reserve its docNo atomically, in one
 * transaction — the exact same construction as saveQuotationAtomic
 * (quotationStore.ts), reusing the SAME `used_docnos` ledger table (a PO's
 * numbers therefore can never collide with a quotation's or an invoice's).
 * See that function's own doc comment for why the docNo is claimed via an
 * INSERT (a real, always-enforced PRIMARY KEY constraint) rather than a
 * SELECT ... FOR UPDATE check: TiDB takes no gap lock on a row that doesn't
 * exist yet, so locking before checking is a no-op for a brand-new docNo.
 *
 * `ON DUPLICATE KEY UPDATE` on the `purchase_orders` insert is retry-safety
 * for `withTransaction`'s own replay-on-transient-connection-loss, NOT a
 * public edit path — nothing in this file ever calls this a second time for
 * the same id with different data.
 */
export async function createPurchaseOrder(rec: {
  id: string;
  docNo: string;
  data: unknown;
  createdAt: string;
}): Promise<void> {
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
          throw new PoDocNoConflictError(rec.docNo);
        }
        await conn.query(
          "UPDATE used_docnos SET createdAt = ? WHERE docNo = ?",
          [rec.createdAt, rec.docNo]
        );
      }
    }
    await conn.query(
      `INSERT INTO purchase_orders (id, docNo, data, createdAt)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         docNo = VALUES(docNo), data = VALUES(data), createdAt = VALUES(createdAt)`,
      [rec.id, rec.docNo, JSON.stringify(rec.data), rec.createdAt]
    );
  });
}

export async function getPurchaseOrder(id: string): Promise<PurchaseOrderRecord | null> {
  const [rows] = await query<RowDataPacket[]>(
    "SELECT * FROM purchase_orders WHERE id = ?",
    [id]
  );
  return rows.length > 0 ? rowToPurchaseOrder(rows[0]) : null;
}

export interface PurchaseOrderSummary {
  id: string;
  docNo: string;
  createdAt: string;
  supplier: string;
  total: number;
  cancelledAt: string | null;
  supersededById: string | null;
}

interface PoDataLite {
  items?: Array<{
    qty?: number;
    unitPrice?: number;
    discount?: number;
    discountType?: "amount" | "percent";
  }>;
  discount?: number;
  discountType?: "amount" | "percent";
  vatEnabled?: boolean;
  supplierCompany?: string;
}

function summarize(data: PoDataLite): { supplier: string; total: number } {
  return {
    supplier: data.supplierCompany || "-",
    total: computeQuoteTotals(data).grandTotal,
  };
}

const LIST_LIMIT = 2000;

/** Saved-PO summaries, newest first. Same LIMIT-2000 shape as
 *  listBillingDocuments — purchase orders are financial/procurement records,
 *  never auto-purged, so this list only grows. */
export async function listPurchaseOrders(): Promise<PurchaseOrderSummary[]> {
  const [rows] = await query<RowDataPacket[]>(
    `SELECT id, docNo, data, createdAt, cancelledAt, supersededById
       FROM purchase_orders
      ORDER BY createdAt DESC
      LIMIT ${LIST_LIMIT}`
  );
  return rows.map((r) => {
    const { supplier, total } = summarize(parseJson<PoDataLite>(r.data, {}));
    return {
      id: r.id,
      docNo: r.docNo ?? "",
      createdAt: r.createdAt,
      supplier,
      total,
      cancelledAt: r.cancelledAt ?? null,
      supersededById: r.supersededById ?? null,
    };
  });
}

/**
 * ยกเลิกใบสั่งซื้อ — non-destructive: the row (and its reserved docNo) stay
 * exactly as they were, just marked cancelled. Refuses a repeat cancel on a
 * row that is already cancelled OR already superseded, so a PO's status
 * history stays one unambiguous chain rather than something that can be
 * toggled back and forth.
 */
export async function cancelPurchaseOrder(id: string, cancelledAt: string): Promise<void> {
  await withTransaction(async (conn) => {
    const [rows] = await conn.query<RowDataPacket[]>(
      "SELECT cancelledAt, supersededById FROM purchase_orders WHERE id = ? FOR UPDATE",
      [id]
    );
    if (rows.length === 0) throw new PurchaseOrderNotFoundError(id);
    if (rows[0].cancelledAt) throw new PurchaseOrderFinalizedError(id, "cancelled");
    if (rows[0].supersededById) throw new PurchaseOrderFinalizedError(id, "superseded");
    await conn.query(
      "UPDATE purchase_orders SET cancelledAt = ? WHERE id = ?",
      [cancelledAt, id]
    );
  });
}

/**
 * ออกใบใหม่แทนใบเดิม — a full replacement, not an edit: mints a brand-new PO
 * (its own docNo, claimed the same atomic way createPurchaseOrder does) and,
 * in the SAME transaction, stamps the old row's `supersededById` so the two
 * are linked forever. Refuses when the old row is already cancelled or
 * already superseded, for the same "one unambiguous chain" reason
 * cancelPurchaseOrder does.
 */
export async function supersedePurchaseOrder(
  oldId: string,
  newRec: { id: string; docNo: string; data: unknown; createdAt: string }
): Promise<void> {
  await withTransaction(async (conn) => {
    const [rows] = await conn.query<RowDataPacket[]>(
      "SELECT cancelledAt, supersededById FROM purchase_orders WHERE id = ? FOR UPDATE",
      [oldId]
    );
    if (rows.length === 0) throw new PurchaseOrderNotFoundError(oldId);
    if (rows[0].cancelledAt) throw new PurchaseOrderFinalizedError(oldId, "cancelled");
    if (rows[0].supersededById) throw new PurchaseOrderFinalizedError(oldId, "superseded");

    if (newRec.docNo) {
      try {
        await conn.query(
          "INSERT INTO used_docnos (docNo, quotationId, createdAt) VALUES (?, ?, ?)",
          [newRec.docNo, newRec.id, newRec.createdAt]
        );
      } catch (err) {
        if ((err as { code?: string })?.code !== "ER_DUP_ENTRY") throw err;
        const [ledgerRows] = await conn.query<RowDataPacket[]>(
          "SELECT quotationId FROM used_docnos WHERE docNo = ? FOR UPDATE",
          [newRec.docNo]
        );
        if (ledgerRows.length === 0 || String(ledgerRows[0].quotationId) !== newRec.id) {
          throw new PoDocNoConflictError(newRec.docNo);
        }
        await conn.query(
          "UPDATE used_docnos SET createdAt = ? WHERE docNo = ?",
          [newRec.createdAt, newRec.docNo]
        );
      }
    }

    await conn.query(
      `INSERT INTO purchase_orders (id, docNo, data, createdAt)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         docNo = VALUES(docNo), data = VALUES(data), createdAt = VALUES(createdAt)`,
      [newRec.id, newRec.docNo, JSON.stringify(newRec.data), newRec.createdAt]
    );

    await conn.query(
      "UPDATE purchase_orders SET supersededById = ? WHERE id = ?",
      [newRec.id, oldId]
    );
  });
}

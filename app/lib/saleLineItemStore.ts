import "server-only";
import { query } from "./db";
import type { RowDataPacket } from "mysql2";
import { sanitizePlainText } from "./sanitizeHtml";

/**
 * Line items of a sale — one row of `sales_record_items` per product line
 * under one `sales_records` row (schema v33).
 *
 * `costAmount` is the product cost of the WHOLE line (not per unit). Bill-level
 * costs (transport, commission, …) stay in `sale_cost_items` and are never
 * duplicated here, so `sales_records.costAmount` =
 * SUM(sales_record_items.costAmount) + SUM(sale_cost_items.amount WHERE
 * costType <> 'product_cost') with nothing counted twice.
 */
export interface SaleLineItem {
  id: string;
  salesRecordId: string;
  productId: string;
  productName: string;
  categoryId: number | null;
  qty: number;
  unitPrice: number;
  totalAmount: number;
  costAmount: number;
  quotationItemId: string | null;
  sortOrder: number;
  createdAt: string;
}

// Mirrors the clamps `cleanInput` applies to the equivalent `sales_records`
// columns, so a line item can never hold a value the parent sale could not.
const MAX_QTY = 1000000;
const MAX_UNIT_PRICE = 999999999.99;
const MAX_AMOUNT = 9999999999.99;

/**
 * Every numeric column is NOT NULL, so a NaN/undefined must land as a number,
 * never as NULL (which would abort the INSERT mid-transaction and roll back an
 * otherwise valid sale).
 */
function toMoney(value: unknown, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(max, Math.round(n * 100) / 100));
}

function toQty(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 1; // same floor as sales_records.qty (DEFAULT 1)
  return Math.max(1, Math.min(MAX_QTY, Math.round(n)));
}

function toCategoryId(value: unknown): number | null {
  const n = Number(value);
  if (value === undefined || value === null || !Number.isFinite(n) || n <= 0) return null;
  return Math.round(n);
}

function toSortOrder(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(MAX_QTY, Math.round(n)));
}

/** Row → typed item. DECIMAL columns come back from mysql2 as strings. */
function mapRow(row: RowDataPacket | Record<string, unknown>): SaleLineItem {
  const r = row as Record<string, unknown>;
  return {
    id: String(r.id || ""),
    salesRecordId: String(r.salesRecordId || ""),
    productId: String(r.productId || ""),
    productName: String(r.productName || ""),
    categoryId: toCategoryId(r.categoryId),
    qty: toQty(r.qty),
    unitPrice: toMoney(r.unitPrice, MAX_UNIT_PRICE),
    totalAmount: toMoney(r.totalAmount, MAX_AMOUNT),
    costAmount: toMoney(r.costAmount, MAX_AMOUNT),
    quotationItemId: r.quotationItemId ? String(r.quotationItemId) : null,
    sortOrder: toSortOrder(r.sortOrder, 0),
    createdAt: String(r.createdAt || ""),
  };
}

/**
 * Normalize one submitted line. `sortOrder` falls back to the submitted
 * position, and `totalAmount` to qty × unitPrice when the caller did not send
 * an explicit total — keeping the documented invariant
 * `sales_records.totalAmount = SUM(items.totalAmount)` computable from what
 * the form sent.
 */
function cleanItem(item: Partial<SaleLineItem>, index: number) {
  const qty = toQty(item.qty);
  const unitPrice = toMoney(item.unitPrice, MAX_UNIT_PRICE);
  const submittedTotal = toMoney(item.totalAmount, MAX_AMOUNT);
  const quotationItemId = sanitizePlainText(item.quotationItemId || "")
    .trim()
    .substring(0, 64);
  return {
    productId: sanitizePlainText(item.productId || "").substring(0, 255),
    productName: sanitizePlainText(item.productName || "").substring(0, 255),
    categoryId: toCategoryId(item.categoryId),
    qty,
    unitPrice,
    totalAmount: submittedTotal > 0 ? submittedTotal : toMoney(qty * unitPrice, MAX_AMOUNT),
    costAmount: toMoney(item.costAmount, MAX_AMOUNT),
    quotationItemId: quotationItemId || null,
    sortOrder: toSortOrder(item.sortOrder, index),
  };
}

/** All line items of one sale, in display order. */
export async function listLineItemsForSale(salesRecordId: string): Promise<SaleLineItem[]> {
  if (!salesRecordId) return [];
  const [rows] = await query<RowDataPacket[]>(
    `SELECT id, salesRecordId, productId, productName, categoryId, qty,
            unitPrice, totalAmount, costAmount, quotationItemId, sortOrder, createdAt
       FROM sales_record_items
      WHERE salesRecordId = ?
      ORDER BY sortOrder ASC, createdAt ASC`,
    [salesRecordId]
  );
  return (rows || []).map(mapRow);
}

/**
 * Replace the line items of one sale with exactly the submitted set, on the
 * CALLER'S transaction connection — line items are written in the same
 * `withTransaction` as the sales record and its equipment rows, so there is
 * never a committed sale without its products.
 *
 * The DELETE here is NOT a violation of the never-auto-delete rule: line items
 * are derived data belonging to this sale (FK ON DELETE CASCADE), unlike
 * `customer_equipments`, which carries independent service/warranty history and
 * is only ever unlinked (`salesRecordId = ''`), never deleted outside the
 * OTP-gated delete route.
 *
 * ids and timestamps are generated INSIDE this call because `withTransaction`
 * may retry its callback up to 3 times; a retried attempt must mint fresh ids
 * rather than reuse ones from a rolled-back attempt.
 */
export async function replaceLineItemsForSale(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  conn: any,
  salesRecordId: string,
  items: Partial<SaleLineItem>[]
): Promise<SaleLineItem[]> {
  if (!salesRecordId) return [];

  await conn.query(`DELETE FROM sales_record_items WHERE salesRecordId = ?`, [
    salesRecordId,
  ]);

  const written: SaleLineItem[] = [];
  const list = Array.isArray(items) ? items : [];
  for (let i = 0; i < list.length; i++) {
    const v = cleanItem(list[i] || {}, i);
    const row: SaleLineItem = {
      id: crypto.randomUUID(),
      salesRecordId,
      createdAt: new Date().toISOString(),
      ...v,
    };
    await conn.query(
      `INSERT INTO sales_record_items
         (id, salesRecordId, productId, productName, categoryId, qty,
          unitPrice, totalAmount, costAmount, quotationItemId, sortOrder, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id,
        row.salesRecordId,
        row.productId,
        row.productName,
        row.categoryId,
        row.qty,
        row.unitPrice,
        row.totalAmount,
        row.costAmount,
        row.quotationItemId,
        row.sortOrder,
        row.createdAt,
      ]
    );
    written.push(row);
  }
  return written;
}

/**
 * Which lines of a quotation have already been converted to a sale, and how
 * many units in total.
 *
 * Aggregates ACROSS sales records on purpose: a customer who buys 2 machines
 * now and the third one a month later produces two separate sales rows against
 * the same quotation, and the caller needs the combined qty per quotation line.
 *
 * ADVISORY ONLY (warning banner / confirm dialog). It never throws and never
 * blocks a write: an unconverted quotation, a missing table, or a query failure
 * all resolve to an empty array so the sale can still be saved.
 */
export async function getSoldQuotationItems(quotationId: string): Promise<
  Array<{ quotationItemId: string; soldQty: number; salesRecordIds: string[] }>
> {
  if (!quotationId) return [];
  try {
    const [rows] = await query<RowDataPacket[]>(
      `SELECT sri.quotationItemId AS quotationItemId,
              sri.salesRecordId   AS salesRecordId,
              COALESCE(SUM(sri.qty), 0) AS soldQty
         FROM sales_record_items sri
         JOIN sales_records sr ON sr.id = sri.salesRecordId
        WHERE sr.quotationId = ?
          AND sri.quotationItemId IS NOT NULL
          AND sri.quotationItemId <> ''
        GROUP BY sri.quotationItemId, sri.salesRecordId
        ORDER BY sri.quotationItemId ASC, MIN(sri.createdAt) ASC`,
      [quotationId]
    );

    // Folded in JS rather than with GROUP_CONCAT: the id list would otherwise
    // be silently truncated at group_concat_max_len.
    const byItem = new Map<
      string,
      { quotationItemId: string; soldQty: number; salesRecordIds: string[] }
    >();
    for (const raw of rows || []) {
      const r = raw as Record<string, unknown>;
      const quotationItemId = String(r.quotationItemId || "");
      if (!quotationItemId) continue;
      const salesRecordId = String(r.salesRecordId || "");
      const qty = Number(r.soldQty);
      const entry = byItem.get(quotationItemId) || {
        quotationItemId,
        soldQty: 0,
        salesRecordIds: [],
      };
      entry.soldQty += Number.isFinite(qty) ? qty : 0;
      if (salesRecordId && !entry.salesRecordIds.includes(salesRecordId)) {
        entry.salesRecordIds.push(salesRecordId);
      }
      byItem.set(quotationItemId, entry);
    }
    return Array.from(byItem.values());
  } catch (error) {
    console.warn("getSoldQuotationItems failed (advisory lookup, ignored):", error);
    return [];
  }
}

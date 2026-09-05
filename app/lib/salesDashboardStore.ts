import "server-only";
import { query, withTransaction } from "./db";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { sanitizePlainText } from "./sanitizeHtml";
import { bangkokDateString, bangkokParts } from "./dateFormat";

// ── Types ────────────────────────────────────────────────────────────────────
import type { SalesRecord, CostItem, CustomerEquipment } from "./types";
import { replaceLineItemsForSale } from "./saleLineItemStore";
import type { SaleLineItem } from "./saleLineItemStore";
import { syncEquipmentRowsForSalesRecord } from "./crmStore";
import type { EquipmentRowInput } from "./crmStore";

/**
 * `quotationId` is a SOFT link to the source quotation (no FK — quotations are
 * still purged by the retention cron, and a sale must never disappear with
 * one). It lives on the row but not yet on the shared `SalesRecord` type, so
 * every write path accepts it through this widened input type.
 */
type SalesRecordInput = Partial<SalesRecord> & { quotationId?: string | null };

/**
 * Anything that can run a parameterised statement: the module-level `query()`
 * helper (its own connection, auto-commit) or a `withTransaction` connection.
 * Lets one INSERT builder serve both the standalone and the atomic path.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SqlExecutor = (sql: string, params?: unknown[]) => Promise<any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TxConnection = { query: (sql: string, params?: unknown[]) => Promise<any> };

function executorFor(conn?: TxConnection): SqlExecutor {
  return conn
    ? (sql, params) => conn.query(sql, params)
    : (sql, params) => query(sql, params);
}



export const COST_TYPE_LABELS: Record<string, string> = {
  product_cost: "ต้นทุนสินค้า",
  transport: "ค่ารถ / ค่าเดินทาง",
  shipping: "ค่าขนส่ง",
  service_visit: "ค่าเซอร์วิส / ค่าติดตั้ง",
  repair: "ค่าซ่อม",
  commission: "ค่าคอมมิชชั่น",
  other: "อื่นๆ",
};

export interface DashboardOverview {
  currentPeriod: { revenue: number; deals: number; newCustomers: number; quotations: number; cost: number; profit: number };
  previousPeriod: { revenue: number; deals: number; newCustomers: number; quotations: number; cost: number; profit: number };
  expiringWarranties: number;
  periodLabel: string;
}

export interface RevenueByPeriod {
  period: string; // e.g. "2026-01", "2026-Q1", "2026"
  revenue: number;
  deals: number;
  cost: number;
  expense: number;
  profit: number;
  margin: number; // percentage 0-100
}

export interface TopItem {
  id: string;
  name: string;
  revenue: number;
  qty: number;
  deals: number;
  percentage: number;
  profit?: number;
  profitMargin?: number;
}

export interface SalespersonStats {
  id: string;
  name: string;
  revenue: number;
  deals: number;
  percentage: number;
  avgDealSize: number;
}

export interface SmartInsight {
  type: "positive" | "warning" | "opportunity" | "info";
  icon: string;
  title: string;
  description: string;
}

// ── CRUD ─────────────────────────────────────────────────────────────────────

function formatLocalDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function cleanDate(d?: string | Date | null): string | undefined {
  if (!d) return undefined;
  // Defense-in-depth: if a raw Date object ever reaches here (e.g. a future
  // query that forgets DATE_FORMAT on a DATE column), format it by its local
  // Y-M-D instead of falling through to String(d).substring(0,10), which reads
  // as "Wed Aug 26" and fails the regex below — silently discarding the date
  // (the bug this replaced) instead of round-tripping it correctly.
  if (d instanceof Date) {
    if (isNaN(d.getTime())) return undefined;
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }
  const s = String(d).trim().substring(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined;
}

function cleanInput(data: SalesRecordInput) {
  return {
    salespersonId: sanitizePlainText(data.salespersonId || "").substring(0, 255),
    customerId: sanitizePlainText(data.customerId || "").substring(0, 255),
    companyId: sanitizePlainText(data.companyId || "").substring(0, 255),
    productId: sanitizePlainText(data.productId || "").substring(0, 255),
    productName: sanitizePlainText(data.productName || "").substring(0, 255),
    categoryId:
      data.categoryId !== undefined &&
      data.categoryId !== null &&
      !isNaN(Number(data.categoryId)) &&
      Number(data.categoryId) > 0
        ? Math.round(Number(data.categoryId))
        : null,
    qty: Math.max(1, Math.min(1000000, Math.round(Number(data.qty) || 0))),
    unitPrice: Math.max(0, Math.min(999999999.99, Number(data.unitPrice) || 0)),
    totalAmount: Math.max(0, Math.min(9999999999.99, Number(data.totalAmount) || 0)),
    costAmount: Math.max(0, Math.min(9999999999.99, Number(data.costAmount) || 0)),
    saleType: data.saleType === "service" ? "service" : "equipment",
    saleDate: (() => {
      const raw = sanitizePlainText(data.saleDate || "").substring(0, 10);
      // Validate YYYY-MM-DD format and that it's a real date
      if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return formatLocalDate(new Date());
      const d = new Date(raw + "T00:00:00");
      if (isNaN(d.getTime())) return formatLocalDate(new Date());
      return raw;
    })(),
    quotationRef: sanitizePlainText(data.quotationRef || "").substring(0, 255),
    quotationId: data.quotationId
      ? sanitizePlainText(String(data.quotationId)).substring(0, 36)
      : null,
    poRef: sanitizePlainText(data.poRef || "").substring(0, 255),
    deliveryRef: sanitizePlainText(data.deliveryRef || "").substring(0, 255),
    invoiceRef: sanitizePlainText(data.invoiceRef || "").substring(0, 255),
    receiptRef: sanitizePlainText(data.receiptRef || "").substring(0, 255),
    warrantyStartDate: cleanDate(data.warrantyStartDate) || null,
    warrantyEndDate: cleanDate(data.warrantyEndDate) || null,
    equipmentId: data.equipmentId
      ? sanitizePlainText(data.equipmentId).substring(0, 36)
      : "",
    note: sanitizePlainText(data.note || "").substring(0, 5000),
  };
}

const LIST_SELECT = `
  SELECT sr.*,
         DATE_FORMAT(sr.saleDate, '%Y-%m-%d') AS saleDate,
         DATE_FORMAT(sr.warrantyStartDate, '%Y-%m-%d') AS warrantyStartDate,
         DATE_FORMAT(sr.warrantyEndDate, '%Y-%m-%d') AS warrantyEndDate,
         sp.name AS salespersonName,
         c.name AS customerName,
         co.name AS companyName,
         p.image AS productImage
  FROM sales_records sr
  -- All JOINs below are on PRIMARY KEY columns (sp.id, c.id, co.id, p.id),
  -- so they automatically use indexes. No additional INDEX needed.
  LEFT JOIN salespeople sp ON sr.salespersonId = sp.id
  LEFT JOIN customers c ON sr.customerId = c.id
  LEFT JOIN companies co ON sr.companyId = co.id
  LEFT JOIN products p ON sr.productId = p.id`;

/**
 * INSERT one `sales_records` row through `exec` — the module-level `query()`
 * for the standalone path, or a transaction connection for the atomic
 * create-with-line-items path. Shared so both write exactly the same columns.
 */
async function insertSalesRecordRow(
  exec: SqlExecutor,
  id: string,
  v: ReturnType<typeof cleanInput>,
  now: string
): Promise<void> {
  // Auto-compute totalAmount if not provided
  const totalAmount = v.totalAmount > 0 ? v.totalAmount : v.qty * v.unitPrice;
  await exec(
    `INSERT INTO sales_records
       (id, salespersonId, customerId, companyId, productId, productName,
        categoryId, qty, unitPrice, totalAmount, costAmount, saleType, saleDate, quotationRef,
        poRef, deliveryRef, invoiceRef, receiptRef, warrantyStartDate, warrantyEndDate,
        equipmentId, note, createdAt, quotationId)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id, v.salespersonId, v.customerId, v.companyId, v.productId,
      v.productName, v.categoryId, v.qty, v.unitPrice, totalAmount,
      v.costAmount, v.saleType, v.saleDate, v.quotationRef,
      v.poRef, v.deliveryRef, v.invoiceRef, v.receiptRef, v.warrantyStartDate, v.warrantyEndDate,
      v.equipmentId, v.note, now, v.quotationId,
    ]
  );
}

/**
 * Fill in productName/categoryId from the catalog for a row that only carries
 * a productId. Pure read — safe to run before opening a transaction.
 */
async function resolveProductDefaults(
  exec: SqlExecutor,
  v: { productId: string; productName: string; categoryId: number | null }
): Promise<void> {
  if (v.productName || !v.productId) return;
  const [pRows] = (await exec(
    "SELECT title_th, title_en, categoryId FROM products WHERE id = ?",
    [v.productId]
  )) as [RowDataPacket[], unknown];
  if (pRows[0]) {
    v.productName = sanitizePlainText(pRows[0].title_th || pRows[0].title_en || "").substring(0, 255);
    if (v.categoryId === null && typeof pRows[0].categoryId === "number") {
      v.categoryId = pRows[0].categoryId;
    }
  }
}

/**
 * Insert a bare `sales_records` row with NO line items. Since v33 the product /
 * category reports read `sales_record_items`, so a sale written through here is
 * invisible to them — use `createSaleWithLineItems` for anything user-facing.
 */
export async function addSalesRecord(
  data: SalesRecordInput
): Promise<SalesRecord> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const v = cleanInput(data);

  // Auto-populate product name and category if only productId is provided
  await resolveProductDefaults(executorFor(), v);

  await insertSalesRecordRow(executorFor(), id, v, now);
  return (await getSalesRecord(id))!;
}

export async function getSalesRecord(id: string): Promise<SalesRecord | null> {
  const [rows] = await query<RowDataPacket[]>(
    `${LIST_SELECT} WHERE sr.id = ?`,
    [id]
  );
  const record = (rows && rows[0] as SalesRecord) || null;
  if (record) {
    const result = await query<RowDataPacket[]>(
      `SELECT serialNumber FROM customer_equipments WHERE salesRecordId = ? ORDER BY createdAt ASC`,
      [id]
    );
    if (result && Array.isArray(result[0])) {
      record.serialNumbers = result[0].map((eq: any) => eq.serialNumber);
    } else {
      record.serialNumbers = [];
    }
  }
  return record;
}

export async function updateSalesRecord(
  id: string,
  data: SalesRecordInput
): Promise<SalesRecord | null> {
  const existing = await getSalesRecord(id);
  if (!existing) return null;
  const v = cleanInput({ ...existing, ...data });
  const totalAmount = v.totalAmount > 0 ? v.totalAmount : v.qty * v.unitPrice;
  await withTransaction(async (conn) => {
    // Same lock as every other write that touches this sale's totals, so a
    // concurrent recalc cannot interleave between the row and its line item.
    await conn.query(LOCK_SALE_SQL, [id]);
    await conn.query(
      `UPDATE sales_records SET
         salespersonId = ?, customerId = ?, companyId = ?, productId = ?,
         productName = ?, categoryId = ?, qty = ?, unitPrice = ?,
         totalAmount = ?, costAmount = ?, saleType = ?, saleDate = ?, quotationRef = ?,
         poRef = ?, deliveryRef = ?, invoiceRef = ?, receiptRef = ?, warrantyStartDate = ?, warrantyEndDate = ?,
         equipmentId = ?, note = ?, quotationId = ?
       WHERE id = ?`,
      [
        v.salespersonId, v.customerId, v.companyId, v.productId,
        v.productName, v.categoryId, v.qty, v.unitPrice, totalAmount,
        v.costAmount, v.saleType, v.saleDate, v.quotationRef,
        v.poRef, v.deliveryRef, v.invoiceRef, v.receiptRef, v.warrantyStartDate, v.warrantyEndDate,
        v.equipmentId, v.note, v.quotationId, id,
      ]
    );
    await syncSingleLineItemToScalars(conn, id, v, totalAmount);
  });
  return getSalesRecord(id);
}

/**
 * Carry a SCALAR edit (the legacy single-product form) down to the sale's line
 * item, in the same transaction as the row update.
 *
 * Since v33 "สินค้าขายดี" / "รายได้ตามหมวดหมู่" read `sales_record_items`, so a
 * row-only edit would leave the reports showing the OLD product and amount
 * while the overview cards show the new one — permanently, with nothing to
 * flag the divergence. The invariant that must hold is
 * `SUM(items.totalAmount) = sales_records.totalAmount` for the same sale.
 *
 * Only a sale with AT MOST ONE line item is touched — the shape every legacy
 * and backfilled sale has. The scalar columns cannot describe a multi-line
 * bill at all, so collapsing one into a single line here would destroy per-line
 * data; those sales are edited through a line-level payload instead.
 *
 * `costAmount` deliberately stays put: product cost is owned by the line item
 * and the cost-item endpoints recompute the sale total from it. The one
 * exception is the line this creates when a sale somehow has none, which uses
 * the v33 backfill's own formula (sale cost minus the bill-level cost items) so
 * `SUM(line costs) + SUM(non-product cost items)` still reproduces the cached
 * `costAmount` exactly.
 */
async function syncSingleLineItemToScalars(
  conn: TxConnection,
  salesRecordId: string,
  v: ReturnType<typeof cleanInput>,
  totalAmount: number
): Promise<void> {
  const [rows] = (await conn.query(
    `SELECT id FROM sales_record_items WHERE salesRecordId = ?
     ORDER BY sortOrder ASC, createdAt ASC`,
    [salesRecordId]
  )) as [RowDataPacket[], unknown];
  const items = Array.isArray(rows) ? rows : [];
  if (items.length > 1) return;

  if (items.length === 1) {
    await conn.query(
      `UPDATE sales_record_items
          SET productId = ?, productName = ?, categoryId = ?, qty = ?,
              unitPrice = ?, totalAmount = ?
        WHERE id = ?`,
      [
        v.productId,
        v.productName,
        v.categoryId,
        v.qty,
        v.unitPrice,
        round2(totalAmount),
        String(items[0].id),
      ]
    );
    return;
  }

  const [costRows] = (await conn.query(
    `SELECT COALESCE(SUM(amount), 0) AS other FROM sale_cost_items
      WHERE salesRecordId = ? AND costType <> 'product_cost'`,
    [salesRecordId]
  )) as [RowDataPacket[], unknown];
  const lineCost = Math.max(0, round2(v.costAmount - Number(costRows?.[0]?.other || 0)));

  // id/createdAt are minted inside the caller's transaction body so a retry
  // re-derives them rather than replaying ids from a rolled-back attempt.
  await conn.query(
    `INSERT INTO sales_record_items
       (id, salesRecordId, productId, productName, categoryId, qty,
        unitPrice, totalAmount, costAmount, quotationItemId, sortOrder, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, ?)`,
    [
      crypto.randomUUID(),
      salesRecordId,
      v.productId,
      v.productName,
      v.categoryId,
      v.qty,
      v.unitPrice,
      round2(totalAmount),
      lineCost,
      new Date().toISOString(),
    ]
  );
}

export async function deleteSalesRecord(id: string): Promise<boolean> {
  const [res] = await query<ResultSetHeader>(
    "DELETE FROM sales_records WHERE id = ?",
    [id]
  );
  return res.affectedRows > 0;
}

// ── Atomic write: sale + line items + equipment ──────────────────────────────

/**
 * THE cost definition for `sales_records.costAmount` — every cost typed into
 * the sale, counted exactly once:
 *
 *   SUM(sales_record_items.costAmount)                            product cost, per line
 * + SUM(sale_cost_items.amount WHERE costType <> 'product_cost')  ค่ารถ / ค่าคอม / ฯลฯ
 *
 * Legacy `product_cost` rows in `sale_cost_items` are KEPT as history (never
 * deleted) but excluded here: after the v33 backfill that same money already
 * sits on the sale's line item, so summing both would double-count the product
 * cost and silently restate every profit/margin figure that reads costAmount.
 */
const COST_AMOUNT_SUM_SQL = `
  SELECT COALESCE((SELECT SUM(costAmount) FROM sales_record_items
                   WHERE salesRecordId = ?), 0)
       + COALESCE((SELECT SUM(amount) FROM sale_cost_items
                   WHERE salesRecordId = ? AND costType <> 'product_cost'), 0) AS total`;

const LOCK_SALE_SQL = "SELECT id FROM sales_records WHERE id = ? FOR UPDATE";

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/** Per-line values, cleaned to the same bounds as the sales_records columns. */
interface LineSummary {
  productId: string;
  productName: string;
  categoryId: number | null;
  qty: number;
  unitPrice: number;
  totalAmount: number;
  costAmount: number;
  sortOrder: number;
}

function cleanLineItem(item: Partial<SaleLineItem>, index: number): LineSummary {
  const qty = Math.max(1, Math.min(1000000, Math.round(Number(item.qty) || 0)));
  const unitPrice = Math.max(0, Math.min(999999999.99, Number(item.unitPrice) || 0));
  const provided = Math.max(0, Math.min(9999999999.99, Number(item.totalAmount) || 0));
  const sortOrder = Number.isFinite(Number(item.sortOrder)) ? Math.round(Number(item.sortOrder)) : index;
  return {
    productId: sanitizePlainText(item.productId || "").substring(0, 255),
    productName: sanitizePlainText(item.productName || "").substring(0, 255),
    categoryId:
      item.categoryId !== undefined &&
      item.categoryId !== null &&
      !isNaN(Number(item.categoryId)) &&
      Number(item.categoryId) > 0
        ? Math.round(Number(item.categoryId))
        : null,
    qty,
    unitPrice,
    totalAmount: provided > 0 ? round2(provided) : round2(qty * unitPrice),
    costAmount: Math.max(0, Math.min(9999999999.99, Number(item.costAmount) || 0)),
    sortOrder,
  };
}

/**
 * Recompute the sale's cached scalar totals from its line items, inside the
 * caller's transaction, locking the sale row first — the same discipline as
 * `recalcCostAmount`, and for the same reason: two concurrent edits on the
 * SAME sale must serialize, or the later write can persist a pre-race snapshot
 * and leave totalAmount/qty permanently out of sync with the line items.
 *
 * Returns null (and writes NOTHING) when the sale has no line items, so an
 * empty read can never zero out a real sale's revenue.
 */
async function recalcSaleTotalsTx(
  conn: TxConnection,
  salesRecordId: string
): Promise<{ totalAmount: number; qty: number; costAmount: number } | null> {
  await conn.query(LOCK_SALE_SQL, [salesRecordId]);
  const [aggRows] = (await conn.query(
    `SELECT COUNT(*) AS lineCount,
            COALESCE(SUM(totalAmount), 0) AS totalAmount,
            COALESCE(SUM(qty), 0) AS qty
     FROM sales_record_items WHERE salesRecordId = ?`,
    [salesRecordId]
  )) as [RowDataPacket[], unknown];
  const agg = aggRows?.[0];
  if (!agg || Number(agg.lineCount || 0) === 0) return null;

  const [costRows] = (await conn.query(COST_AMOUNT_SUM_SQL, [
    salesRecordId,
    salesRecordId,
  ])) as [RowDataPacket[], unknown];

  const totals = {
    totalAmount: round2(Number(agg.totalAmount || 0)),
    qty: Math.max(1, Math.round(Number(agg.qty || 0))),
    costAmount: round2(Number(costRows?.[0]?.total || 0)),
  };
  await conn.query(
    `UPDATE sales_records SET totalAmount = ?, qty = ?, costAmount = ? WHERE id = ?`,
    [totals.totalAmount, totals.qty, totals.costAmount, salesRecordId]
  );
  return totals;
}

/**
 * Public entry point for the same recompute — call it whenever a sale's line
 * items change outside `createSaleWithLineItems`.
 */
export async function recalcSaleTotals(
  salesRecordId: string
): Promise<{ totalAmount: number; qty: number; costAmount: number } | null> {
  if (!salesRecordId) return null;
  return withTransaction((conn) => recalcSaleTotalsTx(conn, salesRecordId));
}

export interface CreateSaleWithLineItemsInput {
  sale: SalesRecordInput;
  items: Partial<SaleLineItem>[];
  equipments: EquipmentRowInput[];
}

/**
 * Create a sale, ALL of its line items and ALL of its equipment rows in ONE
 * transaction — all-or-nothing. This replaces the old flow (commit the sale,
 * then loop `addEquipment` afterwards), which could leave a committed sale
 * with only some of its machines and no way to tell the difference from a
 * complete one. There is no partial success left to report.
 *
 * The scalar product columns on `sales_records` are still filled so the
 * overview cards / exports that read them do not go blank:
 *   qty / totalAmount / costAmount = the SUMS over the line items
 *   productId / productName / categoryId / unitPrice = the MAIN line, defined
 *   as the line with the highest totalAmount (ties broken by the lowest
 *   sortOrder, then submission order) — the line that dominates the bill is
 *   the least misleading single label for it. Revenue attribution must never
 *   be read from these columns again; the reports group by line items.
 */
export async function createSaleWithLineItems(
  input: CreateSaleWithLineItemsInput
): Promise<SalesRecord> {
  const rawItems = (input.items || []).filter(Boolean);
  if (rawItems.length === 0) {
    throw new Error("ต้องมีรายการสินค้าอย่างน้อย 1 รายการ");
  }
  const equipments = Array.isArray(input.equipments) ? input.equipments : [];
  const exec = executorFor();

  // Catalog lookups are pure reads — resolve them BEFORE opening the
  // transaction so the (retryable) transaction body stays short and writes only.
  const lines = rawItems.map((item, i) => cleanLineItem(item, i));
  for (const line of lines) {
    await resolveProductDefaults(exec, line);
  }

  const totalQty = lines.reduce((s, l) => s + l.qty, 0);
  const totalAmount = round2(lines.reduce((s, l) => s + l.totalAmount, 0));
  const totalCost = round2(lines.reduce((s, l) => s + l.costAmount, 0));

  const main = lines.reduce((best, l) =>
    l.totalAmount > best.totalAmount ||
    (l.totalAmount === best.totalAmount && l.sortOrder < best.sortOrder)
      ? l
      : best
  );

  const v = cleanInput({
    ...input.sale,
    productId: main.productId,
    productName: main.productName,
    categoryId: main.categoryId,
    unitPrice: main.unitPrice,
    qty: totalQty,
    totalAmount,
    costAmount: totalCost,
  });

  // Line items carry the resolved product name/category so the reports never
  // have to fall back to the sale's scalar columns.
  const itemsToPersist: Partial<SaleLineItem>[] = rawItems.map((item, i) => ({
    ...item,
    productId: lines[i].productId,
    productName: lines[i].productName,
    categoryId: lines[i].categoryId,
    qty: lines[i].qty,
    unitPrice: lines[i].unitPrice,
    totalAmount: lines[i].totalAmount,
    costAmount: lines[i].costAmount,
    sortOrder: lines[i].sortOrder,
    quotationItemId: item.quotationItemId ?? null,
  }));

  // Defaults for machines whose own row leaves a field out; per-machine values
  // always win (a bill can mix models, warranties and serials).
  const sharedEquipment: Partial<CustomerEquipment> = {
    customerId: v.customerId,
    productId: main.productId,
    productName: main.productName,
    quotationNumber: v.quotationRef,
    warrantyCertNumber: "",
    warrantyType: "",
    warrantyStartDate: v.warrantyStartDate,
    warrantyEndDate: v.warrantyEndDate,
    status: "Active",
  };

  const saleId = await withTransaction(async (conn) => {
    // Every UUID is generated INSIDE the callback: withTransaction retries the
    // whole body up to 3x on a transient connection loss, and ids minted
    // outside would be reused across attempts.
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    await insertSalesRecordRow(executorFor(conn), id, v, now);
    await replaceLineItemsForSale(conn, id, itemsToPersist);
    // Re-derive the cached totals from what was actually persisted, so the
    // invariant holds against the line-item writer's own rounding.
    await recalcSaleTotalsTx(conn, id);
    if (equipments.length > 0) {
      await syncEquipmentRowsForSalesRecord(id, equipments, sharedEquipment, conn);
    }
    return id;
  });

  return (await getSalesRecord(saleId))!;
}

export async function listSalesRecords(filters?: {
  salespersonId?: string;
  customerId?: string;
  categoryId?: number;
  dateFrom?: string;
  dateTo?: string;
}): Promise<SalesRecord[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filters?.salespersonId) {
    where.push("sr.salespersonId = ?");
    params.push(filters.salespersonId);
  }
  if (filters?.customerId) {
    where.push("sr.customerId = ?");
    params.push(filters.customerId);
  }
  if (filters?.categoryId !== undefined && filters.categoryId !== null) {
    where.push("sr.categoryId = ?");
    params.push(filters.categoryId);
  }
  const dateFrom = cleanDate(filters?.dateFrom);
  if (dateFrom) {
    where.push("sr.saleDate >= ?");
    params.push(dateFrom);
  }
  const dateTo = cleanDate(filters?.dateTo);
  if (dateTo) {
    where.push("sr.saleDate <= ?");
    params.push(dateTo);
  }
  const clause = where.length > 0 ? ` WHERE ${where.join(" AND ")}` : "";
  const [rows] = await query<RowDataPacket[]>(
    `${LIST_SELECT}${clause} ORDER BY sr.saleDate DESC LIMIT 1000`,
    params
  );
  return rows as SalesRecord[];
}

// ── Aggregate Queries ────────────────────────────────────────────────────────

export function getPeriodDateRange(periodType?: string, periodValue?: string) {
  let curStart, curEnd, prevStart, prevEnd;
  let periodLabel = "เดือนนี้";
  // Only the DEFAULT (no explicit periodValue) reads "now" — use Bangkok's
  // calendar date/month, not the server's own (UTC on Vercel), or the
  // default view picks the wrong month/quarter/year for up to 7 hours a day.
  const { year: bkkYear, month: bkkMonth } = bangkokParts(new Date());

  if (periodType === 'year') {
    const y = parseInt(periodValue || bkkYear.toString(), 10);
    curStart = `${y}-01-01`;
    curEnd = `${y + 1}-01-01`;
    prevStart = `${y - 1}-01-01`;
    prevEnd = curStart;
    periodLabel = `ปี ${y}`;
  } else if (periodType === 'quarter') {
    const parts = (periodValue || "").split('-Q');
    const y = parseInt(parts[0], 10) || bkkYear;
    const q = parseInt(parts[1], 10) || Math.floor(bkkMonth / 3) + 1;
    const startMonth = (q - 1) * 3;
    curStart = `${y}-${String(startMonth + 1).padStart(2, "0")}-01`;
    const curEndDate = new Date(y, startMonth + 3, 1);
    curEnd = `${curEndDate.getFullYear()}-${String(curEndDate.getMonth() + 1).padStart(2, "0")}-01`;
    const prevStartDate = new Date(y, startMonth - 3, 1);
    prevStart = `${prevStartDate.getFullYear()}-${String(prevStartDate.getMonth() + 1).padStart(2, "0")}-01`;
    prevEnd = curStart;
    periodLabel = `ไตรมาส ${q} ปี ${y}`;
  } else {
    // month (default)
    const parts = (periodValue || "").split('-');
    const y = parseInt(parts[0], 10) || bkkYear;
    const m = parts.length > 1 ? parseInt(parts[1], 10) - 1 : bkkMonth;
    curStart = `${y}-${String(m + 1).padStart(2, "0")}-01`;
    const nextMonth = new Date(y, m + 1, 1);
    curEnd = `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, "0")}-01`;
    const prevDate = new Date(y, m - 1, 1);
    prevStart = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, "0")}-01`;
    prevEnd = curStart;
    const thaiMonths = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
    periodLabel = `เดือน ${thaiMonths[m]} ${y}`;
  }

  return { curStart, curEnd, prevStart, prevEnd, periodLabel };
}

export async function getDashboardOverview(
  curStart: string,
  curEnd: string,
  prevStart: string,
  prevEnd: string
): Promise<Omit<DashboardOverview, 'periodLabel'>> {

  // Current month
  const [curRows] = await query<RowDataPacket[]>(
    `SELECT COALESCE(SUM(totalAmount), 0) AS revenue, COUNT(*) AS deals,
            COALESCE(SUM(costAmount), 0) AS cost
     FROM sales_records WHERE saleDate >= ? AND saleDate < ?`,
    [curStart, curEnd]
  );
  const [curExpRows] = await query<RowDataPacket[]>(
    `SELECT COALESCE(SUM(amount), 0) AS expenses
     FROM expenses WHERE expenseDate >= ? AND expenseDate < ?`,
    [curStart, curEnd]
  );

  // Previous period
  const [prevRows] = await query<RowDataPacket[]>(
    `SELECT COALESCE(SUM(totalAmount), 0) AS revenue, COUNT(*) AS deals,
            COALESCE(SUM(costAmount), 0) AS cost
     FROM sales_records WHERE saleDate >= ? AND saleDate < ?`,
    [prevStart, prevEnd]
  );
  const [prevExpRows] = await query<RowDataPacket[]>(
    `SELECT COALESCE(SUM(amount), 0) AS expenses
     FROM expenses WHERE expenseDate >= ? AND expenseDate < ?`,
    [prevStart, prevEnd]
  );
  // New customers this period
  const [curCust] = await query<RowDataPacket[]>(
    `SELECT COUNT(*) AS cnt FROM customers WHERE createdAt >= ? AND createdAt < ?`,
    [curStart, curEnd]
  );
  const [prevCust] = await query<RowDataPacket[]>(
    `SELECT COUNT(*) AS cnt FROM customers WHERE createdAt >= ? AND createdAt < ?`,
    [prevStart, prevEnd]
  );
  // Quotations — used_docnos is a SHARED ledger for both quotations (docNo
  // prefix "QT") and billing documents (prefixes "INV"/"BN"/"RC"), so this
  // must filter to quotations only or it silently counts every issued
  // document type as a "quotation" (permanently deflating Conversion Rate
  // for any business that also issues billing documents).
  const [curQuot] = await query<RowDataPacket[]>(
    `SELECT COUNT(*) AS cnt FROM used_docnos WHERE docNo LIKE 'QT%' AND createdAt >= ? AND createdAt < ?`,
    [curStart, curEnd]
  );
  const [prevQuot] = await query<RowDataPacket[]>(
    `SELECT COUNT(*) AS cnt FROM used_docnos WHERE docNo LIKE 'QT%' AND createdAt >= ? AND createdAt < ?`,
    [prevStart, prevEnd]
  );
  // Expiring warranties (≤30 days) — Bangkok calendar date, not the server's
  // own (UTC on Vercel), or this window is off by up to a day for 7 hours
  // every day.
  const now = new Date();
  const thirtyDaysLater = bangkokDateString(
    new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
  );
  const today = bangkokDateString(now);
  const [expWarranty] = await query<RowDataPacket[]>(
    `SELECT COUNT(*) AS cnt FROM customer_equipments
     WHERE warrantyEndDate IS NOT NULL AND warrantyEndDate >= ? AND warrantyEndDate <= ?
       AND status = 'Active'`,
    [today, thirtyDaysLater]
  );

  const curRevenue = Number(curRows[0]?.revenue || 0);
  const curCost = Number(curRows[0]?.cost || 0);
  const curExp = Number(curExpRows[0]?.expenses || 0);
  const totalCurCost = curCost + curExp;

  const prevRevenue = Number(prevRows[0]?.revenue || 0);
  const prevCostVal = Number(prevRows[0]?.cost || 0);
  const prevExp = Number(prevExpRows[0]?.expenses || 0);
  const totalPrevCost = prevCostVal + prevExp;

  return {
    currentPeriod: {
      revenue: curRevenue,
      deals: Number(curRows[0]?.deals || 0),
      newCustomers: Number(curCust[0]?.cnt || 0),
      quotations: Number(curQuot[0]?.cnt || 0),
      cost: totalCurCost,
      profit: curRevenue - totalCurCost,
    },
    previousPeriod: {
      revenue: prevRevenue,
      deals: Number(prevRows[0]?.deals || 0),
      newCustomers: Number(prevCust[0]?.cnt || 0),
      quotations: Number(prevQuot[0]?.cnt || 0),
      cost: totalPrevCost,
      profit: prevRevenue - totalPrevCost,
    },
    expiringWarranties: Number(expWarranty[0]?.cnt || 0),
  };
}

type RevenuePeriodGranularity = "month" | "day" | "quarter";

// The SQL period expressions differ only in how the date is formatted; the
// surrounding query (table, WHERE, GROUP BY) is otherwise identical across
// month/day/quarter, so only this piece needs to vary per granularity.
const REVENUE_PERIOD_SQL: Record<RevenuePeriodGranularity, { sales: string; expense: string }> = {
  month: { sales: "DATE_FORMAT(saleDate, '%Y-%m')", expense: "DATE_FORMAT(expenseDate, '%Y-%m')" },
  day: { sales: "DATE_FORMAT(saleDate, '%Y-%m-%d')", expense: "DATE_FORMAT(expenseDate, '%Y-%m-%d')" },
  quarter: {
    sales: "CONCAT(YEAR(saleDate), '-Q', QUARTER(saleDate))",
    expense: "CONCAT(YEAR(expenseDate), '-Q', QUARTER(expenseDate))",
  },
};

function revenuePeriodKey(granularity: RevenuePeriodGranularity, d: Date): string {
  const y = d.getFullYear();
  if (granularity === "month") return `${y}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  if (granularity === "day") {
    return `${y}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  return `${y}-Q${Math.floor(d.getMonth() / 3) + 1}`;
}

/** Mutates `d` forward to the start of the next period for `granularity`. */
function advanceRevenuePeriod(granularity: RevenuePeriodGranularity, d: Date): void {
  if (granularity === "month") d.setMonth(d.getMonth() + 1);
  else if (granularity === "day") d.setDate(d.getDate() + 1);
  else d.setMonth(d.getMonth() + 3);
}

function buildRevenuePeriodRow(
  period: string,
  salesRow: RowDataPacket | undefined,
  expenseRow: RowDataPacket | undefined
): RevenueByPeriod {
  const revenue = Number(salesRow?.revenue || 0);
  const cost = Number(salesRow?.cost || 0);
  const rawExpense = Number(expenseRow?.expenses || 0);
  const profit = revenue - cost - rawExpense;
  return {
    period,
    revenue,
    deals: Number(salesRow?.deals || 0),
    cost,
    // The dashboard chart's "รายจ่าย" series is meant to read as total
    // company outflow (matching the "ต้นทุนและรายจ่ายรวม" figure on the
    // overview card and the combined total shown on the Expenses page),
    // so it includes sales_records.costAmount here too — profit above is
    // still derived from the raw cost/expense values so nothing is
    // double-counted.
    expense: cost + rawExpense,
    profit,
    margin: revenue > 0 ? Math.round((profit / revenue) * 10000) / 100 : 0,
  };
}

async function getRevenueByPeriod(
  granularity: RevenuePeriodGranularity,
  dateFromRaw: string,
  dateToRaw: string
): Promise<RevenueByPeriod[]> {
  const periodSql = REVENUE_PERIOD_SQL[granularity];
  const params: unknown[] = [dateFromRaw, dateToRaw];
  const [rows] = await query<RowDataPacket[]>(
    `SELECT ${periodSql.sales} AS period,
            COALESCE(SUM(totalAmount), 0) AS revenue,
            COALESCE(SUM(costAmount), 0) AS cost,
            COUNT(*) AS deals
     FROM sales_records
     WHERE saleDate >= ? AND saleDate < ?
     GROUP BY period ORDER BY period`,
    params
  );

  const [expRows] = await query<RowDataPacket[]>(
    `SELECT ${periodSql.expense} AS period,
            COALESCE(SUM(amount), 0) AS expenses
     FROM expenses
     WHERE expenseDate >= ? AND expenseDate < ?
     GROUP BY period ORDER BY period`,
    params
  );

  const map = new Map(rows.map((r) => [r.period, r]));
  const expMap = new Map(expRows.map((r) => [r.period, r]));

  const start = new Date(dateFromRaw + "T00:00:00");
  const end = new Date(dateToRaw + "T00:00:00");
  const result: RevenueByPeriod[] = [];
  const seen = new Set<string>(); // a period can't recur with these fixed steps, but guard anyway
  let d = new Date(start);
  while (d < end) {
    const period = revenuePeriodKey(granularity, d);
    if (!seen.has(period)) {
      seen.add(period);
      result.push(buildRevenuePeriodRow(period, map.get(period), expMap.get(period)));
    }
    advanceRevenuePeriod(granularity, d);
  }
  return result;
}

export async function getRevenueByMonth(dateFromRaw: string, dateToRaw: string): Promise<RevenueByPeriod[]> {
  return getRevenueByPeriod("month", dateFromRaw, dateToRaw);
}

export async function getRevenueByDay(dateFromRaw: string, dateToRaw: string): Promise<RevenueByPeriod[]> {
  return getRevenueByPeriod("day", dateFromRaw, dateToRaw);
}

export async function getRevenueByQuarter(dateFromRaw: string, dateToRaw: string): Promise<RevenueByPeriod[]> {
  return getRevenueByPeriod("quarter", dateFromRaw, dateToRaw);
}

/** Same rounding-to-2-decimals percentage calc used by every leaderboard/breakdown below. */
function percentageOf(value: number, total: number): number {
  return total > 0 ? Math.round((value / total) * 10000) / 100 : 0;
}

/**
 * WHERE clause + params for an optional [dateFromRaw, dateToRaw] range on
 * `dateColumn` — callers pass the exact column reference (aliased or not) so
 * the generated SQL text is unchanged from before this was extracted.
 */
function buildSaleDateRangeWhere(
  dateColumn: string,
  dateFromRaw?: string,
  dateToRaw?: string
): { clause: string; params: unknown[] } {
  const where: string[] = [];
  const params: unknown[] = [];
  const dateFrom = cleanDate(dateFromRaw);
  const dateTo = cleanDate(dateToRaw);
  if (dateFrom) { where.push(`${dateColumn} >= ?`); params.push(dateFrom); }
  if (dateTo) { where.push(`${dateColumn} <= ?`); params.push(dateTo); }
  return { clause: where.length > 0 ? `WHERE ${where.join(" AND ")}` : "", params };
}

/**
 * Revenue split by product category, grouped from LINE ITEMS — a bill with
 * three products in two categories now credits each category its own share
 * instead of dumping the whole bill on the sale's single scalar categoryId.
 *
 * Every join is a LEFT JOIN and the bucket fallbacks are unchanged
 * (`id` "unknown" / `name` "ไม่ระบุหมวด"): a line with no category, or one
 * pointing at a deleted category, must still be counted, or the report total
 * stops matching SUM(sales_records.totalAmount) for the same window. The date filter
 * stays on the PARENT sale's saleDate, exactly as before.
 *
 * After the v33 backfill each historical sale has exactly one line item
 * carrying its own scalar values, so every historical figure here is
 * byte-for-byte what the old sales_records-level query returned — including
 * `deals`, since COUNT(DISTINCT salesRecordId) over one-line-per-sale data
 * equals the old COUNT(*).
 */
export async function getRevenueByCategory(
  dateFromRaw?: string,
  dateToRaw?: string
): Promise<TopItem[]> {
  const { clause, params } = buildSaleDateRangeWhere("sr.saleDate", dateFromRaw, dateToRaw);
  const [rows] = await query<RowDataPacket[]>(
    `SELECT sri.categoryId AS id,
            COALESCE(pc.name_th, 'ไม่ระบุหมวด') AS name,
            COALESCE(SUM(sri.totalAmount), 0) AS revenue,
            COALESCE(SUM(sri.qty), 0) AS qty,
            COUNT(DISTINCT sri.salesRecordId) AS deals
     FROM sales_record_items sri
     LEFT JOIN sales_records sr ON sri.salesRecordId = sr.id
     LEFT JOIN product_categories pc ON sri.categoryId = pc.id
     ${clause}
     GROUP BY sri.categoryId, pc.name_th
     ORDER BY revenue DESC`,
    params
  );
  const totalRev = rows.reduce((s, r) => s + Number(r.revenue), 0);
  return rows.map((r) => ({
    id: String(r.id ?? "unknown"),
    name: r.name,
    revenue: Number(r.revenue),
    qty: Number(r.qty),
    deals: Number(r.deals),
    percentage: percentageOf(Number(r.revenue), totalRev),
  }));
}

/**
 * Best sellers, grouped from LINE ITEMS (see getRevenueByCategory for the
 * bucket/date-filter/backfill reasoning — the bucket fallbacks here are the
 * untouched `id` "unspecified" / `name` "ไม่ระบุสินค้า").
 *
 * `deals` is COUNT(DISTINCT salesRecordId): one bill is one deal for that
 * product, never one deal per line.
 */
export async function getTopProducts(
  limit = 10,
  dateFromRaw?: string,
  dateToRaw?: string
): Promise<TopItem[]> {
  const safeLimit = Math.max(1, Math.min(100, Math.round(Number(limit) || 10)));
  const { clause, params } = buildSaleDateRangeWhere("sr.saleDate", dateFromRaw, dateToRaw);
  const [rows] = await query<RowDataPacket[]>(
    `SELECT sri.productId AS id, sri.productName AS name,
            COALESCE(SUM(sri.totalAmount), 0) AS revenue,
            COALESCE(SUM(sri.qty), 0) AS qty,
            COUNT(DISTINCT sri.salesRecordId) AS deals
     FROM sales_record_items sri
     LEFT JOIN sales_records sr ON sri.salesRecordId = sr.id
     ${clause}
     GROUP BY sri.productId, sri.productName
     ORDER BY revenue DESC LIMIT ?`,
    [...params, safeLimit]
  );
  const totalRev = rows.reduce((s, r) => s + Number(r.revenue), 0);
  return rows.map((r) => ({
    id: String(r.id || "unspecified"),
    name: r.name || "ไม่ระบุสินค้า",
    revenue: Number(r.revenue),
    qty: Number(r.qty),
    deals: Number(r.deals),
    percentage: percentageOf(Number(r.revenue), totalRev),
  }));
}

export async function getTopCustomers(
  limit = 10,
  dateFromRaw?: string,
  dateToRaw?: string
): Promise<TopItem[]> {
  const safeLimit = Math.max(1, Math.min(100, Math.round(Number(limit) || 10)));
  const { clause, params } = buildSaleDateRangeWhere("sr.saleDate", dateFromRaw, dateToRaw);
  const [rows] = await query<RowDataPacket[]>(
    `SELECT sr.companyId AS id,
            COALESCE(co.name, 'ไม่ระบุ') AS name,
            COALESCE(SUM(sr.totalAmount), 0) AS revenue,
            COALESCE(SUM(sr.qty), 0) AS qty,
            COUNT(*) AS deals
     FROM sales_records sr
     LEFT JOIN companies co ON sr.companyId = co.id
     ${clause}
     GROUP BY sr.companyId, co.name
     ORDER BY revenue DESC LIMIT ?`,
    [...params, safeLimit]
  );
  const totalRev = rows.reduce((s, r) => s + Number(r.revenue), 0);
  return rows.map((r) => ({
    id: String(r.id || "unspecified"),
    name: r.name || "ไม่ระบุ",
    revenue: Number(r.revenue),
    qty: Number(r.qty),
    deals: Number(r.deals),
    percentage: percentageOf(Number(r.revenue), totalRev),
  }));
}

export async function getSalespersonLeaderboard(
  dateFromRaw?: string,
  dateToRaw?: string
): Promise<SalespersonStats[]> {
  const { clause, params } = buildSaleDateRangeWhere("sr.saleDate", dateFromRaw, dateToRaw);
  const [rows] = await query<RowDataPacket[]>(
    `SELECT sr.salespersonId AS id,
            COALESCE(sp.name, sr.salespersonId) AS name,
            COALESCE(SUM(sr.totalAmount), 0) AS revenue,
            COALESCE(SUM(sr.costAmount), 0) AS cost,
            COUNT(*) AS deals
     FROM sales_records sr
     LEFT JOIN salespeople sp ON sr.salespersonId = sp.id
     ${clause}
     GROUP BY sr.salespersonId, sp.name
     ORDER BY revenue DESC`,
    params
  );
  const totalRev = rows.reduce((s, r) => s + Number(r.revenue), 0);
  return rows.map((r) => ({
    id: String(r.id || "unspecified"),
    name: (r.name && String(r.name).trim()) || "ไม่ระบุเซลล์",
    revenue: Number(r.revenue),
    deals: Number(r.deals),
    percentage: percentageOf(Number(r.revenue), totalRev),
    avgDealSize: Number(r.deals) > 0 ? Math.round(Number(r.revenue) / Number(r.deals)) : 0,
  }));
}

// ── Smart Insights (rule-based) ──────────────────────────────────────────────

export async function getSmartInsights(
  curStart: string,
  curEnd: string,
  prevStart: string,
  prevEnd: string,
  periodLabel: string
): Promise<SmartInsight[]> {
  const insights: SmartInsight[] = [];
  const now = new Date();
  
  const [curRev] = await query<RowDataPacket[]>(
    `SELECT COALESCE(SUM(totalAmount), 0) AS rev FROM sales_records WHERE saleDate >= ? AND saleDate < ?`,
    [curStart, curEnd]
  );
  const [prevRev] = await query<RowDataPacket[]>(
    `SELECT COALESCE(SUM(totalAmount), 0) AS rev FROM sales_records WHERE saleDate >= ? AND saleDate < ?`,
    [prevStart, prevEnd]
  );
  const cur = Number(curRev[0]?.rev || 0);
  const prev = Number(prevRev[0]?.rev || 0);
  if (prev > 0) {
    const pctChange = Math.round(((cur - prev) / prev) * 100);
    if (pctChange > 0) {
      insights.push({
        type: "positive", icon: "📈",
        title: `ยอดขาย${periodLabel}เพิ่มขึ้น ${pctChange}%`,
        description: `เทียบกับช่วงก่อนหน้า (${prev.toLocaleString()} → ${cur.toLocaleString()} บาท)`,
      });
    } else if (pctChange < -10) {
      insights.push({
        type: "warning", icon: "📉",
        title: `ยอดขายเดือนนี้ลดลง ${Math.abs(pctChange)}%`,
        description: `เทียบกับเดือนก่อน — อาจต้องเพิ่มกิจกรรม push sales`,
      });
    }
  } else if (prev === 0 && cur > 0) {
    insights.push({
      type: "positive", icon: "📈",
      title: `ยอดขายเดือนนี้ ${cur.toLocaleString()} บาท`,
      description: "เริ่มต้นมียอดขายในเดือนนี้ (เดือนก่อนหน้าไม่มียอดขาย)",
    });
  }

  // Bangkok calendar date/month, not the server's own (UTC on Vercel) — see
  // getDashboardOverview/getPeriodDateRange for the same reasoning.
  const { year, month } = bangkokParts(now);

  // 2. Customers with no purchase in 6+ months
  const sixMonthsDate = new Date(year, month - 6, 1);
  const sixMonthsAgo = `${sixMonthsDate.getFullYear()}-${String(sixMonthsDate.getMonth() + 1).padStart(2, "0")}-01`;
  const [dormant] = await query<RowDataPacket[]>(
    `SELECT COUNT(DISTINCT companyId) AS cnt FROM sales_records
     WHERE companyId IS NOT NULL AND companyId != '' AND companyId NOT IN (
       SELECT DISTINCT companyId FROM sales_records WHERE saleDate >= ? AND companyId IS NOT NULL AND companyId != ''
     )`,
    [sixMonthsAgo]
  );
  const dormantCount = Number(dormant[0]?.cnt || 0);
  if (dormantCount > 0) {
    insights.push({
      type: "warning", icon: "⏰",
      title: `${dormantCount} ลูกค้าไม่ได้ซื้อมา 6+ เดือน`,
      description: "ควร follow up เพื่อรักษาความสัมพันธ์และเสนอขายเพิ่ม",
    });
  }

  // 3. Top selling category this month
  const [topCat] = await query<RowDataPacket[]>(
    `SELECT COALESCE(pc.name_th, 'ไม่ระบุ') AS name,
            COALESCE(SUM(sr.totalAmount), 0) AS rev
     FROM sales_records sr
     LEFT JOIN product_categories pc ON sr.categoryId = pc.id
     WHERE sr.saleDate >= ? AND sr.saleDate < ?
     GROUP BY sr.categoryId, pc.name_th
     ORDER BY rev DESC LIMIT 1`,
    [curStart, curEnd]
  );
  if (topCat[0]?.name && Number(topCat[0]?.rev) > 0) {
    insights.push({
      type: "info", icon: "🏆",
      title: `หมวด "${topCat[0].name}" ขายดีสุดเดือนนี้`,
      description: `ยอดรวม ${Number(topCat[0].rev).toLocaleString()} บาท`,
    });
  }

  // 4. Repeat customers rate (exclude unlinked empty companies)
  const [repeatData] = await query<RowDataPacket[]>(
    `SELECT
       COUNT(DISTINCT companyId) AS total,
       SUM(CASE WHEN cnt >= 2 THEN 1 ELSE 0 END) AS repeaters
     FROM (
       SELECT companyId, COUNT(*) AS cnt FROM sales_records
       WHERE companyId IS NOT NULL AND companyId != ''
       GROUP BY companyId
     ) sub`
  );
  const totalCustomers = Number(repeatData[0]?.total || 0);
  const repeatCustomers = Number(repeatData[0]?.repeaters || 0);
  if (totalCustomers > 0) {
    const repeatRate = Math.round((repeatCustomers / totalCustomers) * 100);
    insights.push({
      type: repeatRate >= 30 ? "positive" : "opportunity",
      icon: repeatRate >= 30 ? "🔄" : "💡",
      title: `Repeat Customer Rate: ${repeatRate}%`,
      description: `${repeatCustomers} จาก ${totalCustomers} บริษัทซื้อซ้ำ ≥ 2 ครั้ง`,
    });
  }

  // 5. Expiring warranties
  const thirtyDaysLater = bangkokDateString(
    new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
  );
  const today = bangkokDateString(now);
  const [expiring] = await query<RowDataPacket[]>(
    `SELECT COUNT(*) AS cnt FROM customer_equipments
     WHERE warrantyEndDate IS NOT NULL AND warrantyEndDate >= ? AND warrantyEndDate <= ?
       AND status = 'Active'`,
    [today, thirtyDaysLater]
  );
  if (Number(expiring[0]?.cnt) > 0) {
    insights.push({
      type: "warning", icon: "🔔",
      title: `${expiring[0].cnt} เครื่องประกันจะหมดใน 30 วัน`,
      description: "โอกาสเสนอขาย extended warranty หรือ service contract",
    });
  }

  return insights;
}

// ── Cost Item CRUD ───────────────────────────────────────────────────────────
//
// WHERE THE MONEY LIVES
//
//   ต้นทุนสินค้า (product cost)   → sales_record_items.costAmount
//   ค่ารถ / ค่าคอม / ฯลฯ         → sale_cost_items (costType <> 'product_cost')
//
// `sale_cost_items` rows with costType 'product_cost' are LEGACY history only:
// the v33 backfill already copied their money onto the sale's line item, so
// COST_AMOUNT_SUM_SQL excludes them and nothing below ever creates a new one.
//
// Because that money is stored in one place and only one place, every read and
// every write below goes through the SAME place:
//
//   - `getCostItems` presents the line items' product cost as ONE synthetic
//     `product_cost` entry and HIDES the legacy rows, so the cost calculator
//     always shows the number that is actually counted;
//   - `syncCostItems` treats the submitted sheet as authoritative and writes an
//     ABSOLUTE product cost onto the line;
//   - the single-item endpoints address that same synthetic entry by id.
//
// The one thing none of them do is relative arithmetic (`costAmount + delta`).
// A delta needs a baseline, the baseline has to be read before the write, and
// nothing re-derives the line from the rows afterwards — so any lost, doubled
// or interleaved delta (two admin tabs, or a `withTransaction` retry after a
// commit whose ack was lost) drifts the stored cost permanently. Absolute
// writes plus a re-derived total are idempotent and converge instead.

const VALID_COST_TYPES = new Set([
  "product_cost", "transport", "shipping", "service_visit",
  "repair", "commission", "other",
]);

/**
 * costType values that live UIs send but that are not (and never were) stored
 * types. `SalesRecordEditModal` offers "product" for 📦 ต้นทุนค่าสินค้า and
 * "labor" for 👷 ค่าแรง/ค่าบริการ.
 *
 * Without this map `cleanCostInput` would fall through to its "other" default,
 * which is a BILL-LEVEL type that COST_AMOUNT_SUM_SQL counts — so a legacy
 * sale's ต้นทุนสินค้า would be counted twice: once on the line item and once
 * again as an "other" row. Mapping them to the real types keeps one baht in
 * one bucket.
 */
const COST_TYPE_ALIASES: Record<string, string> = {
  product: "product_cost",
  labor: "service_visit",
};

function normalizeCostType(raw: string | undefined): string {
  const t = COST_TYPE_ALIASES[raw || ""] || raw || "";
  return VALID_COST_TYPES.has(t) ? t : "other";
}

function cleanCostInput(data: Partial<CostItem>) {
  return {
    costType: normalizeCostType(data.costType),
    label: sanitizePlainText(data.label || "").substring(0, 255),
    amount: Math.max(0, Math.min(9999999999.99, Number(data.amount) || 0)),
    note: sanitizePlainText(data.note || "").substring(0, 5000),
  };
}

/**
 * Sum the sale's true total cost (see COST_AMOUNT_SUM_SQL) and write it back.
 * Caller must already hold the sale row's lock.
 */
async function sumAndWriteCostAmount(
  conn: TxConnection,
  salesRecordId: string
): Promise<number> {
  const [rows] = (await conn.query(COST_AMOUNT_SUM_SQL, [
    salesRecordId,
    salesRecordId,
  ])) as [RowDataPacket[], unknown];
  const total = round2(Number(rows[0]?.total || 0));
  await conn.query(
    `UPDATE sales_records SET costAmount = ? WHERE id = ?`,
    [total, salesRecordId]
  );
  return total;
}

// ── The sale's product cost, as ONE addressable bucket ───────────────────────

/**
 * The id `getCostItems` gives the synthetic ต้นทุนสินค้า entry. It is derived
 * from the sale id (never stored), so it is stable across reloads and cannot
 * collide with a `sale_cost_items` UUID.
 */
const PRODUCT_COST_ID_PREFIX = "product-cost:";

function productCostItemId(salesRecordId: string): string {
  return `${PRODUCT_COST_ID_PREFIX}${salesRecordId}`;
}

/** The sale id an id from `productCostItemId` refers to, or null. */
function saleIdOfProductCostItem(id: string): string | null {
  return id.startsWith(PRODUCT_COST_ID_PREFIX)
    ? id.slice(PRODUCT_COST_ID_PREFIX.length) || null
    : null;
}

const SELECT_LINES_SQL = `SELECT id, costAmount FROM sales_record_items
     WHERE salesRecordId = ? ORDER BY sortOrder ASC, createdAt ASC`;

async function readLines(
  conn: TxConnection,
  salesRecordId: string
): Promise<{ id: string; costAmount: number }[]> {
  const [rows] = (await conn.query(SELECT_LINES_SQL, [salesRecordId])) as [
    RowDataPacket[],
    unknown,
  ];
  return (Array.isArray(rows) ? rows : []).map((r) => ({
    id: String(r.id),
    costAmount: Number(r.costAmount || 0),
  }));
}

/** Refuses a bill-level write of ต้นทุนสินค้า; the caller is told where it goes. */
export class ProductCostIsPerLineError extends Error {
  constructor() {
    super(
      "ต้นทุนสินค้าเก็บที่รายการสินค้า ไม่ใช่ค่าใช้จ่ายระดับใบขาย — แก้ที่รายการต้นทุนสินค้าของใบขายนี้"
    );
    this.name = "ProductCostIsPerLineError";
  }
}

/**
 * Thrown when a bill-level ต้นทุนสินค้า cannot be attributed to a line. Loud on
 * purpose: the alternative is guessing a per-line split nobody typed, or
 * dropping the amount on the floor.
 */
export class ProductCostNotAttributableError extends Error {
  constructor() {
    super(
      "ใบขายนี้มีสินค้าหลายรายการ — ต้นทุนสินค้าต้องแก้ที่แต่ละรายการ ไม่ใช่ที่ค่าใช้จ่ายรวมของใบขาย"
    );
    this.name = "ProductCostNotAttributableError";
  }
}

/**
 * Write the sale's product cost — an ABSOLUTE amount, never a delta — onto the
 * line item that owns it, under the caller's lock and on the caller's
 * transaction connection.
 *
 *  - exactly ONE line  → that line carries the whole product cost (the legacy
 *    shape, and the shape every v33-backfilled sale has);
 *  - ZERO lines        → self-heal by inserting one line mirroring the sale's
 *    scalars (a sale written through the legacy `addSalesRecord` path, or one
 *    created before the backfill ran), then write to it. `sale` is needed for
 *    that; pass null to skip healing;
 *  - MORE THAN ONE     → per-line costs are owned by the lines. An UNCHANGED
 *    amount (the round trip of what `getCostItems` reported) is a no-op;
 *    anything else throws, because splitting a single bill-level number across
 *    lines would invent per-line figures and silently ignoring it would throw
 *    the user's money away.
 */
async function writeProductCost(
  conn: TxConnection,
  salesRecordId: string,
  amount: number,
  sale: ReturnType<typeof cleanInput> | null
): Promise<void> {
  const target = Math.max(0, round2(amount));
  let lines = await readLines(conn, salesRecordId);

  if (lines.length > 1) {
    const current = round2(lines.reduce((s, l) => s + l.costAmount, 0));
    if (current !== target) throw new ProductCostNotAttributableError();
    return;
  }

  if (lines.length === 0) {
    if (!sale) {
      if (target === 0) return;
      throw new ProductCostNotAttributableError();
    }
    const totalAmount =
      sale.totalAmount > 0 ? sale.totalAmount : sale.qty * sale.unitPrice;
    await syncSingleLineItemToScalars(conn, salesRecordId, sale, totalAmount);
    lines = await readLines(conn, salesRecordId);
    if (lines.length !== 1) throw new ProductCostNotAttributableError();
  }

  await conn.query(
    `UPDATE sales_record_items SET costAmount = ? WHERE id = ?`,
    [target, lines[0].id]
  );
}

/**
 * Lock the sale, set its product cost to an absolute amount, re-derive
 * costAmount from the persisted rows. Idempotent — running it twice with the
 * same amount leaves the same numbers — so `withTransaction`'s retry (which
 * can re-run a body whose commit was already durable but whose ack was lost)
 * is safe, and two concurrent edits converge on whichever ran last instead of
 * stacking their deltas.
 */
async function setProductCost(
  salesRecordId: string,
  amount: number
): Promise<number> {
  const record = await getSalesRecord(salesRecordId);
  const sale = record ? cleanInput(record) : null;
  return withTransaction(async (conn) => {
    await conn.query(LOCK_SALE_SQL, [salesRecordId]);
    await writeProductCost(conn, salesRecordId, amount, sale);
    return sumAndWriteCostAmount(conn, salesRecordId);
  });
}

/**
 * Recalculate the cached costAmount on sales_records: the per-line product
 * cost on `sales_record_items` plus every bill-level cost item that is not a
 * legacy `product_cost` row (see COST_AMOUNT_SUM_SQL for why that type is
 * excluded rather than deleted).
 *
 * Locks the sale's row (SELECT ... FOR UPDATE) before summing+writing, inside
 * one transaction — without this, two concurrent cost-item edits on the SAME
 * sale (e.g. two admin tabs) could each read the sum BEFORE the other's item
 * was inserted, then write back in reverse-completion order, leaving
 * costAmount permanently out of sync with the true sum (and every
 * profit/margin figure that reads costAmount along with it). The lock forces
 * concurrent recalcs to serialize, so whichever finishes last always re-reads
 * the CURRENT total rather than a stale pre-race snapshot.
 */
export async function recalcCostAmount(salesRecordId: string): Promise<number> {
  return withTransaction(async (conn) => {
    await conn.query(LOCK_SALE_SQL, [salesRecordId]);
    return sumAndWriteCostAmount(conn, salesRecordId);
  });
}

/**
 * The sale's cost sheet, as the cost calculator should show it: every
 * bill-level cost item, plus ONE synthetic ต้นทุนสินค้า entry carrying the
 * product cost that `COST_AMOUNT_SUM_SQL` actually counts —
 * `SUM(sales_record_items.costAmount)`.
 *
 * Legacy `product_cost` rows are deliberately NOT returned. They still exist
 * (cost history is never auto-deleted) but they are excluded from the total,
 * and a form that reloaded one would re-submit a number nobody is counting —
 * silently reverting the last correction on the very next save. What is shown
 * here is exactly what is counted, so GET → save → GET is a fixed point.
 */
export async function getCostItems(salesRecordId: string): Promise<CostItem[]> {
  const [rows] = await query<RowDataPacket[]>(
    `SELECT * FROM sale_cost_items
      WHERE salesRecordId = ? AND costType <> 'product_cost'
      ORDER BY createdAt ASC`,
    [salesRecordId]
  );
  const [lineRows] = await query<RowDataPacket[]>(
    `SELECT COALESCE(SUM(costAmount), 0) AS productCost, MIN(createdAt) AS createdAt
       FROM sales_record_items WHERE salesRecordId = ?`,
    [salesRecordId]
  );
  const productCost = round2(Number(lineRows?.[0]?.productCost || 0));
  const items = (rows as CostItem[]) || [];
  if (productCost <= 0) return items;
  return [
    {
      id: productCostItemId(salesRecordId),
      salesRecordId,
      costType: "product_cost",
      label: COST_TYPE_LABELS.product_cost,
      amount: productCost,
      note: "",
      createdAt: String(lineRows?.[0]?.createdAt || ""),
    },
    ...items,
  ];
}

/**
 * Add one BILL-LEVEL cost item (ค่ารถ / ค่าคอม / ฯลฯ).
 *
 * ต้นทุนสินค้า is refused rather than stored: it belongs to a line item, a
 * sale has exactly one product-cost bucket already (the synthetic entry
 * `getCostItems` returns), and "add 12,000 to it" is not an operation that can
 * be retried safely — a `withTransaction` retry after a lost commit ack would
 * add it twice. Callers set it with PUT on that entry's id, or through
 * `syncCostItems`.
 */
export async function addCostItem(
  salesRecordId: string,
  data: Partial<CostItem>
): Promise<CostItem> {
  const v = cleanCostInput(data);
  if (v.costType === "product_cost") {
    throw new ProductCostIsPerLineError();
  }
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await query(
    `INSERT INTO sale_cost_items (id, salesRecordId, costType, label, amount, note, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, salesRecordId, v.costType, v.label, v.amount, v.note, now]
  );
  await recalcCostAmount(salesRecordId);
  const [rows] = await query<RowDataPacket[]>(
    `SELECT * FROM sale_cost_items WHERE id = ?`,
    [id]
  );
  return rows[0] as CostItem;
}

/**
 * Update ONE cost item.
 *
 * The synthetic ต้นทุนสินค้า entry is a real target: PUT on its id writes the
 * new amount straight onto the sale's line item. An absolute SET, so the
 * result of two concurrent edits is one of the two amounts — never their sum.
 */
export async function updateCostItem(
  id: string,
  data: Partial<CostItem>
): Promise<CostItem | null> {
  const productCostSaleId = saleIdOfProductCostItem(id);
  if (productCostSaleId) {
    if (data.costType !== undefined && normalizeCostType(data.costType) !== "product_cost") {
      throw new ProductCostIsPerLineError();
    }
    const amount = Math.max(0, Math.min(9999999999.99, Number(data.amount) || 0));
    await setProductCost(productCostSaleId, amount);
    const items = await getCostItems(productCostSaleId);
    return items.find((i) => i.id === id) || null;
  }

  const [existing] = await query<RowDataPacket[]>(
    `SELECT * FROM sale_cost_items WHERE id = ?`,
    [id]
  );
  if (!existing[0]) return null;
  const v = cleanCostInput({ ...existing[0], ...data });
  // A bill-level row cannot be turned INTO product cost: that money would have
  // to move onto a line item, and this endpoint has no line to move it to.
  if (v.costType === "product_cost" && existing[0].costType !== "product_cost") {
    throw new ProductCostIsPerLineError();
  }
  await query(
    `UPDATE sale_cost_items SET costType = ?, label = ?, amount = ?, note = ? WHERE id = ?`,
    [v.costType, v.label, v.amount, v.note, id]
  );
  await recalcCostAmount(existing[0].salesRecordId);
  const [rows] = await query<RowDataPacket[]>(
    `SELECT * FROM sale_cost_items WHERE id = ?`,
    [id]
  );
  return rows[0] as CostItem;
}

/**
 * Delete ONE cost item.
 *
 * Deleting the synthetic ต้นทุนสินค้า entry clears the sale's per-line product
 * cost to 0 — the only way to say "this sale has no product cost", and the
 * reason the amount is not a one-way ratchet.
 *
 * Deleting a LEGACY `product_cost` row moves the total by nothing, because
 * COST_AMOUNT_SUM_SQL never counted it: its money sits on the line item and
 * stays there. Taking that amount off the line instead would destroy live
 * product cost the row does not own.
 */
export async function deleteCostItem(id: string): Promise<boolean> {
  const productCostSaleId = saleIdOfProductCostItem(id);
  if (productCostSaleId) {
    await setProductCost(productCostSaleId, 0);
    return true;
  }

  const [existing] = await query<RowDataPacket[]>(
    `SELECT salesRecordId, costType, amount FROM sale_cost_items WHERE id = ?`,
    [id]
  );
  const [res] = await query<ResultSetHeader>(
    `DELETE FROM sale_cost_items WHERE id = ?`,
    [id]
  );
  if (res.affectedRows > 0 && existing[0]) {
    await recalcCostAmount(existing[0].salesRecordId);
  }
  return res.affectedRows > 0;
}

/**
 * Replace a sale's cost sheet — the whole thing, exactly as submitted.
 *
 * The bill-level rows (ค่ารถ / ค่าคอม / ฯลฯ) are deleted and re-inserted from
 * the payload. The submitted ต้นทุนสินค้า rows are SUMMED and that total is
 * written onto the sale's line item, which is where COST_AMOUNT_SUM_SQL reads
 * product cost from. Nothing the user typed is discarded and nothing is
 * counted twice: the amount lands in exactly one place.
 *
 * The payload is AUTHORITATIVE, including its silences — a sheet with no
 * ต้นทุนสินค้า row sets the product cost to 0. That is safe because
 * `getCostItems` reports the stored product cost as a row of that sheet, so a
 * form that loaded the sale sends it back; a sheet without one is a sheet the
 * user emptied on purpose. It is also what makes the amount correctable
 * downwards and clearable at all — a "only ever raise it" rule would pin every
 * sale to its first-ever number.
 *
 * Legacy `product_cost` rows in `sale_cost_items` are left where they are (cost
 * history is never deleted automatically) and are neither summed nor returned
 * by `getCostItems`, so they cannot revert a correction.
 */
export async function syncCostItems(
  salesRecordId: string,
  items: Partial<CostItem>[]
): Promise<CostItem[]> {
  const existing = await getSalesRecord(salesRecordId);
  if (!existing) return [];
  const sale = cleanInput(existing);

  return await withTransaction(async (conn) => {
    // Lock first (same reasoning as recalcCostAmount) so a concurrent edit on
    // this sale cannot interleave its delete/insert with ours.
    await conn.query(LOCK_SALE_SQL, [salesRecordId]);

    await conn.query(
      `DELETE FROM sale_cost_items WHERE salesRecordId = ? AND costType <> 'product_cost'`,
      [salesRecordId]
    );

    const insertedItems: CostItem[] = [];
    let submittedProductCost = 0;
    for (const item of items) {
      if (!(Number(item.amount) > 0)) continue;
      const v = cleanCostInput(item);
      if (v.costType === "product_cost") {
        // Bridged onto the line item below instead of being stored here — one
        // sale has one product cost, so the submitted rows are summed.
        submittedProductCost = round2(submittedProductCost + v.amount);
        continue;
      }
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      await conn.query(
        `INSERT INTO sale_cost_items (id, salesRecordId, costType, label, amount, note, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, salesRecordId, v.costType, v.label, v.amount, v.note, now]
      );
      insertedItems.push({ id, salesRecordId, ...v, createdAt: now } as CostItem);
    }

    // Carry the submitted ต้นทุนสินค้า onto the sale's line item — same
    // transaction, still under the FOR UPDATE lock taken above. Throws rather
    // than guesses if the sale is a multi-line bill whose per-line costs this
    // single number would have to be split across.
    await writeProductCost(conn, salesRecordId, submittedProductCost, sale);

    // Re-derive costAmount from the persisted rows (line items + bill-level
    // costs) rather than from the loop's running total, so the sale's product
    // cost is never dropped by a cost-item edit.
    await sumAndWriteCostAmount(conn, salesRecordId);

    return insertedItems;
  });
}

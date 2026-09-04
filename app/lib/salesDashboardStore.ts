import "server-only";
import { query, withTransaction } from "./db";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { sanitizePlainText } from "./sanitizeHtml";
import { bangkokDateString, bangkokParts } from "./dateFormat";

// ── Types ────────────────────────────────────────────────────────────────────
import type { SalesRecord, CostItem } from "./types";



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

function cleanInput(data: Partial<SalesRecord>) {
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

export async function addSalesRecord(
  data: Partial<SalesRecord>
): Promise<SalesRecord> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const v = cleanInput(data);

  // Auto-populate product name and category if only productId is provided
  if (!v.productName && v.productId) {
    const [pRows] = await query<RowDataPacket[]>(
      "SELECT title_th, title_en, categoryId FROM products WHERE id = ?",
      [v.productId]
    );
    if (pRows[0]) {
      v.productName = sanitizePlainText(pRows[0].title_th || pRows[0].title_en || "").substring(0, 255);
      if (v.categoryId === null && typeof pRows[0].categoryId === "number") {
        v.categoryId = pRows[0].categoryId;
      }
    }
  }

  // Auto-compute totalAmount if not provided
  const totalAmount = v.totalAmount > 0 ? v.totalAmount : v.qty * v.unitPrice;
  await query(
    `INSERT INTO sales_records
       (id, salespersonId, customerId, companyId, productId, productName,
        categoryId, qty, unitPrice, totalAmount, costAmount, saleType, saleDate, quotationRef,
        poRef, deliveryRef, invoiceRef, receiptRef, warrantyStartDate, warrantyEndDate,
        equipmentId, note, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id, v.salespersonId, v.customerId, v.companyId, v.productId,
      v.productName, v.categoryId, v.qty, v.unitPrice, totalAmount,
      v.costAmount, v.saleType, v.saleDate, v.quotationRef,
      v.poRef, v.deliveryRef, v.invoiceRef, v.receiptRef, v.warrantyStartDate, v.warrantyEndDate,
      v.equipmentId, v.note, now,
    ]
  );
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
  data: Partial<SalesRecord>
): Promise<SalesRecord | null> {
  const existing = await getSalesRecord(id);
  if (!existing) return null;
  const v = cleanInput({ ...existing, ...data });
  const totalAmount = v.totalAmount > 0 ? v.totalAmount : v.qty * v.unitPrice;
  await query(
    `UPDATE sales_records SET
       salespersonId = ?, customerId = ?, companyId = ?, productId = ?,
       productName = ?, categoryId = ?, qty = ?, unitPrice = ?,
       totalAmount = ?, costAmount = ?, saleType = ?, saleDate = ?, quotationRef = ?,
       poRef = ?, deliveryRef = ?, invoiceRef = ?, receiptRef = ?, warrantyStartDate = ?, warrantyEndDate = ?,
       equipmentId = ?, note = ?
     WHERE id = ?`,
    [
      v.salespersonId, v.customerId, v.companyId, v.productId,
      v.productName, v.categoryId, v.qty, v.unitPrice, totalAmount,
      v.costAmount, v.saleType, v.saleDate, v.quotationRef,
      v.poRef, v.deliveryRef, v.invoiceRef, v.receiptRef, v.warrantyStartDate, v.warrantyEndDate,
      v.equipmentId, v.note, id,
    ]
  );
  return getSalesRecord(id);
}

export async function deleteSalesRecord(id: string): Promise<boolean> {
  const [res] = await query<ResultSetHeader>(
    "DELETE FROM sales_records WHERE id = ?",
    [id]
  );
  return res.affectedRows > 0;
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
  const expense = Number(expenseRow?.expenses || 0);
  const profit = revenue - cost - expense;
  return {
    period,
    revenue,
    deals: Number(salesRow?.deals || 0),
    cost,
    expense,
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

export async function getRevenueByCategory(
  dateFromRaw?: string,
  dateToRaw?: string
): Promise<TopItem[]> {
  const { clause, params } = buildSaleDateRangeWhere("sr.saleDate", dateFromRaw, dateToRaw);
  const [rows] = await query<RowDataPacket[]>(
    `SELECT sr.categoryId AS id,
            COALESCE(pc.name_th, 'ไม่ระบุหมวด') AS name,
            COALESCE(SUM(sr.totalAmount), 0) AS revenue,
            COALESCE(SUM(sr.qty), 0) AS qty,
            COUNT(*) AS deals
     FROM sales_records sr
     LEFT JOIN product_categories pc ON sr.categoryId = pc.id
     ${clause}
     GROUP BY sr.categoryId, pc.name_th
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

export async function getTopProducts(
  limit = 10,
  dateFromRaw?: string,
  dateToRaw?: string
): Promise<TopItem[]> {
  const safeLimit = Math.max(1, Math.min(100, Math.round(Number(limit) || 10)));
  const { clause, params } = buildSaleDateRangeWhere("saleDate", dateFromRaw, dateToRaw);
  const [rows] = await query<RowDataPacket[]>(
    `SELECT productId AS id, productName AS name,
            COALESCE(SUM(totalAmount), 0) AS revenue,
            COALESCE(SUM(qty), 0) AS qty,
            COUNT(*) AS deals
     FROM sales_records ${clause}
     GROUP BY productId, productName
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

const VALID_COST_TYPES = new Set([
  "product_cost", "transport", "shipping", "service_visit",
  "repair", "commission", "other",
]);

function cleanCostInput(data: Partial<CostItem>) {
  return {
    costType: VALID_COST_TYPES.has(data.costType || "") ? data.costType! : "other",
    label: sanitizePlainText(data.label || "").substring(0, 255),
    amount: Math.max(0, Math.min(9999999999.99, Number(data.amount) || 0)),
    note: sanitizePlainText(data.note || "").substring(0, 5000),
  };
}

/**
 * Recalculate the cached costAmount on sales_records from its cost items.
 *
 * Locks the sale's row (SELECT ... FOR UPDATE) before summing+writing, inside
 * one transaction — without this, two concurrent cost-item edits on the SAME
 * sale (e.g. two admin tabs) could each read the sum BEFORE the other's item
 * was inserted, then write back in reverse-completion order, leaving
 * costAmount permanently out of sync with the true sum of sale_cost_items
 * (and every profit/margin figure that reads costAmount along with it). The
 * lock forces concurrent recalcs to serialize, so whichever finishes last
 * always re-reads the CURRENT total rather than a stale pre-race snapshot.
 */
export async function recalcCostAmount(salesRecordId: string): Promise<number> {
  return withTransaction(async (conn) => {
    await conn.query("SELECT id FROM sales_records WHERE id = ? FOR UPDATE", [salesRecordId]);
    const [rows] = await conn.query<RowDataPacket[]>(
      `SELECT COALESCE(SUM(amount), 0) AS total FROM sale_cost_items WHERE salesRecordId = ?`,
      [salesRecordId]
    );
    const total = Number(rows[0]?.total || 0);
    await conn.query(
      `UPDATE sales_records SET costAmount = ? WHERE id = ?`,
      [total, salesRecordId]
    );
    return total;
  });
}

export async function getCostItems(salesRecordId: string): Promise<CostItem[]> {
  const [rows] = await query<RowDataPacket[]>(
    `SELECT * FROM sale_cost_items WHERE salesRecordId = ? ORDER BY createdAt ASC`,
    [salesRecordId]
  );
  return rows as CostItem[];
}

export async function addCostItem(
  salesRecordId: string,
  data: Partial<CostItem>
): Promise<CostItem> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const v = cleanCostInput(data);
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

export async function updateCostItem(
  id: string,
  data: Partial<CostItem>
): Promise<CostItem | null> {
  const [existing] = await query<RowDataPacket[]>(
    `SELECT * FROM sale_cost_items WHERE id = ?`,
    [id]
  );
  if (!existing[0]) return null;
  const v = cleanCostInput({ ...existing[0], ...data });
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

export async function deleteCostItem(id: string): Promise<boolean> {
  const [existing] = await query<RowDataPacket[]>(
    `SELECT salesRecordId FROM sale_cost_items WHERE id = ?`,
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

export async function syncCostItems(
  salesRecordId: string,
  items: Partial<CostItem>[]
): Promise<CostItem[]> {
  const existing = await getSalesRecord(salesRecordId);
  if (!existing) return [];
  
  return await withTransaction(async (conn) => {
    // 1. Delete existing items
    await conn.execute(
      `DELETE FROM sale_cost_items WHERE salesRecordId = ?`,
      [salesRecordId]
    );
    
    // 2. Insert new items and compute total
    const insertedItems: CostItem[] = [];
    let total = 0;
    for (const item of items) {
      if (Number(item.amount) > 0) {
        const id = crypto.randomUUID();
        const now = new Date().toISOString();
        const v = cleanCostInput(item);
        await conn.execute(
          `INSERT INTO sale_cost_items (id, salesRecordId, costType, label, amount, note, createdAt)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [id, salesRecordId, v.costType, v.label, v.amount, v.note, now]
        );
        total += v.amount;
        insertedItems.push({ id, salesRecordId, ...v, createdAt: now } as CostItem);
      }
    }
    
    // 3. Update total cost in sales_records
    await conn.execute(
      `UPDATE sales_records SET costAmount = ? WHERE id = ?`,
      [total, salesRecordId]
    );
    
    return insertedItems;
  });
}

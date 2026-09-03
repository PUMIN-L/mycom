import "server-only";
import { query, withTransaction } from "./db";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { sanitizePlainText } from "./sanitizeHtml";
import type { Expense, RecurringExpense } from "./types";

function formatLocalDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function cleanExpense(data: Partial<Expense>) {
  return {
    title: sanitizePlainText(data.title || "").substring(0, 255),
    amount: Math.max(0, Math.min(9999999999.99, Number(data.amount) || 0)),
    expenseDate: (() => {
      const raw = sanitizePlainText(data.expenseDate || "").substring(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return formatLocalDate(new Date());
      const d = new Date(raw + "T00:00:00");
      if (isNaN(d.getTime())) return formatLocalDate(new Date());
      return raw;
    })(),
    category: sanitizePlainText(data.category || "").substring(0, 100),
    note: sanitizePlainText(data.note || "").substring(0, 5000),
  };
}

export async function addExpense(data: Partial<Expense>): Promise<Expense> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const v = cleanExpense(data);

  await query(
    `INSERT INTO expenses (id, title, amount, expenseDate, category, note, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, v.title, v.amount, v.expenseDate, v.category, v.note, now]
  );
  return (await getExpense(id))!;
}

export async function updateExpense(
  id: string,
  data: Partial<Expense>
): Promise<Expense | null> {
  const existing = await getExpense(id);
  if (!existing) return null;
  const v = cleanExpense({ ...existing, ...data });

  await query(
    `UPDATE expenses SET title = ?, amount = ?, expenseDate = ?, category = ?, note = ? WHERE id = ?`,
    [v.title, v.amount, v.expenseDate, v.category, v.note, id]
  );
  return await getExpense(id);
}

export async function deleteExpense(id: string): Promise<boolean> {
  const [result] = await query<{ affectedRows: number } & RowDataPacket[]>(
    "DELETE FROM expenses WHERE id = ?",
    [id]
  );
  return result.affectedRows > 0;
}

export async function getExpense(id: string): Promise<Expense | null> {
  const [rows] = await query<RowDataPacket[]>(
    `SELECT *, DATE_FORMAT(expenseDate, '%Y-%m-%d') AS expenseDate FROM expenses WHERE id = ?`,
    [id]
  );
  return (rows[0] as Expense) || null;
}

export async function listExpenses(filters?: {
  dateFrom?: string;
  dateTo?: string;
  category?: string;
}): Promise<Expense[]> {
  let sql = `
    SELECT 
      id, title, amount, DATE_FORMAT(expenseDate, '%Y-%m-%d') AS expenseDate, category, note, createdAt, source
    FROM (
      SELECT 
        id, title, amount, expenseDate, category, note, createdAt, 'expense' AS source 
      FROM expenses 
      
      UNION ALL 
      
      SELECT 
        s.id, 
        CONCAT(s.productName, ' (ต้นทุนขาย)') AS title,
        s.costAmount AS amount,
        s.saleDate AS expenseDate,
        CONCAT('ต้นทุน: ', IFNULL(pc.name_th, 'ไม่ระบุหมวดหมู่')) AS category,
        CONCAT('อ้างอิงจากลูกค้า: ', IFNULL(c.name, 'ไม่ระบุ')) AS note,
        s.createdAt,
        'sale_cost' AS source
      FROM sales_records s
      LEFT JOIN customers c ON s.customerId = c.id
      LEFT JOIN product_categories pc ON s.categoryId = pc.id
      WHERE s.costAmount > 0
    ) AS combined
    WHERE 1=1
  `;
  const params: unknown[] = [];

  if (filters?.dateFrom) {
    sql += ` AND expenseDate >= ?`;
    params.push(filters.dateFrom);
  }
  if (filters?.dateTo) {
    sql += ` AND expenseDate <= ?`;
    params.push(filters.dateTo);
  }
  if (filters?.category) {
    sql += ` AND category = ?`;
    params.push(filters.category);
  }

  sql += ` ORDER BY expenseDate DESC, createdAt DESC`;

  const [rows] = await query<RowDataPacket[]>(sql, params);
  return rows as Expense[];
}

// ── Recurring expense templates ─────────────────────────────────────────────
// A template for a monthly cost (rent, salary, ...) — see
// generateExpensesForMonth() for how this turns into a real `expenses` row.
// Generation is always an explicit admin action, never a background cron:
// this file never inserts an `expenses` row on its own.

function cleanRecurringExpense(data: Partial<RecurringExpense>) {
  return {
    title: sanitizePlainText(data.title || "").substring(0, 255),
    amount: Math.max(0, Math.min(9999999999.99, Number(data.amount) || 0)),
    category: sanitizePlainText(data.category || "").substring(0, 100),
    note: sanitizePlainText(data.note || "").substring(0, 5000),
    active: data.active !== false,
  };
}

function rowToRecurringExpense(row: RowDataPacket): RecurringExpense {
  return {
    id: row.id,
    title: row.title,
    amount: Number(row.amount),
    category: row.category,
    note: row.note ?? "",
    active: Boolean(row.active),
    lastGeneratedMonth: row.lastGeneratedMonth ?? null,
    createdAt: row.createdAt,
  };
}

export async function addRecurringExpense(
  data: Partial<RecurringExpense>
): Promise<RecurringExpense> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const v = cleanRecurringExpense(data);

  await query(
    `INSERT INTO recurring_expenses (id, title, amount, category, note, active, lastGeneratedMonth, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`,
    [id, v.title, v.amount, v.category, v.note, v.active, now]
  );
  return (await getRecurringExpense(id))!;
}

export async function updateRecurringExpense(
  id: string,
  data: Partial<RecurringExpense>
): Promise<RecurringExpense | null> {
  const existing = await getRecurringExpense(id);
  if (!existing) return null;
  const v = cleanRecurringExpense({ ...existing, ...data });

  await query(
    `UPDATE recurring_expenses SET title = ?, amount = ?, category = ?, note = ?, active = ? WHERE id = ?`,
    [v.title, v.amount, v.category, v.note, v.active, id]
  );
  return await getRecurringExpense(id);
}

/**
 * Deletes only the TEMPLATE. Real `expenses` rows already generated from it
 * are untouched — `expenses.recurringExpenseId`'s FK is ON DELETE SET NULL,
 * so they just lose the traceability link, never the row itself.
 */
export async function deleteRecurringExpense(id: string): Promise<boolean> {
  const [result] = await query<{ affectedRows: number } & RowDataPacket[]>(
    "DELETE FROM recurring_expenses WHERE id = ?",
    [id]
  );
  return result.affectedRows > 0;
}

export async function getRecurringExpense(
  id: string
): Promise<RecurringExpense | null> {
  const [rows] = await query<RowDataPacket[]>(
    "SELECT * FROM recurring_expenses WHERE id = ?",
    [id]
  );
  return rows.length > 0 ? rowToRecurringExpense(rows[0]) : null;
}

export async function listRecurringExpenses(): Promise<RecurringExpense[]> {
  const [rows] = await query<RowDataPacket[]>(
    "SELECT * FROM recurring_expenses ORDER BY createdAt DESC"
  );
  return rows.map(rowToRecurringExpense);
}

export interface GenerateExpensesResult {
  month: string;
  generated: { id: string; title: string; amount: number }[];
  skippedAlreadyGenerated: string[]; // template titles
  skippedInactive: number;
  failed: string[]; // template titles whose generation errored — safe to retry
}

/**
 * Turns every ACTIVE recurring template not yet generated for `month`
 * ("YYYY-MM") into a real `expenses` row dated the 1st of that month.
 * Idempotent per template per month — safe to click twice (including two
 * concurrent clicks/tabs): the UPDATE below only "claims" a template+month if
 * it isn't already claimed, and its row lock means at most one concurrent
 * caller can win that race for the same template, so it never creates a
 * duplicate expense for the same template+month even under concurrency.
 */
export async function generateExpensesForMonth(
  month: string
): Promise<GenerateExpensesResult> {
  const templates = await listRecurringExpenses();
  const result: GenerateExpensesResult = {
    month,
    generated: [],
    skippedAlreadyGenerated: [],
    skippedInactive: 0,
    failed: [],
  };

  for (const t of templates) {
    if (!t.active) {
      result.skippedInactive++;
      continue;
    }

    const expenseId = crypto.randomUUID();
    const now = new Date().toISOString();
    try {
      // One row created + one template claimed, atomically — a failure here
      // must never leave a template marked "generated" with no matching
      // expense row (or vice versa), and the claim's row lock is what makes
      // concurrent calls for the same template+month mutually exclusive.
      const claimed = await withTransaction(async (conn) => {
        const [claimResult] = await conn.query<ResultSetHeader>(
          `UPDATE recurring_expenses
           SET lastGeneratedMonth = ?
           WHERE id = ? AND (lastGeneratedMonth IS NULL OR lastGeneratedMonth != ?)`,
          [month, t.id, month]
        );
        if (claimResult.affectedRows === 0) return false;
        await conn.query(
          `INSERT INTO expenses (id, title, amount, expenseDate, category, note, createdAt, recurringExpenseId)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [expenseId, t.title, t.amount, `${month}-01`, t.category, t.note, now, t.id]
        );
        return true;
      });

      if (claimed) {
        result.generated.push({ id: expenseId, title: t.title, amount: t.amount });
      } else {
        result.skippedAlreadyGenerated.push(t.title);
      }
    } catch (err) {
      // One template failing (e.g. a transient DB error) must not hide
      // whether earlier templates in this same call already succeeded —
      // record it and keep going instead of throwing and losing that info.
      console.error(`generateExpensesForMonth: failed for template ${t.id} (${t.title}):`, err);
      result.failed.push(t.title);
    }
  }

  return result;
}

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
 *
 * IDEMPOTENCE IS PER TEMPLATE PER MONTH, and it is decided by looking for the
 * `expenses` row itself — never by `lastGeneratedMonth`.
 *
 * `lastGeneratedMonth` holds ONE month, so it cannot answer "was August
 * generated?" once September has been. It used to be the guard, and that made
 * an ordinary backfill duplicate money: generate 2026-09 (marker = "2026-09",
 * one row dated 2026-09-01), then backfill 2026-08 — the old
 * `lastGeneratedMonth != "2026-08"` guard matched, inserted August, and
 * OVERWROTE the marker with "2026-08". Re-running September then matched
 * again and inserted a SECOND 2026-09-01 row for the same template. `expenses`
 * has no unique key on (recurringExpenseId, expenseDate), so nothing rejected
 * it and the month's total was silently double-counted on the dashboard.
 *
 * The guard is now the row: inside the transaction we take a row lock on the
 * template (SELECT ... FOR UPDATE) and then ask `expenses` whether this
 * template already has a row dated `<month>-01`. Two concurrent callers for the
 * same template serialize on that lock, so the loser sees the winner's
 * committed row and skips — the same mutual exclusion the old claim UPDATE
 * provided, now asking a question that is actually per-month.
 *
 * This also makes the callback safe for `withTransaction`'s retry-after-a-lost-
 * commit-ack: the retry re-reads `expenses`, finds the row the first attempt
 * committed, and skips instead of inserting a duplicate. The expense id is
 * minted INSIDE the callback for the same reason.
 *
 * No unique index was added for this. One would be a genuine belt-and-braces,
 * but `expenses` in production may already carry duplicate pairs created by the
 * bug above — `CREATE UNIQUE INDEX` on a table that already violates it fails,
 * and the only ways through are to delete real financial rows during bootstrap
 * or to leave the migration throwing and strand the database half-migrated.
 * Neither is worth it when the write path is the only thing that creates these
 * rows and it is now correct under concurrency and under retry.
 *
 * `lastGeneratedMonth` survives as a DISPLAY hint only ("the latest month this
 * template has been generated for" — /expenses reads it to badge the current
 * month), so it now only ever moves FORWARD. Backfilling August after
 * September no longer rewinds the badge and no longer re-arms September.
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

    const expenseDate = `${month}-01`;
    try {
      // One row created + the display marker moved, atomically. Everything the
      // decision depends on is read INSIDE the attempt, so a retried callback
      // reaches the same conclusion as the attempt that was lost.
      const outcome = await withTransaction(async (conn) => {
        // The lock, and nothing else. Two concurrent generate() calls for this
        // template queue up here, so the existence check below cannot race.
        const [lockRows] = await conn.query<RowDataPacket[]>(
          "SELECT id FROM recurring_expenses WHERE id = ? FOR UPDATE",
          [t.id]
        );
        if (lockRows.length === 0) return { status: "gone" as const };

        // THE guard. Per month, and reading the thing that actually matters —
        // whether this template's expense for this month exists.
        const [existingRows] = await conn.query<RowDataPacket[]>(
          "SELECT id FROM expenses WHERE recurringExpenseId = ? AND expenseDate = ? LIMIT 1",
          [t.id, expenseDate]
        );
        if (existingRows.length > 0) return { status: "exists" as const };

        // Minted here, not before the transaction: withTransaction retries the
        // whole body on a transient connection loss, and a retry must be free
        // to write a fresh row rather than collide with the previous attempt's
        // primary key.
        const expenseId = crypto.randomUUID();
        const now = new Date().toISOString();
        await conn.query(
          `INSERT INTO expenses (id, title, amount, expenseDate, category, note, createdAt, recurringExpenseId)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [expenseId, t.title, t.amount, expenseDate, t.category, t.note, now, t.id]
        );
        // Display hint only, and forward-only: a backfill of an older month
        // must not rewind "latest month generated" (lexical compare is correct
        // for "YYYY-MM").
        await conn.query<ResultSetHeader>(
          `UPDATE recurring_expenses
           SET lastGeneratedMonth = ?
           WHERE id = ? AND (lastGeneratedMonth IS NULL OR lastGeneratedMonth < ?)`,
          [month, t.id, month]
        );
        return { status: "generated" as const, id: expenseId };
      });

      if (outcome.status === "generated") {
        result.generated.push({ id: outcome.id, title: t.title, amount: t.amount });
      } else if (outcome.status === "exists") {
        result.skippedAlreadyGenerated.push(t.title);
      } else {
        // The template was deleted between listRecurringExpenses() and here.
        // Reported as a failure rather than silently dropped: "nothing
        // happened for this one" is a fact the admin has to be told, and
        // "already generated" would be a lie.
        console.error(
          `generateExpensesForMonth: template ${t.id} (${t.title}) disappeared before it could be generated`
        );
        result.failed.push(t.title);
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

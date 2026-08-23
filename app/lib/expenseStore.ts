import "server-only";
import { query } from "./db";
import type { RowDataPacket } from "mysql2";
import { sanitizePlainText } from "./sanitizeHtml";
import type { Expense } from "./types";

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

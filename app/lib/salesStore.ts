import { query } from "./db";
import { sanitizePlainText } from "./sanitizeHtml";

export interface Salesperson {
  id: string;
  name: string;
  phone: string;
  email: string;
  note: string;
  createdAt?: string;
}

// Matches the DB columns (name/phone/email VARCHAR(255), note TEXT) —
// without this, a value longer than the column allows throws an uncaught DB
// error (500) instead of just being clipped, unlike every sibling store.
function cleanSalesperson(data: Partial<Salesperson>) {
  return {
    name: sanitizePlainText(data.name || "").substring(0, 255),
    phone: sanitizePlainText(data.phone || "").substring(0, 255),
    email: sanitizePlainText(data.email || "").substring(0, 255),
    note: sanitizePlainText(data.note || "").substring(0, 5000),
  };
}

export async function getAllSalespeople(): Promise<Salesperson[]> {
  const [rows] = await query<any[]>("SELECT * FROM salespeople ORDER BY createdAt DESC");
  return rows;
}

export async function getSalesperson(id: string): Promise<Salesperson | null> {
  const [rows] = await query<any[]>("SELECT * FROM salespeople WHERE id = ?", [id]);
  return rows[0] || null;
}

export async function createSalesperson(data: Partial<Salesperson>): Promise<Salesperson> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const v = cleanSalesperson(data);

  await query(
    `INSERT INTO salespeople (id, name, phone, email, note, createdAt)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, v.name, v.phone, v.email, v.note, now]
  );

  return (await getSalesperson(id))!;
}

export async function updateSalesperson(id: string, data: Partial<Salesperson>): Promise<Salesperson | null> {
  const v = cleanSalesperson(data);
  const sets: string[] = [];
  const values: unknown[] = [];

  const set = (col: string, val: unknown) => {
    sets.push(`${col} = ?`);
    values.push(val);
  };

  if (data.name !== undefined) set("name", v.name);
  if (data.phone !== undefined) set("phone", v.phone);
  if (data.email !== undefined) set("email", v.email);
  if (data.note !== undefined) set("note", v.note);

  if (sets.length > 0) {
    await query(`UPDATE salespeople SET ${sets.join(", ")} WHERE id = ?`, [...values, id]);
  }

  return await getSalesperson(id);
}

export async function deleteSalesperson(id: string): Promise<boolean> {
  const [result] = await query<any>("DELETE FROM salespeople WHERE id = ?", [id]);
  return result.affectedRows > 0;
}

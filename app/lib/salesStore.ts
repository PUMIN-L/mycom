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
  
  await query(
    `INSERT INTO salespeople (id, name, phone, email, note, createdAt)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      id,
      sanitizePlainText(data.name || ""),
      sanitizePlainText(data.phone || ""),
      sanitizePlainText(data.email || ""),
      sanitizePlainText(data.note || ""),
      now
    ]
  );
  
  return (await getSalesperson(id))!;
}

export async function updateSalesperson(id: string, data: Partial<Salesperson>): Promise<Salesperson | null> {
  const sets: string[] = [];
  const values: unknown[] = [];
  
  const set = (col: string, val: unknown) => {
    sets.push(`${col} = ?`);
    values.push(val);
  };
  
  if (data.name !== undefined) set("name", sanitizePlainText(data.name));
  if (data.phone !== undefined) set("phone", sanitizePlainText(data.phone));
  if (data.email !== undefined) set("email", sanitizePlainText(data.email));
  if (data.note !== undefined) set("note", sanitizePlainText(data.note));
  
  if (sets.length > 0) {
    await query(`UPDATE salespeople SET ${sets.join(", ")} WHERE id = ?`, [...values, id]);
  }
  
  return await getSalesperson(id);
}

export async function deleteSalesperson(id: string): Promise<boolean> {
  const [result] = await query<any>("DELETE FROM salespeople WHERE id = ?", [id]);
  return result.affectedRows > 0;
}

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

/**
 * What is wrong with a salesperson body, in Thai, or null when nothing is.
 * Every field is text: a number or an object used to reach `.trim()` or the
 * sanitizer and come back as a bare 500. `creating` makes the name required;
 * an edit may leave it out, but may not blank it.
 */
export function salespersonInputError(body: unknown, creating: boolean): string | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return "ข้อมูลไม่ถูกต้อง";
  const b = body as Record<string, unknown>;
  if (creating || b.name !== undefined) {
    if (typeof b.name !== "string" || b.name.trim() === "") return "กรุณากรอกชื่อ";
    if (b.name.length > 255) return "ชื่อยาวเกิน 255 ตัวอักษร";
  }
  for (const field of ["phone", "email", "note"] as const) {
    if (b[field] !== undefined && b[field] !== null && typeof b[field] !== "string") {
      return "ข้อมูลไม่ถูกต้อง";
    }
  }
  return null;
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

import { query } from "./db";
import { sanitizePlainText } from "./sanitizeHtml";
import type { Supplier } from "./types";

export async function getAllSuppliers(): Promise<Supplier[]> {
  const [rows] = await query<any[]>("SELECT * FROM suppliers ORDER BY createdAt DESC");
  
  if (rows.length === 0) return rows;

  const [links] = await query<any[]>(`
    SELECT ps.supplierId, p.id, p.title_th, p.title_en 
    FROM product_suppliers ps 
    JOIN products p ON ps.productId = p.id
  `);

  const linksBySupplier = links.reduce((acc, link) => {
    if (!acc[link.supplierId]) acc[link.supplierId] = [];
    acc[link.supplierId].push({ id: link.id, title_th: link.title_th, title_en: link.title_en });
    return acc;
  }, {} as Record<string, Array<{ id: string; title_th: string; title_en: string }>>);

  return rows.map((r) => ({
    ...r,
    linkedProducts: linksBySupplier[r.id] || []
  }));
}

export async function getSupplier(id: string): Promise<Supplier | null> {
  const [rows] = await query<any[]>("SELECT * FROM suppliers WHERE id = ?", [id]);
  const supplier = rows[0] || null;
  if (!supplier) return null;

  const [links] = await query<any[]>(`
    SELECT p.id, p.title_th, p.title_en 
    FROM product_suppliers ps 
    JOIN products p ON ps.productId = p.id
    WHERE ps.supplierId = ?
  `, [id]);

  supplier.linkedProducts = links.map(l => ({ id: l.id, title_th: l.title_th, title_en: l.title_en }));
  return supplier;
}

export async function createSupplier(data: Partial<Supplier>): Promise<Supplier> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  
  await query(
    `INSERT INTO suppliers (id, companyName, contactName, phone, note, createdAt)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      id,
      sanitizePlainText(data.companyName || ""),
      sanitizePlainText(data.contactName || ""),
      sanitizePlainText(data.phone || ""),
      sanitizePlainText(data.note || ""),
      now
    ]
  );
  
  return (await getSupplier(id))!;
}

export async function updateSupplier(id: string, data: Partial<Supplier>): Promise<Supplier | null> {
  const sets: string[] = [];
  const values: unknown[] = [];
  
  const set = (col: string, val: unknown) => {
    sets.push(`${col} = ?`);
    values.push(val);
  };
  
  if (data.companyName !== undefined) set("companyName", sanitizePlainText(data.companyName));
  if (data.contactName !== undefined) set("contactName", sanitizePlainText(data.contactName));
  if (data.phone !== undefined) set("phone", sanitizePlainText(data.phone));
  if (data.note !== undefined) set("note", sanitizePlainText(data.note));
  
  if (sets.length > 0) {
    await query(`UPDATE suppliers SET ${sets.join(", ")} WHERE id = ?`, [...values, id]);
  }
  
  return await getSupplier(id);
}

export async function deleteSupplier(id: string): Promise<boolean> {
  const [result] = await query<any>("DELETE FROM suppliers WHERE id = ?", [id]);
  return result.affectedRows > 0;
}

import { query } from "./db";
import { RowDataPacket, ResultSetHeader } from "mysql2";
import type { ProductCategory, ProductData } from "./types";

// Re-exported so existing callers can keep importing these from "./productStore".
export type { ProductCategory, ProductData } from "./types";

// ── Categories ────────────────────────────────────────────────────────────────

export async function getAllCategories(): Promise<ProductCategory[]> {
  const [rows] = await query<RowDataPacket[]>(
    "SELECT * FROM product_categories ORDER BY sortOrder ASC"
  );
  return rows as ProductCategory[];
}

export async function addCategory(
  category: Omit<ProductCategory, "id" | "sortOrder">
): Promise<ProductCategory> {
  // Generate new ID (max id + 1)
  const [maxRows] = await query<RowDataPacket[]>(
    "SELECT MAX(id) as maxId FROM product_categories"
  );
  const nextId = (maxRows[0].maxId ?? 0) + 1;
  const sortOrder = nextId; // Just use ID as default sort order

  await query(
    "INSERT INTO product_categories (id, name_th, name_en, name_zh, sortOrder) VALUES (?, ?, ?, ?, ?)",
    [nextId, category.name_th, category.name_en, category.name_zh, sortOrder]
  );

  return {
    id: nextId,
    name_th: category.name_th,
    name_en: category.name_en,
    name_zh: category.name_zh,
    sortOrder,
  };
}

export async function deleteCategory(id: number): Promise<boolean> {
  const [result] = await query<ResultSetHeader>(
    "DELETE FROM product_categories WHERE id = ?",
    [id]
  );
  return result.affectedRows > 0;
}

// ── Products ──────────────────────────────────────────────────────────────────

function rowToProduct(row: RowDataPacket): ProductData {
  return {
    id: row.id,
    categoryId: row.categoryId,
    image: row.image,
    title_th: row.title_th,
    title_en: row.title_en,
    title_zh: row.title_zh,
    desc_th: row.desc_th ?? "",
    desc_en: row.desc_en ?? "",
    desc_zh: row.desc_zh ?? "",
    createdAt: row.createdAt,
  };
}

export async function addProduct(product: ProductData): Promise<ProductData> {
  await query(
    "INSERT INTO products (id, categoryId, image, title_th, title_en, title_zh, desc_th, desc_en, desc_zh, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [
      product.id,
      product.categoryId,
      product.image,
      product.title_th,
      product.title_en,
      product.title_zh,
      product.desc_th,
      product.desc_en,
      product.desc_zh,
      product.createdAt,
    ]
  );
  return product;
}

export async function getProduct(id: string): Promise<ProductData | undefined> {
  const [rows] = await query<RowDataPacket[]>(
    "SELECT * FROM products WHERE id = ?",
    [id]
  );
  if (rows.length === 0) return undefined;
  return rowToProduct(rows[0]);
}

export async function getAllProducts(): Promise<ProductData[]> {
  const [rows] = await query<RowDataPacket[]>(
    "SELECT * FROM products ORDER BY categoryId ASC, createdAt ASC"
  );
  return rows.map(rowToProduct);
}

export async function getProductsByCategory(categoryId: number): Promise<ProductData[]> {
  const [rows] = await query<RowDataPacket[]>(
    "SELECT * FROM products WHERE categoryId = ? ORDER BY createdAt ASC",
    [categoryId]
  );
  return rows.map(rowToProduct);
}

export async function deleteProduct(id: string): Promise<boolean> {
  const [result] = await query<ResultSetHeader>(
    "DELETE FROM products WHERE id = ?",
    [id]
  );
  return result.affectedRows > 0;
}

export async function updateProduct(
  id: string,
  updates: Partial<ProductData>
): Promise<ProductData | undefined> {
  const existing = await getProduct(id);
  if (!existing) return undefined;

  const merged: ProductData = {
    ...existing,
    ...updates,
    id, // id cannot change
  };

  await query(
    "UPDATE products SET categoryId = ?, image = ?, title_th = ?, title_en = ?, title_zh = ?, desc_th = ?, desc_en = ?, desc_zh = ? WHERE id = ?",
    [
      merged.categoryId,
      merged.image,
      merged.title_th,
      merged.title_en,
      merged.title_zh,
      merged.desc_th,
      merged.desc_en,
      merged.desc_zh,
      id,
    ]
  );

  return merged;
}

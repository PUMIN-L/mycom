import { query } from "./db";
import { RowDataPacket, ResultSetHeader } from "mysql2";
import type { ProductCategory, ProductData } from "./types";
import { sanitizeRichText } from "./sanitizeHtml";

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

export async function updateCategory(
  id: number,
  category: { name_th: string; name_en: string; name_zh: string }
): Promise<boolean> {
  const [result] = await query<ResultSetHeader>(
    "UPDATE product_categories SET name_th = ?, name_en = ?, name_zh = ? WHERE id = ?",
    [category.name_th, category.name_en, category.name_zh, id]
  );
  return result.affectedRows > 0;
}

export async function reorderCategories(categoryIds: number[]): Promise<boolean> {
  // Update each category's sortOrder to match its index in the array
  // A transaction would be ideal, but for simplicity we'll do it sequentially or with Promise.all
  try {
    const promises = categoryIds.map((id, index) => {
      return query(
        "UPDATE product_categories SET sortOrder = ? WHERE id = ?",
        [index, id]
      );
    });
    await Promise.all(promises);
    return true;
  } catch (error) {
    console.error("Failed to reorder categories:", error);
    return false;
  }
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
    isPublished: row.isPublished === undefined ? true : Boolean(row.isPublished),
  };
}

export async function addProduct(product: ProductData): Promise<ProductData> {
  const isPublished = product.isPublished !== false;
  // Sanitize rich-text descriptions on write so stored HTML is always safe to
  // render with dangerouslySetInnerHTML on public pages.
  const desc_th = sanitizeRichText(product.desc_th);
  const desc_en = sanitizeRichText(product.desc_en);
  const desc_zh = sanitizeRichText(product.desc_zh);
  await query(
    "INSERT INTO products (id, categoryId, image, title_th, title_en, title_zh, desc_th, desc_en, desc_zh, createdAt, isPublished) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [
      product.id,
      product.categoryId,
      product.image,
      product.title_th,
      product.title_en,
      product.title_zh,
      desc_th,
      desc_en,
      desc_zh,
      product.createdAt,
      isPublished,
    ]
  );
  return { ...product, desc_th, desc_en, desc_zh, isPublished };
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
    // Re-sanitize descriptions on every write (they may have changed).
    desc_th: sanitizeRichText(updates.desc_th ?? existing.desc_th),
    desc_en: sanitizeRichText(updates.desc_en ?? existing.desc_en),
    desc_zh: sanitizeRichText(updates.desc_zh ?? existing.desc_zh),
  };

  const isPublished = merged.isPublished !== false;

  await query(
    "UPDATE products SET categoryId = ?, image = ?, title_th = ?, title_en = ?, title_zh = ?, desc_th = ?, desc_en = ?, desc_zh = ?, isPublished = ? WHERE id = ?",
    [
      merged.categoryId,
      merged.image,
      merged.title_th,
      merged.title_en,
      merged.title_zh,
      merged.desc_th,
      merged.desc_en,
      merged.desc_zh,
      isPublished,
      id,
    ]
  );

  return merged;
}

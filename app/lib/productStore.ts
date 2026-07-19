import { query, withTransaction } from "./db";
import { RowDataPacket, ResultSetHeader } from "mysql2";
import type { ProductCategory, ProductData } from "./types";
import { sanitizeRichText } from "./sanitizeHtml";
import { saveRevision } from "./revisionStore";

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
  // Allocate id = MAX(id)+1 and insert it. Under concurrency two callers can
  // compute the same next id; the loser hits a duplicate-key error and simply
  // retries with a freshly-read max, instead of failing the request (or
  // silently overwriting a sibling category).
  const MAX_ATTEMPTS = 5;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const [maxRows] = await query<RowDataPacket[]>(
      "SELECT MAX(id) as maxId FROM product_categories"
    );
    const nextId = (maxRows[0].maxId ?? 0) + 1;
    try {
      await query(
        "INSERT INTO product_categories (id, name_th, name_en, name_zh, sortOrder) VALUES (?, ?, ?, ?, ?)",
        [nextId, category.name_th, category.name_en, category.name_zh, nextId]
      );
      return {
        id: nextId,
        name_th: category.name_th,
        name_en: category.name_en,
        name_zh: category.name_zh,
        sortOrder: nextId,
      };
    } catch (error) {
      const isDup = (error as { code?: string })?.code === "ER_DUP_ENTRY";
      if (isDup && attempt < MAX_ATTEMPTS) continue;
      throw error;
    }
  }
  throw new Error("Failed to allocate a category id after multiple attempts");
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
  // Apply the new sortOrder for every category atomically. A partial failure
  // (e.g. a transient error mid-way) must not leave the ordering half-applied,
  // so run all the UPDATEs inside one transaction that rolls back on error.
  try {
    await withTransaction(async (conn) => {
      for (let index = 0; index < categoryIds.length; index++) {
        await conn.query(
          "UPDATE product_categories SET sortOrder = ? WHERE id = ?",
          [index, categoryIds[index]]
        );
      }
    });
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

  // Build a partial UPDATE that only touches the columns actually supplied, so
  // two concurrent edits to different fields don't clobber each other via a
  // read-modify-write of the whole row. Descriptions are re-sanitized on write.
  const sets: string[] = [];
  const values: unknown[] = [];
  const set = (col: string, val: unknown) => {
    sets.push(`${col} = ?`);
    values.push(val);
  };

  if (updates.categoryId !== undefined) set("categoryId", updates.categoryId);
  if (updates.image !== undefined) set("image", updates.image);
  if (updates.title_th !== undefined) set("title_th", updates.title_th);
  if (updates.title_en !== undefined) set("title_en", updates.title_en);
  if (updates.title_zh !== undefined) set("title_zh", updates.title_zh);
  if (updates.desc_th !== undefined) set("desc_th", sanitizeRichText(updates.desc_th));
  if (updates.desc_en !== undefined) set("desc_en", sanitizeRichText(updates.desc_en));
  if (updates.desc_zh !== undefined) set("desc_zh", sanitizeRichText(updates.desc_zh));
  if (updates.isPublished !== undefined) set("isPublished", updates.isPublished !== false);

  if (sets.length > 0) {
    // Snapshot the previous value first so an accidental overwrite is restorable
    // (a failed snapshot aborts before we touch the row).
    await saveRevision("product", id, existing);
    await query(
      `UPDATE products SET ${sets.join(", ")} WHERE id = ?`,
      [...values, id]
    );
  }

  return getProduct(id);
}

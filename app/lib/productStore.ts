import { cache } from "react";
import { query, withTransaction } from "./db";
import { RowDataPacket, ResultSetHeader } from "mysql2";
import type { ProductCategory, ProductData } from "./types";
import { sanitizeRichText } from "./sanitizeHtml";
import { saveRevision } from "./revisionStore";

// Re-exported so existing callers can keep importing these from "./productStore".
export type { ProductCategory, ProductData } from "./types";

// Single source of truth for "may anonymous callers see this product" — used
// everywhere a product (or something linked to one, like its CMS content)
// gets exposed to a caller that might not be logged in.
export function isProductPublic(product: Pick<ProductData, "isPublished" | "pendingDeleteAt">): boolean {
  return product.isPublished !== false && !product.pendingDeleteAt;
}

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
        [
          nextId, 
          sanitizeRichText(category.name_th).substring(0, 255), 
          sanitizeRichText(category.name_en).substring(0, 255), 
          sanitizeRichText(category.name_zh).substring(0, 255), 
          nextId
        ]
      );
      return {
        id: nextId,
        name_th: sanitizeRichText(category.name_th).substring(0, 255),
        name_en: sanitizeRichText(category.name_en).substring(0, 255),
        name_zh: sanitizeRichText(category.name_zh).substring(0, 255),
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

/**
 * Persists a drag-and-drop reorder as a single `CASE id WHEN ... END` UPDATE
 * instead of one query per row. `table` is always a hardcoded literal from
 * the call sites below, never derived from request input.
 */
async function reorderByCaseWhen<T extends string | number>(
  table: string,
  ids: T[],
  errorLabel: string
): Promise<boolean> {
  if (!ids || ids.length === 0) return true;

  try {
    let caseSql = "CASE id ";
    const params: unknown[] = [];
    const orderedIds: T[] = [];

    ids.forEach((id, index) => {
      caseSql += "WHEN ? THEN ? ";
      params.push(id, index);
      orderedIds.push(id);
    });
    caseSql += "END";

    const placeholders = orderedIds.map(() => "?").join(",");
    params.push(...orderedIds);

    const sql = `UPDATE ${table} SET sortOrder = ${caseSql} WHERE id IN (${placeholders})`;

    await query(sql, params);
    return true;
  } catch (error) {
    console.error(`Failed to reorder ${errorLabel}:`, error);
    return false;
  }
}

export async function reorderCategories(categoryIds: number[]): Promise<boolean> {
  return reorderByCaseWhen("product_categories", categoryIds, "categories");
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
    sortOrder: row.sortOrder ?? 0,
    bestSellerRank: row.bestSellerRank ?? null,
    showBestSellerBadge: row.showBestSellerBadge === undefined ? true : Boolean(row.showBestSellerBadge),
    pendingDeleteAt: row.pendingDeleteAt || null,
  };
}

export async function addProduct(product: ProductData): Promise<ProductData> {
  const isPublished = product.isPublished !== false;
  // Sanitize rich-text descriptions on write so stored HTML is always safe to
  // render with dangerouslySetInnerHTML on public pages.
  const title_th = sanitizeRichText(product.title_th).substring(0, 255);
  const title_en = sanitizeRichText(product.title_en).substring(0, 255);
  const title_zh = sanitizeRichText(product.title_zh).substring(0, 255);
  const desc_th = sanitizeRichText(product.desc_th).substring(0, 10000);
  const desc_en = sanitizeRichText(product.desc_en).substring(0, 10000);
  const desc_zh = sanitizeRichText(product.desc_zh).substring(0, 10000);
  await withTransaction(async (conn) => {
    await conn.query(
      "INSERT INTO products (id, categoryId, image, title_th, title_en, title_zh, desc_th, desc_en, desc_zh, createdAt, isPublished, sortOrder, bestSellerRank, showBestSellerBadge) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        product.id,
        product.categoryId,
        product.image,
        title_th,
        title_en,
        title_zh,
        desc_th,
        desc_en,
        desc_zh,
        product.createdAt,
        isPublished,
        product.sortOrder ?? 0,
        product.bestSellerRank ?? null,
        product.showBestSellerBadge !== false,
      ]
    );

    if (product.supplierIds && product.supplierIds.length > 0) {
      for (const supplierId of product.supplierIds) {
        await conn.query(
          "INSERT INTO product_suppliers (productId, supplierId) VALUES (?, ?)",
          [product.id, supplierId]
        );
      }
    }
  });

  return { ...product, title_th, title_en, title_zh, desc_th, desc_en, desc_zh, isPublished };
}

export async function getProduct(id: string): Promise<ProductData | undefined> {
  const [rows] = await query<RowDataPacket[]>(
    "SELECT * FROM products WHERE id = ?",
    [id]
  );
  if (rows.length === 0) return undefined;
  
  const product = rowToProduct(rows[0]);
  
  const [supplierRows] = await query<RowDataPacket[]>(
    "SELECT supplierId FROM product_suppliers WHERE productId = ?",
    [id]
  );
  product.supplierIds = supplierRows.map((r: any) => r.supplierId);
  
  return product;
}

// cache() de-dupes calls within a single request/render — pages like
// /showcase/[id] call this from several places (visibility checks, the
// visible-products list) and would otherwise re-scan the whole table each time.
export const getAllProducts = cache(async function getAllProducts(): Promise<
  ProductData[]
> {
  const [rows] = await query<RowDataPacket[]>(
    "SELECT * FROM products ORDER BY categoryId ASC, sortOrder ASC, createdAt ASC"
  );
  return rows.map(rowToProduct);
});

export async function getProductsByCategory(categoryId: number): Promise<ProductData[]> {
  const [rows] = await query<RowDataPacket[]>(
    "SELECT * FROM products WHERE categoryId = ? ORDER BY sortOrder ASC, createdAt ASC",
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
  if (updates.title_th !== undefined) set("title_th", sanitizeRichText(updates.title_th).substring(0, 255));
  if (updates.title_en !== undefined) set("title_en", sanitizeRichText(updates.title_en).substring(0, 255));
  if (updates.title_zh !== undefined) set("title_zh", sanitizeRichText(updates.title_zh).substring(0, 255));
  if (updates.desc_th !== undefined) set("desc_th", sanitizeRichText(updates.desc_th).substring(0, 10000));
  if (updates.desc_en !== undefined) set("desc_en", sanitizeRichText(updates.desc_en).substring(0, 10000));
  if (updates.desc_zh !== undefined) set("desc_zh", sanitizeRichText(updates.desc_zh).substring(0, 10000));
  
  if (updates.bestSellerRank !== undefined) {
    set("bestSellerRank", updates.bestSellerRank);
  }
  if (updates.showBestSellerBadge !== undefined) {
    set("showBestSellerBadge", updates.showBestSellerBadge !== false);
  }
  
  if (updates.isPublished !== undefined) {
    set("isPublished", updates.isPublished !== false);
    // If they explicitly publish it again, clear the pending delete status.
    if (updates.isPublished === true) {
      set("pendingDeleteAt", null);
    }
  }
  if (updates.pendingDeleteAt !== undefined) {
    set("pendingDeleteAt", updates.pendingDeleteAt);
  }

  await withTransaction(async (conn) => {
    if (sets.length > 0) {
      // Snapshot the previous value first so an accidental overwrite is restorable
      // (a failed snapshot aborts before we touch the row).
      await saveRevision("product", id, existing);
      await conn.query(
        `UPDATE products SET ${sets.join(", ")} WHERE id = ?`,
        [...values, id]
      );
    }
    
    if (updates.supplierIds !== undefined) {
      await conn.query("DELETE FROM product_suppliers WHERE productId = ?", [id]);
      if (updates.supplierIds.length > 0) {
        for (const supplierId of updates.supplierIds) {
          await conn.query(
            "INSERT INTO product_suppliers (productId, supplierId) VALUES (?, ?)",
            [id, supplierId]
          );
        }
      }
    }
  });

  return getProduct(id);
}

export async function reorderProducts(productIds: string[]): Promise<boolean> {
  return reorderByCaseWhen("products", productIds, "products");
}

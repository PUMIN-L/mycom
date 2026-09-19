import { cache } from "react";
import { unstable_cache } from "next/cache";
import { query, withTransaction } from "./db";
import { RowDataPacket, ResultSetHeader } from "mysql2";
import type { PoolConnection } from "mysql2/promise";
import type { ProductCategory, ProductData } from "./types";
import { sanitizeRichText } from "./sanitizeHtml";
import { saveRevision } from "./revisionStore";

/** Pool or transaction connection — the same narrow shape `billingPayments`
 *  uses, so a helper can be called from inside a transaction or outside one. */
type Queryable = Pick<PoolConnection, "query">;

// Re-exported so existing callers can keep importing these from "./productStore".
export type { ProductCategory, ProductData } from "./types";

// Single source of truth for "may anonymous callers see this product" — used
// everywhere a product (or something linked to one, like its CMS content)
// gets exposed to a caller that might not be logged in.
export function isProductPublic(product: Pick<ProductData, "isPublished" | "pendingDeleteAt">): boolean {
  return product.isPublished !== false && !product.pendingDeleteAt;
}

export class BestSellerRankConflictError extends Error {
  constructor(public rank: number) {
    super(`Best seller rank ${rank} is already assigned to another product`);
    this.name = "BestSellerRankConflictError";
  }
}

// ── Categories ────────────────────────────────────────────────────────────────

// Whole-table reads, cached across requests under the "products" tag.
//
// WHY THAT TAG: every route that writes a product or a category already calls
// `revalidateTag("products", { expire: 0 })` (10 call sites across
// app/api/products/**, plus the revision-restore route), because that is the
// tag getProductsData.ts uses for the homepage. Reusing it means an admin's
// save busts these caches too — there is no window where the CMS shows one
// thing and the public page another.
//
// `revalidate` is a backstop, not the mechanism: a write that never goes
// through those routes (a direct SQL edit, or a future route that forgets the
// tag) would otherwise leave a cache nothing ever invalidates.
const CATALOG_CACHE_TTL_SECONDS = 300;

export const getAllCategories = cache(
  unstable_cache(
    async function fetchAllCategories(): Promise<ProductCategory[]> {
      const [rows] = await query<RowDataPacket[]>(
        "SELECT * FROM product_categories ORDER BY sortOrder ASC"
      );
      return rows as ProductCategory[];
    },
    // Distinct from getProductsData's ["products_data"] — same tag, different
    // payload shape, so they must not share a cache entry.
    ["categories_all"],
    { tags: ["products"], revalidate: CATALOG_CACHE_TTL_SECONDS }
  )
);

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

// Do these two supplier-id lists hold the same suppliers? Order-insensitive on
// purpose (see the call site in updateProduct): both sides are sorted copies —
// the inputs are never mutated — and duplicates still have to line up one for
// one, so this is set equality on a multiset, not just "same members".
function sameSupplierSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((id, i) => id === sortedB[i]);
}

/**
 * The product INSERT, with `uq_products_bestSellerRank` translated into the
 * same Thai refusal the pre-check raises.
 *
 * The unique index — not the SELECT above it — is what makes "one product per
 * rank" true, because the pre-check cannot lock a row that does not exist yet.
 * A duplicate key here therefore means a genuine race with another admin, and
 * it must read as the collision it is rather than as "บันทึกไม่สำเร็จ".
 *
 * Only the RANK can collide: `products.id` is a freshly minted uuid, so the
 * error is only re-attributed when this save was actually setting a rank.
 */
async function insertProductRow(
  conn: Queryable,
  product: ProductData,
  cleaned: {
    title_th: string;
    title_en: string;
    title_zh: string;
    desc_th: string;
    desc_en: string;
    desc_zh: string;
    isPublished: boolean;
    sortOrder: number;
  }
): Promise<void> {
  try {
    await conn.query(
      "INSERT INTO products (id, categoryId, image, title_th, title_en, title_zh, desc_th, desc_en, desc_zh, createdAt, isPublished, sortOrder, bestSellerRank, showBestSellerBadge) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        product.id,
        product.categoryId,
        product.image,
        cleaned.title_th,
        cleaned.title_en,
        cleaned.title_zh,
        cleaned.desc_th,
        cleaned.desc_en,
        cleaned.desc_zh,
        product.createdAt,
        cleaned.isPublished,
        cleaned.sortOrder,
        product.bestSellerRank ?? null,
        product.showBestSellerBadge !== false,
      ]
    );
  } catch (error) {
    const isDup = (error as { code?: string })?.code === "ER_DUP_ENTRY";
    if (isDup && product.bestSellerRank != null) {
      throw new BestSellerRankConflictError(product.bestSellerRank);
    }
    throw error;
  }
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
  let sortOrder = product.sortOrder;
  await withTransaction(async (conn) => {
    if (sortOrder === undefined) {
      // Append to the end of the product's own category instead of defaulting
      // to 0, which would reshuffle a manually-curated catalog order every
      // time an admin adds a new product.
      const [rows] = await conn.query<RowDataPacket[]>(
        "SELECT COALESCE(MAX(sortOrder), -1) + 1 AS nextSort FROM products WHERE categoryId = ?",
        [product.categoryId]
      );
      sortOrder = rows[0].nextSort as number;
    }

    if (product.bestSellerRank != null) {
      // A COURTESY CHECK, NOT THE GUARANTEE. It catches the ordinary case — a
      // rank taken before this admin opened the form — and turns it into a Thai
      // message instead of a database error. It CANNOT catch two saves racing:
      // the row being claimed does not exist yet, and TiDB takes no gap lock on
      // a row that does not exist, so both readers see nothing. That is why the
      // rank now carries `uq_products_bestSellerRank` (db.ts v40) and why the
      // INSERT below is wrapped — the index is what actually refuses the second
      // writer, exactly as `saveQuotationAtomic` claims a docNo.
      const [rankRows] = await conn.query<RowDataPacket[]>(
        "SELECT id FROM products WHERE bestSellerRank = ?",
        [product.bestSellerRank]
      );
      if (rankRows.length > 0) {
        throw new BestSellerRankConflictError(product.bestSellerRank);
      }
    }

    await insertProductRow(conn, product, {
      title_th,
      title_en,
      title_zh,
      desc_th,
      desc_en,
      desc_zh,
      isPublished,
      sortOrder: sortOrder as number,
    });

    if (product.supplierIds && product.supplierIds.length > 0) {
      for (const supplierId of product.supplierIds) {
        await conn.query(
          "INSERT INTO product_suppliers (productId, supplierId) VALUES (?, ?)",
          [product.id, supplierId]
        );
      }
    }
  });

  return { ...product, title_th, title_en, title_zh, desc_th, desc_en, desc_zh, isPublished, sortOrder };
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
// Cached across requests under the "products" tag — see the note above
// getAllCategories for why that tag, and why there is a TTL as well.
export const getAllProducts = cache(
  unstable_cache(
    async function fetchAllProducts(): Promise<ProductData[]> {
      const [rows] = await query<RowDataPacket[]>(
        "SELECT * FROM products ORDER BY categoryId ASC, sortOrder ASC, createdAt ASC"
      );
      return rows.map(rowToProduct);
    },
    ["products_all"],
    { tags: ["products"], revalidate: CATALOG_CACHE_TTL_SECONDS }
  )
);

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
  //
  // ── NO CHANGE, NO SNAPSHOT ────────────────────────────────────────────────
  // `changed` is the third argument to set(): does this column's NEW value
  // differ from what the row already holds? It decides ONE thing — whether a
  // revision is written. The SET list, and therefore the UPDATE and the row it
  // produces, is built exactly as it was before.
  //
  // Which fields were SUPPLIED used to stand in for which fields changed, and
  // the two are not the same thing: the edit form posts every field on every
  // save, so `sets.length > 0` was true even for opening a product and pressing
  // save without touching it. Each of those spent one of the
  // REVISION_KEEP.product = 20 slots this product's history has on a copy of a
  // value that was never overwritten — and 20 such saves leave a history in
  // which every surviving entry restores what is already there.
  //
  // Every comparison is against the value the UPDATE WILL WRITE (post
  // sanitizeRichText, post substring), never the raw `updates` field. Compare
  // the raw field and a save whose only difference was markup the sanitizer
  // strips — or text past the cap — still looks like an edit and snapshots a
  // value identical to the live row.
  const sets: string[] = [];
  const values: unknown[] = [];
  let changed = false;
  const set = (col: string, val: unknown, differs: boolean) => {
    sets.push(`${col} = ?`);
    values.push(val);
    if (differs) changed = true;
  };
  // Sanitize + truncate FIRST, compare the result. `current` is the value
  // rowToProduct read back for this column, i.e. what a previous write of it
  // left behind — with its NULL already normalised to "" (rowToProduct does
  // `?? ""`), so writing "" over a stored NULL is not counted as an edit:
  // nothing that reads this row can tell the two apart.
  const setText = (col: string, raw: string, cap: number, current: string) => {
    const value = sanitizeRichText(raw).substring(0, cap);
    set(col, value, value !== current);
  };

  if (updates.categoryId !== undefined) set("categoryId", updates.categoryId, updates.categoryId !== existing.categoryId);
  if (updates.image !== undefined) set("image", updates.image, updates.image !== existing.image);
  if (updates.title_th !== undefined) setText("title_th", updates.title_th, 255, existing.title_th);
  if (updates.title_en !== undefined) setText("title_en", updates.title_en, 255, existing.title_en);
  if (updates.title_zh !== undefined) setText("title_zh", updates.title_zh, 255, existing.title_zh);
  if (updates.desc_th !== undefined) setText("desc_th", updates.desc_th, 10000, existing.desc_th);
  if (updates.desc_en !== undefined) setText("desc_en", updates.desc_en, 10000, existing.desc_en);
  if (updates.desc_zh !== undefined) setText("desc_zh", updates.desc_zh, 10000, existing.desc_zh);

  if (updates.bestSellerRank !== undefined) {
    // Written raw, so compared raw. rowToProduct already normalises a stored
    // NULL to null, so "not a best seller" saved over "not a best seller" is
    // not an edit.
    set(
      "bestSellerRank",
      updates.bestSellerRank,
      (updates.bestSellerRank ?? null) !== (existing.bestSellerRank ?? null)
    );
  }
  if (updates.showBestSellerBadge !== undefined) {
    // Compare the coerced boolean that is written, not the incoming value —
    // any truthy-but-not-`false` input writes the same `true`.
    const showBadge = updates.showBestSellerBadge !== false;
    set("showBestSellerBadge", showBadge, showBadge !== (existing.showBestSellerBadge !== false));
  }

  if (updates.isPublished !== undefined) {
    const isPublished = updates.isPublished !== false;
    set("isPublished", isPublished, isPublished !== (existing.isPublished !== false));
    // If they explicitly publish it again, clear the pending delete status.
    if (updates.isPublished === true) {
      // …which only changes the row when a delete was actually pending.
      // Re-publishing an already-published product writes NULL over NULL.
      set("pendingDeleteAt", null, (existing.pendingDeleteAt ?? null) !== null);
    }
  }
  if (updates.pendingDeleteAt !== undefined) {
    set(
      "pendingDeleteAt",
      updates.pendingDeleteAt,
      (updates.pendingDeleteAt ?? null) !== (existing.pendingDeleteAt ?? null)
    );
  }

  // `supplierIds` is not a column of `products` and so writes no SET — but it
  // IS part of every product snapshot (getProduct attaches it) and a restore
  // re-applies it (`updateProduct(rev.entityId, data)` in the restore route),
  // and the edit form posts it alongside every column. Before this change, a
  // save that touched ONLY the supplier list still wrote a revision, because
  // the same form also posted the columns and `sets.length > 0` held. It has
  // to keep writing one: silently dropping history for a real edit is the
  // failure this whole change must not introduce.
  //
  // Compared as a SET, not as a list: `product_suppliers` has no ordering
  // column and getProduct reads it back with no ORDER BY, so the order of the
  // array carries no meaning and must not be mistaken for a change.
  if (
    updates.supplierIds !== undefined &&
    !sameSupplierSet(updates.supplierIds, existing.supplierIds ?? [])
  ) {
    changed = true;
  }

  await withTransaction(async (conn) => {
    if (
      updates.bestSellerRank != null &&
      updates.bestSellerRank !== existing.bestSellerRank
    ) {
      // Same courtesy check as addProduct, and with the same limit: it turns an
      // already-taken rank into a Thai message, but it is
      // `uq_products_bestSellerRank` that refuses a true race — see the UPDATE
      // below, which translates the duplicate-key error the index raises.
      // `FOR UPDATE` is gone because it was never doing anything: on the common
      // path it locks nothing (no row holds the rank), and where a row DOES
      // hold it we refuse immediately, so there is nothing left to protect.
      const [rankRows] = await conn.query<RowDataPacket[]>(
        "SELECT id FROM products WHERE bestSellerRank = ? AND id != ?",
        [updates.bestSellerRank, id]
      );
      if (rankRows.length > 0) {
        throw new BestSellerRankConflictError(updates.bestSellerRank);
      }
    }

    if (sets.length > 0) {
      // Snapshot the previous value first so an accidental overwrite is restorable
      // (a failed snapshot aborts before we touch the row). Runs through this
      // transaction's own connection so a retry (withTransaction retries the
      // whole callback on a transient error) can't leave a duplicate snapshot.
      //
      // Only when something the save writes actually differs — a snapshot of a
      // row nothing overwrote could restore nothing, and would cost a slot in
      // a 20-deep history. `changed` is computed before the transaction opens
      // from values nothing in here mutates, so all of withTransaction's
      // up-to-3 attempts decide the same way and the callback stays idempotent.
      if (changed) {
        await saveRevision("product", id, existing, conn);
      }
      try {
        await conn.query(
          `UPDATE products SET ${sets.join(", ")} WHERE id = ?`,
          [...values, id]
        );
      } catch (error) {
        // The unique index on the rank, reported as the collision it is. Only
        // claimed when this save actually SETS a rank — an unrelated duplicate
        // key must keep its own error rather than be mislabelled.
        const isDup = (error as { code?: string })?.code === "ER_DUP_ENTRY";
        if (isDup && updates.bestSellerRank != null) {
          throw new BestSellerRankConflictError(updates.bestSellerRank);
        }
        throw error;
      }
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

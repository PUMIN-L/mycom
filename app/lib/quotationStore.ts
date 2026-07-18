import { query } from "./db";
import type { RowDataPacket } from "mysql2";
import { deleteCloudinaryImages } from "./cloudinaryHelper";

// Persisted quotations. `data` is the opaque client QuoteState (stored as JSON).
// `uploadedImages` lists ONLY the Cloudinary images uploaded specifically for
// this quotation — never catalog/product images — so deleting a quotation can
// safely purge its images without touching product photos.
export interface QuotationRecord {
  id: string;
  docNo: string;
  data: unknown;
  uploadedImages: string[];
  createdAt: string;
}

// mysql2 may return JSON columns already parsed (object) or as a string.
function parseJson<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return value as T;
}

/**
 * Every Cloudinary image URL currently referenced by a product or content —
 * i.e. shared/in-use assets that a quotation delete must NEVER destroy, even if
 * one slipped into `uploadedImages` (client bug or crafted request). This is the
 * server backstop for the image-deletion safety invariant.
 */
async function getReferencedImageUrls(): Promise<Set<string>> {
  const urls = new Set<string>();
  const [products] = await query<RowDataPacket[]>("SELECT image FROM products");
  for (const p of products) if (p.image) urls.add(String(p.image));
  const [contents] = await query<RowDataPacket[]>("SELECT blocks FROM contents");
  for (const c of contents) {
    for (const b of parseJson<Array<Record<string, unknown>>>(c.blocks, [])) {
      if (typeof b?.imageUrl === "string") urls.add(b.imageUrl);
      if (Array.isArray(b?.imageUrls)) {
        for (const u of b.imageUrls) if (typeof u === "string") urls.add(u);
      }
    }
  }
  return urls;
}

/** Drop any URL still referenced by the catalog before we destroy it. */
async function deleteQuoteImagesSafely(images: string[]): Promise<void> {
  if (images.length === 0) return;
  const inUse = await getReferencedImageUrls();
  const safeToDelete = images.filter((u) => !inUse.has(u));
  if (safeToDelete.length > 0) await deleteCloudinaryImages(safeToDelete);
}

function rowToQuotation(row: RowDataPacket): QuotationRecord {
  return {
    id: row.id,
    docNo: row.docNo ?? "",
    data: parseJson(row.data, {}),
    uploadedImages: parseJson<string[]>(row.uploadedImages, []),
    createdAt: row.createdAt,
  };
}

/** Upsert a quotation. Re-saving the same id refreshes its 30-day clock. */
export async function saveQuotation(rec: QuotationRecord): Promise<void> {
  await query(
    `INSERT INTO quotations (id, docNo, data, uploadedImages, createdAt)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       docNo = VALUES(docNo), data = VALUES(data),
       uploadedImages = VALUES(uploadedImages), createdAt = VALUES(createdAt)`,
    [
      rec.id,
      rec.docNo,
      JSON.stringify(rec.data),
      JSON.stringify(rec.uploadedImages),
      rec.createdAt,
    ]
  );
}

export async function getQuotation(id: string): Promise<QuotationRecord | null> {
  const [rows] = await query<RowDataPacket[]>(
    "SELECT * FROM quotations WHERE id = ?",
    [id]
  );
  return rows.length > 0 ? rowToQuotation(rows[0]) : null;
}

// ── Saved-quotations list ────────────────────────────────────────────────────
export interface QuotationSummary {
  id: string;
  docNo: string;
  createdAt: string;
  customer: string;
  total: number;
}

interface QuoteDataLite {
  items?: Array<{ qty?: number; unitPrice?: number }>;
  discount?: number;
  discountType?: string;
  vatEnabled?: boolean;
  customerCompany?: string;
  customerContact?: string;
}

// Recompute the grand total for the list view (mirrors the client's math).
function summarize(data: QuoteDataLite): { customer: string; total: number } {
  const items = Array.isArray(data.items) ? data.items : [];
  const subtotal = items.reduce(
    (s, it) => s + (Number(it.qty) || 0) * (Number(it.unitPrice) || 0),
    0
  );
  const d = Math.max(Number(data.discount) || 0, 0);
  const disc =
    data.discountType === "percent"
      ? (subtotal * Math.min(d, 100)) / 100
      : Math.min(d, subtotal);
  const afterDisc = subtotal - disc;
  const total = afterDisc + (data.vatEnabled ? afterDisc * 0.07 : 0);
  return {
    customer: data.customerCompany || data.customerContact || "-",
    total,
  };
}

export async function listQuotations(): Promise<QuotationSummary[]> {
  const [rows] = await query<RowDataPacket[]>(
    "SELECT id, docNo, data, createdAt FROM quotations ORDER BY createdAt DESC"
  );
  return rows.map((r) => {
    const { customer, total } = summarize(parseJson<QuoteDataLite>(r.data, {}));
    return { id: r.id, docNo: r.docNo ?? "", createdAt: r.createdAt, customer, total };
  });
}

/**
 * Delete a quotation and its uploaded images from Cloudinary. Catalog images
 * are never in `uploadedImages`, so product photos are unaffected.
 * Returns false if the quotation didn't exist.
 */
export async function deleteQuotation(id: string): Promise<boolean> {
  const rec = await getQuotation(id);
  if (!rec) return false;
  await deleteQuoteImagesSafely(rec.uploadedImages);
  await query("DELETE FROM quotations WHERE id = ?", [id]);
  return true;
}

/**
 * Purge quotations older than `days` days, deleting each one's uploaded images
 * from Cloudinary first. ISO-8601 `createdAt` sorts chronologically as text, so
 * a lexical `< cutoff` comparison is correct. Returns how many were purged.
 */
export async function purgeExpiredQuotations(days: number): Promise<number> {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const [rows] = await query<RowDataPacket[]>(
    "SELECT id, uploadedImages FROM quotations WHERE createdAt < ?",
    [cutoff]
  );
  if (rows.length === 0) return 0;

  const images = rows.flatMap((r) => parseJson<string[]>(r.uploadedImages, []));
  await deleteQuoteImagesSafely(images);

  await query("DELETE FROM quotations WHERE createdAt < ?", [cutoff]);
  return rows.length;
}

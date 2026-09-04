import { query, withTransaction } from "./db";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { computeQuoteTotals } from "./quotationTotals";

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
 * Previously deleted orphaned images. Now a no-op: images from quotation
 * cleanup will be picked up by the Orphan Scanner for manual review (which
 * itself checks quotations/billing_documents/products/documents/contents
 * before treating anything as deletable — see app/lib/imageUsageHelper.ts).
 * Cron jobs have no UI to show a confirmation dialog.
 */
async function deleteQuoteImagesSafely(images: string[]): Promise<void> {
  if (images.length === 0) return;
  console.log(`[quotationStore] Skipping auto-delete of ${images.length} images (manual confirmation required). URLs: ${images.join(", ")}`);
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

/** Thrown by saveQuotationAtomic when the docNo is owned by a different quote. */
export class DocNoConflictError extends Error {
  constructor(public readonly docNo: string) {
    super(`docNo ${docNo} is already reserved by another quotation`);
    this.name = "DocNoConflictError";
  }
}

/**
 * Save a quotation AND reserve its docNo atomically, in one transaction.
 *
 * The old flow (check owner → save → reserve as three independent queries) had
 * two holes: (1) if the save committed but the reserve failed, the quote lived
 * with NO ledger entry, so a later quote saw the number as free and reused it;
 * (2) two concurrent saves of the same new number both read owner=null and both
 * won — this second hole was NOT actually closed by a prior fix that locked the
 * ledger row `FOR UPDATE` before checking it, because TiDB does not take a gap
 * lock via `SELECT ... FOR UPDATE` on a row that doesn't exist yet (verified
 * against TiDB's docs) — so that lock was a no-op for a brand-new docNo and two
 * concurrent saves could still both pass the check.
 *
 * The actual fix: claim the docNo via an INSERT into `used_docnos`, whose
 * PRIMARY KEY on `docNo` is a real constraint the DB always enforces — a
 * concurrent duplicate INSERT genuinely fails with ER_DUP_ENTRY, no gap lock
 * required. Only once the row is known to already exist does `FOR UPDATE`
 * reliably take a lock (existing-row locks work fine on TiDB), so the
 * ownership check below is race-safe there.
 */
export async function saveQuotationAtomic(rec: QuotationRecord): Promise<void> {
  await withTransaction(async (conn) => {
    if (rec.docNo) {
      try {
        await conn.query(
          "INSERT INTO used_docnos (docNo, quotationId, createdAt) VALUES (?, ?, ?)",
          [rec.docNo, rec.id, rec.createdAt]
        );
      } catch (err) {
        if ((err as { code?: string })?.code !== "ER_DUP_ENTRY") throw err;
        // Someone already claimed this docNo (possibly this same quote on an
        // earlier save) — the row now genuinely exists, so this lock is real.
        const [rows] = await conn.query<RowDataPacket[]>(
          "SELECT quotationId FROM used_docnos WHERE docNo = ? FOR UPDATE",
          [rec.docNo]
        );
        if (rows.length === 0 || String(rows[0].quotationId) !== rec.id) {
          throw new DocNoConflictError(rec.docNo);
        }
        await conn.query(
          "UPDATE used_docnos SET createdAt = ? WHERE docNo = ?",
          [rec.createdAt, rec.docNo]
        );
      }
    }
    await conn.query(
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
  });
}

// ── Issued quotation-number ledger (used_docnos) ─────────────────────────────
// Separate from `quotations` so a number stays reserved even after its
// quotation is deleted/auto-purged. Kept ~2 days (docNo is date-prefixed).

export interface UsedDocNo {
  docNo: string;
  quotationId: string;
}

/** The quotation that owns this docNo, or null if it's free. */
export async function getDocNoOwner(docNo: string): Promise<string | null> {
  const [rows] = await query<RowDataPacket[]>(
    "SELECT quotationId FROM used_docnos WHERE docNo = ? LIMIT 1",
    [docNo]
  );
  return rows.length > 0 ? String(rows[0].quotationId) : null;
}

/** Reserve a docNo for a quotation (idempotent; refreshes the 2-day clock). */
export async function reserveDocNo(
  docNo: string,
  quotationId: string,
  createdAt: string
): Promise<void> {
  await query(
    `INSERT INTO used_docnos (docNo, quotationId, createdAt) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE createdAt = VALUES(createdAt)`,
    [docNo, quotationId, createdAt]
  );
}

/** All currently-reserved numbers from the last 7 days. */
export async function listRecentDocNos(): Promise<UsedDocNo[]> {
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const [rows] = await query<RowDataPacket[]>(
    "SELECT docNo, quotationId FROM used_docnos WHERE createdAt >= ?",
    [cutoff]
  );
  return rows.map((r) => ({ docNo: r.docNo, quotationId: String(r.quotationId) }));
}

/** Purge reserved numbers older than `days` days. Returns how many were removed. */
export async function purgeOldDocNos(days: number): Promise<number> {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const [res] = await query<ResultSetHeader>(
    "DELETE FROM used_docnos WHERE createdAt < ?",
    [cutoff]
  );
  return res.affectedRows ?? 0;
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
  discountType?: "amount" | "percent";
  vatEnabled?: boolean;
  customerCompany?: string;
  customerContact?: string;
}

// Grand total for the list view — same math as the builder (computeQuoteTotals).
function summarize(data: QuoteDataLite): { customer: string; total: number } {
  return {
    customer: data.customerCompany || data.customerContact || "-",
    total: computeQuoteTotals(data).grandTotal,
  };
}

// Quotations are auto-purged after 30 days (see purgeExpiredQuotations), so
// this table never holds more than ~30 days of drafts under normal
// operation — the LIMIT here is a generous safety cap (in case the cleanup
// cron is ever misconfigured/failing), not the real bound. It used to be a
// tight 200, which meant more than ~7 quotations/day would silently push
// still-live (not yet purged) drafts off the bottom of the list.
const LIST_SAFETY_LIMIT = 2000;

export async function listQuotations(): Promise<QuotationSummary[]> {
  const [rows] = await query<RowDataPacket[]>(
    `SELECT id, docNo, data, createdAt FROM quotations ORDER BY createdAt DESC LIMIT ${LIST_SAFETY_LIMIT}`
  );
  return rows.map((r) => {
    const { customer, total } = summarize(parseJson<QuoteDataLite>(r.data, {}));
    return { id: r.id, docNo: r.docNo ?? "", createdAt: r.createdAt, customer, total };
  });
}

/**
 * Delete a quotation. Returns the list of uploaded image URLs that are now
 * orphaned (the caller/UI should show a confirmation dialog before deleting
 * them from Cloudinary). Returns null if the quotation didn't exist.
 */
export async function deleteQuotation(id: string): Promise<{ orphanedImages: string[] } | null> {
  const rec = await getQuotation(id);
  if (!rec) return null;
  // No auto-delete — just log. Images are returned for client-side confirmation.
  await deleteQuoteImagesSafely(rec.uploadedImages);
  await query("DELETE FROM quotations WHERE id = ?", [id]);
  // Filter to only Cloudinary URLs
  const orphanedImages = rec.uploadedImages.filter((u) => u.includes("cloudinary.com"));
  return { orphanedImages };
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

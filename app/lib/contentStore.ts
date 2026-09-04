import { cache } from "react";
import { query, withTransaction } from "./db";
import { RowDataPacket, ResultSetHeader } from "mysql2";
import type { ContentBlock, ContentData, ContentMeta } from "./types";
import { sanitizeRichText, sanitizePlainText } from "./sanitizeHtml";
import { saveRevision } from "./revisionStore";

// Re-exported so existing callers can keep importing these from "./contentStore".
export type { ContentBlock, ContentData, ContentMeta } from "./types";

/** Thrown by addContent()/updateContent() when the target product already has
 * a DIFFERENT content linked to it — "one content per product" is an
 * invariant, not just a UI hint. */
export class ContentProductConflictError extends Error {
  constructor(public readonly productId: string) {
    super(`product ${productId} already has a content linked to it`);
    this.name = "ContentProductConflictError";
  }
}

// Sanitize the rich-text HTML on every block before it is stored, so content
// rendered later with dangerouslySetInnerHTML on public pages is always safe.
// youtubeUrl is never rendered as HTML (it's parsed into a video id and set as
// an iframe src attribute — see app/components/YoutubeEmbed.tsx), but it's
// still free text a client controls, so strip any tags and cap its length
// like every other plain-text field in this codebase.
function sanitizeBlocks(blocks: ContentBlock[]): ContentBlock[] {
  return blocks.map((b) => {
    let block = b;
    if (block.content !== undefined) {
      block = { ...block, content: sanitizeRichText(block.content) };
    }
    if (block.youtubeUrl !== undefined) {
      block = { ...block, youtubeUrl: sanitizePlainText(block.youtubeUrl).substring(0, 500) };
    }
    return block;
  });
}

// `blocks` is stored as a JSON column. mysql2 may hand it back already parsed
// (object) or as a raw string depending on driver/column config, so handle both.
// A corrupt/truncated value degrades to an empty block list (logged) rather than
// throwing — one bad row must not 500 the entire showcase list.
function parseBlocks(raw: unknown, contentId?: string): ContentBlock[] {
  if (!raw) return [];
  if (typeof raw !== "string") return raw as ContentBlock[];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    console.error(
      `contentStore: failed to parse blocks JSON for content ${contentId ?? "?"} — treating as empty`
    );
    return [];
  }
}

function rowToContent(row: RowDataPacket): ContentData {
  return {
    id: row.id,
    title: row.title,
    blocks: parseBlocks(row.blocks, row.id),
    createdAt: row.createdAt,
    productId: row.productId ?? null,
  };
}

export async function addContent(content: ContentData): Promise<ContentData> {
  const blocks = sanitizeBlocks(content.blocks);
  const sanitizedTitle = sanitizeRichText(content.title).substring(0, 255);
  const productId = content.productId ?? null;

  await withTransaction(async (conn) => {
    if (productId) {
      // Re-check against the live row, not just the route's earlier read —
      // that check-then-insert has a race window two concurrent creates for
      // the same product can both pass. Once a row for this productId
      // exists, FOR UPDATE reliably locks it (TiDB doesn't gap-lock a row
      // that doesn't exist yet, but this only needs to catch an EXISTING
      // claim).
      const [rows] = await conn.query<RowDataPacket[]>(
        "SELECT id FROM contents WHERE productId = ? FOR UPDATE",
        [productId]
      );
      if (rows.length > 0) {
        throw new ContentProductConflictError(productId);
      }
    }
    await conn.query(
      "INSERT INTO contents (id, title, blocks, createdAt, productId) VALUES (?, ?, ?, ?, ?)",
      [content.id, sanitizedTitle, JSON.stringify(blocks), content.createdAt, productId]
    );
  });

  return { ...content, title: sanitizedTitle, blocks };
}

// cache() de-dupes calls with the same id within a single request/render —
// e.g. generateMetadata and the page component both need this content, and
// without it each showcase pageview hit the DB for it twice.
export const getContent = cache(async function getContent(
  id: string
): Promise<ContentData | undefined> {
  const [rows] = await query<RowDataPacket[]>(
    "SELECT * FROM contents WHERE id = ?",
    [id]
  );

  if (rows.length === 0) {
    return undefined;
  }

  return rowToContent(rows[0]);
});

export async function getAllContents(): Promise<ContentData[]> {
  const [rows] = await query<RowDataPacket[]>(
    "SELECT * FROM contents ORDER BY createdAt DESC"
  );

  return rows.map(rowToContent);
}

// Like getAllContents but returns metadata only (block counts computed
// server-side) — used by the showcase list and the related-content list, which
// never render block bodies. Avoids serializing ~120KB of blocks JSON to the
// client. Note: still reads blocks from the DB to count them; the win is the
// client payload, not the query.
export const getAllContentsMeta = cache(async function getAllContentsMeta(): Promise<
  ContentMeta[]
> {
  const [rows] = await query<RowDataPacket[]>(
    "SELECT id, title, blocks, createdAt, productId FROM contents ORDER BY createdAt DESC"
  );
  return rows.map((row) => {
    const blocks = parseBlocks(row.blocks, row.id);
    return {
      id: row.id,
      title: row.title,
      createdAt: row.createdAt,
      productId: row.productId ?? null,
      textCount: blocks.filter((b) => b.type === "text").length,
      imageCount: blocks.filter((b) => b.type === "image").length,
    };
  });
});

export async function getContentByProductId(
  productId: string
): Promise<ContentData | undefined> {
  const [rows] = await query<RowDataPacket[]>(
    "SELECT * FROM contents WHERE productId = ? ORDER BY createdAt DESC LIMIT 1",
    [productId]
  );

  if (rows.length === 0) return undefined;

  return rowToContent(rows[0]);
}

export async function deleteContent(id: string): Promise<boolean> {
  const [result] = await query<ResultSetHeader>(
    "DELETE FROM contents WHERE id = ?",
    [id]
  );
  return result.affectedRows > 0;
}

export async function updateContent(
  id: string,
  updatedContent: Partial<ContentData>
): Promise<ContentData | undefined> {
  const existing = await getContent(id);
  if (!existing) {
    return undefined;
  }

  const title = updatedContent.title !== undefined ? sanitizeRichText(updatedContent.title).substring(0, 255) : existing.title;
  const blocks = sanitizeBlocks(
    updatedContent.blocks !== undefined ? updatedContent.blocks : existing.blocks
  );
  const createdAt = updatedContent.createdAt !== undefined ? updatedContent.createdAt : existing.createdAt;
  // Allow explicit null to unlink, undefined = keep existing
  const productId =
    "productId" in updatedContent
      ? updatedContent.productId ?? null
      : existing.productId ?? null;

  // Only SET the columns actually supplied, so concurrent edits to different
  // fields don't clobber each other via a full-row write.
  const sets: string[] = [];
  const values: unknown[] = [];
  const set = (col: string, val: unknown) => {
    sets.push(`${col} = ?`);
    values.push(val);
  };
  if (updatedContent.title !== undefined) set("title", title);
  if (updatedContent.blocks !== undefined) set("blocks", JSON.stringify(blocks));
  if (updatedContent.createdAt !== undefined) set("createdAt", createdAt);
  if ("productId" in updatedContent) set("productId", productId);

  if (sets.length > 0) {
    if (productId && productId !== existing.productId) {
      // Same race guard as addContent — re-linking an EXISTING content to a
      // different product is a sequential bug otherwise, not just a race: the
      // old check-then-update let any caller silently create a second
      // content for a product that already has one.
      await withTransaction(async (conn) => {
        const [rows] = await conn.query<RowDataPacket[]>(
          "SELECT id FROM contents WHERE productId = ? AND id != ? FOR UPDATE",
          [productId, id]
        );
        if (rows.length > 0) {
          throw new ContentProductConflictError(productId);
        }
        // Snapshot the previous value first so an accidental overwrite is
        // restorable (a failed snapshot aborts before we touch the row) —
        // only reached once the conflict check has already passed. Runs
        // through this transaction's own connection so a retry (withTransaction
        // retries the whole callback on a transient error) can't leave a
        // duplicate snapshot.
        await saveRevision("content", id, existing, conn);
        await conn.query(
          `UPDATE contents SET ${sets.join(", ")} WHERE id = ?`,
          [...values, id]
        );
      });
    } else {
      await saveRevision("content", id, existing);
      await query(
        `UPDATE contents SET ${sets.join(", ")} WHERE id = ?`,
        [...values, id]
      );
    }
  }

  return { id, title, blocks, createdAt, productId };
}

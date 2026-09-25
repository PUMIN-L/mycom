import { cache } from "react";
import { unstable_cache } from "next/cache";
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

// ── Comparing two block lists ─────────────────────────────────────────────
//
// Used by updateContent to answer ONE question: would the UPDATE it is about
// to run actually change `contents.blocks`? That cannot be answered by
// comparing the string we are about to write with the string in the row:
//
//   • the stored side may arrive from the driver already parsed (see
//     parseBlocks below) rather than as the bytes that were written, and a
//     JSON column does not promise to hand back the key order it was given;
//   • `===` on the parsed arrays compares object identity, and the editor
//     rebuilds every block object on every keystroke, so it is never equal;
//   • a hand-rolled deep-equal is one missed branch away from reporting "no
//     change" for a real edit, which is the one failure this must not have.
//
// So BOTH sides go through the SAME pipeline — sanitizeBlocks(), then this
// serializer — and the two strings are compared. Sorting object keys at every
// level is what makes the result independent of the order each side happens
// to carry (one comes from the request body, the other from the database):
// two blocks holding the same fields in a different order are the same block
// to every reader of this data, which only ever accesses properties by name.
// Array order is NOT sorted and never can be — it is the order the blocks
// render in on the page. Keys whose value is `undefined` are dropped by
// JSON.stringify on both sides alike, and an undefined-valued key is
// indistinguishable from an absent one once stored.
//
// This canonical form is for COMPARISON ONLY. The value written to the column
// is still a plain JSON.stringify(blocks), byte for byte what it always was.
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(src).sort()) out[key] = canonicalize(src[key]);
    return out;
  }
  return value;
}

// Takes blocks that have ALREADY been through sanitizeBlocks(), so that each
// side of a comparison gets exactly ONE sanitize pass over its own source —
// never one side sanitized twice and the other once, which would report a
// difference for a value that is not different (and cost a second sanitize of
// a document that can run to hundreds of KB).
function canonicalBlocksJson(sanitized: ContentBlock[]): string {
  return JSON.stringify(canonicalize(sanitized));
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
    updatedAt: row.updatedAt ?? null,
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

// Like getAllContents but returns metadata only — used by the showcase list,
// the related-content list and the sitemap, none of which render block bodies.
//
// `blocks` is deliberately NOT selected: this runs on every /showcase/[id] view
// and every sitemap fetch (both force-dynamic), so reading and parsing the whole
// block JSON of every row meant a full-table blob scan per public pageview.
//
// Cached across requests under the "products" tag. That tag is shared with the
// product/category reads rather than given a "contents" name of its own, on
// purpose: hard-deleting a product CASCADES into deleting its linked content
// (app/lib/productDeleter.ts), and that route only ever busts "products". A
// separate tag would leave this cache holding a content row the database no
// longer has — and the sitemap would then advertise a /showcase/{id} that 404s,
// which is the exact bug commit 5b0f220 fixed. Sharing the tag makes that
// failure structurally impossible; the price is some over-invalidation.
export const getAllContentsMeta = cache(
  unstable_cache(
    async function fetchAllContentsMeta(): Promise<ContentMeta[]> {
      const [rows] = await query<RowDataPacket[]>(
        "SELECT id, title, createdAt, productId, updatedAt FROM contents ORDER BY createdAt DESC"
      );
      return rows.map((row) => ({
        id: row.id,
        title: row.title,
        createdAt: row.createdAt,
        productId: row.productId ?? null,
        updatedAt: row.updatedAt ?? null,
      }));
    },
    ["contents_meta"],
    { tags: ["products"], revalidate: 300 }
  )
);

// Every content linked to a product, bodies included. Unlike
// getContentByProductId this has no LIMIT: "one content per product" is an
// invariant the write paths enforce, but a deleter that trusted it would leave
// orphan rows behind if it were ever violated. Served by idx_contents_productId.
export async function getContentsByProductId(
  productId: string
): Promise<ContentData[]> {
  const [rows] = await query<RowDataPacket[]>(
    "SELECT * FROM contents WHERE productId = ? ORDER BY createdAt DESC",
    [productId]
  );
  return rows.map(rowToContent);
}

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
  //
  // ── NO CHANGE, NO SNAPSHOT ────────────────────────────────────────────────
  // `changed` is the third argument to set(): does this column's NEW value
  // differ from what the row already holds? It decides ONE thing — whether a
  // revision is written. The SET list, and therefore the UPDATE and the row it
  // produces, is built exactly as it was before.
  //
  // Which fields were SUPPLIED used to stand in for which fields changed, and
  // the two are not the same thing: the edit form posts every field on every
  // save, so `sets.length > 0` was true even for opening a content and pressing
  // save without touching it. Every one of those wrote a full copy of
  // `contents.blocks` — the rich-text document, HTML and images and tables, the
  // largest rows in `revisions`. Worse than the bytes: REVISION_KEEP.content is
  // 5, so five no-op saves push every genuinely older version out and leave a
  // history of five identical copies — an undo that can undo nothing.
  //
  // Every comparison below is against the value the UPDATE WILL WRITE (post
  // sanitize, post truncation), never the raw request field. Compare the raw
  // field and a save whose only difference was markup the sanitizer strips
  // still looks like an edit, and snapshots a value identical to the live row.
  const sets: string[] = [];
  const values: unknown[] = [];
  let changed = false;
  const set = (col: string, val: unknown, differs: boolean) => {
    sets.push(`${col} = ?`);
    values.push(val);
    if (differs) changed = true;
  };
  if (updatedContent.title !== undefined) {
    // `title` here is already sanitizeRichText(...).substring(0, 255) —
    // compared against the stored string, which is what a previous write of
    // this same column left behind.
    set("title", title, title !== existing.title);
  }
  if (updatedContent.blocks !== undefined) {
    set(
      "blocks",
      JSON.stringify(blocks),
      // `blocks` is already sanitizeBlocks(updatedContent.blocks); the stored
      // side gets the same single pass over ITS source. Both are then
      // canonicalized the same way — see canonicalize() for why that is a
      // sound "same value?" test for this column.
      canonicalBlocksJson(blocks) !== canonicalBlocksJson(sanitizeBlocks(existing.blocks))
    );
  }
  if (updatedContent.createdAt !== undefined) {
    set("createdAt", createdAt, createdAt !== existing.createdAt);
  }
  if ("productId" in updatedContent) {
    // rowToContent already normalises a stored NULL to null, so an unlink of
    // an already-unlinked content is not an edit.
    set("productId", productId, productId !== (existing.productId ?? null));
  }

  // When the content last CHANGED (schema v43): stamped on the same condition
  // as the revision snapshot, so a save that changes nothing does not move
  // it. It is the sitemap's <lastmod> and the page's dateModified.
  const updatedAt = changed ? new Date().toISOString() : existing.updatedAt ?? null;
  if (changed) {
    sets.push("updatedAt = ?");
    values.push(updatedAt);
  }

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
        //
        // `changed` is decided BEFORE the transaction opens, from values that
        // nothing in here mutates, so every one of withTransaction's up-to-3
        // attempts makes the same decision — the callback stays idempotent.
        // On THIS path it is necessarily true: the branch is only taken when
        // `productId !== existing.productId`, which in turn can only happen
        // when "productId" is in the partial, and that is exactly the case
        // where set("productId", …) was passed differs = true. A genuine
        // re-link always snapshots; the guard is here so the rule reads the
        // same on both paths rather than because this one can skip.
        if (changed) {
          await saveRevision("content", id, existing, conn);
        }
        await conn.query(
          `UPDATE contents SET ${sets.join(", ")} WHERE id = ?`,
          [...values, id]
        );
      });
    } else {
      // No revision when nothing the UPDATE writes would differ from the row
      // it writes over — such a snapshot could only ever restore the value
      // already there, while costing one of the 5 slots this content's real
      // history has. The UPDATE itself still runs, exactly as before.
      if (changed) {
        await saveRevision("content", id, existing);
      }
      await query(
        `UPDATE contents SET ${sets.join(", ")} WHERE id = ?`,
        [...values, id]
      );
    }
  }

  return { id, title, blocks, createdAt, productId, updatedAt };
}

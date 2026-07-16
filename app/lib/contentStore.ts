import { query } from "./db";
import { RowDataPacket, ResultSetHeader } from "mysql2";
import type { ContentBlock, ContentData } from "./types";
import { sanitizeRichText } from "./sanitizeHtml";

// Re-exported so existing callers can keep importing these from "./contentStore".
export type { ContentBlock, ContentData } from "./types";

// Sanitize the rich-text HTML on every block before it is stored, so content
// rendered later with dangerouslySetInnerHTML on public pages is always safe.
function sanitizeBlocks(blocks: ContentBlock[]): ContentBlock[] {
  return blocks.map((b) =>
    b.content !== undefined ? { ...b, content: sanitizeRichText(b.content) } : b
  );
}

// `blocks` is stored as a JSON column. mysql2 may hand it back already parsed
// (object) or as a raw string depending on driver/column config, so handle both.
function rowToContent(row: RowDataPacket): ContentData {
  let blocks: ContentBlock[] = [];
  if (row.blocks) {
    blocks = typeof row.blocks === "string" ? JSON.parse(row.blocks) : row.blocks;
  }
  return {
    id: row.id,
    title: row.title,
    blocks,
    createdAt: row.createdAt,
    productId: row.productId ?? null,
  };
}

export async function addContent(content: ContentData): Promise<ContentData> {
  const blocks = sanitizeBlocks(content.blocks);
  await query(
    "INSERT INTO contents (id, title, blocks, createdAt, productId) VALUES (?, ?, ?, ?, ?)",
    [
      content.id,
      content.title,
      JSON.stringify(blocks),
      content.createdAt,
      content.productId ?? null,
    ]
  );
  return { ...content, blocks };
}

export async function getContent(id: string): Promise<ContentData | undefined> {
  const [rows] = await query<RowDataPacket[]>(
    "SELECT * FROM contents WHERE id = ?",
    [id]
  );

  if (rows.length === 0) {
    return undefined;
  }

  return rowToContent(rows[0]);
}

export async function getAllContents(): Promise<ContentData[]> {
  const [rows] = await query<RowDataPacket[]>(
    "SELECT * FROM contents ORDER BY createdAt DESC"
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

  const title = updatedContent.title !== undefined ? updatedContent.title : existing.title;
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
    await query(
      `UPDATE contents SET ${sets.join(", ")} WHERE id = ?`,
      [...values, id]
    );
  }

  return { id, title, blocks, createdAt, productId };
}

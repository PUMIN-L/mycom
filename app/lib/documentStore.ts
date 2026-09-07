import { cache } from "react";
import { query } from "./db";
import type { DocumentData } from "./types";
import type { RowDataPacket } from "mysql2";
import { saveRevision } from "./revisionStore";
import { sanitizePlainText } from "./sanitizeHtml";

export type { DocumentData };

function mapDocumentRow(row: any): DocumentData {
  return {
    id: row.id,
    title: row.title,
    description: row.description || "",
    pdfUrl: row.pdfUrl,
    coverUrl: row.coverUrl,
    createdAt: row.createdAt,
    sortOrder: row.sortOrder || 0,
  };
}

export async function getAllDocuments(): Promise<DocumentData[]> {
  const [rows] = await query<RowDataPacket[]>(
    "SELECT * FROM documents ORDER BY sortOrder ASC, createdAt DESC"
  );
  return rows.map(mapDocumentRow);
}

// cache() de-dupes calls with the same id within a single request/render —
// generateMetadata and the page component on /document/[id] both need it.
export const getDocument = cache(async function getDocument(
  id: string
): Promise<DocumentData | null> {
  const [rows] = await query<RowDataPacket[]>(
    "SELECT * FROM documents WHERE id = ?",
    [id]
  );
  if (rows.length === 0) return null;
  return mapDocumentRow(rows[0]);
});

export async function addDocument(doc: DocumentData): Promise<void> {
  const title = sanitizePlainText(doc.title).substring(0, 255);
  const description = sanitizePlainText(doc.description || "").substring(0, 2000);

  await query(
    "INSERT INTO documents (id, title, description, pdfUrl, coverUrl, createdAt, sortOrder) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [
      doc.id,
      title,
      description,
      doc.pdfUrl,
      doc.coverUrl,
      doc.createdAt,
      doc.sortOrder,
    ]
  );
}

export async function updateDocument(
  id: string,
  updates: Partial<DocumentData>
): Promise<void> {
  const doc = await getDocument(id);
  if (!doc) throw new Error("Document not found");

  // Only SET the columns actually supplied, so concurrent edits to different
  // fields don't clobber each other via a full-row read-modify-write.
  //
  // ── NO CHANGE, NO SNAPSHOT ────────────────────────────────────────────────
  // `changed` is the third argument to set(): does this column's NEW value
  // differ from what the row already holds? It decides ONE thing — whether a
  // revision is written. The SET list, and therefore the UPDATE and the row it
  // produces, is built exactly as it was before.
  //
  // Which fields were SUPPLIED used to stand in for which fields changed, and
  // the two are not the same thing: the edit form posts title AND description
  // on every save, so `sets.length > 0` was true even for opening a document
  // and pressing save without touching it. Each of those spent one of the
  // REVISION_KEEP.document = 20 slots this document's history has on a copy of
  // a value nothing overwrote, pushing the versions someone might actually
  // want back out of the history.
  //
  // Every comparison is against the value the UPDATE WILL WRITE (post
  // sanitizePlainText, post truncation), never the raw `updates` field — a
  // save whose only difference was markup the sanitizer strips would otherwise
  // look like an edit and snapshot a value identical to the live row. `doc` is
  // what mapDocumentRow read back, so a stored NULL description already reads
  // as "" and a missing sortOrder as 0; writing those over their NULLs changes
  // nothing any reader of this row can see, and is not counted as an edit.
  const sets: string[] = [];
  const values: unknown[] = [];
  let changed = false;
  const set = (col: string, val: unknown, differs: boolean) => {
    sets.push(`${col} = ?`);
    values.push(val);
    if (differs) changed = true;
  };
  if (updates.title !== undefined) {
    const title = sanitizePlainText(updates.title).substring(0, 255);
    set("title", title, title !== doc.title);
  }
  if (updates.description !== undefined) {
    const description = sanitizePlainText(updates.description || "").substring(0, 2000);
    set("description", description, description !== doc.description);
  }
  if (updates.pdfUrl !== undefined) set("pdfUrl", updates.pdfUrl, updates.pdfUrl !== doc.pdfUrl);
  if (updates.coverUrl !== undefined) set("coverUrl", updates.coverUrl, updates.coverUrl !== doc.coverUrl);
  if (updates.sortOrder !== undefined) set("sortOrder", updates.sortOrder, updates.sortOrder !== doc.sortOrder);

  if (sets.length > 0) {
    // Snapshot the previous value first so an accidental overwrite is
    // restorable — but only when there IS an overwrite. A snapshot of a value
    // the save leaves alone could only ever restore what is already in the
    // row, at the cost of one of the 20 slots the real history has.
    if (changed) {
      await saveRevision("document", id, doc);
    }
    await query(
      `UPDATE documents SET ${sets.join(", ")} WHERE id = ?`,
      [...values, id]
    );
  }
}

export async function deleteDocument(id: string): Promise<void> {
  await query("DELETE FROM documents WHERE id = ?", [id]);
}

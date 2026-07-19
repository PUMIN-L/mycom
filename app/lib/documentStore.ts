import { query } from "./db";
import type { DocumentData } from "./types";
import type { RowDataPacket } from "mysql2";
import { saveRevision } from "./revisionStore";

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

export async function getDocument(id: string): Promise<DocumentData | null> {
  const [rows] = await query<RowDataPacket[]>(
    "SELECT * FROM documents WHERE id = ?",
    [id]
  );
  if (rows.length === 0) return null;
  return mapDocumentRow(rows[0]);
}

export async function addDocument(doc: DocumentData): Promise<void> {
  await query(
    "INSERT INTO documents (id, title, description, pdfUrl, coverUrl, createdAt, sortOrder) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [
      doc.id,
      doc.title,
      doc.description,
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
  const sets: string[] = [];
  const values: unknown[] = [];
  const set = (col: string, val: unknown) => {
    sets.push(`${col} = ?`);
    values.push(val);
  };
  if (updates.title !== undefined) set("title", updates.title);
  if (updates.description !== undefined) set("description", updates.description);
  if (updates.pdfUrl !== undefined) set("pdfUrl", updates.pdfUrl);
  if (updates.coverUrl !== undefined) set("coverUrl", updates.coverUrl);
  if (updates.sortOrder !== undefined) set("sortOrder", updates.sortOrder);

  if (sets.length > 0) {
    // Snapshot the previous value first so an accidental overwrite is restorable.
    await saveRevision("document", id, doc);
    await query(
      `UPDATE documents SET ${sets.join(", ")} WHERE id = ?`,
      [...values, id]
    );
  }
}

export async function deleteDocument(id: string): Promise<void> {
  await query("DELETE FROM documents WHERE id = ?", [id]);
}

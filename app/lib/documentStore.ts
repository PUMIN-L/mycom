import { query } from "./db";
import type { DocumentData } from "./types";
import type { RowDataPacket } from "mysql2";

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

  const newDoc = { ...doc, ...updates };
  await query(
    "UPDATE documents SET title = ?, description = ?, pdfUrl = ?, coverUrl = ?, sortOrder = ? WHERE id = ?",
    [
      newDoc.title,
      newDoc.description,
      newDoc.pdfUrl,
      newDoc.coverUrl,
      newDoc.sortOrder,
      id,
    ]
  );
}

export async function deleteDocument(id: string): Promise<void> {
  await query("DELETE FROM documents WHERE id = ?", [id]);
}

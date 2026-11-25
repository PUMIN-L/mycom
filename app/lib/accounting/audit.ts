import "server-only";
import type { PoolConnection } from "mysql2/promise";
import type { RowDataPacket } from "mysql2";
import { query } from "../db";
import type { AuditEntry } from "./types";

// The accounting module's audit log: one short line per thing done — who,
// what, when, to which document. There is no UPDATE or DELETE of it anywhere:
// a deleted document keeps its line here (with its number and total in
// `detail`), which is how "what happened to INV…0005?" is answered later.
//
// Kept small on purpose (the owner asked not to store what is not needed):
// `detail` is a one-line summary of what changed, never a copy of the document.

export type AuditAction =
  | "settings.update"
  | "bank.create"
  | "bank.update"
  | "bank.delete"
  | "doc.create"
  | "doc.update"
  | "doc.issue"
  | "doc.delete"
  | "doc.void"
  | "payment.create"
  | "payment.update"
  | "payment.void"
  /** The accountant's workbook downloaded (step 9) — everything declared, in one file. */
  | "data.export"
  /** Whose commission a customer PO is — ลูกค้าฟอร์ด / ลูกค้าพี่ต่อ (§8h). */
  | "commission.owner"
  /** The commission rate table changed, with the owner's emailed code (§8h). */
  | "commission.rates";

export const AUDIT_DETAIL_MAX = 1000;

export interface AuditInput {
  userId: string;
  username: string;
  action: AuditAction;
  documentId?: string | null;
  docNo?: string | null;
  detail?: string;
}

/** Writes one line — through `conn` when the change it records is in a transaction, so both land or neither does. */
export async function writeAudit(conn: PoolConnection | null, input: AuditInput): Promise<void> {
  const sql =
    "INSERT INTO acc_audit_log (id, at, userId, username, action, documentId, docNo, detail) VALUES (?, ?, ?, ?, ?, ?, ?, ?)";
  const params = [
    crypto.randomUUID(),
    new Date().toISOString(),
    input.userId,
    input.username,
    input.action,
    input.documentId ?? null,
    input.docNo ?? null,
    (input.detail ?? "").slice(0, AUDIT_DETAIL_MAX),
  ];
  if (conn) await conn.query(sql, params);
  else await query(sql, params);
}

/** Newest first; one document's lines when `documentId` is given. */
export async function listAudit(options: { documentId?: string; limit?: number } = {}): Promise<AuditEntry[]> {
  const limit = Math.max(1, Math.min(500, Math.round(Number(options.limit) || 100)));
  const where = options.documentId ? "WHERE documentId = ?" : "";
  const params: unknown[] = options.documentId ? [options.documentId, limit] : [limit];
  const [rows] = await query<RowDataPacket[]>(
    `SELECT id, at, userId, username, action, documentId, docNo, detail FROM acc_audit_log ${where} ORDER BY at DESC LIMIT ?`,
    params
  );
  return rows.map((r) => ({
    id: String(r.id),
    at: String(r.at),
    userId: String(r.userId),
    username: String(r.username),
    action: String(r.action),
    documentId: r.documentId ? String(r.documentId) : null,
    docNo: r.docNo ? String(r.docNo) : null,
    detail: String(r.detail ?? ""),
  }));
}

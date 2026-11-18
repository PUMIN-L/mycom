import type { PoolConnection } from "mysql2/promise";
import type { RowDataPacket } from "mysql2";
import { isValidDateString } from "../dateFormat";
import type { NumberedDocType } from "./types";

// Running numbers of the accounting module: TYPE + YYYYMM + 4 digits, from
// 0001 every month — INV2026110001 (the shape the owner's sample showed).
//
// ⚠️ A number is handed out only when a document is ISSUED, never to a draft,
// and inside the transaction that issues it, from a counter row locked FOR
// UPDATE: two issues at once queue on that lock, so they can neither get the
// same number nor skip one. Deleting the LATEST document of a series/month
// gives its number back (releaseDocNoIfLatest), so a test document deleted
// right away leaves no gap; deleting an older one leaves one — the page says
// so before it deletes.

export const NUMBERED_DOC_TYPES: readonly NumberedDocType[] = ["INV", "RE", "BN", "CN"];
/** Four digits a month. */
export const MAX_DOC_SEQ = 9999;

const DOC_NO_SHAPE = /^(INV|RE|BN|CN)(\d{4})(\d{2})(\d{4})$/;

export class DocNumberExhaustedError extends Error {
  constructor(type: NumberedDocType, period: string) {
    super(`เลขเอกสาร ${type} ของเดือน ${period} เต็มแล้ว (${MAX_DOC_SEQ} ใบ)`);
    this.name = "DocNumberExhaustedError";
  }
}

/** The month a document is numbered in: its issue date's "YYYYMM". */
export function docPeriod(issueDate: string): string {
  if (!isValidDateString(issueDate)) throw new Error(`วันที่ออกเอกสารไม่ถูกต้อง: ${issueDate}`);
  return issueDate.slice(0, 4) + issueDate.slice(5, 7);
}

export function formatDocNo(type: NumberedDocType, period: string, seq: number): string {
  return `${type}${period}${String(seq).padStart(4, "0")}`;
}

/** A number this module minted, read back — null for anything else (an external document's number). */
export function parseDocNo(docNo: string | null | undefined): { type: NumberedDocType; period: string; seq: number } | null {
  const m = DOC_NO_SHAPE.exec(String(docNo ?? ""));
  if (!m) return null;
  const month = Number(m[3]);
  if (month < 1 || month > 12) return null;
  const seq = Number(m[4]);
  if (seq < 1) return null;
  return { type: m[1] as NumberedDocType, period: m[2] + m[3], seq };
}

/**
 * Hands out the next number for `type` in the month of `issueDate`. Run inside
 * the transaction that writes the document. Starts past the highest number
 * already on a document as well as the counter, so a lost counter row cannot
 * hand out a number that is taken.
 */
export async function allocateDocNo(conn: PoolConnection, type: NumberedDocType, issueDate: string): Promise<string> {
  const period = docPeriod(issueDate);
  await conn.query("INSERT IGNORE INTO acc_counters (docType, period, lastNo) VALUES (?, ?, 0)", [type, period]);
  const [counterRows] = await conn.query<RowDataPacket[]>(
    "SELECT lastNo FROM acc_counters WHERE docType = ? AND period = ? FOR UPDATE",
    [type, period]
  );
  const [maxRows] = await conn.query<RowDataPacket[]>(
    "SELECT MAX(docNo) AS maxNo FROM acc_documents WHERE docType = ? AND source = 'internal' AND docNo LIKE ?",
    [type, `${type}${period}%`]
  );
  const onDocuments = parseDocNo(maxRows[0]?.maxNo)?.seq ?? 0;
  const next = Math.max(Number(counterRows[0]?.lastNo) || 0, onDocuments) + 1;
  if (next > MAX_DOC_SEQ) throw new DocNumberExhaustedError(type, period);
  await conn.query("UPDATE acc_counters SET lastNo = ? WHERE docType = ? AND period = ?", [next, type, period]);
  return formatDocNo(type, period, next);
}

/**
 * Gives `docNo` back when it is still the latest of its series and month — its
 * document is being deleted in this same transaction. True when it was.
 */
export async function releaseDocNoIfLatest(conn: PoolConnection, docNo: string): Promise<boolean> {
  const parsed = parseDocNo(docNo);
  if (!parsed) return false;
  const [rows] = await conn.query<RowDataPacket[]>(
    "SELECT lastNo FROM acc_counters WHERE docType = ? AND period = ? FOR UPDATE",
    [parsed.type, parsed.period]
  );
  if (Number(rows[0]?.lastNo) !== parsed.seq) return false;
  await conn.query("UPDATE acc_counters SET lastNo = ? WHERE docType = ? AND period = ?", [
    parsed.seq - 1,
    parsed.type,
    parsed.period,
  ]);
  return true;
}

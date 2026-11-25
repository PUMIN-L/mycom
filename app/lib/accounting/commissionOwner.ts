import "server-only";
import type { RowDataPacket } from "mysql2";
import { withTransaction } from "../db";
import { ApiError } from "../apiHelpers";
import { writeAudit } from "./audit";
import { getAccDocument, type AccDocument } from "./documents";
import { COMMISSION_KIND_LABELS, COMMISSION_KIND_REQUIRED, commissionKindOf, type CommissionKind } from "./commission";

// Whose commission a customer PO is (ARCHITECTURE.md §8h): "ลูกค้าฟอร์ด" or
// "ลูกค้าพี่ต่อ", chosen by hand on the PO (the owner, 2026-11-25) — not the
// PO's salesperson, not the company's เซลล์ผู้ดูแล. NULL until chosen; a PO
// not chosen yet is left off the ladder and cannot be paid.

interface Actor {
  userId: string;
  username: string;
}

export interface CommissionOwnerChange {
  /** The PO as it is now. */
  order: AccDocument;
  /** What it was — null when nothing had been chosen yet. */
  from: CommissionKind | null;
  to: CommissionKind;
}

/**
 * Sets it, under the PO's lock, with a line in the history. A cancelled PO may
 * still be chosen: what it delivered before it was cancelled still counts. Not
 * the PO's content, so its `updatedAt` — what an edit of its lines checks — is
 * left alone. Choosing what it already is writes nothing.
 */
export async function setSalesOrderCommission(id: string, kind: CommissionKind, actor: Actor): Promise<CommissionOwnerChange> {
  if (commissionKindOf(kind) === null) throw new ApiError(400, COMMISSION_KIND_REQUIRED);
  const seen: { from: CommissionKind | null } = { from: null };
  await withTransaction(async (conn) => {
    const [rows] = await conn.query<RowDataPacket[]>(
      "SELECT id, docType, customerPoNo, commissionOf FROM acc_documents WHERE id = ? LIMIT 1 FOR UPDATE",
      [id]
    );
    const row = rows[0];
    if (!row || row.docType !== "SO") throw new ApiError(404, "ไม่พบ PO ลูกค้านี้");
    seen.from = commissionKindOf(row.commissionOf);
    if (seen.from === kind) return;
    // Not while its commission is marked paid: those amounts were worked out
    // for this person's customer. A LOCKING read — a plain one in a TiDB
    // transaction reads the snapshot it began with.
    const [live] = await conn.query<RowDataPacket[]>(
      "SELECT id FROM acc_commission_payouts WHERE salesOrderId = ? AND voidedAt IS NULL LIMIT 1 FOR UPDATE",
      [id]
    );
    if (live.length > 0) throw new ApiError(409, "จ่ายค่าคอมของ PO นี้แล้ว — ยกเลิกการบันทึกจ่ายก่อน");
    await conn.query("UPDATE acc_documents SET commissionOf = ? WHERE id = ?", [kind, id]);
    await writeAudit(conn, {
      ...actor,
      action: "commission.owner",
      documentId: id,
      docNo: String(row.customerPoNo ?? ""),
      detail: `ค่าคอมของ: ${seen.from ? COMMISSION_KIND_LABELS[seen.from] : "ยังไม่เลือก"} → ${COMMISSION_KIND_LABELS[kind]}`,
    });
  });
  const order = await getAccDocument(id);
  if (!order) throw new ApiError(404, "ไม่พบ PO ลูกค้านี้");
  return { order, from: seen.from, to: kind };
}

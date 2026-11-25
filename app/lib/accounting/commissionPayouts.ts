import "server-only";
import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { query, withTransaction } from "../db";
import { ApiError } from "../apiHelpers";
import { bangkokDateString, formatDisplayDate, isValidDateString } from "../dateFormat";
import { writeAudit } from "./audit";
import { formatSatang } from "./money";
import { commissionMonth, type CommissionStatus } from "./commissionData";

// Marking a PO's commission paid (ARCHITECTURE.md §8h), schema v60.
//
// Only a PO that may be paid (chosen, delivered in full, paid in full, every
// cost typed) and only once. The amounts as worked out now are LOCKED in the
// mark: a later change (a back-dated PO, a cost fixed, a credit note) shows as
// a difference on the screen and never rewrites what was paid. Undone with a
// reason, never deleted.
//
// Locks: the PO only — never an invoice (the module's order is invoice → PO,
// so this cannot deadlock an issue) — then the PO's marks with a LOCKING read
// (a plain SELECT in a TiDB transaction reads the snapshot it began with and
// would miss a mark committed while this waited for the PO).

interface Actor {
  userId: string;
  username: string;
}

const NOT_PAYABLE: Record<Exclude<CommissionStatus, "payable" | "paid">, string> = {
  unassigned: "ยังไม่ได้เลือกว่า PO นี้เป็นค่าคอมของใคร",
  "not-delivered": "PO นี้ยังส่งของไม่ครบ",
  "cost-missing": "ยังกรอกต้นทุนของ PO นี้ไม่ครบ",
  "awaiting-payment": "ลูกค้ายังจ่ายเงิน PO นี้ไม่ครบ",
};
const ALREADY_PAID = "บันทึกจ่ายค่าคอมของ PO นี้ไปแล้ว";

export async function recordPayout(salesOrderId: string, paidDate: string, actor: Actor): Promise<{ id: string }> {
  const date = String(paidDate ?? "").trim();
  if (!isValidDateString(date)) throw new ApiError(400, "วันที่จ่ายไม่ถูกต้อง");
  if (date > bangkokDateString(new Date())) throw new ApiError(400, "วันที่จ่ายต้องไม่เป็นวันในอนาคต");
  const [found] = await query<RowDataPacket[]>("SELECT id, docType, issueDate, customerPoNo FROM acc_documents WHERE id = ? LIMIT 1", [salesOrderId]);
  const po = found[0];
  if (!po || po.docType !== "SO") throw new ApiError(404, "ไม่พบ PO ลูกค้านี้");

  // Worked out exactly as the screen shows it.
  const poMonth = String(po.issueDate).slice(0, 7);
  const data = await commissionMonth(poMonth);
  const row = data?.rows.find((r) => r.id === salesOrderId);
  if (!data || !row) throw new ApiError(409, "PO นี้ไม่นับค่าคอม (ยกเลิกก่อนส่งของ)");
  if (row.commissionStatus === "paid") throw new ApiError(409, ALREADY_PAID);
  if (row.commissionStatus !== "payable") throw new ApiError(409, NOT_PAYABLE[row.commissionStatus]);

  const id = randomUUID();
  await withTransaction(async (conn) => {
    const [locked] = await conn.query<RowDataPacket[]>("SELECT id, commissionOf, customerPoNo FROM acc_documents WHERE id = ? FOR UPDATE", [salesOrderId]);
    if (!locked[0]) throw new ApiError(404, "ไม่พบ PO ลูกค้านี้");
    if (locked[0].commissionOf !== row.kind) throw new ApiError(409, "ค่าคอมของ PO นี้เพิ่งถูกเปลี่ยน กรุณาโหลดหน้าใหม่");
    const [live] = await conn.query<RowDataPacket[]>(
      "SELECT id FROM acc_commission_payouts WHERE salesOrderId = ? AND voidedAt IS NULL LIMIT 1 FOR UPDATE",
      [salesOrderId]
    );
    if (live.length > 0) throw new ApiError(409, ALREADY_PAID);
    await conn.query(
      `INSERT INTO acc_commission_payouts
         (id, salesOrderId, kind, poMonth, profitSatang, ladderFromSatang, ladderToSatang, fordSatang, torSatang, companySatang, rateSetId, paidDate, createdAt, createdBy)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        salesOrderId,
        row.kind,
        poMonth,
        row.countedSatang,
        row.ladderFromSatang,
        row.ladderToSatang,
        row.fordSatang,
        row.torSatang,
        row.companySatang,
        data.rateSet.id,
        date,
        new Date().toISOString(),
        actor.username,
      ]
    );
    await writeAudit(conn, {
      ...actor,
      action: "commission.payout",
      documentId: salesOrderId,
      docNo: row.customerPoNo,
      detail: `บันทึกจ่ายค่าคอม วันที่ ${formatDisplayDate(date)} · ฟอร์ด ${formatSatang(row.fordSatang)} · พี่ต่อ ${formatSatang(row.torSatang)} บาท`,
    });
  });
  return { id };
}

/** Undoes a mark — with the reason; the PO, then the mark, locked. */
export async function voidPayout(payoutId: string, reason: unknown, actor: Actor): Promise<void> {
  const why = typeof reason === "string" ? reason.trim().slice(0, 500) : "";
  if (!why) throw new ApiError(400, "กรุณาบอกเหตุผลที่ยกเลิกการบันทึกจ่าย");
  const [found] = await query<RowDataPacket[]>("SELECT id, salesOrderId FROM acc_commission_payouts WHERE id = ? LIMIT 1", [payoutId]);
  if (!found[0]) throw new ApiError(404, "ไม่พบรายการจ่ายค่าคอมนี้");
  const salesOrderId = String(found[0].salesOrderId);
  await withTransaction(async (conn) => {
    const [po] = await conn.query<RowDataPacket[]>("SELECT id, customerPoNo FROM acc_documents WHERE id = ? FOR UPDATE", [salesOrderId]);
    const [rows] = await conn.query<RowDataPacket[]>("SELECT id, voidedAt, paidDate FROM acc_commission_payouts WHERE id = ? FOR UPDATE", [payoutId]);
    const payout = rows[0];
    if (!payout) throw new ApiError(404, "ไม่พบรายการจ่ายค่าคอมนี้");
    if (payout.voidedAt) throw new ApiError(409, "รายการนี้ยกเลิกไปแล้ว");
    await conn.query("UPDATE acc_commission_payouts SET voidedAt = ?, voidedBy = ?, voidReason = ? WHERE id = ?", [new Date().toISOString(), actor.username, why, payoutId]);
    await writeAudit(conn, {
      ...actor,
      action: "commission.payout.void",
      documentId: salesOrderId,
      docNo: po[0] ? String(po[0].customerPoNo ?? "") : null,
      detail: `ยกเลิกการบันทึกจ่ายค่าคอม (จ่ายเมื่อ ${formatDisplayDate(String(payout.paidDate))}) · เหตุผล: ${why}`,
    });
  });
}

import "server-only";
import type { RowDataPacket } from "mysql2";
import { query, withTransaction } from "../db";
import { ApiError } from "../apiHelpers";
import { applySaleCostEditTx } from "../salesDashboardStore";
import { writeAudit } from "./audit";
import { satangToBaht, signedDecimalToSatang } from "./money";
import { commissionCosts } from "./commissionData";
import { NOTHING_TO_SAVE, cleanCostEdit, costEditDetail, costEditProblems } from "./costEditRules";
import type { PoCosts } from "./commissionTypes";

// A delivery's costs edited on the commission screen (ARCHITECTURE.md §8h) —
// the same costs the /dashboard sale form edits, written through the
// dashboard's own cost store (applySaleCostEditTx), so a figure reads the same
// in both. What was sent is checked first; then, under the SALE's lock (a
// locking read — TiDB), the delivery must be one of THIS PO's, not a credit
// note (no cost of its own), and its cost as the sale stored it when the editor
// opened — a change made meanwhile is refused, never overwritten. A line in
// the PO's history in the same transaction.
//
// Locks: the sale only — every dashboard cost write takes the same one, and
// no accounting path holds a sale's lock while it waits for an invoice or a PO.
// A PO whose commission is already marked paid may still be edited: what was
// paid stays locked and the change shows as a difference (§8h).

interface Actor {
  userId: string;
  username: string;
}

const satang = (baht: number) => Math.round(baht * 100);

export async function editDeliveryCosts(poId: string, body: unknown, actor: Actor): Promise<PoCosts> {
  const edit = cleanCostEdit(body);
  if (!edit) throw new ApiError(400, "ข้อมูลต้นทุนไม่ถูกต้อง");
  const problems = costEditProblems(edit);
  if (problems.length > 0) throw new ApiError(400, problems[0]);
  const [found] = await query<RowDataPacket[]>("SELECT id, docType, customerPoNo FROM acc_documents WHERE id = ? LIMIT 1", [poId]);
  const po = found[0];
  if (!po || po.docType !== "SO") throw new ApiError(404, "ไม่พบ PO ลูกค้านี้");

  await withTransaction(async (conn) => {
    const [sales] = await conn.query<RowDataPacket[]>("SELECT id, dealId, invoiceRef, totalAmount, costAmount FROM sales_records WHERE id = ? FOR UPDATE", [edit.saleId]);
    const sale = sales[0];
    if (!sale || String(sale.dealId ?? "") !== poId) throw new ApiError(404, "ไม่พบการส่งของนี้ใน PO นี้");
    if (signedDecimalToSatang(sale.totalAmount) < 0) throw new ApiError(409, "ใบลดหนี้ไม่มีต้นทุนให้แก้");
    if (signedDecimalToSatang(sale.costAmount) !== edit.expectedCostSatang) {
      throw new ApiError(409, "ต้นทุนของการส่งของครั้งนี้ถูกแก้จากที่อื่นหลังจากเปิดดู — กรุณาโหลดใหม่แล้วแก้อีกครั้ง");
    }

    const done = await applySaleCostEditTx(conn, edit.saleId, {
      lines: edit.lines.map((l) => ({ id: l.id, costAmount: satangToBaht(l.costSatang) })),
      add: edit.add.map((r) => ({ costType: r.costType, label: r.label, note: r.note, amount: satangToBaht(r.amountSatang) })),
      update: edit.update.map((r) => ({ id: r.id, costType: r.costType, label: r.label, note: r.note, amount: satangToBaht(r.amountSatang) })),
      remove: edit.remove,
    });
    // The same figures sent back: nothing to keep (and the transaction rolls back).
    if (done.lines.length + done.added.length + done.updated.length + done.removed.length === 0) throw new ApiError(400, NOTHING_TO_SAVE);

    const figure = (r: { costType: string; label: string; amount: number }) => ({ costType: r.costType, label: r.label, amountSatang: satang(r.amount) });
    await writeAudit(conn, {
      ...actor,
      action: "commission.cost",
      documentId: poId,
      docNo: String(po.customerPoNo ?? ""),
      detail: costEditDetail({
        invoiceRef: String(sale.invoiceRef ?? ""),
        lines: done.lines.map((l) => ({ productName: l.productName, beforeSatang: satang(l.before), afterSatang: satang(l.after) })),
        added: done.added.map(figure),
        updated: done.updated.map((u) => ({ before: figure(u.before), after: figure(u.after) })),
        removed: done.removed.map(figure),
        totalBeforeSatang: satang(done.costAmountBefore),
        totalAfterSatang: satang(done.costAmountAfter),
      }),
    });
  });

  const costs = await commissionCosts(poId);
  if (!costs) throw new ApiError(404, "ไม่พบ PO ลูกค้านี้");
  return costs;
}

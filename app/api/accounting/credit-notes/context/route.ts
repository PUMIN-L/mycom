import { NextRequest } from "next/server";
import { withRoute, jsonError } from "../../../../lib/apiHelpers";
import { noStoreJson, requireAccountingUser } from "../../../../lib/accounting/guard";
import { creditContext } from "../../../../lib/accounting/creditNotes";

// GET /api/accounting/credit-notes/context?invoice=… — what a credit note
// against this invoice needs: the invoice, what earlier credit notes took off
// it, what it still owes and whether money is due back.
export const GET = withRoute("โหลดข้อมูลใบแจ้งหนี้ไม่สำเร็จ", async (request: NextRequest) => {
  await requireAccountingUser();
  const context = await creditContext((request.nextUrl.searchParams.get("invoice") || "").slice(0, 36));
  if (!context) return jsonError("ไม่พบใบแจ้งหนี้ที่ออกแล้วนี้", 404);
  return noStoreJson(context);
});

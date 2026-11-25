import { NextRequest } from "next/server";
import { withRoute, ApiError } from "../../../../lib/apiHelpers";
import { noStoreJson, requireAccountingUser } from "../../../../lib/accounting/guard";
import { recordPayout } from "../../../../lib/accounting/commissionPayouts";

// POST /api/accounting/commission/payouts — { salesOrderId, paidDate }: marks
// a customer PO's commission paid (ARCHITECTURE.md §8h). Only a PO that may be
// paid, only once; the amounts as worked out now are locked in the mark.
export const POST = withRoute("บันทึกจ่ายค่าคอมไม่สำเร็จ", async (request: NextRequest) => {
  const { actor } = await requireAccountingUser();
  const body = (await request.json()) as Record<string, unknown> | null;
  const salesOrderId = body?.salesOrderId;
  const paidDate = body?.paidDate;
  if (typeof salesOrderId !== "string" || !salesOrderId || typeof paidDate !== "string") {
    throw new ApiError(400, "ข้อมูลการจ่ายค่าคอมไม่ถูกต้อง");
  }
  return noStoreJson(await recordPayout(salesOrderId, paidDate.trim(), actor));
});

import { NextRequest } from "next/server";
import { withRoute, ApiError } from "../../../../lib/apiHelpers";
import { noStoreJson, requireAccountingUser } from "../../../../lib/accounting/guard";
import { recordPayout } from "../../../../lib/accounting/commissionPayouts";
import { payoutReport } from "../../../../lib/accounting/commissionReport";

// GET /api/accounting/commission/payouts?from=YYYY-MM-DD&to=YYYY-MM-DD — the
// payout summary (ARCHITECTURE.md §8h): the live paid-out marks of that range
// of paid dates with what was locked, which changed since, the rate sets used,
// the company, who asked and when; `&withCosts=1` adds each PO's costs (the
// PDF's "แสดงรายละเอียดต้นทุน").
export const GET = withRoute("โหลดสรุปการจ่ายค่าคอมไม่สำเร็จ", async (request: NextRequest) => {
  const { actor } = await requireAccountingUser();
  const params = request.nextUrl.searchParams;
  return noStoreJson(
    await payoutReport(params.get("from") ?? "", params.get("to") ?? "", { withCosts: params.get("withCosts") === "1", exportedBy: actor.username })
  );
});

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

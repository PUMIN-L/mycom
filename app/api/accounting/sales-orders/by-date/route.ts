import { NextRequest } from "next/server";
import { withRoute, ApiError } from "../../../../lib/apiHelpers";
import { daysBetweenDateStrings, isValidDateString } from "../../../../lib/dateFormat";
import { noStoreJson, requireAccountingUser } from "../../../../lib/accounting/guard";
import { ordersByIssueDate } from "../../../../lib/accounting/salesOrders";
import { ORDER_CHART_MAX_DAYS } from "../../../../lib/accounting/orderChart";

// GET /api/accounting/sales-orders/by-date?from=YYYY-MM-DD&to=YYYY-MM-DD — the
// dashboard's "ยอดตาม PO ลูกค้า": the open customer POs received each day of
// [from, to), by their own PO date, ex VAT; `to` exclusive. Behind the
// module's gate like its other routes — switched off, it answers 404 and the
// dashboard hides the chart.
export const GET = withRoute("โหลดยอดตาม PO ลูกค้าไม่สำเร็จ", async (request: NextRequest) => {
  await requireAccountingUser();
  const params = request.nextUrl.searchParams;
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  if (!isValidDateString(from) || !isValidDateString(to) || from >= to) throw new ApiError(400, "ช่วงวันที่ไม่ถูกต้อง");
  if ((daysBetweenDateStrings(from, to) ?? Infinity) > ORDER_CHART_MAX_DAYS) {
    throw new ApiError(400, `ช่วงวันที่ยาวเกินไป (ไม่เกิน ${ORDER_CHART_MAX_DAYS} วัน)`);
  }
  return noStoreJson({ from, to, days: await ordersByIssueDate(from, to) });
});

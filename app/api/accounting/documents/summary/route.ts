import { NextRequest } from "next/server";
import { withRoute, ApiError } from "../../../../lib/apiHelpers";
import { addMonthsToDateString, bangkokDateString, isValidDateString } from "../../../../lib/dateFormat";
import { noStoreJson, requireAccountingUser } from "../../../../lib/accounting/guard";
import { documentSummary } from "../../../../lib/accounting/documents";

// GET /api/accounting/documents/summary[?month=YYYY-MM] — the invoice list's
// cards: what is owed (all of it, whatever the list's filter), what is past
// due as of today (Bangkok), what was issued in the month (this month by default).
export const GET = withRoute("โหลดสรุปยอดไม่สำเร็จ", async (request: NextRequest) => {
  await requireAccountingUser();
  const today = bangkokDateString(new Date());
  const month = request.nextUrl.searchParams.get("month") || today.slice(0, 7);
  const monthStart = `${month}-01`;
  if (!isValidDateString(monthStart)) throw new ApiError(400, "เดือนไม่ถูกต้อง");
  return noStoreJson(await documentSummary(today, monthStart, addMonthsToDateString(monthStart, 1)));
});

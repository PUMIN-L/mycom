import { NextRequest } from "next/server";
import { withRoute } from "../../../../lib/apiHelpers";
import { noStoreJson, requireAccountingUser } from "../../../../lib/accounting/guard";
import { openInvoicesFor } from "../../../../lib/accounting/billingNotes";

// GET /api/accounting/billing-notes/open-invoices?companyId=…|buyerName=… —
// a customer's invoices still owing, oldest first, with the open billing
// notes each is on already.
export const GET = withRoute("โหลดใบแจ้งหนี้ค้างชำระไม่สำเร็จ", async (request: NextRequest) => {
  await requireAccountingUser();
  const params = request.nextUrl.searchParams;
  return noStoreJson(
    await openInvoicesFor({ companyId: (params.get("companyId") || "").slice(0, 255), buyerName: (params.get("buyerName") || "").slice(0, 255) })
  );
});

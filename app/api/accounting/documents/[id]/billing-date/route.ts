import { NextRequest } from "next/server";
import { withRoute, ApiError } from "../../../../../lib/apiHelpers";
import { noStoreJson, requireAccountingUser } from "../../../../../lib/accounting/guard";
import { setInvoiceBillingDate } from "../../../../../lib/accounting/documents";

type Ctx = { params: Promise<{ id: string }> };

// PATCH /api/accounting/documents/[id]/billing-date — { billingDate:
// "YYYY-MM-DD" | null }: an invoice's วันวางบิล (internal, never printed; the
// CRM alert "วางบิล" opens 7 days before it). Null or "" clears it.
export const PATCH = withRoute("บันทึกวันวางบิลไม่สำเร็จ", async (request: NextRequest, { params }: Ctx) => {
  const { actor } = await requireAccountingUser();
  const { id } = await params;
  const body = (await request.json()) as Record<string, unknown>;
  const raw = body.billingDate;
  if (raw !== null && typeof raw !== "string") throw new ApiError(400, "วันวางบิลไม่ถูกต้อง");
  const billingDate = typeof raw === "string" && raw.trim() ? raw.trim() : null;
  return noStoreJson(await setInvoiceBillingDate(id, billingDate, actor));
});

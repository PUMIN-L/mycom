import { NextRequest } from "next/server";
import { withRoute } from "../../../../../lib/apiHelpers";
import { noStoreJson, requireAccountingUser } from "../../../../../lib/accounting/guard";
import { recordBillingPayment } from "../../../../../lib/accounting/billingNotes";
import { cleanPaymentInput } from "../../../../../lib/accounting/paymentRules";

type Ctx = { params: Promise<{ id: string }> };

// POST /api/accounting/billing-notes/[id]/payments — money received against
// the billing note (the payment fields of /documents/[id]/payments): spread
// over its invoices, one receipt for all (two when goods and services mix).
export const POST = withRoute("บันทึกรับชำระไม่สำเร็จ", async (request: NextRequest, { params }: Ctx) => {
  const { actor } = await requireAccountingUser();
  const { id } = await params;
  return noStoreJson(await recordBillingPayment(id, cleanPaymentInput(await request.json()), actor), { status: 201 });
});

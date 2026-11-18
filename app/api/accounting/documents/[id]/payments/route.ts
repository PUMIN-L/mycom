import { NextRequest } from "next/server";
import { withRoute, jsonError } from "../../../../../lib/apiHelpers";
import { noStoreJson, requireAccountingUser } from "../../../../../lib/accounting/guard";
import { paymentContext, recordPayment } from "../../../../../lib/accounting/payments";
import { cleanPaymentInput } from "../../../../../lib/accounting/paymentRules";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/accounting/documents/[id]/payments — the invoice's payments
// (voided ones too), what it still owes, its services before VAT (the
// withholding base) and the customer's usual withholding rate.
export const GET = withRoute("โหลดรายการรับชำระไม่สำเร็จ", async (_request: NextRequest, { params }: Ctx) => {
  await requireAccountingUser();
  const { id } = await params;
  const context = await paymentContext(id);
  if (!context) return jsonError("ไม่พบใบแจ้งหนี้นี้", 404);
  return noStoreJson(context);
});

// POST /api/accounting/documents/[id]/payments — records money received
// ({ paidDate, method, bankAccountId, amountSatang, whtPercent, whtSatang,
// feeSatang, cert50Received, cert50Note, externalReceiptNo, note }) and issues
// its receipt, unless an outside receipt number is given.
export const POST = withRoute("บันทึกรับชำระไม่สำเร็จ", async (request: NextRequest, { params }: Ctx) => {
  const { actor } = await requireAccountingUser();
  const { id } = await params;
  const input = cleanPaymentInput(await request.json());
  return noStoreJson(await recordPayment(id, input, actor), { status: 201 });
});

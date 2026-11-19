import { NextRequest } from "next/server";
import { withRoute, jsonError } from "../../../../../lib/apiHelpers";
import { noStoreJson, requireAccountingUser } from "../../../../../lib/accounting/guard";
import { depositContext, recordDeposit } from "../../../../../lib/accounting/deposits";
import { cleanPaymentInput } from "../../../../../lib/accounting/paymentRules";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/accounting/sales-orders/[id]/deposits — the PO's deposits (voided
// ones too), the most a new one may be, what is deducted / left, its services
// before VAT (the withholding base) and the customer's usual withholding.
export const GET = withRoute("โหลดเงินมัดจำไม่สำเร็จ", async (_request: NextRequest, { params }: Ctx) => {
  await requireAccountingUser();
  const { id } = await params;
  const context = await depositContext(id);
  if (!context) return jsonError("ไม่พบ PO ลูกค้านี้", 404);
  return noStoreJson(context);
});

// POST /api/accounting/sales-orders/[id]/deposits — a deposit received (the
// payment fields of /documents/[id]/payments, no outside receipt): issues its
// ใบเสร็จรับเงิน/ใบกำกับภาษี.
export const POST = withRoute("บันทึกเงินมัดจำไม่สำเร็จ", async (request: NextRequest, { params }: Ctx) => {
  const { actor } = await requireAccountingUser();
  const { id } = await params;
  const input = cleanPaymentInput(await request.json());
  return noStoreJson(await recordDeposit(id, input, actor), { status: 201 });
});

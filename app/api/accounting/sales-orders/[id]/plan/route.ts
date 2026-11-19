import { NextRequest } from "next/server";
import { withRoute } from "../../../../../lib/apiHelpers";
import { noStoreJson, requireAccountingUser } from "../../../../../lib/accounting/guard";
import { saveSalesOrderPlan } from "../../../../../lib/accounting/salesOrders";
import { cleanPlan } from "../../../../../lib/accounting/depositRules";

type Ctx = { params: Promise<{ id: string }> };

// PUT /api/accounting/sales-orders/[id]/plan — { items: [{ label, stage,
// amountSatang, dueDate }] }: the PO's payment plan, saved over the old one;
// answers the plan with where each item stands.
export const PUT = withRoute("บันทึกแผนเก็บเงินไม่สำเร็จ", async (request: NextRequest, { params }: Ctx) => {
  const { actor } = await requireAccountingUser();
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  return noStoreJson({ plan: await saveSalesOrderPlan(id, cleanPlan(body?.items), actor) });
});

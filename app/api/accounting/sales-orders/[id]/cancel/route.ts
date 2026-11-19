import { NextRequest } from "next/server";
import { withRoute } from "../../../../../lib/apiHelpers";
import { noStoreJson, requireAccountingUser } from "../../../../../lib/accounting/guard";
import { cancelSalesOrder } from "../../../../../lib/accounting/salesOrders";

type Ctx = { params: Promise<{ id: string }> };

// POST /api/accounting/sales-orders/[id]/cancel — { reason }: the customer
// cancelled (the rest of) the PO. It leaves the backlog; what was delivered
// stays delivered. Not a tax matter, so no password — the reason is kept.
export const POST = withRoute("ยกเลิก PO ลูกค้าไม่สำเร็จ", async (request: NextRequest, { params }: Ctx) => {
  const { actor } = await requireAccountingUser();
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  return noStoreJson(await cancelSalesOrder(id, typeof body?.reason === "string" ? body.reason : "", actor));
});

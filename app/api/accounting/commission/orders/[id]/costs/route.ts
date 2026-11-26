import { NextRequest } from "next/server";
import { withRoute, ApiError } from "../../../../../../lib/apiHelpers";
import { noStoreJson, requireAccountingUser } from "../../../../../../lib/accounting/guard";
import { commissionCosts } from "../../../../../../lib/accounting/commissionData";
import { editDeliveryCosts } from "../../../../../../lib/accounting/commissionCostEdit";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/accounting/commission/orders/[id]/costs — what a customer PO's profit
// is made of, by delivery: each product's cost, the other costs typed on the
// sale by kind ("ค่าคอมมิชชั่น" shown, never deducted), and the totals the
// commission counts (ARCHITECTURE.md §8h). Loaded when its row is opened.
export const GET = withRoute("โหลดต้นทุนของ PO ไม่สำเร็จ", async (_request: NextRequest, { params }: Ctx) => {
  await requireAccountingUser();
  const { id } = await params;
  const costs = await commissionCosts(id);
  if (!costs) throw new ApiError(404, "ไม่พบ PO ลูกค้านี้");
  return noStoreJson(costs);
});

// PUT /api/accounting/commission/orders/[id]/costs — { saleId, expectedCostSatang,
// lines, add, update, remove }: one delivery's costs edited right on the
// commission screen (the same costs the dashboard's sale form edits), with a
// line in the PO's history. Answers the PO's costs as they are now.
export const PUT = withRoute("บันทึกต้นทุนไม่สำเร็จ", async (request: NextRequest, { params }: Ctx) => {
  const { actor } = await requireAccountingUser();
  const { id } = await params;
  const body = (await request.json()) as unknown;
  return noStoreJson(await editDeliveryCosts(id, body, actor));
});

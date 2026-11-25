import { NextRequest } from "next/server";
import { withRoute, ApiError } from "../../../../../../lib/apiHelpers";
import { noStoreJson, requireAccountingUser } from "../../../../../../lib/accounting/guard";
import { commissionCosts } from "../../../../../../lib/accounting/commissionData";

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

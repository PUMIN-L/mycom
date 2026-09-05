import { NextRequest, NextResponse } from "next/server";
import { withRoute, requireAuth } from "../../../../../../lib/apiHelpers";
import {
  getSalesRecord,
  updateCostItem,
  deleteCostItem,
  ProductCostIsPerLineError,
  ProductCostNotAttributableError,
} from "../../../../../../lib/salesDashboardStore";

/** Both "that money belongs somewhere else" refusals are client errors, not 500s. */
function costRefusal(error: unknown): NextResponse | null {
  return error instanceof ProductCostIsPerLineError ||
    error instanceof ProductCostNotAttributableError
    ? NextResponse.json({ error: (error as Error).message }, { status: 400 })
    : null;
}

type Ctx = { params: Promise<{ id: string; costId: string }> };

// PUT /api/admin/sales/[id]/costs/[costId] — update a cost item
export const PUT = withRoute(
  "แก้ไขรายการต้นทุนไม่สำเร็จ",
  async (request: NextRequest, { params }: Ctx) => {
    await requireAuth();
    const { id, costId } = await params;
    const record = await getSalesRecord(id);
    if (!record) {
      return NextResponse.json({ error: "ไม่พบรายการขาย" }, { status: 404 });
    }
    const body = await request.json();
    if (body.amount !== undefined && (!Number.isFinite(Number(body.amount)) || Number(body.amount) <= 0)) {
      return NextResponse.json(
        { error: "จำนวนเงินต้องมากกว่า 0" },
        { status: 400 }
      );
    }
    let updated;
    try {
      updated = await updateCostItem(costId, body);
    } catch (error) {
      const refusal = costRefusal(error);
      if (refusal) return refusal;
      throw error;
    }
    if (!updated) {
      return NextResponse.json({ error: "ไม่พบรายการต้นทุน" }, { status: 404 });
    }
    const updatedRecord = await getSalesRecord(id);
    return NextResponse.json({
      item: updated,
      costAmount: updatedRecord?.costAmount ?? 0,
    });
  }
);

// DELETE /api/admin/sales/[id]/costs/[costId] — delete a cost item
export const DELETE = withRoute(
  "ลบรายการต้นทุนไม่สำเร็จ",
  async (_request: NextRequest, { params }: Ctx) => {
    await requireAuth();
    const { id, costId } = await params;
    const record = await getSalesRecord(id);
    if (!record) {
      return NextResponse.json({ error: "ไม่พบรายการขาย" }, { status: 404 });
    }
    let deleted;
    try {
      deleted = await deleteCostItem(costId);
    } catch (error) {
      const refusal = costRefusal(error);
      if (refusal) return refusal;
      throw error;
    }
    if (!deleted) {
      return NextResponse.json({ error: "ไม่พบรายการต้นทุน" }, { status: 404 });
    }
    const updatedRecord = await getSalesRecord(id);
    return NextResponse.json({
      success: true,
      costAmount: updatedRecord?.costAmount ?? 0,
    });
  }
);

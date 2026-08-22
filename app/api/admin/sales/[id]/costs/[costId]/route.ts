import { NextRequest, NextResponse } from "next/server";
import { withRoute, requireAuth } from "../../../../../../lib/apiHelpers";
import {
  getSalesRecord,
  updateCostItem,
  deleteCostItem,
} from "../../../../../../lib/salesDashboardStore";

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
    const updated = await updateCostItem(costId, body);
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
    const deleted = await deleteCostItem(costId);
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

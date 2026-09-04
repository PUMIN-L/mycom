import { NextRequest, NextResponse } from "next/server";
import { withRoute, requireAuth } from "../../../../../lib/apiHelpers";
import {
  getSalesRecord,
  getCostItems,
  addCostItem,
} from "../../../../../lib/salesDashboardStore";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/admin/sales/[id]/costs — list cost items for a sale
export const GET = withRoute(
  "โหลดรายการต้นทุนไม่สำเร็จ",
  async (_request: NextRequest, { params }: Ctx) => {
    await requireAuth();
    const { id } = await params;
    const record = await getSalesRecord(id);
    if (!record) {
      return NextResponse.json({ error: "ไม่พบรายการขาย" }, { status: 404 });
    }
    const items = await getCostItems(id);
    return NextResponse.json({ items, costAmount: record.costAmount });
  }
);

// POST /api/admin/sales/[id]/costs — add a cost item
export const POST = withRoute(
  "เพิ่มรายการต้นทุนไม่สำเร็จ",
  async (request: NextRequest, { params }: Ctx) => {
    await requireAuth();
    const { id } = await params;
    const record = await getSalesRecord(id);
    if (!record) {
      return NextResponse.json({ error: "ไม่พบรายการขาย" }, { status: 404 });
    }
    const body = await request.json();
    if (!body.amount || !Number.isFinite(Number(body.amount)) || Number(body.amount) <= 0) {
      return NextResponse.json(
        { error: "จำนวนเงินต้องมากกว่า 0" },
        { status: 400 }
      );
    }
    const item = await addCostItem(id, body);
    const updatedRecord = await getSalesRecord(id);
    return NextResponse.json({
      item,
      costAmount: updatedRecord?.costAmount ?? 0,
    });
  }
);

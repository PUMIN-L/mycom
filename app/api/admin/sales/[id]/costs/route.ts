import { NextRequest, NextResponse } from "next/server";
import { withRoute, requireAuth } from "../../../../../lib/apiHelpers";
import {
  getSalesRecord,
  getCostItems,
  addCostItem,
  ProductCostIsPerLineError,
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
    // ต้นทุนสินค้า is per line item, not a bill-level cost row — a client that
    // asks for one gets told where it belongs (400) rather than a 500, and
    // nothing is written anywhere.
    let item;
    try {
      item = await addCostItem(id, body);
    } catch (error) {
      if (error instanceof ProductCostIsPerLineError) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      throw error;
    }
    const updatedRecord = await getSalesRecord(id);
    return NextResponse.json({
      item,
      costAmount: updatedRecord?.costAmount ?? 0,
    });
  }
);

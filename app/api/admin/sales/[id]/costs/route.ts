import { NextRequest, NextResponse } from "next/server";
import { withRoute, requireAuth } from "../../../../../lib/apiHelpers";
import { parsePositiveMoney } from "../../../../../lib/moneyAmount";
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
    // Rounded to the satang before the check, and stored rounded: 0.004 would
    // otherwise pass "more than 0" and land in DECIMAL(12,2) as ฿0.00.
    const parsed = parsePositiveMoney(body.amount);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    body.amount = parsed.amount;
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

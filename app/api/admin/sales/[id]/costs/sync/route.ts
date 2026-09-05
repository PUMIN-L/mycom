import { NextRequest, NextResponse } from "next/server";
import { withRoute, requireAuth } from "../../../../../../lib/apiHelpers";
import {
  syncCostItems,
  ProductCostNotAttributableError,
} from "../../../../../../lib/salesDashboardStore";

type Ctx = { params: Promise<{ id: string }> };

// PUT /api/admin/sales/[id]/costs/sync — sync all cost items transactionally
export const PUT = withRoute(
  "บันทึกข้อมูลต้นทุนไม่สำเร็จ",
  async (request: NextRequest, { params }: Ctx) => {
    await requireAuth();
    const { id } = await params;
    const body = await request.json();
    
    if (!Array.isArray(body)) {
      return NextResponse.json({ error: "รูปแบบข้อมูลไม่ถูกต้อง" }, { status: 400 });
    }
    
    // A bill-level ต้นทุนสินค้า on a multi-line bill cannot be attributed to a
    // line without inventing a split, so the store refuses it. Surface that as
    // a 400 with its own message: the client keeps the sheet the user typed and
    // is told to edit the per-line costs instead. Nothing is written.
    let items;
    try {
      items = await syncCostItems(id, body);
    } catch (error) {
      if (error instanceof ProductCostNotAttributableError) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      throw error;
    }


    return NextResponse.json({
      success: true,
      items
    });
  }
);

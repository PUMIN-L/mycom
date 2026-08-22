import { NextRequest, NextResponse } from "next/server";
import { withRoute, requireAuth } from "../../../../../../lib/apiHelpers";
import { syncCostItems } from "../../../../../../lib/salesDashboardStore";

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
    
    const items = await syncCostItems(id, body);
    
    return NextResponse.json({
      success: true,
      items
    });
  }
);

import { NextResponse } from "next/server";
import { withRoute, requireAuth } from "../../../../lib/apiHelpers";
import { salespersonLinkCounts } from "../../../../lib/deleteBlockers";

// GET /api/salespeople/[id]/links — the sales records that still name this
// salesperson, counted, for the delete dialog on /customers.
// DELETE /api/salespeople/[id] still checks for itself.
export const GET = withRoute(
  "ตรวจสอบข้อมูลที่ผูกกับพนักงานขายไม่สำเร็จ",
  async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
    await requireAuth();
    const { id } = await params;
    return NextResponse.json(await salespersonLinkCounts(id));
  }
);

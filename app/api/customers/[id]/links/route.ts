import { NextResponse } from "next/server";
import { withRoute, requireAuth } from "../../../../lib/apiHelpers";
import { customerLinkCounts } from "../../../../lib/deleteBlockers";

// GET /api/customers/[id]/links — what still points at this customer, counted
// (machines, sales records, follow-up calls, job sheets). The delete dialog on
// /customers reads it to say why a customer cannot be deleted before the
// admin presses ลบ. DELETE /api/customers/[id] still checks for itself.
export const GET = withRoute(
  "ตรวจสอบข้อมูลที่ผูกกับลูกค้าไม่สำเร็จ",
  async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
    await requireAuth();
    const { id } = await params;
    return NextResponse.json(await customerLinkCounts(id));
  }
);

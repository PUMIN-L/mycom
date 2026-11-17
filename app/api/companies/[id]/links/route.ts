import { NextResponse } from "next/server";
import { withRoute, requireAuth } from "../../../../lib/apiHelpers";
import { companyLinkCounts } from "../../../../lib/deleteBlockers";

// GET /api/companies/[id]/links — the customers and job sheets that still
// point at this company, counted, for the delete dialog on /customers.
// DELETE /api/companies/[id] still checks for itself.
export const GET = withRoute(
  "ตรวจสอบข้อมูลที่ผูกกับบริษัทไม่สำเร็จ",
  async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
    await requireAuth();
    const { id } = await params;
    return NextResponse.json(await companyLinkCounts(id));
  }
);

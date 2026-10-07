import { NextRequest, NextResponse } from "next/server";
import { getAllSalespeople, createSalesperson, salespersonInputError } from "../../lib/salesStore";
import { requireAuth, withRoute } from "../../lib/apiHelpers";

// GET — list all salespeople (admin only — internal staff data).
export const GET = withRoute(
  "โหลดรายชื่อพนักงานขายไม่สำเร็จ",
  async (_request: NextRequest) => {
    await requireAuth();
    const salespeople = await getAllSalespeople();
    return NextResponse.json(salespeople);
  }
);

// POST — create new salesperson (login required)
export const POST = withRoute(
  "เพิ่มพนักงานขายไม่สำเร็จ",
  async (request: NextRequest) => {
    await requireAuth();
    const body = await request.json();
    
    const invalid = salespersonInputError(body, true);
    if (invalid) {
      return NextResponse.json({ error: invalid }, { status: 400 });
    }

    const created = await createSalesperson(body);
    return NextResponse.json(created, { status: 201 });
  }
);

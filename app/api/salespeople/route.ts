import { NextRequest, NextResponse } from "next/server";
import { getAllSalespeople, createSalesperson } from "../../lib/salesStore";
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
    
    if (!body.name || body.name.trim() === "") {
      return NextResponse.json({ error: "กรุณากรอกชื่อ" }, { status: 400 });
    }
    
    if (body.name.length > 255) {
      return NextResponse.json({ error: "ชื่อยาวเกิน 255 ตัวอักษร" }, { status: 400 });
    }

    const created = await createSalesperson(body);
    return NextResponse.json(created, { status: 201 });
  }
);

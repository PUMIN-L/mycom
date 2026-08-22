import { NextRequest, NextResponse } from "next/server";
import { withRoute, requireAuth } from "../../../lib/apiHelpers";
import { addExpense, listExpenses } from "../../../lib/expenseStore";

export const GET = withRoute(
  "ดึงข้อมูลรายจ่ายไม่สำเร็จ",
  async (request: NextRequest) => {
    await requireAuth();
    const url = request.nextUrl;
    const filters = {
      dateFrom: url.searchParams.get("dateFrom") || undefined,
      dateTo: url.searchParams.get("dateTo") || undefined,
      category: url.searchParams.get("category") || undefined,
    };
    const records = await listExpenses(filters);
    return NextResponse.json(records);
  }
);

export const POST = withRoute(
  "บันทึกรายจ่ายไม่สำเร็จ",
  async (request: NextRequest) => {
    await requireAuth();
    const body = await request.json();

    if (!body.title) {
      return NextResponse.json(
        { error: "กรุณาระบุชื่อรายการ" },
        { status: 400 }
      );
    }
    if (!body.expenseDate || !/^\d{4}-\d{2}-\d{2}$/.test(body.expenseDate)) {
      return NextResponse.json(
        { error: "กรุณาระบุวันที่ (YYYY-MM-DD)" },
        { status: 400 }
      );
    }

    const record = await addExpense(body);
    return NextResponse.json(record, { status: 201 });
  }
);

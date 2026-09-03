import { NextRequest, NextResponse } from "next/server";
import { withRoute, requireAuth } from "../../../../lib/apiHelpers";
import { addRecurringExpense, listRecurringExpenses } from "../../../../lib/expenseStore";

export const GET = withRoute(
  "ดึงข้อมูลรายจ่ายประจำไม่สำเร็จ",
  async () => {
    await requireAuth();
    const records = await listRecurringExpenses();
    return NextResponse.json(records);
  }
);

export const POST = withRoute(
  "บันทึกรายจ่ายประจำไม่สำเร็จ",
  async (request: NextRequest) => {
    await requireAuth();
    const body = await request.json();

    if (!body.title) {
      return NextResponse.json({ error: "กรุณาระบุชื่อรายการ" }, { status: 400 });
    }
    const amountNum = Number(body.amount);
    if (!body.amount || !Number.isFinite(amountNum) || amountNum <= 0) {
      return NextResponse.json(
        { error: "จำนวนเงินต้องมากกว่า 0" },
        { status: 400 }
      );
    }

    const record = await addRecurringExpense(body);
    return NextResponse.json(record, { status: 201 });
  }
);

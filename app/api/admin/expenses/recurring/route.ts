import { NextRequest, NextResponse } from "next/server";
import { withRoute, requireAuth } from "../../../../lib/apiHelpers";
import { addRecurringExpense, listRecurringExpenses } from "../../../../lib/expenseStore";
import { parsePositiveMoney } from "../../../../lib/moneyAmount";
import { expenseTextError } from "../../../../lib/expenseInput";

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

    const invalid = expenseTextError(body, true);
    if (invalid) {
      return NextResponse.json({ error: invalid }, { status: 400 });
    }
    // Rounded to the satang before the check, and the rounded value is what is
    // stored: 0.004 would otherwise be a ฿0.00 bill generated every month.
    const parsed = parsePositiveMoney(body.amount);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const record = await addRecurringExpense({ ...body, amount: parsed.amount });
    return NextResponse.json(record, { status: 201 });
  }
);

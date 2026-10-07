import { NextRequest, NextResponse } from "next/server";
import { withRoute, requireAuth } from "../../../../lib/apiHelpers";
import { updateExpense, deleteExpense } from "../../../../lib/expenseStore";
import { parsePositiveMoney } from "../../../../lib/moneyAmount";
import { isValidDateString } from "../../../../lib/dateFormat";
import { expenseTextError } from "../../../../lib/expenseInput";

export const PUT = withRoute(
  "แก้ไขรายจ่ายไม่สำเร็จ",
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    await requireAuth();
    const { id } = await params;
    const body = await request.json();

    const invalid = expenseTextError(body, false);
    if (invalid) {
      return NextResponse.json({ error: invalid }, { status: 400 });
    }
    // Sent means checked — see POST /api/admin/expenses for why neither may be
    // left to the store's silent fallbacks.
    if (
      body.expenseDate !== undefined &&
      (typeof body.expenseDate !== "string" || !isValidDateString(body.expenseDate))
    ) {
      return NextResponse.json(
        { error: "กรุณาระบุวันที่ (YYYY-MM-DD)" },
        { status: 400 }
      );
    }
    if (body.amount !== undefined) {
      const parsed = parsePositiveMoney(body.amount);
      if (!parsed.ok) {
        return NextResponse.json({ error: parsed.error }, { status: 400 });
      }
      body.amount = parsed.amount;
    }

    const record = await updateExpense(id, body);
    if (!record) {
      return NextResponse.json({ error: "ไม่พบรายการรายจ่าย" }, { status: 404 });
    }
    return NextResponse.json(record);
  }
);

export const DELETE = withRoute(
  "ลบรายจ่ายไม่สำเร็จ",
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    await requireAuth();
    const { id } = await params;
    const success = await deleteExpense(id);
    if (!success) {
      return NextResponse.json({ error: "ไม่พบรายการรายจ่าย" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  }
);

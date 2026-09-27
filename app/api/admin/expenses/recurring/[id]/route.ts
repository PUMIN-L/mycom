import { NextRequest, NextResponse } from "next/server";
import { withRoute, requireAuth } from "../../../../../lib/apiHelpers";
import { updateRecurringExpense, deleteRecurringExpense } from "../../../../../lib/expenseStore";
import { parsePositiveMoney } from "../../../../../lib/moneyAmount";

export const PUT = withRoute(
  "แก้ไขรายจ่ายประจำไม่สำเร็จ",
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    await requireAuth();
    const { id } = await params;
    const body = await request.json();

    if (body.amount !== undefined) {
      // Rounded before the check, and stored rounded (see the POST).
      const parsed = parsePositiveMoney(body.amount);
      if (!parsed.ok) {
        return NextResponse.json({ error: parsed.error }, { status: 400 });
      }
      body.amount = parsed.amount;
    }

    const record = await updateRecurringExpense(id, body);
    if (!record) {
      return NextResponse.json({ error: "ไม่พบรายการรายจ่ายประจำ" }, { status: 404 });
    }
    return NextResponse.json(record);
  }
);

export const DELETE = withRoute(
  "ลบรายจ่ายประจำไม่สำเร็จ",
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    await requireAuth();
    const { id } = await params;
    const success = await deleteRecurringExpense(id);
    if (!success) {
      return NextResponse.json({ error: "ไม่พบรายการรายจ่ายประจำ" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  }
);

import { NextRequest, NextResponse } from "next/server";
import { withRoute, requireAuth } from "../../../../../lib/apiHelpers";
import { updateRecurringExpense, deleteRecurringExpense } from "../../../../../lib/expenseStore";

export const PUT = withRoute(
  "แก้ไขรายจ่ายประจำไม่สำเร็จ",
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    await requireAuth();
    const { id } = await params;
    const body = await request.json();

    if (body.amount !== undefined && !(Number(body.amount) > 0)) {
      return NextResponse.json(
        { error: "จำนวนเงินต้องมากกว่า 0" },
        { status: 400 }
      );
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

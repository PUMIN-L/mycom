import { NextRequest, NextResponse } from "next/server";
import { withRoute, requireAuth } from "../../../../lib/apiHelpers";
import { updateExpense, deleteExpense } from "../../../../lib/expenseStore";

export const PUT = withRoute(
  "แก้ไขรายจ่ายไม่สำเร็จ",
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    await requireAuth();
    const { id } = await params;
    const body = await request.json();

    if (body.expenseDate && !/^\d{4}-\d{2}-\d{2}$/.test(body.expenseDate)) {
      return NextResponse.json(
        { error: "กรุณาระบุวันที่ (YYYY-MM-DD)" },
        { status: 400 }
      );
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

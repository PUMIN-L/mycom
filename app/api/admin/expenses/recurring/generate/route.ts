import { NextRequest, NextResponse } from "next/server";
import { withRoute, requireAuth } from "../../../../../lib/apiHelpers";
import { generateExpensesForMonth } from "../../../../../lib/expenseStore";
import { bangkokCurrentMonth } from "../../../../../lib/dateFormat";

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

// POST /api/admin/expenses/recurring/generate — the ONLY thing that turns a
// recurring template into a real expenses row. Always an explicit admin
// click (body: { month?: "YYYY-MM" }, defaults to the current Bangkok
// month) — never a background cron, so a financial record only ever appears
// because someone asked for it.
export const POST = withRoute(
  "สร้างรายจ่ายประจำเดือนไม่สำเร็จ",
  async (request: NextRequest) => {
    await requireAuth();
    const body = await request.json().catch(() => ({}));
    const month = body?.month ? String(body.month) : bangkokCurrentMonth();

    if (!MONTH_RE.test(month)) {
      return NextResponse.json(
        { error: "รูปแบบเดือนไม่ถูกต้อง (ต้องเป็น YYYY-MM)" },
        { status: 400 }
      );
    }

    const result = await generateExpensesForMonth(month);
    return NextResponse.json(result);
  }
);

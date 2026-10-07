import { NextRequest, NextResponse } from "next/server";
import { withRoute, requireAuth } from "../../../lib/apiHelpers";
import { addExpense, listExpenses } from "../../../lib/expenseStore";
import { parsePositiveMoney } from "../../../lib/moneyAmount";
import { isValidDateString } from "../../../lib/dateFormat";
import { expenseTextError } from "../../../lib/expenseInput";

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

    const invalid = expenseTextError(body, true);
    if (invalid) {
      return NextResponse.json({ error: invalid }, { status: 400 });
    }
    // A date that does not exist ("2026-02-30") is refused, not quietly
    // replaced: expenseStore falls back to TODAY for anything it cannot read.
    if (typeof body.expenseDate !== "string" || !isValidDateString(body.expenseDate)) {
      return NextResponse.json(
        { error: "กรุณาระบุวันที่ (YYYY-MM-DD)" },
        { status: 400 }
      );
    }
    // The same money rule as every other amount (lib/moneyAmount.ts): the
    // store's own Number(x) || 0 turned "abc" into a ฿0 expense, "1e3" into
    // ฿1,000 and a negative into ฿0 — all saved without a word.
    const parsed = parsePositiveMoney(body.amount);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const record = await addExpense({ ...body, amount: parsed.amount });
    return NextResponse.json(record, { status: 201 });
  }
);

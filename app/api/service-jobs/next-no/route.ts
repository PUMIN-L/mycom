import { NextRequest, NextResponse } from "next/server";
import { withRoute, requireAuth } from "../../../lib/apiHelpers";
import { peekNextJobNo } from "../../../lib/serviceJobStore";
import { sanitizePlainText } from "../../../lib/sanitizeHtml";
import { respondToJobError } from "../serviceJobRequest";

// GET /api/service-jobs/next-no?date=YYYY-MM-DD
//
// The number a sheet issued for that date WOULD get — for SHOWING, before the
// sheet is saved. The job-sheet page exists to produce paper, and an admin who
// cannot see the number until after he has pressed บันทึก is an admin printing
// blind; this is how he sees it.
//
// ⚠️ IT RESERVES NOTHING, and no caller may send the answer back as the number
// to use. Issuing still mints inside the transaction that writes the row
// (claimJobNo), so if another admin claims this number in between, his sheet
// keeps it and ours takes the next free one. The UI must therefore label this
// as ตัวอย่าง (an estimate), never as the document's number.
//
// A static segment beats the `[id]` route in the App Router, and no job id is
// ever the literal "next-no" (they are UUIDs), so nothing is shadowed.
export const GET = withRoute(
  "ดูเลขที่ใบ Job ถัดไปไม่สำเร็จ",
  async (request: NextRequest) => {
    await requireAuth();
    const date = sanitizePlainText(
      new URL(request.url).searchParams.get("date") ?? ""
    )
      .trim()
      .substring(0, 20);
    try {
      return NextResponse.json({ jobNo: await peekNextJobNo(date) });
    } catch (error) {
      return respondToJobError(error);
    }
  }
);

import { NextRequest } from "next/server";
import { withRoute, ApiError } from "../../../../lib/apiHelpers";
import { isValidDateString } from "../../../../lib/dateFormat";
import { noStoreJson, requireAccountingUser } from "../../../../lib/accounting/guard";
import { peekNextDocNo } from "../../../../lib/accounting/documents";
import { NUMBERED_DOC_TYPES } from "../../../../lib/accounting/numbering";
import type { NumberedDocType } from "../../../../lib/accounting/types";

// GET /api/accounting/documents/next-number?type=INV&date=YYYY-MM-DD — the
// number issuing on that date would give now. A preview; nothing is reserved.
export const GET = withRoute("โหลดเลขเอกสารถัดไปไม่สำเร็จ", async (request: NextRequest) => {
  await requireAccountingUser();
  const type = (request.nextUrl.searchParams.get("type") || "INV") as NumberedDocType;
  const date = request.nextUrl.searchParams.get("date") || "";
  if (!NUMBERED_DOC_TYPES.includes(type)) throw new ApiError(400, "ประเภทเอกสารไม่ถูกต้อง");
  if (!isValidDateString(date)) throw new ApiError(400, "วันที่ไม่ถูกต้อง");
  return noStoreJson({ docNo: await peekNextDocNo(type, date) });
});

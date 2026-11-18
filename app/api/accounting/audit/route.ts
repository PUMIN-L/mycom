import { NextRequest } from "next/server";
import { withRoute } from "../../../lib/apiHelpers";
import { noStoreJson, requireAccountingUser } from "../../../lib/accounting/guard";
import { listAudit } from "../../../lib/accounting/audit";

// GET /api/accounting/audit[?documentId=…&limit=…] — who did what, newest first.
export const GET = withRoute("โหลดประวัติการทำรายการไม่สำเร็จ", async (request: NextRequest) => {
  await requireAccountingUser();
  const documentId = request.nextUrl.searchParams.get("documentId") || undefined;
  const limit = Number(request.nextUrl.searchParams.get("limit")) || undefined;
  return noStoreJson(await listAudit({ documentId, limit }));
});

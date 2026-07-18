import { NextResponse } from "next/server";
import { withRoute, requireAuth } from "../../../lib/apiHelpers";
import { listRecentDocNos } from "../../../lib/quotationStore";

// GET /api/quotations/docnos (login required) — the reserved quotation numbers
// (last ~2 days), so the builder can warn about duplicates + auto-run the next
// trailing number even for quotations that were downloaded then deleted.
export const GET = withRoute("โหลดเลขที่ที่ใช้แล้วไม่สำเร็จ", async () => {
  await requireAuth();
  return NextResponse.json(await listRecentDocNos());
});

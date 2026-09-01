import { NextResponse } from "next/server";
import { withRoute, requireAuth } from "../../../lib/apiHelpers";
import { listRecentDocNos } from "../../../lib/quotationStore";

// GET /api/billing/docnos (login required) — the reserved document numbers
// ledger (shared `used_docnos` table with quotations; prefixes don't collide).
// The builder uses this — not the live /api/billing list — for the duplicate
// check and the auto-run next number, so a number stays "taken" even after its
// billing document is deleted (mirrors /api/quotations/docnos). Without this,
// deleting a document made its number look free again while the ledger still
// held the reservation, so the very next auto-suggested number 409'd forever.
export const GET = withRoute("โหลดเลขที่ที่ใช้แล้วไม่สำเร็จ", async () => {
  await requireAuth();
  return NextResponse.json(await listRecentDocNos());
});

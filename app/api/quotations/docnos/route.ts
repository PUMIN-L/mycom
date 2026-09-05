import { NextRequest, NextResponse } from "next/server";
import { withRoute, requireAuth } from "../../../lib/apiHelpers";
import { listDocNosByBase, listRecentDocNos } from "../../../lib/quotationStore";

// GET /api/quotations/docnos (login required) — the reserved quotation numbers
// (last ~7 days), so the builder can warn about duplicates + auto-run the next
// trailing number even for quotations that were downloaded then deleted.
//
// GET /api/quotations/docnos?base=QT260719-23 — every number ever issued under
// that base instead, however old. The version picker needs this: quotations are
// kept for two years, so the document being cloned is usually far outside the
// recent window, and `used_docnos` still owns its v1/v2/… forever.
export const GET = withRoute(
  "โหลดเลขที่ที่ใช้แล้วไม่สำเร็จ",
  async (request?: NextRequest) => {
    await requireAuth();
    const base = request?.nextUrl?.searchParams.get("base")?.trim();
    return NextResponse.json(
      base ? await listDocNosByBase(base) : await listRecentDocNos()
    );
  }
);

import { NextRequest, NextResponse } from "next/server";
import { withRoute, requireAuth } from "../../../lib/apiHelpers";
import { sanitizePlainText } from "../../../lib/sanitizeHtml";
import {
  listDocNosByBase,
  listRecentDocNos,
  type UsedDocNo,
} from "../../../lib/quotationStore";

// GET /api/quotations/docnos (login required) — the reserved quotation numbers
// (last ~7 days), so the builder can warn about duplicates for quotations that
// were downloaded then deleted.
//
// ⚠️ That windowed answer is for WARNING ONLY. Nothing may MINT a number from
// it: a day's DDMMYY prefix is identical to another day's legacy YYMMDD prefix
// a year earlier (25 Oct 2026 → "251026" ← 26 Oct 2025), and last year's
// numbers are outside the window while `used_docnos` still owns them forever.
// See the header of app/lib/quotationNumber.ts.
//
// GET /api/quotations/docnos?base=QT260719-23 — every number ever issued under
// that base instead, however old, from the non-windowed ledger. TWO callers
// need exactly this:
//   • the version picker (`base` = a whole number → its v1/v2/…): quotations
//     are kept for two years, so the document being cloned is usually far
//     outside the recent window;
//   • the MINT (`base` = a day's prefix): the only lookup that can see the
//     cross-year collision above.
//
// `base` may be repeated — `?base=QT251026-&base=QT261025-` — because a day has
// TWO legitimate prefixes (current DDMMYY + legacy YYMMDD) and the mint must
// see both in one answer. The lists are merged and de-duplicated by docNo.
export const GET = withRoute(
  "โหลดเลขที่ที่ใช้แล้วไม่สำเร็จ",
  async (request?: NextRequest) => {
    await requireAuth();
    const bases = (request?.nextUrl?.searchParams.getAll("base") ?? [])
      .map((b) => sanitizePlainText(b).trim())
      .filter((b) => b.length > 0);

    if (bases.length === 0) {
      return NextResponse.json(await listRecentDocNos());
    }

    // De-duplicate the bases first: the two prefixes coincide on the dates
    // where DDMMYY == YYMMDD, and asking twice would return every row twice.
    const unique = Array.from(new Set(bases));
    const lists = await Promise.all(unique.map((b) => listDocNosByBase(b)));
    const byDocNo = new Map<string, UsedDocNo>();
    for (const row of lists.flat()) {
      if (!byDocNo.has(row.docNo)) byDocNo.set(row.docNo, row);
    }
    return NextResponse.json(Array.from(byDocNo.values()));
  }
);

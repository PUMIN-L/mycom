import { NextRequest, NextResponse } from "next/server";
import { withRoute, requireAuth, ApiError } from "../../../lib/apiHelpers";
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

/**
 * How many `base` params one request may carry.
 *
 * Every distinct base is its own `LIKE 'base%'` scan, and they all run at once
 * under Promise.all — against the single shared TiDB instance the whole
 * business runs on, and `used_docnos` is never purged so that scan only ever
 * gets longer. Before `base` could repeat, this route ran exactly ONE query;
 * unbounded, one authenticated tab can turn a single request into two hundred
 * concurrent non-indexable scans.
 *
 * Two is all any real caller needs (the day's two prefixes, or one whole number
 * for the version picker); four leaves headroom without being a fan-out.
 *
 * Over the bound the request is REFUSED, never trimmed to the first four:
 * answering about fewer bases than were asked for would hand the mint a ledger
 * missing exactly the prefix it could not see, which is the bug this whole
 * `?base=` path exists to prevent.
 *
 * Deliberately NOT exported: Next validates a route module's exports, and a
 * route file may only export its HTTP methods and the framework's own config.
 */
const MAX_DOCNO_BASES = 4;

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
    // Counted BEFORE de-duplication, on purpose: the bound is on what the
    // request asked for, and no caller of this app asks about five bases.
    if (bases.length > MAX_DOCNO_BASES) {
      throw new ApiError(
        400,
        `ขอเลขที่ได้สูงสุด ${MAX_DOCNO_BASES} ชุดต่อหนึ่งคำขอ กรุณาแยกคำขอ`
      );
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

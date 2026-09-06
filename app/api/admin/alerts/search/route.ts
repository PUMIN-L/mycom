import { NextRequest, NextResponse } from "next/server";
import { withRoute, requireAuth, jsonError } from "../../../../lib/apiHelpers";
import { sanitizePlainText } from "../../../../lib/sanitizeHtml";
import { searchDatedAlerts } from "../../../../lib/alertSearchStore";
import { validateSearchRange } from "../../../../lib/alertDateSearch";

/**
 * GET /api/admin/alerts/search?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Everything dated that falls on the given day (`from === to`) or inside the
 * given range, from all six dated sources — past and future alike.
 *
 * This route deliberately ignores every window `GET /api/admin/alerts` is
 * built on. Those windows keep the DEFAULT FEED short; they do not define what
 * exists. Last month's appointment and next quarter's are equally invisible in
 * the feed today, one because its query has no lower bound and the other
 * because it has not reached the upper one, and both are findable here.
 *
 * `getAlerts()` and the feed route are untouched by this change: same
 * thresholds, same keys, same number on the bell.
 */
export const GET = withRoute(
  "ค้นหาแจ้งเตือนตามวันที่ไม่สำเร็จ",
  async (request: NextRequest) => {
    await requireAuth();

    const url = new URL(request.url);
    const from = sanitizePlainText(url.searchParams.get("from") || "").trim();
    const to = sanitizePlainText(url.searchParams.get("to") || "").trim();

    // The SAME function the search panel calls, so the screen can never state
    // one rule while the server enforces another. A bad range is refused with
    // the Thai reason and NO query is issued — it never falls back to "today"
    // and quietly answers a question nobody asked.
    const rangeError = validateSearchRange(from, to);
    if (rangeError) return jsonError(rangeError, 400);

    const result = await searchDatedAlerts(from, to);
    return NextResponse.json(result);
  }
);

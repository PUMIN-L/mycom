import { NextRequest, NextResponse } from "next/server";
import { withRoute, requireAuth, jsonError } from "../../../lib/apiHelpers";
import { sanitizePlainText } from "../../../lib/sanitizeHtml";
import { searchNotes } from "../../../lib/customerNoteSearchStore";
import {
  NOTE_SEARCH_TERM_MAX_LENGTH,
  buildMatcher,
} from "../../../lib/noteSearch";

/**
 * GET /api/customers/note-search?term=…&matchCase=1&useRegex=1
 *
 * Every customer whose `note` — the "บันทึกลูกค้า" call log — contains the
 * term, with the count and the surrounding text for each one.
 *
 * THIS ROUTE READS. It issues one SELECT and nothing else; there is no write
 * statement anywhere on this path, and no way for pressing "ค้นหา" to change a
 * customer's note. Replacing is a separate route, reached only after a
 * separate confirmation.
 *
 * The existing name/company search on the customers page is untouched by this
 * change: it is a different control, on different columns, and it keeps
 * working exactly as it did.
 */
export const GET = withRoute(
  "ค้นหาคำในบันทึกลูกค้าไม่สำเร็จ",
  async (request: NextRequest) => {
    await requireAuth();

    const url = new URL(request.url);
    // Sliced before sanitising so an absurd query string costs nothing; one
    // character over the cap is enough for `buildMatcher` to still refuse it
    // with the right reason rather than silently searching a trimmed term.
    const term = sanitizePlainText(
      (url.searchParams.get("term") || "").slice(0, NOTE_SEARCH_TERM_MAX_LENGTH + 1)
    );
    const matchCase = isOn(url.searchParams.get("matchCase"));
    const useRegex = isOn(url.searchParams.get("useRegex"));

    // The SAME function the search panel validates with, so the screen cannot
    // state one rule while the server enforces another. A refused pattern
    // returns the Thai reason and NO query is issued — an empty term never
    // falls through to an empty result set, which would read as "this word
    // appears nowhere" instead of "you did not search yet".
    const built = buildMatcher({ term, matchCase, useRegex });
    if (!built.ok) return jsonError(built.reason, 400);

    const result = await searchNotes(built.matcher);
    return NextResponse.json({ term, matchCase, useRegex, ...result });
  }
);

/** Query-string booleans. Anything that is not an explicit yes is off, so a
 *  typo in a URL can never silently turn regular expressions on. */
function isOn(value: string | null): boolean {
  return value === "1" || value === "true";
}

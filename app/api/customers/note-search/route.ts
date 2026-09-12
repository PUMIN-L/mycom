import { NextRequest, NextResponse } from "next/server";
import { withRoute, requireAuth, jsonError } from "../../../lib/apiHelpers";
import { searchNotes } from "../../../lib/customerNoteSearchStore";
import { boundIncomingTerm, buildMatcher } from "../../../lib/noteSearch";

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
    // THE TERM IS NOT SANITISED, AND THAT IS THE POINT. It is a NEEDLE, not
    // stored text: it goes into a JSON body, a React text child and the
    // matcher, and nothing on this path renders it as markup. It used to run
    // through `sanitizePlainText`, which DELETES tag-like substrings — typing
    // `a<b` searched for `a` and echoed `term: "a"` back, so "แทนที่ทั้งหมด"
    // built on that answer would rewrite every letter `a` in a hundred call
    // logs. `boundIncomingTerm` does the one thing the term genuinely needs: a
    // length bound, deliberately one character over the cap so `buildMatcher`
    // refuses an over-long term instead of searching a trimmed one. See
    // "Values that cross a boundary" in `app/lib/noteSearch.ts`.
    const term = boundIncomingTerm(url.searchParams.get("term"));
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
    // The term ECHOED is the matcher's own — byte for byte the needle that was
    // run. The screen sends this value straight back as the term of a replace,
    // so it has to be the thing that was searched for and not a cleaned-up
    // cousin of it.
    return NextResponse.json({
      term: built.matcher.term,
      matchCase,
      useRegex,
      ...result,
    });
  }
);

/** Query-string booleans. Anything that is not an explicit yes is off, so a
 *  typo in a URL can never silently turn regular expressions on. */
function isOn(value: string | null): boolean {
  return value === "1" || value === "true";
}

import { NextRequest, NextResponse } from "next/server";
import { withRoute, requireAuth, jsonError } from "../../../lib/apiHelpers";
import { sanitizePlainText } from "../../../lib/sanitizeHtml";
import {
  NoteReplaceRefusedError,
  replaceInNotes,
} from "../../../lib/customerNoteSearchStore";
import type { NoteReplaceItem } from "../../../lib/customerNoteSearchStore";
import {
  NOTE_SEARCH_MAX_INPUT_LENGTH,
  NOTE_SEARCH_TERM_MAX_LENGTH,
  buildMatcher,
  validateReplaceItemCount,
  validateReplacement,
} from "../../../lib/noteSearch";

/**
 * POST /api/customers/note-replace
 *
 * Body: `{ term, matchCase, useRegex, replacement, items: [{ customerId,
 * expectedNote }] }`
 *
 * Rewrites the "บันทึกลูกค้า" call log of the listed customers — real business
 * history, years of it — so every guard on this path is enforced HERE and not
 * only in the browser. A disabled button is a courtesy; this is the control.
 *
 *   • The pattern goes through `buildMatcher`, the same function the screen
 *     validates with, which refuses anything that can match the empty string.
 *     A hand-built request carrying `.*` is refused before a transaction is
 *     opened and issues NO UPDATE.
 *   • The per-request cap is a refusal, never a trim.
 *   • Every customer carries the note the screen saw; the store re-reads under
 *     a lock and refuses that customer if it has moved on, so a bulk replace
 *     cannot swallow somebody else's edit.
 *   • Every write is preceded by `saveRevision("customer", …)` in the same
 *     transaction. No history means no overwrite.
 *
 * THE ROUTE WRITES NOTHING ITSELF. It validates the envelope and hands one
 * transaction to `customerNoteSearchStore.replaceInNotes`, whose only write
 * statement touches `customers.note`.
 */
export const POST = withRoute(
  "แทนที่คำในบันทึกลูกค้าไม่สำเร็จ",
  async (request: NextRequest) => {
    await requireAuth();

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError("รูปแบบข้อมูลที่ส่งมาไม่ถูกต้อง", 400);
    }
    const payload = (body ?? {}) as Record<string, unknown>;

    const term = sanitizePlainText(
      String(payload.term ?? "").slice(0, NOTE_SEARCH_TERM_MAX_LENGTH + 1)
    );
    const matchCase = payload.matchCase === true;
    const useRegex = payload.useRegex === true;

    const built = buildMatcher({ term, matchCase, useRegex });
    if (!built.ok) return jsonError(built.reason, 400);

    // An empty replacement is allowed and means "delete this word" — a real
    // thing to want, and the confirm dialog says so in words rather than
    // showing an arrow pointing at nothing.
    const replacement = sanitizePlainText(
      String(payload.replacement ?? "").slice(0, NOTE_SEARCH_MAX_INPUT_LENGTH)
    );
    const replacementError = validateReplacement(replacement);
    if (replacementError) return jsonError(replacementError, 400);

    const rawItems = payload.items;
    if (!Array.isArray(rawItems) || rawItems.length === 0) {
      return jsonError("กรุณาเลือกอย่างน้อย 1 รายที่ต้องการแทนที่", 400);
    }

    // Refused whole, never trimmed: doing the first 100 of 140 and answering
    // "สำเร็จ" is how an admin walks away believing a rename finished. Nothing
    // is written when this fires.
    const countError = validateReplaceItemCount(rawItems.length);
    if (countError) return jsonError(countError, 400);

    // Sanitised at the boundary, and again in the store beside the statements
    // that use them — `sanitizePlainText` decodes entities before re-encoding,
    // so it is idempotent and running it twice changes nothing. `expectedNote`
    // is sliced first so a hand-built request cannot make the sanitiser chew
    // through megabytes; a value that was cut simply fails the equality check
    // in the store and is refused as stale rather than written.
    const items: NoteReplaceItem[] = rawItems.map((raw) => {
      const item = (raw ?? {}) as Record<string, unknown>;
      return {
        customerId: sanitizePlainText(String(item.customerId ?? "")).trim(),
        expectedNote: sanitizePlainText(
          String(item.expectedNote ?? "").slice(0, NOTE_SEARCH_MAX_INPUT_LENGTH)
        ),
      };
    });

    let report;
    try {
      report = await replaceInNotes({ matcher: built.matcher, replacement, items });
    } catch (error) {
      // The store enforces the batch cap beside the statements it protects.
      // Reaching this means the envelope check above was bypassed, so it is a
      // 400 with the store's Thai reason rather than an opaque 500.
      if (error instanceof NoteReplaceRefusedError) {
        return jsonError(error.message, 400);
      }
      throw error;
    }

    // 400 with the SAME BODY SHAPE when every customer was refused: the screen
    // has to render the reasons, not a success toast for a batch in which
    // nothing happened. Partial success stays a 200 — success with a report
    // attached — and a batch that was entirely `unchanged` is a 200 too:
    // nothing was refused and nothing needed changing.
    const everythingRefused =
      report.results.length > 0 && report.results.every((r) => r.status === "refused");

    return NextResponse.json(report, { status: everythingRefused ? 400 : 200 });
  }
);

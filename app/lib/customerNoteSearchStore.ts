import "server-only";
import { query, withTransaction } from "./db";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { sanitizePlainText } from "./sanitizeHtml";
import { saveRevision } from "./revisionStore";
import {
  NOTE_SEARCH_MAX_INPUT_LENGTH,
  NOTE_SEARCH_ROW_CAP,
  NoteScanBudgetError,
  applyReplace,
  createScanBudget,
  findMatches,
  noteLengthRefusal,
  readIdentityToken,
  validateReplaceItemCount,
} from "./noteSearch";
import type {
  NoteMatch,
  NoteMatchSummary,
  NoteMatcher,
  NoteScanOptions,
} from "./noteSearch";

/**
 * The read path and the write path for search-and-replace across every
 * customer's `note`.
 *
 * Spec: openspec/changes/add-customer-note-search.
 *
 * WHAT THIS MODULE MAY WRITE: exactly one column, `customers.note`, and rows
 * in `revisions`. There is no statement anywhere in this file that writes
 * `companyId`, `name`, `department`, `phone` or `email` — a bulk path must
 * touch the least it possibly can, and that absence is the real control.
 * `__tests__/lib/customerNoteSearchStore.test.ts` asserts it from the SQL
 * actually issued, not from this comment.
 *
 * WHY THE MATCHER IS A PARAMETER AND NOT A TERM: the only way to obtain a
 * `NoteMatcher` is `buildMatcher()`, which refuses an empty term, a broken
 * pattern and — the one that matters — any pattern that can match the empty
 * string. Taking the matcher rather than the raw text means there is no code
 * path from a dangerous pattern to an UPDATE, whatever a hand-built request
 * sends.
 */

// ── Search ───────────────────────────────────────────────────────────────────

export interface NoteSearchRow {
  customerId: string;
  customerName: string;
  companyName: string;
  /**
   * The note as it is stored, right now. It is the preview material AND the
   * concurrency token: the screen sends it back as `expectedNote` when it asks
   * for a replace, and the write refuses if the stored value has moved on
   * since. Plain text — never rendered as markup.
   */
  note: string;
  /** How many times the term appears in this note. */
  matchCount: number;
  /** `matchCount` hit the per-note scan cap; there may be more. */
  countCapped: boolean;
  /** The first few matches with the text around them. */
  matches: NoteMatch[];
}

export interface NoteSearchResult {
  rows: NoteSearchRow[];
  /** Customers whose note matched, in total. `rows` may be shorter. */
  total: number;
  /** Matching customers NOT in `rows`, so the screen can say "และอีก N ราย"
   *  rather than letting a capped list read as the whole answer. */
  hidden: number;
  cap: number;
  /** Total matches across every matching customer, capped list or not. */
  totalMatches: number;
  /**
   * Notes too long to run a pattern against safely, and therefore NOT
   * searched. Reported rather than swallowed: a customer whose note was never
   * examined must not be indistinguishable from one with no matches. Expected
   * to be 0 — the write paths cap notes far below that limit.
   */
  skippedOversize: number;
}

/**
 * Every customer whose note contains the term.
 *
 * THE MATCHING HAPPENS IN JAVASCRIPT, NOT IN SQL, and that is deliberate:
 *
 *   • `note LIKE '%term%'` cannot use an index — a leading wildcard forces a
 *     full scan regardless — so pushing the filter into SQL buys no speed, it
 *     only moves where the rows are discarded.
 *   • It would be WRONG as well as pointless. `LIKE` is evaluated in the
 *     column's collation, and TiDB's default for utf8mb4 is `utf8mb4_bin`; a
 *     case-insensitive search (the default here) would then silently lose
 *     every row whose match differs in case — the exact failure this feature
 *     exists to prevent. Regular-expression mode has no `LIKE` equivalent at
 *     all.
 *   • The one matcher in `noteSearch.ts` is then the only thing that decides
 *     what a match is, for the browser, the search and the replace alike.
 *
 * Only the four columns the results table needs are read, and rows with no
 * note at all are excluded in SQL — that is where the volume is.
 */
export async function searchNotes(
  matcher: NoteMatcher,
  options?: { cap?: number }
): Promise<NoteSearchResult> {
  const cap = Math.max(1, Math.floor(options?.cap ?? NOTE_SEARCH_ROW_CAP));

  const [rows] = await query<RowDataPacket[]>(
    `SELECT c.id, c.name, c.note, co.name AS companyName
     FROM customers c
     LEFT JOIN companies co ON c.companyId = co.id
     WHERE c.note IS NOT NULL AND c.note <> ''
     ORDER BY c.name ASC`
  );

  const matched: NoteSearchRow[] = [];
  let totalMatches = 0;
  let skippedOversize = 0;

  // ONE time budget for the whole table, not one per row. A pattern that takes
  // 30ms on a single note is invisible; the same pattern across every customer
  // in the business is a request that never comes back, and only a shared
  // budget can see the difference. Every note carries its customer's name, so
  // the abort names the row it stopped on.
  //
  // A budget abort THROWS out of this function. Deliberately not caught here:
  // this is the read path, it has written nothing and can write nothing, and
  // `withRoute` turns the throw into a Thai failure for the screen while the
  // precise reason goes to the server log. Swallowing it and returning the rows
  // gathered so far would be the one thing that must never happen — a partial
  // result that looks exactly like a complete one.
  const budget = createScanBudget();

  for (const row of rows) {
    const note = row.note === null || row.note === undefined ? "" : String(row.note);
    if (note.length > NOTE_SEARCH_MAX_INPUT_LENGTH) {
      skippedOversize++;
      continue;
    }
    const summary = findMatches(note, matcher, {
      budget,
      label: String(row.name ?? ""),
    });
    if (summary.count === 0) continue;
    totalMatches += summary.count;
    matched.push({
      customerId: String(row.id ?? ""),
      customerName: String(row.name ?? ""),
      companyName: row.companyName === null || row.companyName === undefined
        ? ""
        : String(row.companyName),
      note,
      matchCount: summary.count,
      countCapped: summary.countCapped,
      matches: summary.matches,
    });
  }

  return {
    rows: matched.slice(0, cap),
    total: matched.length,
    hidden: Math.max(0, matched.length - cap),
    cap,
    totalMatches,
    skippedOversize,
  };
}

// ── Replace ──────────────────────────────────────────────────────────────────

/** Structural shape of the connection a `withTransaction` callback gets, so
 *  this module needs no mysql2 connection type of its own. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TxConn = { query: (sql: string, params?: unknown[]) => Promise<any> };

export const NOTE_REPLACE_REFUSAL_CODES = [
  /** No such customer — deleted since the search, or a fabricated id. */
  "not_found",
  /** The stored note is not the one the screen saw. Somebody else edited it. */
  "stale",
  /** The replaced note would pass 2000 characters and be silently truncated. */
  "too_long",
  /** The pattern produced a zero-length match, or more matches than the scan
   *  cap. Should be unreachable — `buildMatcher` refuses these — so it exists
   *  to fail loudly rather than write something strange. */
  "unsafe_match",
] as const;
export type NoteReplaceRefusalCode = (typeof NOTE_REPLACE_REFUSAL_CODES)[number];

export const NOTE_REPLACE_STATUSES = ["replaced", "unchanged", "refused"] as const;
export type NoteReplaceStatus = (typeof NOTE_REPLACE_STATUSES)[number];

export interface NoteReplaceItem {
  customerId: string;
  /**
   * The note the SCREEN saw when it ran the search. Mandatory: it is what
   * stops a bulk replace from swallowing an edit somebody made in the minutes
   * between the preview and the confirm, and it is what makes a replayed
   * transaction refuse instead of replacing twice.
   */
  expectedNote: string;
}

export interface NoteReplaceItemResult {
  customerId: string;
  /** Read inside the transaction, so the report names the customer even if the
   *  screen's copy was stale. Empty when the row was not found. */
  customerName: string;
  status: NoteReplaceStatus;
  /** Matches found in the note as it stood in the database. */
  matchCount: number;
  /** Length of the note that was written (or would have been). */
  resultLength: number;
  code: NoteReplaceRefusalCode | null;
  /** Thai. Empty string for `replaced`; explains itself otherwise. */
  reason: string;
}

export interface NoteReplaceReport {
  replacedCount: number;
  unchangedCount: number;
  refusedCount: number;
  /** One entry per submitted item, in submission order. Never short, never
   *  reordered — a report you have to align by hand is not a report. */
  results: NoteReplaceItemResult[];
}

export interface NoteReplaceInput {
  matcher: NoteMatcher;
  replacement: string;
  items: NoteReplaceItem[];
}

/**
 * Thrown for a request that must not be written. The route turns it into a 400
 * with this message; the class exists so the cap lives with the code that
 * issues the SQL, not only in the route above it.
 *
 * Two things raise it. The batch cap, before a transaction is opened, so no
 * query is issued at all; and a scan that ran out of its time budget partway
 * through the transaction — which rolls back, so in both cases the message's
 * claim that nothing was written is true when it reaches the screen.
 */
export class NoteReplaceRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NoteReplaceRefusedError";
  }
}

/**
 * The match count and the replaced note for one customer — with a scan that
 * ran out of time converted into `NoteReplaceRefusedError`.
 *
 * WHY CONVERT IT. A budget abort is not one customer's refusal; it is the batch
 * giving up, and it must not land in `results` as a per-customer reason while
 * the other 39 customers get written. Throwing rolls the transaction back, so
 * nothing is written at all, and `NoteReplaceRefusedError` is the one class the
 * route already turns into a 400 carrying its own Thai text — which names the
 * customer the scan stalled on, instead of the opaque 500 an unrecognised
 * error would produce.
 */
function scanOrRefuse(
  current: string,
  matcher: NoteMatcher,
  replacement: string,
  scan: NoteScanOptions
): { summary: NoteMatchSummary; next: string | null } {
  try {
    return {
      summary: findMatches(current, matcher, scan),
      next: applyReplace(current, matcher, replacement, scan),
    };
  } catch (error) {
    if (error instanceof NoteScanBudgetError) {
      throw new NoteReplaceRefusedError(error.message);
    }
    throw error;
  }
}

function refused(
  customerId: string,
  customerName: string,
  code: NoteReplaceRefusalCode,
  reason: string,
  matchCount = 0
): NoteReplaceItemResult {
  return {
    customerId,
    customerName,
    status: "refused",
    matchCount,
    resultLength: 0,
    code,
    reason,
  };
}

/**
 * Replace the term in every listed customer's note, inside ONE transaction,
 * and report on every customer individually.
 *
 * ATOMICITY. The whole batch is a single `withTransaction`, 2 customers or
 * 100. Half the call logs rewritten and half not is a state nobody can detect
 * from the screen and nobody can undo by hand, so a failure at customer 37 of
 * 40 rolls everything back and rewrites nothing. Per-customer REFUSALS are a
 * different thing entirely: they are decisions, they are reported, and they do
 * not roll anybody else back.
 *
 * IDEMPOTENCE, which `withTransaction` requires because it retries the whole
 * callback up to 3 times on a transient connection loss:
 *   • `results` is declared INSIDE the callback and rebuilt from scratch every
 *     attempt. An array outside would report every customer twice after one
 *     retry.
 *   • The new note is computed INSIDE the callback from the note read in THAT
 *     attempt — never from anything resolved before the transaction opened.
 *   • `saveRevision` mints its UUID inside the callback and runs through this
 *     transaction's own connection, so a rolled-back attempt leaves no stray
 *     snapshot.
 *   • The `expectedNote` guard closes the last hole. If an attempt committed
 *     and its acknowledgement was lost, the replay re-reads the ALREADY
 *     REPLACED note, sees it differs from `expectedNote`, and refuses every
 *     customer as `stale`. The report is then wrong while the data is right —
 *     the correct side to fail on, and the next search shows the truth.
 *
 * HISTORY FIRST, ALWAYS. `saveRevision("customer", …)` runs before the UPDATE
 * for every customer written. If it throws, the transaction rolls back and
 * NOTHING is rewritten: no history means no destructive write.
 */
export async function replaceInNotes(
  input: NoteReplaceInput
): Promise<NoteReplaceReport> {
  const matcher = input.matcher;

  // The replacement is the one value here that really is TEXT ON ITS WAY INTO
  // STORAGE, so it keeps the project's sanitiser. The screen says so in words
  // before the confirm dialog opens ("คำแทนที่มีอักขระ < > หรือ &…"), because
  // this is the one place on this path where what is stored can differ from
  // what was previewed.
  const replacement = sanitizePlainText(input.replacement ?? "");

  // THE TOKENS ARE READ VERBATIM. `customerId` is a row key and `expectedNote`
  // is a concurrency token — they are compared, never rendered — and running
  // either through `sanitizePlainText` encodes ONE SIDE of an equality test
  // whose other side is the raw column. Any note that is not already a fixed
  // point of the sanitiser (one imported straight into `customers.note`, one
  // truncated by `substring(0, 2000)` after its entities were encoded, one this
  // very function wrote) then failed the check for ever and was reported as
  // "somebody else edited this" when nobody had. See "Values that cross a
  // boundary" in `noteSearch.ts`.
  const items: NoteReplaceItem[] = (input.items ?? []).map((item) => ({
    customerId: readIdentityToken(item?.customerId).trim(),
    expectedNote: readIdentityToken(item?.expectedNote),
  }));

  // The cap is enforced HERE, beside the statements it protects, as well as in
  // the route. Refusal, not truncation, and it throws before a transaction is
  // even opened, so no query is issued.
  const countError = validateReplaceItemCount(items.length);
  if (countError) throw new NoteReplaceRefusedError(countError);

  return withTransaction(async (conn: TxConn) => {
    // Rebuilt every attempt. Nothing outside this callback accumulates.
    const results: NoteReplaceItemResult[] = [];

    // ONE time budget for the batch, created INSIDE the callback like
    // everything else here: a retried attempt is fresh work and gets a fresh
    // budget, rather than inheriting a clock the failed attempt already ran
    // down. The scan throws `NoteScanBudgetError` when it runs out, which
    // `scanOrRefuse` turns into a refusal of the whole batch: the transaction
    // rolls back and nobody's note is touched.
    const budget = createScanBudget();

    const ids: string[] = [];
    for (const item of items) {
      if (item.customerId && !ids.includes(item.customerId)) ids.push(item.customerId);
    }

    // ONE grouped, locking read — never one query per customer. `FOR UPDATE`
    // holds these rows for the handful of statements that follow, so the note
    // that is snapshotted, measured and compared is the note that gets
    // overwritten.
    //
    // The FULL row is read, not just the note: the snapshot written to
    // `revisions` is the whole customer, matching what the single-customer
    // edit in `PUT /api/customers/[id]` stores, so one restore path can serve
    // both. There is no JOIN here — locking rows in `companies` for a company
    // name nobody writes would be a lock taken for a display string.
    const state = new Map<string, RowDataPacket>();
    if (ids.length > 0) {
      const [rows] = await conn.query(
        `SELECT id, companyId, name, department, phone, email, note
         FROM customers WHERE id IN (${ids.map(() => "?").join(", ")}) FOR UPDATE`,
        ids
      );
      for (const row of rows as RowDataPacket[]) {
        state.set(String(row.id ?? ""), row);
      }
    }

    for (const item of items) {
      // 1. Existence.
      const row = state.get(item.customerId);
      if (!row) {
        results.push(
          refused(
            item.customerId,
            "",
            "not_found",
            "ไม่พบลูกค้ารายนี้แล้ว อาจถูกลบไปหลังจากที่หน้าจอค้นหาครั้งล่าสุด กรุณาค้นหาใหม่อีกครั้ง"
          )
        );
        continue;
      }

      const customerName = String(row.name ?? "");
      const current = row.note === null || row.note === undefined ? "" : String(row.note);

      // 2. The staleness guard, against the value read HERE — never against
      //    anything the client asserted about anybody else. This is also what
      //    makes the same id listed twice in one request refuse the second
      //    time instead of being replaced twice: `row.note` is updated after
      //    every successful write below.
      //
      //    BOTH SIDES ARE RAW. `current` is `customers.note` exactly as stored
      //    and `item.expectedNote` is exactly what the screen was sent, so this
      //    compares the note to itself and answers the question actually being
      //    asked. Never reintroduce a transform on one side of it: doing that
      //    does not make the check stricter, it makes it answer a different
      //    question and refuse rows nobody touched.
      if (current !== item.expectedNote) {
        results.push(
          refused(
            item.customerId,
            customerName,
            "stale",
            "บันทึกของลูกค้ารายนี้ถูกแก้ไขไปแล้วหลังจากที่หน้าจอค้นหามา ระบบจึงไม่เขียนทับให้ " +
              "เพื่อไม่ให้งานของคนที่แก้ไปพร้อมกันหายไป กรุณาค้นหาใหม่แล้วเลือกรายนี้อีกครั้ง"
          )
        );
        continue;
      }

      // 3. The new note, computed from what THIS attempt read. Both calls
      //    spend the batch's shared time budget and carry the customer's name,
      //    so a scan that runs away is stopped and named rather than holding
      //    every locked row in this transaction until something times out.
      const { summary, next } = scanOrRefuse(current, matcher, replacement, {
        budget,
        label: customerName,
      });
      if (next === null) {
        results.push(
          refused(
            item.customerId,
            customerName,
            "unsafe_match",
            "คำค้นนี้จับคู่กับบันทึกของรายนี้ในลักษณะที่ระบบไม่ยอมเขียนทับ (ตำแหน่งว่าง หรือเจอมากผิดปกติ) " +
              "กรุณาระบุคำค้นให้เจาะจงขึ้นแล้วลองใหม่",
            summary.count
          )
        );
        continue;
      }

      // 4. Nothing to do. Reported as `unchanged` with NO UPDATE issued, so a
      //    summary can never claim "แก้ไขแล้ว 12 ราย" when 3 of them were
      //    already correct.
      if (next === current) {
        results.push({
          customerId: item.customerId,
          customerName,
          status: "unchanged",
          matchCount: summary.count,
          resultLength: current.length,
          code: null,
          reason: "ไม่พบคำที่ต้องการแทนที่ในบันทึกของรายนี้แล้ว จึงไม่มีอะไรถูกเปลี่ยน",
        });
        continue;
      }

      // 5. The 2000-character ceiling — MEASURED, then refused. The customer
      //    write routes reach it with `substring(0, 2000)`, which cuts the end
      //    of a years-long call log off and tells nobody.
      const lengthError = noteLengthRefusal(next);
      if (lengthError) {
        results.push(
          refused(item.customerId, customerName, "too_long", lengthError, summary.count)
        );
        continue;
      }

      // 6. History BEFORE the overwrite, through this transaction's own
      //    connection so it rolls back with everything else. A snapshot that
      //    survives without its update is harmless; an update without its
      //    snapshot is the thing this whole change exists to prevent.
      await saveRevision("customer", item.customerId, row, conn);

      // 7. The narrowest possible write: ONE column, with the note we read
      //    repeated in the WHERE. Nothing else on the customer row is touched,
      //    and a row that changed between the read and this statement matches
      //    nothing and is refused rather than overwritten.
      const [result] = await conn.query(
        "UPDATE customers SET note = ? WHERE id = ? AND note = ?",
        [next, item.customerId, current]
      );

      if ((result as ResultSetHeader)?.affectedRows === 0) {
        results.push(
          refused(
            item.customerId,
            customerName,
            "stale",
            "บันทึกของรายนี้ถูกแก้ไขพอดีระหว่างที่กำลังบันทึก ระบบจึงไม่เขียนทับให้ กรุณาค้นหาใหม่อีกครั้ง",
            summary.count
          )
        );
        continue;
      }

      results.push({
        customerId: item.customerId,
        customerName,
        status: "replaced",
        matchCount: summary.count,
        resultLength: next.length,
        code: null,
        reason: "",
      });

      // Keep this attempt's view of the row current, so a second item naming
      // the same customer is refused as stale instead of replaced twice.
      row.note = next;
    }

    // Any OTHER database error thrown above propagates out of this callback:
    // the transaction rolls back and NOBODY's note is changed. A partial bulk
    // rewrite of years of call logs is worse than a failed one.
    return {
      replacedCount: results.filter((r) => r.status === "replaced").length,
      unchangedCount: results.filter((r) => r.status === "unchanged").length,
      refusedCount: results.filter((r) => r.status === "refused").length,
      results,
    };
  });
}

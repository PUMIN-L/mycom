/**
 * Search-and-replace over `customers.note`, as PURE functions — no DOM, no DB,
 * no fetch.
 *
 * THE ONE IMPURITY IS A CLOCK, and it is here on purpose: the scan loops read
 * the elapsed time so a search that is taking absurdly long can stop instead of
 * locking up the machine it is running on (see "The backtracking guard" below).
 * It is a READ of a monotonic counter, nothing else, and every entry point lets
 * the caller inject its own `now()` so the tests drive it deterministically
 * rather than by sleeping.
 *
 * Spec: openspec/changes/add-customer-note-search.
 *
 * IMPORTS: none, deliberately. The results table, the confirm dialog and the
 * two API routes all have to agree on what a match IS, what gets refused and
 * WHY — so the browser and the server call these same functions rather than
 * each carrying their own copy of the rules. That only works while this file
 * drags nothing server-side (mysql2, sanitize-html) into a client bundle, the
 * same reason `alertDateSearch.ts` keeps its imports down to one leaf module.
 *
 * THE ONE THING THIS FILE IS FOR: `buildMatcher()` is the SINGLE place that
 * decides whether a search term may be run at all. The person using this
 * system owns the business; he is not a programmer. Typing `.*` into the
 * regular-expression box and pressing "แทนที่ทั้งหมด" is, without a guard,
 * "erase every customer's call log in one click" — so a pattern that can match
 * the empty string is refused here, before anything reaches a query, and the
 * refusal is detected by RUNNING the pattern, never by reading its text.
 *
 * THE BACKTRACKING GUARD, AND WHAT IT HONESTLY IS. `(a+)+b` run against a long
 * line of `a`s makes the regular-expression engine try every way of splitting
 * that line — work that doubles with every extra character. In the browser that
 * is not "slow": the tab stops responding, with the confirm dialog for a bulk
 * edit half-open, and the only way out is to kill it.
 *
 * There is NO timeout available to defend against this, and this file does not
 * pretend otherwise. JavaScript has no regular-expression timeout, and one call
 * to `exec()` is ATOMIC — it runs to completion on the only thread there is, so
 * nothing in this process can interrupt it once it has started. The guard is
 * therefore built out of the three things that DO work, each covering a
 * different case and none of them covering all of them:
 *
 *   (a) A STATIC REFUSAL in `buildMatcher` — `backtrackingRefusal()` — for the
 *       pattern SHAPES that cause exponential backtracking: a quantifier on a
 *       group that itself ends in a quantifier (`(a+)+`, `(a*)*`, `(a+)*`), and
 *       a quantified group whose alternatives overlap (`(a|aa)+`). This is the
 *       only part that helps against a SINGLE catastrophic `exec()`, because it
 *       refuses the pattern before any `exec()` is reached. It is a HEURISTIC,
 *       NOT A PROOF: it recognises the classic shapes, and a sufficiently
 *       inventive pattern can still get past it.
 *   (b) AN ELAPSED-TIME BUDGET (`createScanBudget`), checked BETWEEN matches in
 *       `findMatches` / `applyReplace` and once before each note's scan begins.
 *       This is what covers the cases (a) cannot see — a pattern that is merely
 *       expensive multiplied by 500 matches, or by 100 notes in one preview
 *       pass — and it aborts with a Thai message that NAMES the note it was
 *       working on. It cannot break into a single `exec()`; it can only decline
 *       to start the next one.
 *   (c) THE LENGTH BOUNDS below — the pattern (200) and the note (20 000). They
 *       are what keeps the worst case that survives (a) and (b) finite at all,
 *       since the cost of a pathological pattern grows with both.
 *
 * Whatever gets through is a Thai error, and never a half-finished replace:
 * every failure mode here aborts before a write rather than returning a partial
 * result.
 *
 * NO "WHOLE WORD" OPTION EXISTS, and that is a decision rather than an
 * oversight. JavaScript's `\b` is defined on the edges of `[A-Za-z0-9_]`; Thai
 * has no spaces between words and no Thai character is in that set, so
 * `\bเวอร์เนีย\b` can never match Thai text. A button whose result is always
 * empty is worse than no button. Nothing in this file emits `\b`.
 */

// ── Caps ─────────────────────────────────────────────────────────────────────
//
// Every number below is written down with the reason for the number. A cap
// with no rationale is a cap nobody dares to change and nobody can defend.

/**
 * The ceiling `app/api/customers/route.ts` and `app/api/customers/[id]
 * /route.ts` already impose with `sanitizePlainText(...).substring(0, 2000)`.
 * That `substring` is a SILENT truncation: a replacement longer than the word
 * it replaces can push a note past 2000 and the tail disappears with nobody
 * told. The replace path measures against this constant first and refuses the
 * customer instead — see `customerNoteSearchStore.replaceInNotes`.
 */
export const CUSTOMER_NOTE_MAX_LENGTH = 2000;

/**
 * Longest search term / regular expression accepted. Two jobs: it catches a
 * paste accident, and it is half of the backtracking guard below — the cost of
 * a pathological pattern grows with BOTH the pattern and the input, so both
 * are bounded.
 */
export const NOTE_SEARCH_TERM_MAX_LENGTH = 200;

/** Longest replacement accepted. A replacement longer than the whole note
 *  ceiling cannot produce a note that fits anyway, so anything near it is a
 *  paste accident; 500 leaves room for a genuine multi-line replacement. */
export const NOTE_REPLACEMENT_MAX_LENGTH = 500;

/**
 * Longest note this module will run a user-supplied pattern against. The write
 * paths cap notes at 2000, so 20000 is pure headroom for a row that predates
 * that cap or was written straight into the database. A note past this is
 * SKIPPED, and `searchNotes` counts the skips and reports them — an unsearched
 * customer must never look like a customer with no matches.
 */
export const NOTE_SEARCH_MAX_INPUT_LENGTH = 20000;

/** Matches counted in one note before the count stops. A 1-character term in a
 *  2000-character note can match hundreds of times; the count is a number on a
 *  screen, so "500+" is as useful as an exact figure and bounds the work. */
export const NOTE_MATCH_SCAN_CAP = 500;

/** Matches returned WITH surrounding context per note. The table shows the
 *  context so an admin can tell "เวอร์เนีย" the product from "เวอร์เนีย" in
 *  someone's name before replacing anything; five windows is enough to judge
 *  that, and the full count is reported separately. */
export const NOTE_MATCH_SAMPLE_CAP = 5;

/** Characters of the note kept on each side of a match in that context
 *  window. Wide enough to carry the date at the start of a call-log line and
 *  the gist of the sentence, narrow enough for a table cell. */
export const NOTE_SNIPPET_CONTEXT = 48;

/**
 * Milliseconds one pass through this module may spend before it gives up —
 * part (b) of the backtracking guard at the top of the file.
 *
 * THE NUMBER IS CHOSEN FROM BOTH ENDS. Real work is nowhere near it: scanning
 * 100 notes of 2000 characters for an ordinary word takes single-digit
 * milliseconds, so the budget is roughly a thousandfold headroom and no honest
 * search will ever meet it. At the other end, 1.5 seconds is about as long as a
 * screen may sit frozen before the person in front of it starts clicking things
 * twice — and this code runs IN THE BROWSER while the confirm dialog for a bulk
 * edit is being built, where "frozen" costs an admin his afternoon.
 *
 * It is a budget for a whole PASS, not for one note: the caller creates one
 * budget and hands the same one to every note, which is the only way the "100
 * merely-slow notes" case can be caught at all.
 */
export const NOTE_SCAN_TIME_BUDGET_MS = 1500;

/**
 * Customers one replace request may carry. Each one costs a locked row, a
 * revision INSERT and an UPDATE inside a single transaction, so this is the
 * length of the lock window as much as it is a batch size — twice the
 * statements per row that the bulk reschedule does, over rows carrying
 * kilobytes of text, which is why this number is smaller than that one.
 * Exceeding it REFUSES the whole request — never trims it: doing 100 of 140
 * and reporting success is how an admin walks away believing a rename
 * finished.
 */
export const NOTE_REPLACE_MAX_ITEMS = 100;

/**
 * Customers listed in one search result. The true number of matching customers
 * is reported alongside, so hitting this says "และอีก N ราย" instead of
 * quietly looking like the whole answer.
 *
 * DELIBERATELY THE SAME NUMBER AS `NOTE_REPLACE_MAX_ITEMS`: a list you can see
 * in full is a list you can act on in full. If the search showed more rows
 * than one replace request may carry, "แทนที่ทั้งหมด" on a full page of
 * results would be refused as too large — a dead end built out of two
 * constants that were each reasonable on their own.
 */
export const NOTE_SEARCH_ROW_CAP = NOTE_REPLACE_MAX_ITEMS;

// ── Refusals ─────────────────────────────────────────────────────────────────

export const NOTE_SEARCH_REFUSAL_CODES = [
  /** Nothing typed, or only whitespace. */
  "empty_term",
  /** Term / pattern longer than `NOTE_SEARCH_TERM_MAX_LENGTH`. */
  "term_too_long",
  /** Regular-expression mode, and `new RegExp()` threw. */
  "invalid_regex",
  /** The term carries an invisible control character (a newline, a tab, a NUL).
   *  Refused rather than stripped — see `NOTE_SEARCH_REFUSAL_REASONS`. */
  "control_characters",
  /** The pattern matches an empty string — `.*`, `a?`, `(?:)`, `\b`, `(?=x)`.
   *  These match at EVERY position of EVERY note. */
  "matches_empty",
  /** The pattern has one of the SHAPES that backtrack exponentially — `(a+)+`,
   *  `(a*)*`, `(a|aa)+`. Refused by reading the pattern, because by the time
   *  one of these is running there is nothing left that can stop it. */
  "catastrophic_backtracking",
] as const;
export type NoteSearchRefusalCode = (typeof NOTE_SEARCH_REFUSAL_CODES)[number];

/**
 * A validated matcher. The ONLY way to obtain one is `buildMatcher()`, which
 * refuses everything dangerous — so "there is a matcher" is itself the proof
 * that the pattern passed the guard, and no code path can reach an UPDATE with
 * a pattern that did not.
 */
export interface NoteMatcher {
  /** Exactly what the user typed, kept for display and for the report. */
  readonly term: string;
  readonly matchCase: boolean;
  readonly useRegex: boolean;
  /** The regular-expression source actually used (the escaped term in plain
   *  mode). Exposed for tests and diagnostics, not for rebuilding by hand. */
  readonly source: string;
  readonly flags: string;
  /**
   * A FRESH `RegExp` every call. A `RegExp` with the `g` flag carries a
   * mutable `lastIndex`, so a single shared instance would resume mid-note on
   * the next customer and quietly skip matches. Never cache the result.
   */
  regex(): RegExp;
}

export type BuildMatcherResult =
  | { ok: true; matcher: NoteMatcher; code: null; reason: null }
  | { ok: false; matcher: null; code: NoteSearchRefusalCode; reason: string };

/**
 * Thai, and every one of them says what to do next. "ค้นหาไม่ได้" on its own
 * teaches an admin only that the software is in his way.
 */
export const NOTE_SEARCH_REFUSAL_REASONS = {
  emptyTerm:
    "กรุณาพิมพ์คำที่ต้องการค้นหาก่อน ระบบไม่ค้นหาด้วยคำว่าง " +
    "เพราะผลลัพธ์ว่างเปล่าจะทำให้เข้าใจผิดว่าค้นแล้วไม่เจอ",
  controlCharacters:
    "คำค้นมีอักขระควบคุมที่มองไม่เห็นปนมาด้วย (เช่น ตัวขึ้นบรรทัด แท็บ หรืออักขระว่างพิเศษ) " +
    "ระบบจึงยังไม่ค้นหาให้ เพราะคำค้นแบบนี้จะแสดงบนหน้ายืนยันไม่ตรงกับของจริง " +
    "ทำให้อ่านผิดว่ากำลังจะแทนที่คำไหน กรุณาลบอักขระเหล่านั้นออก " +
    "(ถ้าต้องการหาตัวขึ้นบรรทัดจริงๆ ให้เปิดโหมด .* แล้วพิมพ์ \\n)",
  termTooLong:
    `คำค้นยาวเกินไป ใช้ได้ไม่เกิน ${NOTE_SEARCH_TERM_MAX_LENGTH} ตัวอักษร ` +
    "ลองตัดให้เหลือเฉพาะคำที่ต้องการหาจริงๆ",
  matchesEmpty:
    "รูปแบบนี้จับคู่กับ “ข้อความว่าง” ได้ ซึ่งแปลว่ามันตรงกับทุกตำแหน่งของบันทึกทุกราย " +
    "ถ้ากดแทนที่ทั้งหมด จะเป็นการเขียนทับบันทึกของลูกค้าทุกคนในคลิกเดียว ระบบจึงไม่ยอมให้ใช้ " +
    "กรุณาระบุให้เจาะจงขึ้น เช่น พิมพ์คำจริงที่ต้องการหา หรือเปลี่ยน * และ ? เป็น +",
  nestedQuantifier:
    "รูปแบบนี้ใส่เครื่องหมาย “ซ้ำได้หลายตัว” (+ * หรือ {…}) ซ้อนกันสองชั้น " +
    "คือในวงเล็บลงท้ายด้วย + หรือ * อยู่แล้ว แล้วยังมี + หรือ * ต่อท้ายวงเล็บอีกชั้น เช่น (ก+)+ " +
    "รูปแบบแบบนี้ทำให้ระบบต้องไล่ความเป็นไปได้เพิ่มเป็นเท่าตัวทุกตัวอักษร " +
    "บันทึกยาวๆ เพียงรายเดียวก็ทำให้หน้าจอค้างจนกดอะไรไม่ได้ ระบบจึงไม่ยอมให้ใช้ " +
    "กรุณาเหลือ + หรือ * ไว้ชั้นเดียว เช่น เปลี่ยน (ก+)+ เป็น ก+",
  ambiguousAlternation:
    "รูปแบบนี้มีวงเล็บที่ต่อท้ายด้วย + หรือ * และข้างในมีตัวเลือกคั่นด้วย | ที่ทับซ้อนกันเอง " +
    "(ตัวเลือกหนึ่งเป็นส่วนขึ้นต้นของอีกตัวเลือกหนึ่ง) เช่น (ก|กก)+ " +
    "ระบบจะต้องไล่ทุกวิธีที่จะแบ่งข้อความออกเป็นชิ้นๆ จนหน้าจอค้าง ระบบจึงไม่ยอมให้ใช้ " +
    "กรุณาเขียนตัวเลือกให้ไม่ทับกัน เช่น (ก|ข)+ หรือใช้ ก+ ไปเลย",
} as const;

/**
 * The Thai message for a scan that ran out of time, naming the note it was
 * working on when the budget ran out.
 *
 * NAMING THE NOTE IS THE POINT. The confirm dialog computes the preview for up
 * to 100 customers in one pass; "ค้นหาไม่สำเร็จ" would leave an admin with 100
 * suspects and no way to tell which one to open. The caller passes the customer
 * name as the label, and it comes back out here.
 */
export function scanBudgetReason(label: string | null, budgetMs: number): string {
  const seconds = (budgetMs / 1000).toFixed(1).replace(/\.0$/, "");
  const where = label ? ` ขณะกำลังตรวจบันทึกของ “${label}”` : "";
  return (
    `คำค้นนี้ใช้เวลาประมวลผลนานผิดปกติ (เกิน ${seconds} วินาที)${where} ` +
    "ระบบจึงหยุดกลางคันเพื่อไม่ให้หน้าจอค้าง — และ ยังไม่มีบันทึกของลูกค้ารายใดถูกแก้ " +
    "กรุณาระบุคำค้นให้เจาะจงขึ้น หรือปิดโหมด .* แล้วค้นด้วยคำธรรมดา"
  );
}

function refuse(
  code: NoteSearchRefusalCode,
  reason: string
): BuildMatcherResult {
  return { ok: false, matcher: null, code, reason };
}

// ── Values that cross a boundary ─────────────────────────────────────────────
//
// THE RULE THIS SECTION EXISTS TO ENFORCE. A value that is TRANSFORMED at one
// boundary and then COMPARED or EXECUTED at another is a silent bug waiting to
// happen: the two boundaries disagree, and the screen goes on showing the value
// the user typed while the system works with a different one. Two values on
// this path had exactly that shape, and both were routed through
// `sanitizePlainText` because it was the helper nearest to hand:
//
//   • THE SEARCH TERM. `sanitizePlainText` deleted tag-like substrings — "a<b"
//     became "a", "<test" became "" (it now removes only real tags, "<b>x</b>",
//     but that is still a change) — so the browser validated one needle and
//     the server searched for another, then echoed the shortened one back for
//     the replace to be built on. A needle is never rendered as markup; it goes
//     into a bound parameter, a JSON body and a React text child. It needs a
//     LENGTH BOUND and a refusal for anything that would misrepresent itself on
//     the confirm screen. It does not need escaping, and escaping it was the
//     bug.
//   • THE CONCURRENCY TOKEN (`expectedNote`) AND THE ROW KEY (`customerId`).
//     These are not text, they are identity checks. Encoding one side of an
//     equality test and not the other means any stored note that is not already
//     a fixed point of the sanitiser — a note imported straight into the
//     column, or one truncated after its entities were encoded — is refused as
//     "stale" for ever, telling the admin about a concurrent edit that never
//     happened. They must travel VERBATIM to the comparison.
//
// Neither relaxation weakens anything. `buildMatcher` still refuses the term,
// and the store still compares `expectedNote` against the note it re-read under
// `FOR UPDATE`, so a real concurrent edit is still refused.

/**
 * A search term as it arrives from an untrusted request.
 *
 * The ONE thing done to it is a COST BOUND, not a clean-up: an absurd query
 * string is cut so nothing downstream has to walk megabytes. It is cut to ONE
 * CHARACTER OVER the cap on purpose, so `buildMatcher` still sees an over-long
 * term and refuses it with `termTooLong` rather than silently searching a
 * trimmed one. Every term short enough to be legal comes out of here byte for
 * byte as it was typed.
 */
export function boundIncomingTerm(value: unknown): string {
  return String(value ?? "").slice(0, NOTE_SEARCH_TERM_MAX_LENGTH + 1);
}

/**
 * An identity token — `expectedNote`, `customerId` — read from an untrusted
 * request and destined for an EQUALITY TEST against a value read out of the
 * database.
 *
 * It is coerced to a string and NOTHING ELSE. Not sanitised, not trimmed here,
 * not truncated: every one of those transforms the left-hand side of a
 * comparison whose right-hand side is raw, which turns "is this still the row
 * the screen saw?" into "is this row already shaped the way our sanitiser would
 * shape it?" — a question nobody asked and one that some perfectly untouched
 * rows answer "no" to for ever.
 *
 * Safe to leave unbounded: an over-long value cannot equal a note the search
 * path would ever hand out (`searchNotes` skips anything past
 * `NOTE_SEARCH_MAX_INPUT_LENGTH`), so it is REFUSED by the comparison rather
 * than written, and a JavaScript string comparison checks length first.
 */
export function readIdentityToken(value: unknown): string {
  return typeof value === "string" ? value : String(value ?? "");
}

/**
 * Control characters: C0, DEL and C1. A note may well contain newlines — it is
 * a line-per-call log — but a TERM carrying one is refused rather than stripped,
 * because the confirm dialog states the term inside a line-oriented message
 * (`คำค้น: “…”`), so an embedded newline there reads as a different sentence
 * from the one that will actually be run. Regular-expression mode still offers
 * `\n`, `\t` and `\r` as escapes, which are ordinary characters in the source.
 */
const TERM_CONTROL_CHARACTERS = /[\u0000-\u001F\u007F-\u009F]/;

// ── Building the matcher ─────────────────────────────────────────────────────

/** Everything a regular expression treats specially, so a plain search for
 *  "ราคา (ลด 10%)" searches for that text and not for a group. */
const REGEX_METACHARACTERS = /[.*+?^${}()|[\]\\]/g;

function escapeRegExp(literal: string): string {
  return literal.replace(REGEX_METACHARACTERS, "\\$&");
}

// ── (a) The static backtracking refusal ──────────────────────────────────────
//
// THIS IS A HEURISTIC, NOT A PROOF, and it is written down here so nobody
// reads the code and believes otherwise. Deciding whether an arbitrary regular
// expression backtracks exponentially is not something a hundred lines of
// string-walking settles; what these lines do is recognise the SHAPES that
// cause it in practice, which is worth doing because those shapes are also the
// ones an admin types by accident:
//
//   • A quantifier applied to a group that itself ends in a quantifier —
//     `(a+)+`, `(a*)*`, `(a+)*`, `(\d+){2,}`, `([a-z]+)+`. The inner and the
//     outer quantifier can divide the same run of text between them in
//     exponentially many ways, and on a failing match the engine tries all of
//     them.
//   • A quantified group whose alternatives OVERLAP — `(a|aa)+`, `(x|xy)*`.
//     Same explosion, arrived at through the `|` instead of through a nested
//     quantifier.
//
// It is deliberately the only part of the guard that reads the pattern's text
// rather than running it, and that is not a contradiction of the empty-match
// check above (which refuses to read text and insists on running the pattern).
// The difference is what is being asked. "Does this match nothing?" has a cheap,
// exact answer from running it. "Will this take until Thursday?" does not — you
// cannot run it to find out, because running it IS the failure. So this one is
// answered by shape, accepting that some patterns will be refused that would
// have been fine, and some will be allowed that are not.
//
// WHAT IT DOES NOT CATCH, stated plainly: an expensive pattern with no nested
// quantifier at all (`\d+\d+\d+\d+e` divides its input combinatorially without
// a single group), and anything cleverer. Those are what part (b), the time
// budget, is for — and against a single atomic `exec()` even that cannot help.
// It also has NO false-positive licence to spare: refusing `(abc)+`, `a+b+` or
// `(ก|ข)+` would take an ordinary tool away from an admin to prevent a problem
// he does not have, so every rule below is written to leave those alone and the
// tests pin that down.

/** Recursion depth for the walker. A pattern is at most 200 characters, so a
 *  nesting deeper than this is not a real search — and a bounded walker cannot
 *  itself become the thing that hangs the tab. */
const BACKTRACKING_SCAN_MAX_DEPTH = 8;

/**
 * Index just after the quantifier at `i`, or null when there is none. Handles
 * `*`, `+`, `?`, `{n}`, `{n,}`, `{n,m}` and the lazy `?` that may follow any of
 * them. A `{` that is not a well-formed quantifier is a literal brace and is
 * reported as "no quantifier", which is exactly how the engine reads it.
 */
function quantifierEnd(source: string, i: number): number | null {
  if (i >= source.length) return null;
  const char = source[i];
  let end: number;
  if (char === "*" || char === "+" || char === "?") {
    end = i + 1;
  } else if (char === "{") {
    const close = source.indexOf("}", i + 1);
    if (close === -1) return null;
    if (!/^\{\d+(,\d*)?\}$/.test(source.slice(i, close + 1))) return null;
    end = close + 1;
  } else {
    return null;
  }
  // `+?`, `*?`, `{1,2}?` — lazy, and just as capable of backtracking.
  if (source[end] === "?") end += 1;
  return end;
}

/** Index just after the `]` closing the character class that starts at `i`, or
 *  the end of the source if it is unterminated. `[` and `]` inside a class are
 *  escaped, so only `\` needs special handling. */
function classEnd(source: string, i: number): number {
  let j = i + 1;
  // A `]` in the first position is a literal `]`, not the end of the class.
  if (source[j] === "^") j += 1;
  if (source[j] === "]") j += 1;
  while (j < source.length) {
    if (source[j] === "\\") j += 2;
    else if (source[j] === "]") return j + 1;
    else j += 1;
  }
  return source.length;
}

/** Index just after the `)` matching the `(` at `i`, or the end of the source
 *  if it is unbalanced (`buildMatcher` has already rejected those as syntax
 *  errors; this is only so the walker terminates). */
function groupEnd(source: string, i: number): number {
  let depth = 0;
  let j = i;
  while (j < source.length) {
    const char = source[j];
    if (char === "\\") j += 2;
    else if (char === "[") j = classEnd(source, j);
    else if (char === "(") { depth += 1; j += 1; }
    else if (char === ")") { depth -= 1; j += 1; if (depth === 0) return j; }
    else j += 1;
  }
  return source.length;
}

/** One atom of a pattern: a literal, an escape, a class or a group, plus the
 *  quantifier stuck to it. */
interface RegexAtom {
  start: number;
  /** Index just after the atom itself, BEFORE any quantifier. */
  bodyEnd: number;
  /** Index just after the quantifier, or `bodyEnd` when there is none. */
  end: number;
  quantified: boolean;
  isGroup: boolean;
}

/** The atoms of `segment`, at its top level: a group counts as ONE atom, and
 *  `|` is skipped (alternation is split separately). */
function atomsOf(segment: string): RegexAtom[] {
  const atoms: RegexAtom[] = [];
  let i = 0;
  while (i < segment.length) {
    const char = segment[i];
    if (char === "|") { i += 1; continue; }
    const start = i;
    let bodyEnd: number;
    let isGroup = false;
    if (char === "\\") bodyEnd = Math.min(i + 2, segment.length);
    else if (char === "[") bodyEnd = classEnd(segment, i);
    else if (char === "(") { bodyEnd = groupEnd(segment, i); isGroup = true; }
    else bodyEnd = i + 1;
    const quantEnd = quantifierEnd(segment, bodyEnd);
    atoms.push({
      start,
      bodyEnd,
      end: quantEnd ?? bodyEnd,
      quantified: quantEnd !== null,
      isGroup,
    });
    i = quantEnd ?? bodyEnd;
    if (i <= start) i = start + 1; // never stand still
  }
  return atoms;
}

/** The text inside a group, with `?:`, `?=`, `?!`, `?<=`, `?<!` and `?<name>`
 *  stripped off the front. */
function groupBody(group: string): string {
  const inner = group.slice(1, group.endsWith(")") ? -1 : undefined);
  const prefix = /^\?(:|=|!|<=|<!|<[A-Za-z_$][\w$]*>)/.exec(inner);
  return prefix ? inner.slice(prefix[0].length) : inner;
}

/** The top-level alternatives of `segment`, split on `|` outside classes and
 *  groups. `a|b` → ["a", "b"]; `(a|b)c` → ["(a|b)c"]. */
function topLevelAlternatives(segment: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let i = 0;
  while (i < segment.length) {
    const char = segment[i];
    if (char === "\\") i += 2;
    else if (char === "[") i = classEnd(segment, i);
    else if (char === "(") i = groupEnd(segment, i);
    else if (char === "|") { parts.push(segment.slice(start, i)); i += 1; start = i; }
    else i += 1;
  }
  parts.push(segment.slice(start));
  return parts;
}

/**
 * True when this branch ENDS in a quantifier — the inner half of `(a+)+`.
 *
 * "Ends in" and not "contains", and that distinction is the whole reason the
 * false-positive rate stays near zero: `(a+b)+` contains a quantifier but ends
 * in a literal `b`, which anchors every repetition and makes the match linear,
 * so it is left alone. `(a+)+` ends in the quantifier, so the inner and outer
 * quantifiers are competing for the same characters.
 *
 * An unquantified group at the end is followed inwards — `((a+))+` is `(a+)+`
 * wearing a hat.
 */
function branchEndsInQuantifier(branch: string, depth: number): boolean {
  if (depth > BACKTRACKING_SCAN_MAX_DEPTH) return false;
  const atoms = atomsOf(branch);
  const last = atoms[atoms.length - 1];
  if (!last) return false;
  if (last.quantified) return true;
  if (!last.isGroup) return false;
  const body = groupBody(branch.slice(last.start, last.bodyEnd));
  return topLevelAlternatives(body).some((inner) =>
    branchEndsInQuantifier(inner, depth + 1)
  );
}

/**
 * True when two of these alternatives overlap — one is a prefix of another, as
 * in `(a|aa)+`, so the engine can split the same text between the repetitions
 * in more than one way.
 *
 * ONLY PLAIN LITERAL BRANCHES ARE COMPARED. Working out whether `(\d+|[0-9]x)`
 * overlaps means evaluating the pattern, which is the thing this check exists
 * to avoid doing; a branch carrying anything but ordinary characters is left
 * out of the comparison rather than guessed at. That keeps `(ใบเสนอราคา|ใบแจ้งหนี้)+`
 * — same first two characters, neither a prefix of the other — usable, which is
 * the sort of pattern this feature is actually for.
 */
function alternativesOverlap(branches: string[], flags: string): boolean {
  const literal = branches.filter((branch) => branch.length > 0 && /^[^\\[\](){}|*+?^$.]+$/.test(branch));
  const values = flags.includes("i")
    ? literal.map((branch) => branch.toLowerCase())
    : literal;
  for (let a = 0; a < values.length; a++) {
    for (let b = 0; b < values.length; b++) {
      if (a === b) continue;
      if (values[b].startsWith(values[a])) return true;
    }
  }
  return false;
}

/** The Thai reason this pattern is refused as catastrophic, or null. Walks
 *  every group in the pattern, including nested ones. */
function backtrackingRefusal(
  source: string,
  flags: string,
  depth = 0
): string | null {
  if (depth > BACKTRACKING_SCAN_MAX_DEPTH) return null;
  for (const atom of atomsOf(source)) {
    if (!atom.isGroup) continue;
    const body = groupBody(source.slice(atom.start, atom.bodyEnd));
    if (atom.quantified) {
      const branches = topLevelAlternatives(body);
      if (branches.some((branch) => branchEndsInQuantifier(branch, depth + 1))) {
        return NOTE_SEARCH_REFUSAL_REASONS.nestedQuantifier;
      }
      if (branches.length > 1 && alternativesOverlap(branches, flags)) {
        return NOTE_SEARCH_REFUSAL_REASONS.ambiguousAlternation;
      }
    }
    // Down into the group either way: the dangerous shape may be buried in a
    // group that is not itself repeated, as in `หา(ก(ข+)+)`.
    const nested = backtrackingRefusal(body, flags, depth + 1);
    if (nested) return nested;
  }
  return null;
}

/**
 * The probe corpus for the empty-match test. The check RUNS the pattern —
 * reading the pattern's text and looking for `.*` is a game the pattern always
 * wins (`.{0,}`, `[\s\S]*`, `(?:)`, `x{0}` and a dozen more all mean the same
 * thing), so instead the pattern is executed and asked whether it produced a
 * zero-length match.
 *
 * `""` alone catches `.*`, `a?` and `(?:)` — the cases the spec names. The
 * other strings exist for the zero-WIDTH family, which `""` cannot catch:
 * `\b`, `(?=Company)` and `(?<=x)` all fail against an empty string and then
 * match at every position of a real note. So the corpus carries Latin letters,
 * digits, Thai, a newline, a space and the punctuation that shows up in a call
 * log.
 */
const EMPTY_MATCH_PROBES = [
  "",
  " ",
  "\n",
  "abc XYZ",
  "0123456789",
  "ก ข ค เวอร์เนีย ดิจิตอล",
  "6/9/26 โทรหา QC ส่ง Company_1 (x-y) [z] a.b\n7/9/26 ติดตามใบเสนอราคา",
];

/** True when the pattern produces a zero-length match against any probe. */
function producesEmptyMatch(source: string, flags: string): boolean {
  const globalFlags = flags.includes("g") ? flags : `${flags}g`;
  for (const probe of EMPTY_MATCH_PROBES) {
    let regex: RegExp;
    try {
      regex = new RegExp(source, globalFlags);
    } catch {
      // Caller has already validated the syntax; an unbuildable pattern is not
      // an empty-match pattern.
      return false;
    }
    let match: RegExpExecArray | null;
    let guard = 0;
    while ((match = regex.exec(probe)) !== null) {
      if (match[0].length === 0) return true;
      // `exec` on a `g` regex always advances past a non-empty match; if it
      // ever did not, the loop below would spin forever, so it is treated as
      // the same danger.
      if (regex.lastIndex <= match.index) return true;
      if (++guard > 200) break;
    }
  }
  return false;
}

export interface BuildMatcherInput {
  term: string;
  /** `Aa` — off by default, so "company" finds "Company". */
  matchCase?: boolean;
  /** `.*` — off by default. */
  useRegex?: boolean;
}

/**
 * Validate a search term and turn it into a matcher, or refuse with a Thai
 * reason. Both API routes and (in the browser) the search panel call THIS, so
 * the screen cannot state one rule while the server enforces another.
 *
 * Flags:
 *   • `g` — every occurrence, always.
 *   • `i` unless `matchCase` — a no-op for Thai, which has no letter case, and
 *     exactly what is wanted for the Latin brand and model names mixed into
 *     these notes.
 *   • `m` — a customer note is a line-per-call log, so `^` and `$` mean the
 *     start and end of a LINE, which is what someone searching `^7/9` means.
 *     `.` still stops at a newline (no `s` flag), so no pattern quietly
 *     swallows the line structure.
 *
 * No `u` flag: Thai is entirely inside the BMP so it buys nothing here, while
 * unicode mode makes harmless-but-redundant escapes (`\-`, `\ `) throw, which
 * would refuse patterns that work fine.
 */
export function buildMatcher(input: BuildMatcherInput): BuildMatcherResult {
  const term = String(input?.term ?? "");
  const matchCase = input?.matchCase === true;
  const useRegex = input?.useRegex === true;

  // An empty search is refused rather than run. Running it would return
  // nothing, and "ไม่พบ" reads as "this word is nowhere in your customers'
  // notes" — a confident wrong answer to a question nobody asked.
  if (term.trim() === "") {
    return refuse("empty_term", NOTE_SEARCH_REFUSAL_REASONS.emptyTerm);
  }

  if (term.length > NOTE_SEARCH_TERM_MAX_LENGTH) {
    return refuse("term_too_long", NOTE_SEARCH_REFUSAL_REASONS.termTooLong);
  }

  // REFUSED, NOT STRIPPED. Stripping is the very shape of bug this whole path
  // just stopped doing: the browser would validate one term, the server would
  // run another, and the confirm dialog would quote a third. A refusal is
  // computed identically by the browser and both routes — they all call this
  // one function — so the screen and the server can never disagree about it.
  if (TERM_CONTROL_CHARACTERS.test(term)) {
    return refuse("control_characters", NOTE_SEARCH_REFUSAL_REASONS.controlCharacters);
  }

  const source = useRegex ? term : escapeRegExp(term);
  const flags = matchCase ? "gm" : "gim";

  try {
    // Built once here purely to surface a syntax error as a refusal instead of
    // as a 500 from somewhere further in.
    new RegExp(source, flags);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return refuse(
      "invalid_regex",
      "รูปแบบ (Regular Expression) ที่พิมพ์มาไม่ถูกต้อง ระบบจึงยังไม่ค้นหาให้ " +
        "ถ้าไม่ได้ตั้งใจใช้รูปแบบพิเศษ ให้ปิดปุ่ม .* แล้วค้นด้วยคำธรรมดา " +
        `(รายละเอียดจากระบบ: ${detail})`
    );
  }

  // (a) THE STATIC BACKTRACKING REFUSAL, AND IT RUNS BEFORE ANYTHING IS
  // EXECUTED — including before the empty-match probe below, which is itself a
  // series of `exec()` calls. `(a+)+` would have to survive seven of those
  // probes to reach this line if the order were the other way round, and one
  // `exec()` is all a catastrophic pattern needs. Applied in plain mode too:
  // every metacharacter has been escaped by then, so no plain term can trip it
  // — but there is no second, weaker path that could skip it either.
  const backtracking = backtrackingRefusal(source, flags);
  if (backtracking) {
    return refuse("catastrophic_backtracking", backtracking);
  }

  // The guard, run rather than guessed. Applied in plain mode too: an escaped
  // non-empty term can never match "", so the check simply passes — but there
  // is then no second, weaker path that could ever skip it.
  if (producesEmptyMatch(source, flags)) {
    return refuse("matches_empty", NOTE_SEARCH_REFUSAL_REASONS.matchesEmpty);
  }

  return {
    ok: true,
    code: null,
    reason: null,
    matcher: {
      term,
      matchCase,
      useRegex,
      source,
      flags,
      regex: () => new RegExp(source, flags),
    },
  };
}

// ── (b) The elapsed-time budget ──────────────────────────────────────────────

/**
 * The clock. `performance.now()` where it exists (browsers, and Node since 16)
 * because it is monotonic — `Date.now()` can be dragged backwards by an NTP
 * correction mid-scan, which would silently extend the budget instead of
 * ending it. `Date.now()` is the fallback, and being off by a clock adjustment
 * is survivable for a guard whose job is "notice a search taking a thousand
 * times longer than any real one".
 */
const monotonicNow: () => number =
  typeof performance !== "undefined" && typeof performance.now === "function"
    ? () => performance.now()
    : () => Date.now();

/**
 * Raised when a scan runs out of time. Carries a Thai message that names the
 * note being scanned, so a preview over 100 customers says WHICH customer.
 *
 * It is thrown rather than returned, and that is deliberate: an abort is not a
 * per-note decision the caller may quietly record and carry on from. Returning
 * a value would let an existing caller treat "we gave up" as "no matches here",
 * which is the silent partial result this whole guard exists to prevent. A
 * throw has to be caught to be ignored.
 */
export class NoteScanBudgetError extends Error {
  /** The note the scan was on — a customer name, when the caller passed one. */
  readonly label: string | null;
  readonly budgetMs: number;
  readonly elapsedMs: number;

  constructor(label: string | null, budgetMs: number, elapsedMs: number) {
    super(scanBudgetReason(label, budgetMs));
    this.name = "NoteScanBudgetError";
    this.label = label;
    this.budgetMs = budgetMs;
    this.elapsedMs = elapsedMs;
  }
}

export interface NoteScanBudget {
  readonly budgetMs: number;
  /** Time spent since the budget was created. For tests and diagnostics. */
  elapsedMs(): number;
  /**
   * Throw `NoteScanBudgetError` if the budget is spent. `label` names whatever
   * is being scanned right now and ends up in the Thai message.
   */
  check(label?: string | null): void;
}

/**
 * A budget for ONE pass of work, however many notes that pass covers.
 *
 * Create one and hand the same one to every `findMatches` / `applyReplace` call
 * in the pass — that is what makes "100 notes, each taking 20ms" a refusal
 * rather than a two-second freeze. A call given no budget makes itself a fresh
 * one, so a lone call is still bounded; it just cannot see what the calls
 * before it spent.
 *
 * `now` is injectable so tests can prove the abort deterministically instead of
 * sleeping and hoping.
 *
 * Spent means `elapsed >= budgetMs`, so a budget of 0 refuses before doing any
 * work at all — which is what a test wanting a guaranteed abort should pass.
 */
export function createScanBudget(options?: {
  budgetMs?: number;
  now?: () => number;
}): NoteScanBudget {
  const requested = options?.budgetMs;
  const budgetMs =
    typeof requested === "number" && Number.isFinite(requested)
      ? Math.max(0, requested)
      : NOTE_SCAN_TIME_BUDGET_MS;
  const now = options?.now ?? monotonicNow;
  const startedAt = now();
  return {
    budgetMs,
    elapsedMs: () => now() - startedAt,
    check(label?: string | null) {
      const elapsed = now() - startedAt;
      if (elapsed >= budgetMs) {
        throw new NoteScanBudgetError(label ?? null, budgetMs, elapsed);
      }
    },
  };
}

/** What every scanning function takes as its last argument. */
export interface NoteScanOptions {
  /** The pass-wide budget. Omitted, the call gets one of its own. */
  budget?: NoteScanBudget;
  /** Whose note this is — quoted back in the Thai error, so an abort in the
   *  middle of a 100-customer preview names the customer it stopped on. */
  label?: string | null;
}

// ── Finding ──────────────────────────────────────────────────────────────────

export interface NoteMatch {
  /** Index into the note where the match starts / ends. */
  start: number;
  end: number;
  /** The matched text itself, verbatim from the note. */
  text: string;
  /**
   * The note around the match, cut from the REAL note. Plain text — a note may
   * well contain characters that look like a tag, and nothing renders this as
   * markup.
   */
  snippet: string;
  /** Where `text` sits inside `snippet`, so the caller can highlight it
   *  without searching the snippet again (and finding the wrong occurrence). */
  snippetMatchStart: number;
  snippetMatchEnd: number;
  /** True when the snippet was cut off at that end, i.e. show a "…". */
  prefixTruncated: boolean;
  suffixTruncated: boolean;
}

export interface NoteMatchSummary {
  /** Total matches in this note, up to `NOTE_MATCH_SCAN_CAP`. */
  count: number;
  /** The first `NOTE_MATCH_SAMPLE_CAP` matches, with context. */
  matches: NoteMatch[];
  /** `count` stopped at the scan cap; there may be more. */
  countCapped: boolean;
  /** The note was longer than `NOTE_SEARCH_MAX_INPUT_LENGTH` and was NOT
   *  scanned. Callers report this; they never present it as "no matches". */
  skipped: boolean;
}

const EMPTY_SUMMARY: NoteMatchSummary = {
  count: 0,
  matches: [],
  countCapped: false,
  skipped: false,
};

function buildSnippet(note: string, start: number, end: number): NoteMatch {
  const from = Math.max(0, start - NOTE_SNIPPET_CONTEXT);
  const to = Math.min(note.length, end + NOTE_SNIPPET_CONTEXT);
  return {
    start,
    end,
    text: note.slice(start, end),
    // Sliced straight out of the note, newlines and all. The line structure is
    // what makes a call log readable, so it is neither collapsed nor escaped
    // here; the caller renders plain text.
    snippet: note.slice(from, to),
    snippetMatchStart: start - from,
    snippetMatchEnd: end - from,
    prefixTruncated: from > 0,
    suffixTruncated: to < note.length,
  };
}

/**
 * Every match of `matcher` in one note: how many, and the first few with the
 * surrounding text. Read-only — nothing here changes a note.
 *
 * A zero-length match STOPS the scan. `buildMatcher` already refuses the
 * patterns that produce them, so this is the backstop for anything exotic that
 * slipped past the probe corpus: without it, `exec` would never advance and
 * the loop would spin forever.
 *
 * THROWS `NoteScanBudgetError` when the pass runs out of time — checked once
 * before the scan starts (so a pass already spent on earlier notes stops here
 * instead of adding to the delay) and again after every match (so one note with
 * an expensive pattern and hundreds of matches cannot run away). What it CANNOT
 * do is interrupt the `exec()` in progress; nothing on this thread can.
 */
export function findMatches(
  note: string | null | undefined,
  matcher: NoteMatcher,
  options?: NoteScanOptions
): NoteMatchSummary {
  const text = String(note ?? "");
  if (text === "") return EMPTY_SUMMARY;
  if (text.length > NOTE_SEARCH_MAX_INPUT_LENGTH) {
    return { count: 0, matches: [], countCapped: false, skipped: true };
  }

  const budget = options?.budget ?? createScanBudget();
  const label = options?.label ?? null;
  budget.check(label);

  const regex = matcher.regex();
  const matches: NoteMatch[] = [];
  let count = 0;
  let countCapped = false;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match[0].length === 0) break;
    count++;
    if (matches.length < NOTE_MATCH_SAMPLE_CAP) {
      matches.push(buildSnippet(text, match.index, match.index + match[0].length));
    }
    if (count >= NOTE_MATCH_SCAN_CAP) {
      countCapped = true;
      break;
    }
    budget.check(label);
  }

  return { count, matches, countCapped, skipped: false };
}

/** Just the number, for callers that only need to know whether to keep a row.
 *  Same scan, same caps — there is no second, subtly different matcher. */
export function countMatches(
  note: string | null | undefined,
  matcher: NoteMatcher,
  options?: NoteScanOptions
): number {
  return findMatches(note, matcher, options).count;
}

// ── Replacing ────────────────────────────────────────────────────────────────

/**
 * The note with every match replaced, or `null` when the replace is REFUSED
 * (an over-long note, a zero-length match, or more matches than
 * `NOTE_MATCH_SCAN_CAP`). Null is never "no change" — a note with no matches
 * comes back unchanged, as a string.
 *
 * The replacement is LITERAL. This walks the note and splices, rather than
 * calling `String.prototype.replace`, for two reasons that both matter here:
 *
 *   1. `String.replace` gives `$&`, `$1`, `` $` `` and `$'` special meaning in
 *      the replacement. Someone replacing a price with "$5" would get the
 *      whole matched text inserted instead, and would have no idea why. There
 *      is no capture-group substitution in this feature at all: what you type
 *      is what goes in.
 *   2. One left-to-right pass over the ORIGINAL note. The output is never
 *      re-scanned, so replacing "เวอร์เนีย" with "เวอร์เนียดิจิตอล" cannot
 *      match its own output and run away.
 *
 * LINE STRUCTURE SURVIVES. Only the matched spans are substituted; every
 * character outside them — newlines above all — is copied through byte for
 * byte. A customer note is dated lines, and the line breaks are what make it
 * readable as "what was said on which day".
 *
 * THROWS `NoteScanBudgetError` when the pass runs out of time, on the same
 * schedule as `findMatches`. A refusal of one note is `null`; running out of
 * time is not a refusal of one note, it is the pass giving up, and the two must
 * not arrive through the same channel — the browser builds its confirm dialog
 * by calling this for up to 100 customers in a row, and "this customer cannot
 * be replaced" and "stop, the machine is bogged down" are different sentences
 * to put in front of an admin.
 */
export function applyReplace(
  note: string | null | undefined,
  matcher: NoteMatcher,
  replacement: string | null | undefined,
  options?: NoteScanOptions
): string | null {
  const text = String(note ?? "");
  if (text.length > NOTE_SEARCH_MAX_INPUT_LENGTH) return null;

  // An empty replacement is allowed on purpose: it means "delete this word",
  // which is a real and reasonable thing to want. The confirm dialog says so
  // in words rather than showing an empty arrow.
  const value = String(replacement ?? "");

  const budget = options?.budget ?? createScanBudget();
  const label = options?.label ?? null;
  budget.check(label);

  const regex = matcher.regex();
  let out = "";
  let cursor = 0;
  let replaced = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    // Backstop for a zero-width pattern that got past `buildMatcher`: refuse
    // the whole note rather than splice the replacement in at every position.
    if (match[0].length === 0) return null;
    if (++replaced > NOTE_MATCH_SCAN_CAP) return null;
    out += text.slice(cursor, match.index) + value;
    cursor = match.index + match[0].length;
    budget.check(label);
  }

  return out + text.slice(cursor);
}

// ── Envelope validation ──────────────────────────────────────────────────────

/** The Thai error for a replace batch that is empty or too large, or null.
 *  A refusal, never a trim — see `NOTE_REPLACE_MAX_ITEMS`. */
export function validateReplaceItemCount(count: number): string | null {
  if (!Number.isInteger(count) || count < 1) {
    return "กรุณาเลือกอย่างน้อย 1 รายที่ต้องการแทนที่";
  }
  if (count > NOTE_REPLACE_MAX_ITEMS) {
    return (
      `แทนที่ได้ครั้งละไม่เกิน ${NOTE_REPLACE_MAX_ITEMS} ราย แต่ส่งมา ${count} ราย ` +
      "กรุณาแบ่งเป็นหลายครั้ง (ระบบไม่ตัดส่วนเกินทิ้งให้ เพราะการแก้แค่บางส่วนแล้วบอกว่าสำเร็จ อันตรายกว่าการปฏิเสธ)"
    );
  }
  return null;
}

/** The Thai error for an over-long replacement, or null. */
export function validateReplacement(replacement: string): string | null {
  if (replacement.length > NOTE_REPLACEMENT_MAX_LENGTH) {
    return (
      `คำแทนที่ยาวเกินไป ใช้ได้ไม่เกิน ${NOTE_REPLACEMENT_MAX_LENGTH} ตัวอักษร ` +
      `(บันทึกของลูกค้าหนึ่งรายเก็บได้ทั้งหมดไม่เกิน ${CUSTOMER_NOTE_MAX_LENGTH} ตัวอักษรอยู่แล้ว)`
    );
  }
  return null;
}

/**
 * The Thai reason a replaced note cannot be written, or null when it fits.
 * The 2000-character ceiling is enforced by `substring(0, 2000)` in the
 * customer write routes, which CUTS THE TAIL OFF AND TELLS NOBODY. Anything
 * that would be cut is refused here instead, per customer, with the numbers
 * in the message so the admin can see how far over it is.
 */
export function noteLengthRefusal(nextNote: string): string | null {
  if (nextNote.length <= CUSTOMER_NOTE_MAX_LENGTH) return null;
  return (
    `บันทึกใหม่จะยาว ${nextNote.length} ตัวอักษร เกินเพดาน ${CUSTOMER_NOTE_MAX_LENGTH} ตัวอักษรที่ระบบเก็บได้ ` +
    "ถ้าเขียนทับ ท้ายบันทึกจะถูกตัดหายไปโดยไม่มีใครรู้ ระบบจึงไม่แก้รายนี้ให้ " +
    "กรุณาใช้คำแทนที่ที่สั้นลง หรือเปิดบันทึกของรายนี้แล้วจัดการเองก่อน"
  );
}

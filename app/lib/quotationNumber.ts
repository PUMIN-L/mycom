// Quotation running-number helpers. Pure + dependency-free for unit testing and
// sharing between UIs.
//
// ── The docNo shape, and why there are TWO of them ──────────────────────────
// A quotation number is `QT<6-digit date>-<NN>`; NN is a running number within
// the day that starts at DOCNO_START.
//
//   CURRENT (task 5):  QT + DDMMYY + "-" + NN   →  QT050926-23   (5 Sep 2026)
//   LEGACY  (issued
//    up to 4 Sep 2026): QT + YYMMDD + "-" + NN  →  QT260905-23   (5 Sep 2026)
//
// Every quotation issued before the change keeps its LEGACY number forever —
// those documents are already with customers and can never be rewritten. So the
// helpers here do not "convert" anything: they simply understand both shapes.
// New numbers are always minted in the CURRENT shape.
//
// ── Why matching both prefixes is safe (no cross-date contamination) ─────────
// Both shapes are six digits, so one could fear a legacy number for date A
// looking like a current number for a different date B. It cannot happen for
// two dates in the same year:
//
//   legacy "YYMMDD" == current "DDMMYY"  ⟺  YY == DD(current), MM == MM,
//                                            DD(legacy) == YY
//
// With a shared year YY, that forces the day of both dates to equal YY and the
// months to be equal — i.e. it is the SAME calendar date, spelled two ways
// (e.g. 26 Sep 2026 is "260926" in both shapes). A prefix therefore never
// captures another day's numbers, which is exactly what the allocator needs:
// one running sequence per day, no matter which shape a number was issued in.
//
// ── The one thing that genuinely changed: ordering ──────────────────────────
// The legacy shape sorted chronologically as plain text because the year came
// first. The current one does NOT ("050926" < "060826"). Nothing in this app
// orders or ranges by docNo — every list orders by `createdAt`, and the
// `used_docnos` ledger is windowed on its own `createdAt` column — so this is
// documented as a constraint on future code rather than fixed here:
// ⚠️ NEVER sort, range-scan or compare quotation numbers as text to get
//    chronological order. Order by `createdAt`.

// Each day's running number starts here (business convention).
export const DOCNO_START = 22;

export const pad2 = (n: number) => String(n).padStart(2, "0");

/** The literal prefix every quotation number carries. */
export const QUOTATION_DOCNO_PREFIX = "QT";

/** Split a `yyyy-mm-dd` date into its two-digit parts, or null if it isn't one. */
function splitIsoDate(
  isoDate: string
): { yy: string; mm: string; dd: string } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(isoDate ?? "").trim());
  if (!m) return null;
  return { yy: m[1].slice(2), mm: m[2], dd: m[3] };
}

/**
 * Date part of a NEW quotation number — DDMMYY.
 * "2026-09-05" → "050926". A non-ISO input yields "" (the caller then gets a
 * "QT-" prefix, exactly what the old code produced for an empty date).
 */
export function docNoDatePart(isoDate: string): string {
  const p = splitIsoDate(isoDate);
  return p ? `${p.dd}${p.mm}${p.yy}` : "";
}

/**
 * Date part of a LEGACY quotation number — YYMMDD.
 * "2026-09-05" → "260905". Kept ONLY so already-issued numbers can still be
 * recognised; nothing mints one any more.
 */
export function legacyDocNoDatePart(isoDate: string): string {
  const p = splitIsoDate(isoDate);
  return p ? `${p.yy}${p.mm}${p.dd}` : "";
}

/** The prefix a number issued TODAY gets, e.g. "QT050926-". */
export function quotationDocNoPrefix(isoDate: string): string {
  return `${QUOTATION_DOCNO_PREFIX}${docNoDatePart(isoDate)}-`;
}

/** The legacy prefix for the same date, e.g. "QT260905-". */
export function legacyQuotationDocNoPrefix(isoDate: string): string {
  return `${QUOTATION_DOCNO_PREFIX}${legacyDocNoDatePart(isoDate)}-`;
}

/**
 * EVERY prefix a quotation for `isoDate` may legitimately carry — the current
 * shape first (that is the one new numbers are minted with), then the legacy
 * one, de-duplicated for the dates where the two coincide.
 *
 * Hand this to `nextDocNo` so the day's running number keeps climbing across
 * the format change instead of restarting at DOCNO_START beside numbers that
 * are already out with customers.
 */
export function quotationDocNoPrefixes(isoDate: string): string[] {
  const current = quotationDocNoPrefix(isoDate);
  const legacy = legacyQuotationDocNoPrefix(isoDate);
  return current === legacy ? [current] : [current, legacy];
}

/**
 * Next free trailing number for a date prefix: the day's first number is
 * DOCNO_START (-22), then -23, -24, …
 *
 * `prefix` is either a single prefix (the billing helpers still pass one) or a
 * list of prefixes that all name the SAME day — every one of them is scanned
 * for the day's highest number, and the number is issued under the FIRST.
 * Numbers belonging to other days are ignored, as are unparseable suffixes.
 */
export function nextDocNo(
  prefix: string | readonly string[],
  used: readonly string[]
): string {
  const prefixes = (typeof prefix === "string" ? [prefix] : Array.from(prefix ?? []))
    .filter((p): p is string => typeof p === "string");
  // Numbers are always issued under the first (current-shape) prefix.
  const issueUnder = prefixes[0] ?? "";

  let max = 0;
  for (const d of used ?? []) {
    if (typeof d !== "string") continue;
    for (const p of prefixes) {
      if (!d.startsWith(p)) continue;
      const n = parseInt(d.slice(p.length), 10);
      if (!Number.isNaN(n) && n > max) max = n;
      break; // one prefix per number — the shapes never overlap (see header)
    }
  }
  return `${issueUnder}${pad2(Math.max(max + 1, DOCNO_START))}`;
}

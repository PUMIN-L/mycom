// ใบ Job (service job sheet) running-number helpers. Pure + dependency-free.
//
// ── There is NO allocator in this file, and there must never be one ──────────
// A job-sheet number is `JOB<DDMMYY>-<NN>` — the same construction quotations
// (`QT…`) and billing documents (`INV`/`BN`/`RC`) already use, running within
// the day from DOCNO_START. Everything below is `quotationNumber.ts` with a
// different literal, exactly as `billingNumber.ts` is: the date parts, the
// prefix list and `nextDocNo` itself all come from there.
//
// That matters more than it looks. `nextDocNo` does one thing no hand-rolled
// max+1 does: it REFUSES TO RETURN A NUMBER THE LEDGER ALREADY OWNS, walking
// forward until it finds one that is genuinely free. Six-digit DDMMYY prefixes
// can be owned by numbers issued in a different year under the legacy YYMMDD
// shape (25 Jun 2026 → "250626" ← 26 Jun 2025), `used_docnos` is never purged,
// and its PRIMARY KEY refuses a number that is already taken. A second
// allocator here would re-open that hole for JOB numbers alone, and the failure
// looks like "the admin is told his number is a duplicate and has no way to
// clear it". The whole header of quotationNumber.ts applies verbatim.
//
// ⚠️ Everything documented there is binding here too — above all: MINT from the
//    non-date-windowed ledger for these prefixes (listDocNosByBase), never from
//    a 7-day window, and NEVER sort or range-scan job numbers as text to get
//    chronological order (DDMMYY doesn't sort). Order by `createdAt`.

import {
  nextDocNo,
  pad2,
  docNoDatePart,
  legacyDocNoDatePart,
  docNoPrefixes,
} from "./quotationNumber";

/** The literal prefix every job-sheet number carries. */
export const SERVICE_JOB_DOCNO_PREFIX = "JOB";

/**
 * The prefix a job number issued for `isoDate` gets — DDMMYY.
 * "2026-09-05" → "JOB050926-". A non-ISO input yields "JOB-", matching what
 * the quotation and billing helpers do with an empty date.
 */
export function serviceJobDocNoPrefix(isoDate: string): string {
  return `${SERVICE_JOB_DOCNO_PREFIX}${docNoDatePart(isoDate)}-`;
}

/**
 * The LEGACY (YYMMDD) prefix for the same date, e.g. "JOB260905-".
 *
 * No job number was EVER issued in the legacy shape — this document type was
 * born after quotations and billing had already switched to DDMMYY. It is
 * computed anyway, and scanned anyway (see below), for one reason: it keeps
 * JOB on the identical code path as QT/INV instead of a special case that a
 * future reader has to verify is safe. Scanning a prefix that owns nothing
 * costs one extra ledger lookup and changes no result.
 */
export function legacyServiceJobDocNoPrefix(isoDate: string): string {
  return `${SERVICE_JOB_DOCNO_PREFIX}${legacyDocNoDatePart(isoDate)}-`;
}

/**
 * EVERY prefix a job sheet for `isoDate` may legitimately carry — the current
 * shape FIRST (numbers are always issued under it), then the legacy one,
 * de-duplicated for the dates where the two coincide.
 *
 * Hand this to `nextDocNo`, never a bare string.
 */
export function serviceJobDocNoPrefixes(isoDate: string): string[] {
  return docNoPrefixes(SERVICE_JOB_DOCNO_PREFIX, isoDate);
}

/**
 * Next available job number for `isoDate`, in the current shape.
 *
 * `usedDocNos` must be the NON-date-windowed ledger for this day's prefixes
 * (listDocNosByBase / the store's own read) whenever the result will actually
 * be issued — the returned number is only guaranteed free among the numbers
 * this list could see.
 */
export function nextServiceJobDocNo(
  isoDate: string,
  usedDocNos: readonly string[]
): string {
  return nextDocNo(serviceJobDocNoPrefixes(isoDate), usedDocNos);
}

export { pad2, nextDocNo };

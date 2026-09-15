// Purchase-order running-number helpers. Thin wrapper around the generic
// allocator in quotationNumber.ts — same construction as billingNumber.ts /
// serviceJobNumber.ts, not a second implementation of the same idea.
//
// A PO number is `PO<DDMMYY>-<NN>`, NN running within the day from
// DOCNO_START. No legacy YYMMDD shape: unlike quotations/billing/service
// jobs, purchase orders are a brand-new document type here — there are no
// numbers already out with a supplier in the old shape to keep recognising.
//
// Reuses the SAME shared `used_docnos` ledger every other document type
// mints from (see quotationStore.ts's header on listDocNosByBase) — a PO's
// numbers therefore can never collide with a quotation's or an invoice's,
// and everything that header says about minting from the non-windowed
// ledger applies here unchanged.

import { nextDocNo, pad2, docNoDatePart } from "./quotationNumber";

export const PO_DOCNO_PREFIX = "PO";

/** The prefix a PO number issued TODAY gets, e.g. "PO150926-". */
export function poDocNoPrefix(isoDate: string): string {
  return `${PO_DOCNO_PREFIX}${docNoDatePart(isoDate)}-`;
}

/**
 * Next available PO docNo for the given date.
 *
 * `usedDocNos` must be the non-date-windowed ledger for this prefix when the
 * result will actually be issued (`listDocNosByBase(poDocNoPrefix(isoDate))`
 * — see the header of quotationNumber.ts for why a 7-day window is only
 * safe for warning about a duplicate, never for minting one).
 */
export function nextPoDocNo(isoDate: string, usedDocNos: string[]): string {
  return nextDocNo(poDocNoPrefix(isoDate), usedDocNos);
}

export { pad2, nextDocNo };

// Billing document running-number helpers. Pure + dependency-free.
//
// ── The docNo shape, and why there are TWO of them ──────────────────────────
// A billing number is `<INV|BN|RC><6-digit date>-<NN>`, NN running within the
// day from DOCNO_START — the same construction quotations use, because the
// customer receives a quotation and an invoice for the SAME deal and the two
// numbers must not carry two different date formats.
//
//   CURRENT:  INV + DDMMYY + "-" + NN  →  INV050926-23   (5 Sep 2026)
//   LEGACY:   INV + YYMMDD + "-" + NN  →  INV260905-23   (5 Sep 2026)
//
// Quotations switched to DDMMYY first (see quotationNumber.ts); billing follows
// here. EVERY NUMBER ALREADY ISSUED KEEPS ITS LEGACY FORM — those invoices,
// ใบวางบิล and receipts are with customers and with the revenue department and
// can never be rewritten. So nothing below converts anything: the allocator
// simply understands both shapes and mints only the current one, exactly as
// `quotationDocNoPrefixes` / `nextDocNo` already do for quotations.
//
// Everything else that matters — why matching both prefixes cannot capture
// another day's numbers within a year, why it DELIBERATELY does across a year
// boundary, and why a minted number must be checked against the non-date-
// windowed ledger — is documented once, in the header of quotationNumber.ts.
// ⚠️ Billing numbers are subject to all of it: never sort or range-scan them as
//    text to get chronological order, and never mint from a 7-day window.

import {
  nextDocNo,
  pad2,
  docNoDatePart,
  legacyDocNoDatePart,
  docNoPrefixes,
} from "./quotationNumber";

export type BillingDocType = "invoice" | "billing_note" | "receipt";

export const BILLING_PREFIX: Record<BillingDocType, string> = {
  invoice: "INV",
  billing_note: "BN",
  receipt: "RC",
};

export const BILLING_LABELS: Record<BillingDocType, { th: string; en: string }> = {
  invoice: { th: "ใบแจ้งหนี้ / ใบกำกับภาษี", en: "INVOICE / TAX INVOICE" },
  billing_note: { th: "ใบวางบิล", en: "BILLING NOTE" },
  receipt: { th: "ใบเสร็จรับเงิน", en: "RECEIPT" },
};

/**
 * The prefix a billing number issued TODAY gets — DDMMYY.
 * ("2026-08-10", invoice) → "INV100826-". A non-ISO input yields "INV-", which
 * is what the old implementation produced for an empty date.
 */
export function billingDatePrefix(docType: BillingDocType, isoDate: string): string {
  return `${BILLING_PREFIX[docType]}${docNoDatePart(isoDate)}-`;
}

/**
 * The LEGACY prefix for the same date — YYMMDD, e.g. "INV260810-". Kept ONLY so
 * numbers already issued stay recognisable; nothing mints one any more.
 */
export function legacyBillingDatePrefix(
  docType: BillingDocType,
  isoDate: string
): string {
  return `${BILLING_PREFIX[docType]}${legacyDocNoDatePart(isoDate)}-`;
}

/**
 * EVERY prefix a billing document of this type for `isoDate` may legitimately
 * carry — current shape first (new numbers are minted under it), then legacy,
 * de-duplicated for the dates where the two coincide.
 *
 * Hand this to `nextDocNo` so the day's running number keeps climbing across
 * the format change instead of restarting at DOCNO_START beside numbers that
 * are already out with customers.
 */
export function billingDocNoPrefixes(
  docType: BillingDocType,
  isoDate: string
): string[] {
  return docNoPrefixes(BILLING_PREFIX[docType], isoDate);
}

/**
 * Next available billing docNo for the given type and date, in the CURRENT
 * shape, counting the day's numbers in BOTH shapes.
 *
 * `usedDocNos` must be the non-date-windowed ledger for this day's prefixes
 * when the result will actually be issued — see the header.
 */
export function nextBillingDocNo(
  docType: BillingDocType,
  isoDate: string,
  usedDocNos: string[]
): string {
  return nextDocNo(billingDocNoPrefixes(docType, isoDate), usedDocNos);
}

export { pad2, nextDocNo };

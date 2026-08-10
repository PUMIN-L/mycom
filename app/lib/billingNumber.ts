// Billing document running-number helpers. Reuses nextDocNo from quotationNumber
// but with different prefixes per document type. Pure + dependency-free.

import { nextDocNo, pad2 } from "./quotationNumber";

export type BillingDocType = "invoice" | "billing_note" | "receipt";

export const BILLING_PREFIX: Record<BillingDocType, string> = {
  invoice: "INV",
  billing_note: "BN",
  receipt: "RC",
};

export const BILLING_LABELS: Record<BillingDocType, { th: string; en: string }> = {
  invoice: { th: "ใบแจ้งหนี้", en: "INVOICE" },
  billing_note: { th: "ใบวางบิล", en: "BILLING NOTE" },
  receipt: { th: "ใบเสร็จรับเงิน", en: "RECEIPT" },
};

/** Build the date prefix for a billing docNo, e.g. "INV20260810-" */
export function billingDatePrefix(docType: BillingDocType, isoDate: string): string {
  const dateStr = isoDate.replace(/-/g, "");
  return `${BILLING_PREFIX[docType]}${dateStr}-`;
}

/** Get the next available billing docNo for the given type and date. */
export function nextBillingDocNo(
  docType: BillingDocType,
  isoDate: string,
  usedDocNos: string[]
): string {
  const prefix = billingDatePrefix(docType, isoDate);
  return nextDocNo(prefix, usedDocNos);
}

export { pad2, nextDocNo };

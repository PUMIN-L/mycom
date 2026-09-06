/**
 * The ช่องทางชำระเงิน vocabulary. Pure + dependency-free.
 *
 * Extracted from the billing builder (where it was a local const) because the
 * payment modal on the receivables ledger and the alert card now record the
 * SAME field into `billing_payments.method`. Two copies of this list would
 * quietly diverge and leave the ledger filtering on values the builder no
 * longer writes.
 *
 * A handful of fixed options, so every dropdown built from it passes
 * `searchable={false}` (AGENTS.md: never a native <select>).
 */
export const PAYMENT_METHODS = [
  "โอนเงิน",
  "เงินสด",
  "เช็ค",
  "บัตรเครดิต",
  "อื่นๆ",
] as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** The pre-filled default — a Thai SME's ordinary case is a bank transfer. */
export const DEFAULT_PAYMENT_METHOD: PaymentMethod = "โอนเงิน";

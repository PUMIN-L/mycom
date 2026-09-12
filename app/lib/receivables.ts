/**
 * ลูกหนี้ค้างชำระ — WHICH document carries a debt, HOW MUCH of it is still
 * owed, and HOW LATE it is. One pure module, shared by the store, the ledger
 * page and the alert card, so the SQL, the badge and the ageing tile can never
 * disagree about the same row.
 *
 * Pure + free of any server dependency on purpose (the quotationTotals.ts /
 * alertThresholds.ts pattern): it is imported by client components, so nothing
 * here may reach for the DB driver. It imports only `dateFormat`, which is the
 * one definition of calendar-day arithmetic in this codebase.
 *
 * ── WHICH DOCUMENT CARRIES THE DEBT ─────────────────────────────────────────
 * THE INVOICE DOES. Nothing else, by default. The three billing types are a
 * PICKER, not a workflow: an admin can start an ใบแจ้งหนี้, an ใบวางบิล or an
 * ใบเสร็จ from scratch, each independently re-importing the same lines from the
 * same quotation, and `billing_documents` has no column that says "this receipt
 * pays that invoice" other than the `settlesDocId` added with this feature. So
 * one deal can legitimately produce all three rows with the same
 * `linkedQuotationId`, the same customer and the same grandTotal — summing "all
 * billing documents" would triple the debt.
 *
 *   • ใบวางบิล is a collection cover-sheet. The money it asks for is already
 *     owed on the invoice(s) it bundles; counting it doubles the debt of every
 *     customer whose accounts-payable department demands one.
 *   • ใบเสร็จรับเงิน is evidence money ARRIVED. It discharges debt, it never
 *     creates it — which is why a receipt with `settlesDocId` produces a
 *     `billing_payments` row instead of a receivable.
 *
 * THE ESCAPE HATCH: some Thai customers are billed with an ใบวางบิล alone and
 * no invoice is ever raised in this system. That debt would be invisible under
 * a pure docType rule, so `receivableOverride` is tri-state — NULL means "apply
 * the default rule for this docType" (what 100% of existing rows silently mean,
 * hence no backfill), 1 forces the document in, 0 forces it out. Deciding is
 * ONE CLICK BY THE ADMIN, never a guess by the code: matching customer+total
 * heuristics on financial data is exactly the cleverness that produces a wrong
 * ยอดค้าง nobody can explain.
 *
 * ── MONEY IS COMPARED IN DECIMAL SPACE, NEVER BY FLOAT EQUALITY ─────────────
 * `computeQuoteTotals` does not round `grandTotal` (only per-line discounts go
 * through round2), so 7% VAT on an odd base leaves float dust. `totalAmount` is
 * the DECIMAL(12,2) column that dust was rounded into, and every "is it
 * settled?" question is asked with a satang tolerance. `paid === total` would
 * leave invoices that can never be closed and alerts that can never clear.
 */

import { daysBetweenDateStrings } from "./dateFormat";

/** Half a satang. Anything smaller than this is float dust, not money. */
export const SATANG_TOLERANCE = 0.005;

/**
 * The version suffix on a cloned document number ("INV260810-01" ->
 * "INV260810-01v2"). Kept here because BOTH the ledger's superseded fallback
 * and /billing/saved's "(เวอร์ชันเก่า)" badge have to strip exactly the same
 * shapes, and a row billed twice is the failure this prevents.
 */
const DOCNO_VERSION_SUFFIX = /(?:-V|-v|v|V)(\d+)$/;

/** "INV260810-01v2" -> "INV260810-01". A docNo with no version is unchanged. */
export function baseDocNo(docNo: string): string {
  return String(docNo ?? "").replace(DOCNO_VERSION_SUFFIX, "");
}

/** "INV260810-01v2" -> 2. An unversioned original is version 0. */
export function docNoVersion(docNo: string): number {
  const match = DOCNO_VERSION_SUFFIX.exec(String(docNo ?? ""));
  if (!match) return 0;
  const n = parseInt(match[1], 10);
  return Number.isFinite(n) ? n : 0;
}

/** Why a document is NOT a live receivable. First match wins. */
export type ReceivableTerminal =
  /** ยกเลิกแล้ว — keeps its payment history and its reserved docNo. */
  | "cancelled"
  /** A newer version of this document exists ("แก้ไข (New Ver.)") AND THAT
   *  VERSION IS STILL ALIVE. A newer version that was itself cancelled carries
   *  nothing, so it cannot be what makes this row terminal — see
   *  `supersededByCancelled`. */
  | "superseded"
  /** Not an invoice, or explicitly excluded with receivableOverride = 0. */
  | "not_debt_carrier"
  /** ยอด 0 (or negative, from a row written before the negative-total guard). */
  | "zero_total";

export type ReceivablePaymentState = "unpaid" | "partial" | "paid" | "overpaid";

export type ReceivableDueState = "no_due_date" | "not_due" | "due_today" | "overdue";

/**
 * The ageing buckets a Thai SME's accountant already reads. Inclusive at the
 * top, non-overlapping and exhaustive. `daysOverdue = 0` (ครบกำหนดวันนี้) sits
 * in ยังไม่ถึงกำหนด, because money due today is not late today.
 */
export type AgeingBucketId =
  | "not_due"
  | "d1_30"
  | "d31_60"
  | "d61_90"
  | "d90_plus"
  /** Shown APART. Never folded into an overdue bucket and never included in the
   *  "ค้างเกินกำหนด" headline — nobody agreed to a term on these. */
  | "no_due_date";

export const AGEING_BUCKETS: { id: AgeingBucketId; label: string }[] = [
  { id: "not_due", label: "ยังไม่ถึงกำหนด" },
  { id: "d1_30", label: "เกิน 1-30 วัน" },
  { id: "d31_60", label: "เกิน 31-60 วัน" },
  { id: "d61_90", label: "เกิน 61-90 วัน" },
  { id: "d90_plus", label: "เกิน 90 วัน" },
  { id: "no_due_date", label: "ไม่ได้กำหนดวันครบกำหนด" },
];

export const TERMINAL_LABELS: Record<ReceivableTerminal, string> = {
  cancelled: "ยกเลิก",
  superseded: "ถูกแทนที่ (เวอร์ชันใหม่)",
  not_debt_carrier: "ไม่นับเป็นลูกหนี้",
  zero_total: "ไม่มียอด",
};

/**
 * Shown on a row that WOULD have been "ถูกแทนที่" if the newer version had
 * survived. The debt is real again and it is counted again, but silently
 * putting it back would ambush an admin who believes he cancelled it — so the
 * row says why it is here.
 *
 * Rendered as the rose badge on each revived row of /billing/receivables. A
 * badge can be filtered off the screen by a bucket tile while the money stays
 * in the headline, so `revivedSupersededDocs` below is rendered UNFILTERED
 * beside it; the two together are what stop a debt re-entering ยอดค้าง with
 * nothing on screen to explain it.
 */
export const REVIVED_SUPERSEDE_LABEL = "เวอร์ชันใหม่ถูกยกเลิก — กลับมาเป็นลูกหนี้";

export const PAYMENT_STATE_LABELS: Record<ReceivablePaymentState, string> = {
  unpaid: "ยังไม่ชำระ",
  partial: "ชำระบางส่วน",
  paid: "ชำระครบ",
  overpaid: "ชำระเกิน",
};

/** What `resolveReceivableStatus` needs. Every field is a denormalised COLUMN
 *  on `billing_documents` — nothing here requires parsing the JSON blob, which
 *  is what lets the alert card and the ageing query stay cheap. */
export interface ReceivableStatusInput {
  docType: string;
  totalAmount: number;
  paidAmount: number;
  dueDate?: string | null;
  cancelledAt?: string | null;
  supersededById?: string | null;
  /**
   * TRUE when the row named by `supersededById` is itself ยกเลิกแล้ว.
   *
   * "ถูกแทนที่" has to mean REPLACED BY A ROW THAT IS STILL ALIVE. A cancelled
   * newer version carries no debt and no credit, so if it were still allowed to
   * make the original terminal, BOTH rows would be terminal and a real debt
   * would be absent from `entries`, from `totalOutstanding`, from every ageing
   * bucket and from the overdue headline — with nothing at all on screen to say
   * so. Resolving this needs sight of the OTHER row, which only
   * `buildReceivablesLedger` has; a caller that cannot see it leaves this
   * undefined and keeps the conservative reading (still superseded).
   */
  supersededByCancelled?: boolean;
  /** Tri-state: null = default rule for this docType, 1 = in, 0 = out. */
  receivableOverride?: number | null;
}

export interface ReceivableStatus {
  /** Null when the document IS a live receivable. */
  terminal: ReceivableTerminal | null;
  paymentState: ReceivablePaymentState;
  dueState: ReceivableDueState;
  /** `max(0, total - paid)` — ALWAYS floored, so an overpaid or negative-total
   *  document can never subtract from the company's total ยอดค้าง. */
  outstanding: number;
  /** Baht received beyond the total, or 0. A prompt for a human: it is neither
   *  auto-applied to another invoice nor auto-refunded. */
  overpaidBy: number;
  /** Whole days past `dueDate` (negative = still to come). Null with no due
   *  date, which is NOT the same as 0. */
  daysOverdue: number | null;
  /** True only when this row belongs in the ledger and the alert feed: no
   *  terminal flag AND money is still owed. */
  isOpen: boolean;
  /** This row is back in the ledger only because the newer version that
   *  replaced it was cancelled. Rendered as REVIVED_SUPERSEDE_LABEL on the row
   *  in /billing/receivables, so the debt's return is stated rather than
   *  merely happening.
   *
   *  OPTIONAL only so that the few places which hand-build a `ReceivableStatus`
   *  to sample a label (ReceivablesGuidePanel) need not restate it;
   *  `resolveReceivableStatus` always sets it. */
  revivedFromCancelledSuccessor?: boolean;
}

/**
 * Does this document carry debt at all?
 *
 * The override is checked FIRST and is absolute in both directions — that is
 * the whole point of it being tri-state rather than a boolean with a default.
 */
export function isDebtCarrier(input: {
  docType: string;
  receivableOverride?: number | null;
}): boolean {
  const override = input.receivableOverride;
  if (override === 1) return true;
  if (override === 0) return false;
  return input.docType === "invoice";
}

/**
 * The one place the two orthogonal axes (payment, due) and the three terminal
 * flags are resolved. `today` is a Bangkok calendar-day string
 * (`bangkokDateString(new Date())`) on BOTH sides — the server flags with it
 * and the client re-derives with the same helper, so a laptop set to another
 * timezone cannot disagree with the feed.
 *
 * The axes COMBINE deliberately: a part-paid invoice can be overdue on its
 * balance ("ชำระบางส่วน • เกินกำหนด 12 วัน • ค้าง ฿70,000"). Modelling
 * ชำระบางส่วน as mutually exclusive with เกินกำหนด is how a deposit becomes an
 * invoice nobody ever chases.
 */
export function resolveReceivableStatus(
  input: ReceivableStatusInput,
  today: string
): ReceivableStatus {
  const total = Number(input.totalAmount) || 0;
  const paid = Number(input.paidAmount) || 0;

  // A newer version only makes this row terminal while that version is ALIVE.
  const revivedFromCancelledSuccessor = Boolean(
    input.supersededById && input.supersededByCancelled
  );

  let terminal: ReceivableTerminal | null = null;
  if (input.cancelledAt) terminal = "cancelled";
  else if (input.supersededById && !revivedFromCancelledSuccessor) terminal = "superseded";
  else if (!isDebtCarrier(input)) terminal = "not_debt_carrier";
  else if (total <= 0) terminal = "zero_total";

  let paymentState: ReceivablePaymentState;
  if (paid > total + SATANG_TOLERANCE) paymentState = "overpaid";
  else if (paid >= total - SATANG_TOLERANCE) paymentState = "paid";
  else if (paid <= SATANG_TOLERANCE) paymentState = "unpaid";
  else paymentState = "partial";

  const outstanding = Math.max(0, total - paid);
  const overpaidBy = Math.max(0, paid - total);

  const dueDate = input.dueDate ? String(input.dueDate) : "";
  const daysOverdue = dueDate ? daysBetweenDateStrings(dueDate, today) : null;

  let dueState: ReceivableDueState;
  if (daysOverdue === null) dueState = "no_due_date";
  else if (daysOverdue > 0) dueState = "overdue";
  else if (daysOverdue === 0) dueState = "due_today";
  else dueState = "not_due";

  return {
    terminal,
    paymentState,
    dueState,
    outstanding,
    overpaidBy,
    daysOverdue,
    isOpen: terminal === null && outstanding > SATANG_TOLERANCE,
    revivedFromCancelledSuccessor,
  };
}

/**
 * Which ageing bucket an OPEN receivable falls in. Computed by the same
 * function as the row badge on purpose — a `CASE WHEN` in SQL would be a second
 * definition that drifts from the badge the first time a boundary moves.
 */
export function receivableAgeingBucket(status: {
  daysOverdue: number | null;
}): AgeingBucketId {
  const days = status.daysOverdue;
  if (days === null) return "no_due_date";
  if (days <= 0) return "not_due";
  if (days <= 30) return "d1_30";
  if (days <= 60) return "d31_60";
  if (days <= 90) return "d61_90";
  return "d90_plus";
}

/** A short Thai phrase for the due axis, e.g. "เกินกำหนด 12 วัน". */
export function dueStateLabel(status: ReceivableStatus): string {
  switch (status.dueState) {
    case "no_due_date":
      return "ยังไม่กำหนดวันครบกำหนด";
    case "overdue":
      return `เกินกำหนด ${status.daysOverdue} วัน`;
    case "due_today":
      return "ครบกำหนดวันนี้";
    default:
      return `อีก ${Math.abs(status.daysOverdue ?? 0)} วัน`;
  }
}

// ── The ledger ───────────────────────────────────────────────────────────────

/** One row as the ledger reads it — the denormalised columns, no `data` blob. */
export interface ReceivableRow {
  id: string;
  docNo: string;
  docType: string;
  docDate: string | null;
  dueDate: string | null;
  customerName: string;
  customerPhone: string;
  linkedQuotationId: string | null;
  totalAmount: number;
  paidAmount: number;
  receivableOverride: number | null;
  cancelledAt: string | null;
  supersededById: string | null;
  settlesDocId: string | null;
  createdAt: string;
}

export interface ReceivableEntry extends ReceivableRow {
  status: ReceivableStatus;
  bucket: AgeingBucketId;
  /** The docNo of the version that replaced this one — whether it was found by
   *  the `supersededById` column or, for rows that predate that column, by the
   *  base-docNo fallback. Also filled when that newer version was CANCELLED, so
   *  a revived row can name the version whose cancellation brought it back
   *  (`status.revivedFromCancelledSuccessor`). */
  supersededByDocNo: string | null;
}

export interface AgeingBucketTotal {
  id: AgeingBucketId;
  label: string;
  amount: number;
  count: number;
}

export interface CustomerReceivableGroup {
  customerName: string;
  customerPhone: string;
  outstanding: number;
  overdueOutstanding: number;
  count: number;
  entries: ReceivableEntry[];
}

export interface ReceivablesLedger {
  /** Every open receivable, most overdue first then largest outstanding. */
  entries: ReceivableEntry[];
  /** ยอดค้างทั้งหมด, EXCLUDING the ไม่ได้กำหนดวันครบกำหนด rows — those are shown
   *  apart so the headline is never inflated by documents nobody assigned a
   *  term to. `totalOutstandingWithUndated` includes them. */
  totalOutstanding: number;
  totalOutstandingWithUndated: number;
  overdueOutstanding: number;
  overdueCount: number;
  undatedOutstanding: number;
  undatedCount: number;
  buckets: AgeingBucketTotal[];
  customers: CustomerReceivableGroup[];
  /** ใบวางบิลที่ยังไม่มีใบแจ้งหนี้ — a nudge list, never an automatic inclusion. */
  unlinkedBillingNotes: ReceivableEntry[];
  /** Rows that are back in `entries` ONLY because the newer version that had
   *  replaced them was cancelled. They ARE counted in every total — the debt is
   *  real — and they are listed here as well so the screen can say so out loud
   *  instead of a cancelled correction quietly re-billing a customer.
   *
   *  Rendered as the "↩️ กลับมาเป็นลูกหนี้: เวอร์ชันใหม่ถูกยกเลิก" panel on
   *  /billing/receivables, alongside the ใบวางบิล and ยังไม่มียอด nudges, with
   *  a confirmed "ไม่นับเป็นลูกหนี้" for the admin who meant the cancellation
   *  to close the matter. It is deliberately NOT subject to the bucket or
   *  customer filters: the money it explains is in the headline regardless of
   *  them. */
  revivedSupersededDocs: ReceivableEntry[];
  /** Invoices with no lines/amount: usually an unfinished document, so they get
   *  a "ตรวจสอบ" nudge instead of silently vanishing. */
  zeroTotalInvoices: ReceivableEntry[];
}

/** Is this row an invoice that would satisfy an ใบวางบิล's debt? `supersededBy`
 *  is the LIVE replacement resolved below — a row whose newer version was
 *  cancelled is an eligible invoice again, exactly as it is a receivable again. */
function isEligibleInvoice(row: ReceivableRow, liveSuccessorId: string | null): boolean {
  return (
    row.docType === "invoice" &&
    !row.cancelledAt &&
    !liveSuccessorId &&
    row.receivableOverride !== 0 &&
    Number(row.totalAmount) > 0
  );
}

/**
 * Which row (if any) has REPLACED this one, and whether that row is still alive.
 *
 * Two ways a replacement is known, and both are needed: the `supersededById`
 * column the clone flow stamps going forward, and — for rows already in
 * production when that column arrived — the base-docNo fallback that
 * /billing/saved's "(เวอร์ชันเก่า)" badge also performs.
 */
interface Supersession {
  /** The replacement, live or cancelled. Null when nothing replaced this row. */
  successorId: string | null;
  successorDocNo: string | null;
  /** True when that replacement is itself ยกเลิกแล้ว — so it replaces nothing. */
  successorCancelled: boolean;
}

const NO_SUPERSESSION: Supersession = {
  successorId: null,
  successorDocNo: null,
  successorCancelled: false,
};

/**
 * Turn the raw rows into everything the ledger screen needs, in ONE pass.
 *
 * `supersededById` is stamped by the clone flow going forward, but rows already
 * in production predate the column — so the base-docNo fallback that
 * /billing/saved already performs for its "(เวอร์ชันเก่า)" badge is applied
 * here too. Without it every corrected invoice is billed twice and the owner's
 * total ยอดค้าง is simply wrong.
 */
export function buildReceivablesLedger(
  rows: ReceivableRow[],
  today: string
): ReceivablesLedger {
  const byId = new Map(rows.map((row) => [String(row.id), row] as const));

  // Highest version per base docNo, so an older version can be recognised even
  // when nothing stamped it. TWO maps, because a CANCELLED newer version must
  // not be what hides the older one: `latestLive` is what supersedes, while
  // `latestAny` is only used to NAME the cancelled version that did not.
  type VersionRef = { id: string; docNo: string; version: number };
  const latestLiveByBase = new Map<string, VersionRef>();
  const latestAnyByBase = new Map<string, VersionRef>();
  for (const row of rows) {
    if (!row.docNo) continue;
    const base = baseDocNo(row.docNo);
    const ref: VersionRef = { id: String(row.id), docNo: row.docNo, version: docNoVersion(row.docNo) };
    const currentAny = latestAnyByBase.get(base);
    if (!currentAny || ref.version > currentAny.version) latestAnyByBase.set(base, ref);
    if (row.cancelledAt) continue;
    const currentLive = latestLiveByBase.get(base);
    if (!currentLive || ref.version > currentLive.version) latestLiveByBase.set(base, ref);
  }

  function supersessionOf(row: ReceivableRow): Supersession {
    // A row that names ITSELF supersedes nothing — the save path refuses to
    // write that, and a row from before it did must not vanish over it.
    const stamped =
      row.supersededById && String(row.supersededById) !== String(row.id)
        ? String(row.supersededById)
        : null;
    const successor = stamped ? byId.get(stamped) : undefined;
    if (stamped && !successor) {
      // The stamp names a row this page of results cannot see (LIMIT 2000), so
      // its state cannot be judged. Assume it is alive: over-stating that a row
      // is superseded is visible on the newer version, while wrongly reviving a
      // debt that IS covered elsewhere would double-bill the customer.
      return { successorId: stamped, successorDocNo: null, successorCancelled: false };
    }
    if (successor && !successor.cancelledAt) {
      return {
        successorId: String(successor.id),
        successorDocNo: successor.docNo || null,
        successorCancelled: false,
      };
    }

    const version = docNoVersion(row.docNo);
    const base = row.docNo ? baseDocNo(row.docNo) : null;
    const live = base ? latestLiveByBase.get(base) : undefined;
    if (live && live.id !== String(row.id) && live.version > version) {
      return { successorId: live.id, successorDocNo: live.docNo, successorCancelled: false };
    }

    // Nothing alive replaced this row. Name whatever did, so the ledger can
    // explain why the debt is back.
    if (successor) {
      return {
        successorId: String(successor.id),
        successorDocNo: successor.docNo || null,
        successorCancelled: true,
      };
    }
    const any = base ? latestAnyByBase.get(base) : undefined;
    if (any && any.id !== String(row.id) && any.version > version) {
      return { successorId: any.id, successorDocNo: any.docNo, successorCancelled: true };
    }
    return NO_SUPERSESSION;
  }

  const supersessions = new Map<string, Supersession>(
    rows.map((row) => [String(row.id), supersessionOf(row)] as const)
  );
  const liveSuccessorOf = (row: ReceivableRow): string | null => {
    const sup = supersessions.get(String(row.id)) ?? NO_SUPERSESSION;
    return sup.successorCancelled ? null : sup.successorId;
  };

  const entries: ReceivableEntry[] = [];
  const zeroTotalInvoices: ReceivableEntry[] = [];
  const unlinkedBillingNotes: ReceivableEntry[] = [];
  const revivedSupersededDocs: ReceivableEntry[] = [];

  // Which quotations already have an invoice that carries their debt — the test
  // the ใบวางบิล nudge list uses, so the override is never offered for a BN
  // whose invoice already exists.
  const invoicedQuotationIds = new Set<string>();
  for (const row of rows) {
    if (isEligibleInvoice(row, liveSuccessorOf(row)) && row.linkedQuotationId) {
      invoicedQuotationIds.add(String(row.linkedQuotationId));
    }
  }

  for (const row of rows) {
    const sup = supersessions.get(String(row.id)) ?? NO_SUPERSESSION;

    const effective: ReceivableRow = {
      ...row,
      totalAmount: Number(row.totalAmount) || 0,
      paidAmount: Number(row.paidAmount) || 0,
      supersededById: sup.successorId,
    };

    const status = resolveReceivableStatus(
      { ...effective, supersededByCancelled: sup.successorCancelled },
      today
    );
    const entry: ReceivableEntry = {
      ...effective,
      status,
      bucket: receivableAgeingBucket(status),
      supersededByDocNo: sup.successorDocNo,
    };

    if (status.isOpen) {
      entries.push(entry);
      if (status.revivedFromCancelledSuccessor) revivedSupersededDocs.push(entry);
      continue;
    }

    // An invoice with no amount is usually an unfinished one, not a settled
    // one — surface it rather than dropping it.
    if (
      status.terminal === "zero_total" &&
      effective.docType === "invoice" &&
      !effective.cancelledAt
    ) {
      zeroTotalInvoices.push(entry);
    }

    // An ใบวางบิล the admin has not yet ruled on, whose debt no invoice carries.
    if (
      effective.docType === "billing_note" &&
      effective.receivableOverride == null &&
      !effective.cancelledAt &&
      !liveSuccessorOf(effective) &&
      effective.totalAmount > 0 &&
      (!effective.linkedQuotationId ||
        !invoicedQuotationIds.has(String(effective.linkedQuotationId)))
    ) {
      unlinkedBillingNotes.push(entry);
    }
  }

  // Most overdue first, then largest outstanding — the order a person chasing
  // money works in.
  entries.sort((a, b) => {
    const aDays = a.status.daysOverdue ?? -Infinity;
    const bDays = b.status.daysOverdue ?? -Infinity;
    if (aDays !== bDays) return bDays - aDays;
    return b.status.outstanding - a.status.outstanding;
  });

  const buckets: AgeingBucketTotal[] = AGEING_BUCKETS.map((b) => ({
    ...b,
    amount: 0,
    count: 0,
  }));
  const bucketIndex = new Map(buckets.map((b, i) => [b.id, i] as const));

  let totalOutstanding = 0;
  let overdueOutstanding = 0;
  let overdueCount = 0;
  let undatedOutstanding = 0;
  let undatedCount = 0;

  const customerMap = new Map<string, CustomerReceivableGroup>();

  for (const entry of entries) {
    const amount = entry.status.outstanding;
    const slot = buckets[bucketIndex.get(entry.bucket)!];
    slot.amount += amount;
    slot.count += 1;

    if (entry.bucket === "no_due_date") {
      undatedOutstanding += amount;
      undatedCount += 1;
    } else {
      totalOutstanding += amount;
      if (entry.status.dueState === "overdue") {
        overdueOutstanding += amount;
        overdueCount += 1;
      }
    }

    // Chasing is done per customer, not per document: one phone call settles
    // four invoices.
    const key = entry.customerName || entry.docNo || entry.id;
    const group = customerMap.get(key) ?? {
      customerName: entry.customerName || entry.docNo || "-",
      customerPhone: entry.customerPhone,
      outstanding: 0,
      overdueOutstanding: 0,
      count: 0,
      entries: [],
    };
    group.outstanding += amount;
    if (entry.status.dueState === "overdue") group.overdueOutstanding += amount;
    group.count += 1;
    if (!group.customerPhone && entry.customerPhone) group.customerPhone = entry.customerPhone;
    group.entries.push(entry);
    customerMap.set(key, group);
  }

  const customers = [...customerMap.values()].sort(
    (a, b) => b.overdueOutstanding - a.overdueOutstanding || b.outstanding - a.outstanding
  );

  return {
    entries,
    totalOutstanding,
    totalOutstandingWithUndated: totalOutstanding + undatedOutstanding,
    overdueOutstanding,
    overdueCount,
    undatedOutstanding,
    undatedCount,
    buckets,
    customers,
    unlinkedBillingNotes,
    revivedSupersededDocs,
    zeroTotalInvoices,
  };
}

/**
 * The date-search rules, as PURE functions — no DB, no React, no clock.
 *
 * Spec: openspec/changes/add-alert-date-search (proposal D1-D10).
 *
 * The one thing this file exists for: `evaluateMovability()` is the SINGLE
 * place that decides whether a found row may have its date rescheduled, and it
 * returns both the verdict AND the Thai reason when the answer is no. The
 * results table greys a checkbox with it and
 * `POST /api/admin/alerts/reschedule` refuses with it, so the two can never
 * drift apart. A disabled checkbox enforced only in the browser is decoration;
 * this function is the actual control, and the route calls it against the
 * status it read from the database itself, never against what the client
 * claimed.
 *
 * IMPORTS: only `./dateFormat`, which is itself import-free. That keeps this
 * module safe for a client component (the in-page guide, the results table) to
 * import without dragging mysql2 into the browser bundle — the same reason
 * `alertThresholds.ts` has no imports at all.
 *
 * NOTE ON FILE LAYOUT: the proposal put the four new caps in
 * `app/lib/alertThresholds.ts`, the result types in `app/lib/types.ts` and the
 * transaction in `app/lib/alertReschedule.ts`. This workflow phase owns
 * neither of those first two files, so the caps and the types live here (still
 * import-free at the leaves, so the guide panel can read the same numbers the
 * queries run on) and the transaction lives in `alertSearchStore.ts`.
 */

import {
  addDaysToDateString,
  daysBetweenDateStrings,
  isValidDateString,
} from "./dateFormat";

// ── Caps ─────────────────────────────────────────────────────────────────────
//
// Every number below is paired with the reason for the number, not just a
// name: a cap whose rationale is not written down is a cap nobody dares change
// and nobody can defend.

/** Rows returned per category by one date search. The list is capped, the
 *  `*Total` beside it is not — exactly the `incompleteEquipmentsTotal`
 *  distinction the feed already draws, so "และอีก N รายการ" can be shown
 *  instead of a backlog silently disappearing. 200 is the same number as the
 *  per-request reschedule cap on purpose: a category you can see in full is a
 *  category you can act on in full. */
export const DATE_SEARCH_ROW_CAP = 200;

/** Widest date range one search may span, in days. A year is the longest span
 *  that still means something operationally here — warranty and calibration
 *  cycles are annual — and anything wider is a report, not a search. 366
 *  rather than 365 so "the whole of a leap year" is not off by one. */
export const DATE_SEARCH_MAX_RANGE_DAYS = 366;

/** Items one bulk-reschedule request may carry. One narrow UPDATE per row
 *  inside a single transaction: 200 short statements sit comfortably inside a
 *  request's time budget and keep the lock window short. Bigger than that is a
 *  data migration, not an afternoon's rescheduling. Exceeding it REFUSES the
 *  whole request — never truncates (see the spec's cap requirement). */
export const BULK_RESCHEDULE_MAX_ITEMS = 200;

/** Largest |N| for a ±N day shift, ≈10 years. Two jobs: it catches a typo
 *  (nobody moves an appointment 4,000 days), and it keeps every result inside
 *  a 4-digit year. A 5-digit year would break the `YYYY-MM-DD` shape that
 *  LEXICAL comparison on these VARCHAR date columns depends on, poisoning
 *  every range query that reads them, forever. */
export const BULK_RESCHEDULE_MAX_SHIFT_DAYS = 3650;

// ── Kinds and codes ──────────────────────────────────────────────────────────

/** The six sources a date search draws from. Each is matched on the date that
 *  MEANS something for that source, never the first date column in its table —
 *  see `matchedDate` below. */
export const DATED_ALERT_KINDS = [
  "schedule",
  "customer_call",
  "task",
  "warranty",
  "calibration",
  "receivable",
] as const;
export type DatedAlertKind = (typeof DATED_ALERT_KINDS)[number];

/** The three kinds whose date is a REMINDER the owner set, and may therefore
 *  be moved. The other three are facts about a machine or a contract. */
export const MOVABLE_ALERT_KINDS = ["schedule", "customer_call", "task"] as const;

export const RESCHEDULE_REFUSAL_CODES = [
  /** Warranty / calibration / receivable — or a kind this system does not
   *  know. Their date is a fact, not a reminder. */
  "immovable_fact",
  /** Schedule completed/cancelled, or task done. */
  "closed",
  /** A task with no due date: there is no date to move. */
  "no_date",
  /** No such row (deleted since the search, or a fabricated id). */
  "not_found",
  /** `expectedDate` disagrees with what is stored — the screen is stale. */
  "stale",
  /** The computed date did not survive `isValidDateString`. */
  "invalid_result",
] as const;
export type RescheduleRefusalCode = (typeof RESCHEDULE_REFUSAL_CODES)[number];

export const RESCHEDULE_ITEM_STATUSES = ["moved", "unchanged", "refused"] as const;
export type RescheduleItemStatus = (typeof RESCHEDULE_ITEM_STATUSES)[number];

export const RESCHEDULE_MODES = ["set", "shift"] as const;
export type RescheduleMode = (typeof RESCHEDULE_MODES)[number];

// ── Result shapes ────────────────────────────────────────────────────────────

/** One row of a date search, whatever source it came from. */
export interface DatedAlertRow {
  kind: DatedAlertKind;
  id: string;
  /**
   * The date this row was MATCHED on — the date that means "something happens
   * on this day" for its category, not the first date column in its table:
   *
   *   schedule / customer_call → `service_schedules.scheduledDate`
   *   task                     → `crm_tasks.dueDate`
   *   warranty                 → `customer_equipments.warrantyEndDate`
   *   calibration              → the DUE date, `calibrationDate + 12 months`
   *                              — NOT the raw `calibrationDate`, which is the
   *                              day the last calibration was DONE, and not
   *                              the 12−2 month alert-start date, which is an
   *                              artifact of a lead constant rather than an
   *                              event in anyone's calendar
   *   receivable               → `billing_documents.dueDate`
   *
   * Always `YYYY-MM-DD`, zero-padded: these columns are compared and sorted
   * LEXICALLY in SQL.
   */
  matchedDate: string;
  title: string;
  subtitle: string;
  customerName: string;
  companyName: string;
  /** The source row's own status verbatim (`pending`, `completed`,
   *  `cancelled`, `done`, `Active`, `Expired`, `paid`, …). It is a BADGE and a
   *  tick-gate, never a filter — a past-date search is a review, and hiding
   *  what got done makes last Tuesday read as a week of failure. */
  status: string;
  overdue: boolean;
  /** ISO instant an alert-feed snooze runs until, or null. Present so the row
   *  can be badged "เลื่อนแจ้งเตือนถึง …". Snoozed rows are returned and stay
   *  tickable: snooze means "don't nag", not "doesn't exist". */
  snoozedUntil: string | null;
  movable: boolean;
  /** Thai, and null exactly when `movable` is true. */
  immovableReason: string | null;
  /** Refusal code matching `immovableReason`, null when movable. */
  immovableCode: RescheduleRefusalCode | null;
  // Category extras, all optional.
  serialNumber?: string;
  productName?: string;
  docNo?: string;
  outstanding?: number;
  topicName?: string;
  topicIcon?: string;
  topicColor?: string;
  scheduleType?: string;
  equipmentId?: string | null;
  customerId?: string | null;
  /** Warranty rows only: false when this machine's warranty alert is switched
   *  off, which is why it never reaches the feed. */
  warrantyAlertEnabled?: boolean;
  /** Calibration rows only: the day the last calibration was performed, kept
   *  beside `matchedDate` so the row can say where the due date came from. */
  calibrationDate?: string | null;
}

/** One category's slice of a search: the capped list plus the true count. */
export interface DatedAlertBucket {
  rows: DatedAlertRow[];
  total: number;
}

export interface AlertDateSearchResult {
  from: string;
  to: string;
  schedules: DatedAlertBucket;
  customerCalls: DatedAlertBucket;
  tasks: DatedAlertBucket;
  warranties: DatedAlertBucket;
  calibrations: DatedAlertBucket;
  receivables: DatedAlertBucket;
}

export interface RescheduleItemInput {
  kind: string;
  id: string;
  /** The date the SCREEN saw when it ran the search. The guard that makes a
   *  replay refuse instead of shifting twice — see `alertSearchStore.ts`. */
  expectedDate: string;
}

export interface RescheduleItemResult {
  kind: string;
  id: string;
  status: RescheduleItemStatus;
  /** The date found in the database, or null when the row was not found. */
  fromDate: string | null;
  /** The date written (or that would have been), or null when refused. */
  toDate: string | null;
  code: RescheduleRefusalCode | null;
  /** Thai. Empty string for `moved`; explains itself for everything else. */
  reason: string;
}

export interface RescheduleReport {
  movedCount: number;
  unchangedCount: number;
  refusedCount: number;
  /** One entry per submitted item, in the order they were submitted. Never
   *  short, never reordered — a report you have to align by hand is not a
   *  report. */
  results: RescheduleItemResult[];
}

// ── Movability: the one rule ─────────────────────────────────────────────────

/** What `evaluateMovability` needs. Deliberately structural, so both a
 *  `DatedAlertRow` from a search and a bare `{ kind, status, matchedDate }`
 *  read inside the reschedule transaction can be passed to it. */
export interface MovabilityInput {
  kind: string;
  status?: string | null;
  /** The matched date as stored. Null/empty means "no date at all", which is
   *  a real state for a task and nothing else. */
  matchedDate?: string | null;
}

export type Movability =
  | { movable: true; code: null; reason: null }
  | { movable: false; code: RescheduleRefusalCode; reason: string };

const MOVABLE: Movability = { movable: true, code: null, reason: null };

function no(code: RescheduleRefusalCode, reason: string): Movability {
  return { movable: false, code, reason };
}

/**
 * Thai reasons. Two families, and every one of them names a way OUT — "ไม่
 * สามารถแก้ไขได้" on its own tells an admin nothing except that the software
 * is in his way.
 *
 * None of these strings names a database column. The person reading them
 * knows about warranties and appointments, not about `warrantyEndDate`.
 */
export const IMMOVABLE_REASONS = {
  warranty:
    "วันหมดประกันเป็นข้อเท็จจริงของเครื่อง ไม่ใช่การแจ้งเตือนที่เลื่อนได้ " +
    "การย้ายวันที่นี่คือการปลอมวันหมดประกัน ถ้าวันหมดประกันไม่ถูกต้อง " +
    "ให้ไปแก้ที่ข้อมูลเครื่องของลูกค้ารายนี้",
  calibration:
    "วันครบกำหนดสอบเทียบคำนวณจากวันที่สอบเทียบครั้งล่าสุด " +
    "การเลื่อนที่นี่คือการปิดเสียงเตือนที่ควรดัง ถ้าเพิ่งสอบเทียบไปแล้ว " +
    "ให้บันทึกวันสอบเทียบครั้งใหม่ที่ข้อมูลเครื่อง แล้ววันครบกำหนดจะขยับเอง",
  receivable:
    "วันครบกำหนดชำระคือเงื่อนไขเครดิตที่ตกลงกับลูกค้าไว้ " +
    "การเลื่อนคือการยืดเครดิตให้ลูกค้า ต้องทำที่หน้าลูกหนี้ (/billing/receivables) ไม่ใช่ที่นี่",
  completed:
    "นัดนี้ปิดงานไปแล้ว วันที่ของมันคือหลักฐานว่าเข้าไปเมื่อไหร่ " +
    "ซึ่งประวัติการเข้าบริการอ้างอิงอยู่ ถ้าต้องเข้าไปอีกครั้ง ให้สร้างนัดใหม่",
  cancelled:
    "นัดนี้ถูกยกเลิกไปแล้ว การเลื่อนวันไม่ทำให้มันกลับมา ถ้ายังต้องเข้าไปหาลูกค้า " +
    "ให้สร้างนัดใหม่แทนการเลื่อนใบนี้",
  done:
    'งานนี้ทำเสร็จแล้ว ถ้ายังต้องทำอีก ให้กด "เปิดใหม่" ให้กลับมาเป็นงานค้างก่อน ' +
    "แล้วจึงเลื่อนวันได้",
  noDate:
    "งานนี้ยังไม่ได้กำหนดวันครบกำหนด จึงไม่มีวันให้เลื่อน " +
    "ให้เปิดงานนี้แล้วกำหนดวันครบกำหนดก่อน",
  unknown:
    "ระบบไม่รู้จักประเภทของรายการนี้ จึงไม่ยอมให้เลื่อนวัน " +
    "กรุณาค้นหาใหม่อีกครั้งแล้วเลือกจากผลลัพธ์ล่าสุด",
} as const;

/**
 * THE rule. Both the screen and the API ask this question, of the same
 * function, and get the same answer with the same wording.
 *
 * Order matters: kind first, because warranty/calibration/receivable are
 * immovable no matter what status they carry — their date is a fact, and a
 * "pending" fact is still a fact.
 */
export function evaluateMovability(row: MovabilityInput): Movability {
  const kind = String(row.kind ?? "");

  if (kind === "warranty") return no("immovable_fact", IMMOVABLE_REASONS.warranty);
  if (kind === "calibration") return no("immovable_fact", IMMOVABLE_REASONS.calibration);
  if (kind === "receivable") return no("immovable_fact", IMMOVABLE_REASONS.receivable);

  const status = String(row.status ?? "").trim();

  if (kind === "schedule" || kind === "customer_call") {
    if (status === "completed") return no("closed", IMMOVABLE_REASONS.completed);
    if (status === "cancelled") return no("closed", IMMOVABLE_REASONS.cancelled);
    // Anything that is not one of the two closed states is treated as open.
    // A stray status must not become a silent green light, so require pending
    // explicitly.
    if (status !== "pending") return no("closed", IMMOVABLE_REASONS.completed);
    return MOVABLE;
  }

  if (kind === "task") {
    if (status === "done") return no("closed", IMMOVABLE_REASONS.done);
    if (status !== "pending") return no("closed", IMMOVABLE_REASONS.done);
    const due = String(row.matchedDate ?? "").trim();
    // A task with no due date is a perfectly valid post-it; it just has no
    // date to move, which is a different refusal from "closed".
    if (!due) return no("no_date", IMMOVABLE_REASONS.noDate);
    return MOVABLE;
  }

  // An unknown kind is refused as an immovable fact rather than crashing the
  // batch: one fabricated value in a hand-built request must not 500 the
  // request or take the valid items down with it.
  return no("immovable_fact", IMMOVABLE_REASONS.unknown);
}

/** Verdict only. Thin wrapper so a caller that just needs the boolean does not
 *  reimplement the rule "quickly" somewhere else. */
export function isRowMovable(row: MovabilityInput): boolean {
  return evaluateMovability(row).movable;
}

/** The Thai reason, or null when the row IS movable. */
export function immovableReasonFor(row: MovabilityInput): string | null {
  return evaluateMovability(row).reason;
}

// ── Selection ────────────────────────────────────────────────────────────────

/** Rows the "เลือกทั้งหมด" button is allowed to tick, within the category
 *  filter currently applied to the results. Ticking rows that will be refused
 *  later teaches an admin to stop reading warnings. */
export function selectableRows(
  rows: DatedAlertRow[],
  filterKind?: DatedAlertKind | "all" | null
): DatedAlertRow[] {
  const scoped =
    !filterKind || filterKind === "all"
      ? rows
      : rows.filter((r) => r.kind === filterKind);
  return scoped.filter((r) => isRowMovable(r));
}

export interface SelectAllPlan {
  /** Ids to tick, in display order. */
  ids: string[];
  /** How many will be ticked. */
  selectedCount: number;
  /** How many COULD have been ticked in this scope. */
  eligibleCount: number;
  /** How many were left out because of the per-request cap. */
  cappedOut: number;
  /** Total rows in scope, movable or not — the "y" of "x จาก y รายการ". */
  scopeCount: number;
}

/**
 * What "เลือกทั้งหมด" will do, computed before it does it, so the button can
 * say so out loud: how many it ticks, what the cap is, how many are left.
 * `cappedOut > 0` is a fact to announce, never a silent trim.
 */
export function selectAllPlan(
  rows: DatedAlertRow[],
  filterKind?: DatedAlertKind | "all" | null,
  cap: number = BULK_RESCHEDULE_MAX_ITEMS
): SelectAllPlan {
  const scopeCount =
    !filterKind || filterKind === "all"
      ? rows.length
      : rows.filter((r) => r.kind === filterKind).length;
  const eligible = selectableRows(rows, filterKind);
  const limit = Math.max(0, Math.floor(cap));
  const chosen = eligible.slice(0, limit);
  return {
    ids: chosen.map((r) => r.id),
    selectedCount: chosen.length,
    eligibleCount: eligible.length,
    cappedOut: eligible.length - chosen.length,
    scopeCount,
  };
}

// ── Date arithmetic ──────────────────────────────────────────────────────────

export interface TargetDateOptions {
  /** mode "set" — the one date every ticked row lands on. */
  targetDate?: string | null;
  /** mode "shift" — ±N days, spacing preserved. */
  shiftDays?: number | null;
}

/**
 * The new date for one row, or null when the answer would not be a valid
 * `YYYY-MM-DD` (the caller turns null into `invalid_result` and writes
 * nothing).
 *
 * EVERY date calculation in this feature goes through `addDaysToDateString`.
 * No `new Date()` / `setDate()` / `toISOString()` touches these strings
 * anywhere: the app runs on Vercel in UTC while the business lives in Bangkok,
 * and that gap has already produced dated bugs in this project. The result
 * being fully zero-padded is load-bearing, not cosmetic — these columns are
 * VARCHAR compared LEXICALLY, so a single "2026-9-4" would sort before
 * "2026-10-05" and quietly break every range query that reads the column.
 */
export function computeTargetDate(
  mode: RescheduleMode,
  row: { matchedDate?: string | null },
  options: TargetDateOptions
): string | null {
  if (mode === "set") {
    const target = String(options.targetDate ?? "").trim();
    return isValidDateString(target) ? target : null;
  }

  if (mode === "shift") {
    const current = String(row.matchedDate ?? "").trim();
    if (!isValidDateString(current)) return null;
    const days = Number(options.shiftDays);
    if (!Number.isInteger(days) || days === 0) return null;
    if (Math.abs(days) > BULK_RESCHEDULE_MAX_SHIFT_DAYS) return null;
    const shifted = addDaysToDateString(current, days);
    // addDaysToDateString returns its input unchanged when it cannot parse it,
    // so the result is re-checked rather than trusted.
    return isValidDateString(shifted) ? shifted : null;
  }

  return null;
}

export interface ShiftSummary {
  /** How many of the given rows produced a usable target date. */
  count: number;
  /** Earliest / latest resulting date, for "ผลลัพธ์อยู่ระหว่าง … ถึง …". */
  earliest: string | null;
  latest: string | null;
  /** How many land BEFORE today. Shifting into the past is allowed on purpose
   *  (an admin catching up on a backlog has every reason to pull work
   *  forward), so this number exists to be said out loud in the confirm
   *  dialog, not to block the move. */
  beforeTodayCount: number;
  /** Rows whose target date could not be computed at all. */
  invalidCount: number;
}

/**
 * What a ±N day shift will actually produce, for the confirm dialog. `today`
 * is a PARAMETER — this function never reads a clock, so it is testable and so
 * the caller is forced to hand it `bangkokDateString(new Date())` rather than
 * the server's UTC day.
 */
export function summariseShift(
  rows: Array<{ matchedDate?: string | null }>,
  shiftDays: number,
  today: string
): ShiftSummary {
  let earliest: string | null = null;
  let latest: string | null = null;
  let beforeTodayCount = 0;
  let invalidCount = 0;
  let count = 0;

  for (const row of rows) {
    const target = computeTargetDate("shift", row, { shiftDays });
    if (!target) {
      invalidCount++;
      continue;
    }
    count++;
    // Lexical comparison is exact here: both sides are zero-padded YYYY-MM-DD.
    if (earliest === null || target < earliest) earliest = target;
    if (latest === null || target > latest) latest = target;
    if (isValidDateString(today) && target < today) beforeTodayCount++;
  }

  return { count, earliest, latest, beforeTodayCount, invalidCount };
}

// ── Search-range validation ──────────────────────────────────────────────────

/**
 * The Thai error for a bad search range, or null when it is fine. The route
 * and the search panel both call THIS, so there is no way for the screen to
 * state one rule and the server to enforce another.
 *
 * An inverted range is refused rather than silently swapped: swapping hides
 * the typo, and the admin then trusts a result for a range he never asked for.
 */
export function validateSearchRange(from: string, to: string): string | null {
  const a = String(from ?? "").trim();
  const b = String(to ?? "").trim();

  if (!a || !b) return "กรุณาเลือกวันที่ที่ต้องการค้นหา";
  if (!isValidDateString(a) || !isValidDateString(b)) {
    return "รูปแบบวันที่ไม่ถูกต้อง ต้องเป็น ปปปป-ดด-วว เช่น 2026-06-12";
  }
  if (a > b) {
    return 'ช่วงวันที่กลับหัว — วันที่ "จาก" ต้องไม่หลังวันที่ "ถึง"';
  }

  // Inclusive width: a single-day search (from === to) is 1 day, not 0.
  const span = (daysBetweenDateStrings(a, b) ?? 0) + 1;
  if (span > DATE_SEARCH_MAX_RANGE_DAYS) {
    return `ช่วงวันที่กว้างเกินไป — ค้นหาได้ครั้งละไม่เกิน ${DATE_SEARCH_MAX_RANGE_DAYS} วัน แต่ช่วงที่เลือกกว้าง ${span} วัน`;
  }

  return null;
}

/**
 * The Thai error for a bad shift size, or null. `|N| ≤ 3650` and `N ≠ 0`:
 * a shift of zero is not a move, it is a request that means nothing, and the
 * screen should say so rather than let the server report 12 rows "unchanged".
 */
export function validateShiftDays(shiftDays: unknown): string | null {
  const days = Number(shiftDays);
  if (!Number.isInteger(days)) return "จำนวนวันที่จะเลื่อนต้องเป็นจำนวนเต็ม";
  if (days === 0) return "จำนวนวันที่จะเลื่อนต้องไม่เป็น 0 (0 วันคือไม่ได้เลื่อนอะไรเลย)";
  if (Math.abs(days) > BULK_RESCHEDULE_MAX_SHIFT_DAYS) {
    return `เลื่อนได้ครั้งละไม่เกิน ${BULK_RESCHEDULE_MAX_SHIFT_DAYS} วัน แต่ที่ส่งมาคือ ${days} วัน`;
  }
  return null;
}

/** The Thai error for a batch that is too large, or null. A refusal, never a
 *  trim: an admin who reads "สำเร็จ" and walks away believing all 240
 *  appointments moved finds out the truth by missing one. */
export function validateItemCount(count: number): string | null {
  if (!Number.isInteger(count) || count < 1) {
    return "กรุณาเลือกอย่างน้อย 1 รายการที่ต้องการเลื่อนวัน";
  }
  if (count > BULK_RESCHEDULE_MAX_ITEMS) {
    return `เลื่อนวันได้ครั้งละไม่เกิน ${BULK_RESCHEDULE_MAX_ITEMS} รายการ แต่ส่งมา ${count} รายการ กรุณาแบ่งเป็นหลายครั้ง (ระบบไม่ตัดส่วนเกินทิ้งให้ เพราะการทำแค่บางส่วนแล้วบอกว่าสำเร็จ อันตรายกว่าการปฏิเสธ)`;
  }
  return null;
}

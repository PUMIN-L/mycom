import "server-only";
import { query, withTransaction } from "./db";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { sanitizePlainText } from "./sanitizeHtml";
import { bangkokDateString } from "./dateFormat";
import { sqlNotSupersededByLiveRow } from "./receivables";
import { CALIBRATION_VALIDITY_MONTHS } from "./types";
import {
  DATE_SEARCH_ROW_CAP,
  evaluateMovability,
  computeTargetDate,
} from "./alertDateSearch";
import type {
  AlertDateSearchResult,
  DatedAlertBucket,
  DatedAlertRow,
  RescheduleItemInput,
  RescheduleItemResult,
  RescheduleMode,
  RescheduleReport,
} from "./alertDateSearch";

/**
 * The date-search read path and the bulk-reschedule write path.
 *
 * Spec: openspec/changes/add-alert-date-search.
 *
 * WHY THIS IS A SEPARATE MODULE, not more functions inside `crmStore.ts`:
 * the search deliberately ignores every window the feed is built on. The feed
 * clamps schedules to today+7, warranties to today+30, receivables to
 * today+7 and calibration to the 12−2 month alert-start — all of which exist
 * to keep the DEFAULT feed short, and none of which defines what exists. A
 * search for "12 มิ.ย." must answer with what is on that day, past or future.
 * Sharing a query with `getAlerts()` would mean editing `getAlerts()`, and the
 * one thing this change must not do is move the feed.
 *
 * THE WRITE PATH CAN TOUCH EXACTLY TWO COLUMNS: `service_schedules
 * .scheduledDate` and `crm_tasks.dueDate`. There is NO statement anywhere in
 * this file that writes `customer_equipments` or `billing_documents` — that
 * absence is the real control. The greyed-out checkbox in the browser is only
 * an advance warning, and `__tests__/api/alertSearch.test.ts` asserts the
 * absence from the SQL actually issued, not from this comment.
 */

// The search never joins `alert_snoozes` to FILTER. It joins to READ
// `snoozeUntil`, so a snoozed row can be badged "เลื่อนแจ้งเตือนถึง …" and
// still be ticked: snooze means "don't nag me until then", not "this doesn't
// exist". Hiding a snoozed appointment would make the screen answer "nothing
// on that day" for a day the owner has an appointment on — a wrong answer.

const SCHEDULE_SEARCH_SELECT = `
  SELECT s.id, s.equipmentId, s.customerId, s.scheduleType, s.scheduledDate,
         s.status, s.notes,
         e.serialNumber,
         COALESCE(c.name, c2.name) AS customerName,
         COALESCE(co.name, co2.name) AS companyName,
         COALESCE(NULLIF(e.productName, ''), p.title_th) AS productName,
         sno.snoozeUntil AS snoozeUntil
  FROM service_schedules s
  LEFT JOIN customer_equipments e ON s.equipmentId = e.id
  LEFT JOIN customers c ON e.customerId = c.id
  LEFT JOIN companies co ON c.companyId = co.id
  LEFT JOIN products p ON e.productId = p.id
  LEFT JOIN customers c2 ON s.customerId = c2.id
  LEFT JOIN companies co2 ON c2.companyId = co2.id
  LEFT JOIN alert_snoozes sno ON sno.alertType = 'schedule' AND sno.referenceId = s.id`;

const EQUIPMENT_SEARCH_SELECT = `
  SELECT e.id, e.customerId, e.serialNumber, e.warrantyEndDate, e.calibrationDate,
         e.status,
         COALESCE(e.warrantyAlertEnabled, 1) AS warrantyAlertEnabled,
         COALESCE(NULLIF(e.productName, ''), p.title_th) AS productName,
         c.name AS customerName, co.name AS companyName`;

const EQUIPMENT_SEARCH_FROM = `
  FROM customer_equipments e
  LEFT JOIN customers c ON e.customerId = c.id
  LEFT JOIN companies co ON c.companyId = co.id
  LEFT JOIN products p ON e.productId = p.id`;

// The debtCarrier rule from receivables.ts, in SQL, identical to the feed's:
// an invoice by default, plus anything explicitly overridden IN, minus
// anything overridden OUT. Cancelled and superseded documents are excluded
// because the due date of a document that has been withdrawn no longer means
// anything. There is deliberately NO outstanding-balance clause: a document
// that has been paid in full still genuinely fell due on that day, and the
// point of searching a past date is to review what was supposed to happen.
//
// "ถูกแทนที่" comes from `sqlNotSupersededByLiveRow`, the same call `getAlerts`,
// `listOpenInvoices` and `listUndatedReceivables` make. Searching a past date is
// how the owner reconstructs what that day looked like, so it has to show the
// same debts the day's ledger did — and every time this clause was written out
// by hand instead, it stopped doing that: a cancelled correction made the
// original vanish from the day it fell due, and a pre-v37 correction left both
// versions in the results.
const RECEIVABLE_SEARCH_WHERE = `
  WHERE b.dueDate IS NOT NULL
    AND b.dueDate BETWEEN ? AND ?
    AND b.cancelledAt IS NULL
    AND ${sqlNotSupersededByLiveRow("b")}
    AND (b.receivableOverride = 1
         OR (b.receivableOverride IS NULL AND b.docType = 'invoice'))`;

/** Fallback heading for a task whose topic row is gone — the same string
 *  `taskStore.UNASSIGNED_TOPIC_NAME` uses. Duplicated as a literal rather than
 *  imported so this module does not pull the whole task store in; a task with
 *  a dangling topic must still appear in the search, never throw and never be
 *  filtered away. */
const UNASSIGNED_TOPIC_NAME = "ไม่ระบุหัวข้อ";
const UNASSIGNED_TOPIC_ICON = "📌";
const UNASSIGNED_TOPIC_COLOR = "slate";

function str(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

/** Attach the movability verdict + Thai reason from the ONE pure rule, on the
 *  server, so the table and the API can never disagree about a row. */
function withMovability(
  row: Omit<DatedAlertRow, "movable" | "immovableReason" | "immovableCode">
): DatedAlertRow {
  const verdict = evaluateMovability({
    kind: row.kind,
    status: row.status,
    matchedDate: row.matchedDate,
  });
  return {
    ...row,
    movable: verdict.movable,
    immovableReason: verdict.reason,
    immovableCode: verdict.code,
  };
}

function countOf(rows: RowDataPacket[]): number {
  return Number(rows[0]?.cnt) || 0;
}

// ── Search ───────────────────────────────────────────────────────────────────

/**
 * Everything dated that falls between `from` and `to` (inclusive), from all
 * six sources, with each source matched on the date that MEANS something for
 * it. Both ends must already be validated `YYYY-MM-DD` — the route checks with
 * `validateSearchRange` and refuses before any query is issued.
 *
 * "ข้อมูลไม่ครบ" and "เอกสารค้าง" are absent by design, not by oversight:
 * neither has a date of its own. One is a blank field (no serial, no warranty
 * start) with no date attached at all; the other is an AGE measured from
 * `saleDate` that alerts forever with no due date, and `saleDate` is the day
 * something was sold, not the day anything falls due. Matching on it would
 * answer a different question from the one asked.
 *
 * The range is exactly the range asked for. A one-day search is `from === to`
 * and returns that day — one code path, never widened.
 */
export async function searchDatedAlerts(
  from: string,
  to: string
): Promise<AlertDateSearchResult> {
  // Bangkok's calendar day, never Vercel's UTC one: between 00:00 and 06:59
  // Thai time a UTC "today" is still yesterday, which would mislabel a whole
  // day's rows as overdue (or not) for seven hours every single day.
  const today = bangkokDateString(new Date());

  const [
    scheduleRows,
    scheduleCount,
    callRows,
    callCount,
    warrantyRows,
    warrantyCount,
    calibrationRows,
    calibrationCount,
    receivableRows,
    receivableCount,
    taskRows,
    taskCount,
  ] = await Promise.all([
    // ── กำหนดการ (ผูกเครื่อง) ────────────────────────────────────────────────
    // No `scheduleDays` cutoff and no `status` clause. The window belongs to
    // the feed; status is a badge and a tick-gate, not a filter — a completed
    // appointment on the searched day is part of the answer to "what was
    // supposed to happen that day", and hiding it makes last week read as a
    // week where nothing got done.
    query<RowDataPacket[]>(
      `${SCHEDULE_SEARCH_SELECT}
       WHERE s.equipmentId IS NOT NULL
         AND s.scheduledDate BETWEEN ? AND ?
       ORDER BY s.scheduledDate ASC, s.id ASC
       LIMIT ${DATE_SEARCH_ROW_CAP}`,
      [from, to]
    ),
    query<RowDataPacket[]>(
      `SELECT COUNT(*) AS cnt FROM service_schedules s
       WHERE s.equipmentId IS NOT NULL
         AND s.scheduledDate BETWEEN ? AND ?`,
      [from, to]
    ),

    // ── นัดโทรลูกค้า ─────────────────────────────────────────────────────────
    query<RowDataPacket[]>(
      `${SCHEDULE_SEARCH_SELECT}
       WHERE s.equipmentId IS NULL AND s.customerId IS NOT NULL
         AND s.scheduledDate BETWEEN ? AND ?
       ORDER BY s.scheduledDate ASC, s.id ASC
       LIMIT ${DATE_SEARCH_ROW_CAP}`,
      [from, to]
    ),
    query<RowDataPacket[]>(
      `SELECT COUNT(*) AS cnt FROM service_schedules s
       WHERE s.equipmentId IS NULL AND s.customerId IS NOT NULL
         AND s.scheduledDate BETWEEN ? AND ?`,
      [from, to]
    ),

    // ── ประกันใกล้หมด ────────────────────────────────────────────────────────
    // Neither `status != 'Expired'` nor `warrantyAlertEnabled = 1` — both of
    // which the feed applies. "Whose warranty ends that day" has one answer
    // whether or not the reminder was switched off, so both values are SELECTed
    // instead, to badge the row with why it never reaches the feed.
    query<RowDataPacket[]>(
      `${EQUIPMENT_SEARCH_SELECT},
              sno.snoozeUntil AS snoozeUntil
       ${EQUIPMENT_SEARCH_FROM}
       LEFT JOIN alert_snoozes sno ON sno.alertType = 'warranty' AND sno.referenceId = e.id
       WHERE e.warrantyEndDate IS NOT NULL
         AND e.warrantyEndDate BETWEEN ? AND ?
       ORDER BY e.warrantyEndDate ASC, e.id ASC
       LIMIT ${DATE_SEARCH_ROW_CAP}`,
      [from, to]
    ),
    query<RowDataPacket[]>(
      `SELECT COUNT(*) AS cnt FROM customer_equipments e
       WHERE e.warrantyEndDate IS NOT NULL
         AND e.warrantyEndDate BETWEEN ? AND ?`,
      [from, to]
    ),

    // ── ใกล้ถึงกำหนดสอบเทียบ ─────────────────────────────────────────────────
    // Matched on the DUE date — `calibrationDate + CALIBRATION_VALIDITY_MONTHS`
    // (12) — and NOT on the 12−2 = 10 months the feed uses. The two ask
    // different questions: the feed asks "has the reminder started ringing
    // yet?", which is a lead-time artifact and not an event in anyone's
    // calendar; the search asks "what falls due on that day?", which is the
    // anniversary itself. Nor is it matched on the raw `calibrationDate`, which
    // is the day the LAST calibration was performed — searching 12 Jun 2026
    // must not return a machine calibrated that day, it must return machines
    // due that day.
    //
    // DATE_ADD in SQL and `addMonthsToDateString` on the display side are
    // documented to agree; the computed due date is returned already formatted
    // so nothing downstream recomputes it a third way.
    query<RowDataPacket[]>(
      `${EQUIPMENT_SEARCH_SELECT},
              DATE_FORMAT(DATE_ADD(e.calibrationDate, INTERVAL ? MONTH), '%Y-%m-%d') AS calibrationDueDate,
              sno.snoozeUntil AS snoozeUntil
       ${EQUIPMENT_SEARCH_FROM}
       LEFT JOIN alert_snoozes sno ON sno.alertType = 'calibration' AND sno.referenceId = e.id
       WHERE e.calibrationDate IS NOT NULL
         AND DATE_ADD(e.calibrationDate, INTERVAL ? MONTH) BETWEEN ? AND ?
       ORDER BY calibrationDueDate ASC, e.id ASC
       LIMIT ${DATE_SEARCH_ROW_CAP}`,
      [CALIBRATION_VALIDITY_MONTHS, CALIBRATION_VALIDITY_MONTHS, from, to]
    ),
    query<RowDataPacket[]>(
      `SELECT COUNT(*) AS cnt FROM customer_equipments e
       WHERE e.calibrationDate IS NOT NULL
         AND DATE_ADD(e.calibrationDate, INTERVAL ? MONTH) BETWEEN ? AND ?`,
      [CALIBRATION_VALIDITY_MONTHS, from, to]
    ),

    // ── ลูกหนี้ค้างชำระ ──────────────────────────────────────────────────────
    query<RowDataPacket[]>(
      `SELECT b.id, b.docNo, b.docType, b.docDate, b.dueDate, b.customerName,
              b.totalAmount, b.paidAmount,
              (b.totalAmount - b.paidAmount) AS outstanding,
              sno.snoozeUntil AS snoozeUntil
       FROM billing_documents b
       LEFT JOIN alert_snoozes sno ON sno.alertType = 'receivable' AND sno.referenceId = b.id
       ${RECEIVABLE_SEARCH_WHERE}
       ORDER BY b.dueDate ASC, b.id ASC
       LIMIT ${DATE_SEARCH_ROW_CAP}`,
      [from, to]
    ),
    query<RowDataPacket[]>(
      `SELECT COUNT(*) AS cnt FROM billing_documents b
       ${RECEIVABLE_SEARCH_WHERE}`,
      [from, to]
    ),

    // ── สิ่งที่ต้องทำ (กระดานงานที่เจ้าของเขียนเอง) ──────────────────────────
    // No `status` filter, same as everything else here. LEFT JOIN so a task
    // whose topic row was deleted outside the app still appears, under the
    // fallback heading, rather than being dropped or throwing.
    //
    // Appearing in a SEARCH RESULT does not make a manual task an automatic
    // alert: it keeps its "บันทึกเอง" badge, and nothing on this path writes
    // `alert_snoozes` for it.
    query<RowDataPacket[]>(
      `SELECT t.id, t.topicId, t.title, t.detail, t.dueDate, t.status, t.completedAt,
              tp.name AS topicName, tp.icon AS topicIcon, tp.color AS topicColor
       FROM crm_tasks t
       LEFT JOIN task_topics tp ON tp.id = t.topicId
       WHERE t.dueDate IS NOT NULL AND t.dueDate <> ''
         AND t.dueDate BETWEEN ? AND ?
       ORDER BY t.dueDate ASC, t.id ASC
       LIMIT ${DATE_SEARCH_ROW_CAP}`,
      [from, to]
    ),
    query<RowDataPacket[]>(
      `SELECT COUNT(*) AS cnt FROM crm_tasks t
       WHERE t.dueDate IS NOT NULL AND t.dueDate <> ''
         AND t.dueDate BETWEEN ? AND ?`,
      [from, to]
    ),
  ]);

  const toScheduleRow = (
    row: RowDataPacket,
    kind: "schedule" | "customer_call"
  ): DatedAlertRow => {
    const matchedDate = str(row.scheduledDate);
    return withMovability({
      kind,
      id: str(row.id),
      matchedDate,
      title: str(row.scheduleType) === "phone_call" ? "นัดโทรหาลูกค้า" : "นัดเข้าบริการ",
      subtitle: str(row.notes),
      customerName: str(row.customerName),
      companyName: str(row.companyName),
      status: str(row.status),
      overdue: matchedDate < today && str(row.status) === "pending",
      snoozedUntil: row.snoozeUntil ? str(row.snoozeUntil) : null,
      scheduleType: str(row.scheduleType),
      equipmentId: row.equipmentId ? str(row.equipmentId) : null,
      customerId: row.customerId ? str(row.customerId) : null,
      serialNumber: str(row.serialNumber),
      productName: str(row.productName),
    });
  };

  const buildBucket = (rows: DatedAlertRow[], total: number): DatedAlertBucket => ({
    rows,
    total,
  });

  const schedules = (scheduleRows[0] as RowDataPacket[]).map((r) =>
    toScheduleRow(r, "schedule")
  );
  const customerCalls = (callRows[0] as RowDataPacket[]).map((r) =>
    toScheduleRow(r, "customer_call")
  );

  const warranties = (warrantyRows[0] as RowDataPacket[]).map((row) => {
    const matchedDate = str(row.warrantyEndDate);
    return withMovability({
      kind: "warranty" as const,
      id: str(row.id),
      matchedDate,
      title: str(row.productName),
      subtitle: str(row.serialNumber) ? `S/N ${str(row.serialNumber)}` : "",
      customerName: str(row.customerName),
      companyName: str(row.companyName),
      status: str(row.status),
      overdue: matchedDate < today,
      snoozedUntil: row.snoozeUntil ? str(row.snoozeUntil) : null,
      serialNumber: str(row.serialNumber),
      productName: str(row.productName),
      customerId: row.customerId ? str(row.customerId) : null,
      // TINYINT(1) → boolean, so the row can be badged "ปิดแจ้งเตือนประกันไว้"
      // and the admin can see WHY this one never appeared in the feed.
      warrantyAlertEnabled: Boolean(Number(row.warrantyAlertEnabled)),
    });
  });

  const calibrations = (calibrationRows[0] as RowDataPacket[]).map((row) => {
    const matchedDate = str(row.calibrationDueDate);
    return withMovability({
      kind: "calibration" as const,
      id: str(row.id),
      matchedDate,
      title: str(row.productName),
      subtitle: str(row.serialNumber) ? `S/N ${str(row.serialNumber)}` : "",
      customerName: str(row.customerName),
      companyName: str(row.companyName),
      status: str(row.status),
      overdue: matchedDate < today,
      snoozedUntil: row.snoozeUntil ? str(row.snoozeUntil) : null,
      serialNumber: str(row.serialNumber),
      productName: str(row.productName),
      customerId: row.customerId ? str(row.customerId) : null,
      calibrationDate: row.calibrationDate ? str(row.calibrationDate) : null,
    });
  });

  const receivables = (receivableRows[0] as RowDataPacket[]).map((row) => {
    const matchedDate = str(row.dueDate);
    // DECIMAL arrives from mysql2 as a STRING. Coerced once, here, so nothing
    // downstream concatenates money instead of adding it. Floored at 0 for the
    // same reason the ledger floors it: an overpaid document must never
    // subtract from a total.
    const outstanding = Math.max(0, Number(row.outstanding) || 0);
    return withMovability({
      kind: "receivable" as const,
      id: str(row.id),
      matchedDate,
      title: str(row.docNo),
      subtitle: str(row.docType),
      customerName: str(row.customerName),
      companyName: "",
      // A document with nothing left to pay is badged "ชำระครบแล้ว" rather
      // than filtered out — it still fell due on the searched day.
      status: outstanding <= 0.005 ? "paid" : "unpaid",
      overdue: matchedDate < today && outstanding > 0.005,
      snoozedUntil: row.snoozeUntil ? str(row.snoozeUntil) : null,
      docNo: str(row.docNo),
      outstanding,
    });
  });

  const tasks = (taskRows[0] as RowDataPacket[]).map((row) => {
    const hasTopic = row.topicName !== null && row.topicName !== undefined;
    const matchedDate = str(row.dueDate);
    return withMovability({
      kind: "task" as const,
      id: str(row.id),
      matchedDate,
      title: str(row.title),
      subtitle: str(row.detail),
      customerName: "",
      companyName: "",
      status: str(row.status) === "done" ? "done" : "pending",
      overdue: matchedDate < today && str(row.status) !== "done",
      // The manual board never carries an alert snooze, and this path must not
      // start giving it one.
      snoozedUntil: null,
      topicName: hasTopic ? str(row.topicName) : UNASSIGNED_TOPIC_NAME,
      topicIcon: hasTopic ? str(row.topicIcon) : UNASSIGNED_TOPIC_ICON,
      topicColor: hasTopic ? str(row.topicColor) : UNASSIGNED_TOPIC_COLOR,
    });
  });

  return {
    from,
    to,
    schedules: buildBucket(schedules, countOf(scheduleCount[0] as RowDataPacket[])),
    customerCalls: buildBucket(customerCalls, countOf(callCount[0] as RowDataPacket[])),
    tasks: buildBucket(tasks, countOf(taskCount[0] as RowDataPacket[])),
    warranties: buildBucket(warranties, countOf(warrantyCount[0] as RowDataPacket[])),
    calibrations: buildBucket(
      calibrations,
      countOf(calibrationCount[0] as RowDataPacket[])
    ),
    receivables: buildBucket(
      receivables,
      countOf(receivableCount[0] as RowDataPacket[])
    ),
  };
}

// ── Bulk reschedule ──────────────────────────────────────────────────────────

/** Structural shape of the connection a `withTransaction` callback gets, so
 *  this module needs no mysql2 connection type. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TxConn = { query: (sql: string, params?: unknown[]) => Promise<any> };

export interface RescheduleInput {
  mode: RescheduleMode;
  targetDate?: string | null;
  shiftDays?: number | null;
  items: RescheduleItemInput[];
}

/** A refusal, built in one place so every one of them carries a code AND a
 *  Thai sentence. A refusal without a reason is just a shrug. */
function refused(
  item: RescheduleItemInput,
  code: RescheduleItemResult["code"],
  reason: string,
  fromDate: string | null = null
): RescheduleItemResult {
  return {
    kind: item.kind,
    id: item.id,
    status: "refused",
    fromDate,
    toDate: null,
    code,
    reason,
  };
}

/**
 * Move the date of every listed item, inside ONE transaction, and report on
 * every item individually.
 *
 * ATOMICITY. The whole batch is a single `withTransaction`, whether it carries
 * 2 items or 200 and whether or not it spans both tables. Half the
 * appointments moved and half not is a state an admin cannot detect and cannot
 * undo; failing at row 137 of 200 therefore rolls everything back and moves
 * nothing.
 *
 * IDEMPOTENCE, which `withTransaction` requires because it retries the
 * callback up to 3 times on a transient connection loss:
 *   • `results` is declared INSIDE the callback and rebuilt from scratch on
 *     every attempt. Appending to an array declared outside would report every
 *     item twice after one retry.
 *   • Target dates are computed INSIDE the callback from the dates read in
 *     THAT attempt — never from values computed before the transaction opened.
 *     This is the difference that matters: a shift is RELATIVE, so a target
 *     date resolved once and reused across a replay is exactly how +7 becomes
 *     +14.
 *   • The mandatory `expectedDate` guard closes the last hole. If an attempt
 *     committed but its acknowledgement was lost and the callback is replayed,
 *     the replay re-reads the ALREADY-SHIFTED date, finds it differs from
 *     `expectedDate`, and refuses every item as `stale`. The report is then
 *     wrong while the data is right — the correct side to fail on for a
 *     cumulative operation, and the next search shows the real dates anyway.
 *
 * SCOPE. Only two columns are ever written. Nothing here writes
 * `alert_snoozes` (moving a date is not the same as cancelling a snooze, and
 * an undeclared write to another table is a side effect nobody expects),
 * writes `service_logs`, changes any row's `status`, or touches `completedAt`.
 * `updateSchedule()` is deliberately NOT used: it merges and rewrites the whole
 * row including `notes`, `scheduleType` and `assignedToAdminId`, and a batch
 * path must touch the least it possibly can.
 */
export async function rescheduleDatedAlerts(
  input: RescheduleInput
): Promise<RescheduleReport> {
  const mode = input.mode;
  const targetDate = input.targetDate ?? null;
  const shiftDays = input.shiftDays ?? null;

  // Project convention: every incoming string is sanitised before use, even
  // though each one below travels as a bound parameter.
  const items: RescheduleItemInput[] = input.items.map((item) => ({
    kind: sanitizePlainText(String(item?.kind ?? "")).trim(),
    id: sanitizePlainText(String(item?.id ?? "")).trim(),
    expectedDate: sanitizePlainText(String(item?.expectedDate ?? "")).trim(),
  }));

  return withTransaction(async (conn: TxConn) => {
    // Rebuilt every attempt. Nothing outside this callback accumulates.
    const results: RescheduleItemResult[] = [];

    // Which ids need reading, split by table. Immovable kinds are classified
    // before any SQL is composed, so a warranty/calibration/receivable id can
    // never reach a write statement even if a hand-built request lists one.
    const scheduleIds: string[] = [];
    const taskIds: string[] = [];
    for (const item of items) {
      if (!item.id) continue;
      if (item.kind === "schedule" || item.kind === "customer_call") {
        if (!scheduleIds.includes(item.id)) scheduleIds.push(item.id);
      } else if (item.kind === "task") {
        if (!taskIds.includes(item.id)) taskIds.push(item.id);
      }
    }

    // One grouped SELECT per table, inside the same transaction — never one
    // query per item — and every one of them `FOR UPDATE`.
    //
    // ── WHY THE LOCK ────────────────────────────────────────────────────────
    // The read decides what this move is ALLOWED to do (the staleness test
    // against `expectedDate`, and the +N days arithmetic that starts from
    // `state.date`). Without a lock two admins both read 12 มิ.ย., both pass
    // the staleness test, and both write: one asks for +7 and the other for
    // +3, both are told "ย้ายแล้ว", and the appointment ends up on whichever
    // date committed last. The same pattern as `replaceInNotes`, which locks
    // its grouped read for the same reason and says so.
    const scheduleState = new Map<string, { date: string; status: string }>();
    if (scheduleIds.length > 0) {
      const [rows] = await conn.query(
        `SELECT id, scheduledDate, status FROM service_schedules
         WHERE id IN (${scheduleIds.map(() => "?").join(", ")})
         FOR UPDATE`,
        scheduleIds
      );
      for (const row of rows as RowDataPacket[]) {
        scheduleState.set(str(row.id), {
          date: str(row.scheduledDate),
          status: str(row.status),
        });
      }
    }

    const taskState = new Map<string, { date: string; status: string }>();
    if (taskIds.length > 0) {
      const [rows] = await conn.query(
        `SELECT id, dueDate, status FROM crm_tasks
         WHERE id IN (${taskIds.map(() => "?").join(", ")})
         FOR UPDATE`,
        taskIds
      );
      for (const row of rows as RowDataPacket[]) {
        taskState.set(str(row.id), {
          date: str(row.dueDate),
          status: str(row.status),
        });
      }
    }

    for (const item of items) {
      const isSchedule = item.kind === "schedule" || item.kind === "customer_call";
      const isTask = item.kind === "task";

      // 1. Kind. Warranty / calibration / receivable / anything unrecognised is
      //    an immovable fact and is refused here, before any SQL is composed
      //    for it. This check does not consult the database at all — there is
      //    no path from these kinds to a write statement.
      if (!isSchedule && !isTask) {
        const verdict = evaluateMovability({ kind: item.kind });
        results.push(
          refused(item, verdict.code ?? "immovable_fact", verdict.reason ?? "")
        );
        continue;
      }

      // 2. Existence.
      const state = isSchedule ? scheduleState.get(item.id) : taskState.get(item.id);
      if (!state) {
        results.push(
          refused(
            item,
            "not_found",
            "ไม่พบรายการนี้แล้ว อาจถูกลบไปหลังจากที่หน้าจอค้นหาครั้งล่าสุด กรุณาค้นหาใหม่"
          )
        );
        continue;
      }

      // 3. The rule — asked of the status READ HERE, never of anything the
      //    client sent. Catches "closed since the search" and "task with no
      //    due date".
      const verdict = evaluateMovability({
        kind: item.kind,
        status: state.status,
        matchedDate: state.date,
      });
      if (!verdict.movable) {
        results.push(refused(item, verdict.code, verdict.reason, state.date || null));
        continue;
      }

      // 4. The staleness guard. Also what makes a duplicate id inside one
      //    request refuse the second time rather than shift twice: `state` is
      //    updated after every successful move below.
      if (state.date !== item.expectedDate) {
        results.push(
          refused(
            item,
            "stale",
            `วันที่ของรายการนี้ถูกแก้ไปแล้ว (ตอนนี้เป็น ${state.date}) ไม่ตรงกับที่หน้าจอเห็นตอนค้นหา ระบบจึงไม่ย้ายให้ กรุณาค้นหาใหม่แล้วเลือกอีกครั้ง`,
            state.date || null
          )
        );
        continue;
      }

      // 5. The new date, computed from what THIS attempt read.
      const nextDate = computeTargetDate(mode, { matchedDate: state.date }, {
        targetDate,
        shiftDays,
      });
      if (!nextDate) {
        results.push(
          refused(
            item,
            "invalid_result",
            "วันที่ที่คำนวณได้ไม่ถูกต้องตามรูปแบบวันที่ ระบบจึงไม่บันทึกให้ กรุณาตรวจสอบวันที่หรือจำนวนวันที่จะเลื่อน",
            state.date
          )
        );
        continue;
      }

      // 6. Already there. Reported as `unchanged` with no UPDATE, so the
      //    summary cannot claim "ย้ายแล้ว 12 รายการ" when 3 never moved.
      if (nextDate === state.date) {
        results.push({
          kind: item.kind,
          id: item.id,
          status: "unchanged",
          fromDate: state.date,
          toDate: nextDate,
          code: null,
          reason: "วันที่เดิมตรงกับวันที่ปลายทางอยู่แล้ว จึงไม่ได้เปลี่ยนแปลง",
        });
        continue;
      }

      // 7. The narrow write: one named date column, with BOTH the status and
      //    the date we read repeated in the WHERE. The status condition stops a
      //    row closed since the read from being moved; the date condition is
      //    the compare-and-set that makes this write conditional on the world
      //    not having changed — the same shape as `replaceInNotes`'s
      //    `WHERE id = ? AND note = ?`. `FOR UPDATE` above already serialises
      //    the two transactions, so this is the belt to that lock's braces: it
      //    also covers a row edited by something that never took the lock at
      //    all (the per-row date picker on the alert card, another session's
      //    save), where the alternative is reporting "ย้ายแล้ว" over a change
      //    the admin never saw.
      const [result] = isSchedule
        ? await conn.query(
            `UPDATE service_schedules SET scheduledDate = ?
              WHERE id = ? AND status = 'pending' AND scheduledDate = ?`,
            [nextDate, item.id, state.date]
          )
        : await conn.query(
            `UPDATE crm_tasks SET dueDate = ?
              WHERE id = ? AND status = 'pending' AND dueDate = ?`,
            [nextDate, item.id, state.date]
          );

      if ((result as ResultSetHeader)?.affectedRows === 0) {
        // The status OR the date changed underneath us. Either way this item is
        // refused — never rolled back on everybody else's behalf. The message
        // covers both because the row is gone from under us and re-reading it
        // to say which one moved would be one more race.
        results.push(
          refused(
            item,
            "closed",
            "รายการนี้ถูกปิดงานหรือถูกแก้วันที่ไปพอดีระหว่างที่กำลังบันทึก ระบบจึงไม่ย้ายวันให้ กรุณาค้นหาใหม่เพื่อดูสถานะล่าสุด",
            state.date
          )
        );
        continue;
      }

      results.push({
        kind: item.kind,
        id: item.id,
        status: "moved",
        fromDate: state.date,
        toDate: nextDate,
        code: null,
        reason: "",
      });

      // Keep this attempt's view of the row current, so a second item naming
      // the same id sees the new date and is refused as `stale` instead of
      // being shifted a second time.
      state.date = nextDate;
    }

    // Any OTHER database error thrown above (not one of the classifications)
    // propagates out of this callback: the transaction rolls back and NOTHING
    // is moved. That is deliberate — a partial batch is worse than a failed one.
    return {
      movedCount: results.filter((r) => r.status === "moved").length,
      unchangedCount: results.filter((r) => r.status === "unchanged").length,
      refusedCount: results.filter((r) => r.status === "refused").length,
      results,
    };
  });
}

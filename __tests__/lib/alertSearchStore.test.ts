// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

// The DB is mocked and the assertions are made against the SQL and the params
// actually issued — the same pattern as crmStore.test.ts / taskStore.test.ts.
// `withTransaction` invokes the callback with a scripted connection so the REAL
// transaction body runs; two tests below replace that mock with one that rolls
// back or retries exactly as db.ts does.
const conn = { query: vi.fn() };
const topQuery = vi.fn();
const runTransaction = vi.fn();

vi.mock('@/app/lib/db', () => ({
  query: (...args: unknown[]) => topQuery(...args),
  withTransaction: (...args: unknown[]) => runTransaction(...args),
}));

import { searchDatedAlerts, rescheduleDatedAlerts } from '@/app/lib/alertSearchStore';
import { CALIBRATION_VALIDITY_MONTHS } from '@/app/lib/types';
import { CALIBRATION_ALERT_LEAD_MONTHS } from '@/app/lib/alertThresholds';
import { DATE_SEARCH_ROW_CAP } from '@/app/lib/alertDateSearch';

const sqlOf = (call: unknown[]) => String(call[0]);
const paramsOf = (call: unknown[]) => call[1] as unknown[];
/** Every SELECT the search issued, whitespace collapsed for readable matching. */
const topSql = () => topQuery.mock.calls.map((c) => sqlOf(c).replace(/\s+/g, ' '));
const connSql = () => conn.query.mock.calls.map((c) => sqlOf(c).replace(/\s+/g, ' '));

/** The one row-listing query for a category, found by the table + clause that
 *  identifies it. Count queries are excluded so assertions about the LIST are
 *  never accidentally satisfied by its COUNT twin. */
function listQuery(pattern: RegExp): string {
  const found = topSql().filter((s) => pattern.test(s) && !/SELECT COUNT\(\*\)/.test(s));
  expect(found).toHaveLength(1);
  return found[0];
}
beforeEach(() => {
  vi.clearAllMocks();
  conn.query.mockReset().mockImplementation((sql: string) =>
    /^\s*SELECT/i.test(sql)
      ? Promise.resolve([[]])
      : Promise.resolve([{ affectedRows: 1 }])
  );
  topQuery.mockReset().mockImplementation(() => Promise.resolve([[]]));
  runTransaction
    .mockReset()
    .mockImplementation(async (fn: (c: typeof conn) => Promise<unknown>) => fn(conn));
});

// ════════════════════════════════════════════════════════════════════════════
// searchDatedAlerts — the queries
// ════════════════════════════════════════════════════════════════════════════

describe('searchDatedAlerts — the search ignores every window the feed uses', () => {
  it('binds the exact range asked for, and never widens it', () => {
    // A search for one day must return one day. Every query gets the SAME
    // from/to, bound, never interpolated.
    return searchDatedAlerts('2026-06-12', '2026-06-12').then(() => {
      for (const call of topQuery.mock.calls) {
        const params = paramsOf(call);
        expect(params).toContain('2026-06-12');
        // The date strings travel as bound parameters — never spliced into SQL,
        // where they could not be escaped and could not be indexed.
        expect(sqlOf(call)).not.toContain('2026-06-12');
      }
    });
  });

  it('the equipment-schedule query has no scheduleDays cutoff and no status filter', async () => {
    await searchDatedAlerts('2026-06-01', '2026-06-30');
    const sql = listQuery(/FROM service_schedules s .*s\.equipmentId IS NOT NULL/);

    expect(sql).toContain('s.scheduledDate BETWEEN ? AND ?');
    // The feed clamps to today + scheduleDays. The search must not: those
    // windows keep the DEFAULT FEED short, they do not define what exists.
    expect(sql).not.toMatch(/s\.scheduledDate\s*<=\s*\?/);
    // Status is a badge and a tick-gate, never a filter — a completed
    // appointment is part of the answer to "what was supposed to happen".
    expect(sql).not.toMatch(/s\.status\s*=/);
  });

  it('the customer-call query is scoped by equipmentId/customerId, not by status', async () => {
    await searchDatedAlerts('2026-06-01', '2026-06-30');
    const sql = listQuery(/s\.equipmentId IS NULL AND s\.customerId IS NOT NULL/);
    expect(sql).toContain('s.scheduledDate BETWEEN ? AND ?');
    expect(sql).not.toMatch(/s\.status\s*=/);
  });

  it('no query filters on snoozeUntil — a snoozed row is still on that day (D9)', async () => {
    await searchDatedAlerts('2026-06-01', '2026-06-30');
    for (const sql of topSql()) {
      // alert_snoozes is joined only to READ the badge value. Filtering on it
      // would make the screen answer "nothing that day" for a day the owner
      // has an appointment on.
      expect(sql).not.toMatch(/snoozeUntil\s+IS\s+NULL/i);
      expect(sql).not.toMatch(/snoozeUntil\s*<=/i);
    }
    const sql = listQuery(/FROM service_schedules s .*s\.equipmentId IS NOT NULL/);
    expect(sql).toContain('sno.snoozeUntil AS snoozeUntil');
  });

  it('calibration matches the DUE date: binds 12 months, not the feed`s 10', async () => {
    await searchDatedAlerts('2027-06-12', '2027-06-12');
    const call = topQuery.mock.calls.find(
      (c) => /DATE_ADD\(e\.calibrationDate/.test(sqlOf(c)) && !/COUNT\(\*\)/.test(sqlOf(c))
    )!;
    const sql = sqlOf(call).replace(/\s+/g, ' ');

    // The feed asks "has the reminder started ringing?" (12 - 2 = 10 months).
    // The search asks "what falls due that day?" — the anniversary itself.
    expect(paramsOf(call)[0]).toBe(CALIBRATION_VALIDITY_MONTHS);
    expect(paramsOf(call)[0]).toBe(12);
    expect(paramsOf(call)[0]).not.toBe(
      CALIBRATION_VALIDITY_MONTHS - CALIBRATION_ALERT_LEAD_MONTHS
    );
    // Matched on the computed due date, ranged — not on the raw
    // calibrationDate, which is the day the LAST calibration was performed.
    expect(sql).toContain('DATE_ADD(e.calibrationDate, INTERVAL ? MONTH) BETWEEN ? AND ?');
    expect(sql).not.toMatch(/e\.calibrationDate BETWEEN/);
    expect(paramsOf(call).slice(1)).toEqual([12, '2027-06-12', '2027-06-12']);
  });

  it('the warranty query drops both filters the feed applies, and reads them instead', async () => {
    await searchDatedAlerts('2026-06-01', '2026-06-30');
    const sql = listQuery(/e\.warrantyEndDate BETWEEN/);

    // "Whose warranty ends that day" has one answer whether or not the
    // reminder was switched off, or the machine already marked Expired.
    expect(sql).not.toMatch(/e\.status\s*!=\s*'Expired'/);
    expect(sql).not.toMatch(/warrantyAlertEnabled\s*=\s*1/);
    // But both values come back, so the row can be badged with WHY it never
    // reaches the feed.
    expect(sql).toContain('warrantyAlertEnabled');
    expect(sql).toContain('e.status');
  });

  it('the receivable query excludes cancelled/superseded but NOT paid-in-full', async () => {
    await searchDatedAlerts('2026-06-01', '2026-06-30');
    const sql = listQuery(/FROM billing_documents b/);

    // A withdrawn document's due date no longer means anything.
    expect(sql).toContain('b.cancelledAt IS NULL');
    // "ถูกแทนที่" = replaced by a row that is STILL ALIVE, the same rule the
    // ledger screen, the feed and listOpenInvoices apply. Raise a correction,
    // cancel the correction, and a plain `b.supersededById IS NULL` erased the
    // original invoice from the very day it fell due — while /billing/receivables
    // was still counting that debt and badging it "เวอร์ชันใหม่ถูกยกเลิก".
    // Bites: the old clause fails the negative assertion below.
    expect(sql).toContain('NOT EXISTS');
    expect(sql).toContain('newer.id = b.supersededById');
    expect(sql).toContain('newer.cancelledAt IS NULL');
    expect(sql).not.toContain('b.supersededById IS NULL');
    // Same debtCarrier rule as the feed.
    expect(sql).toContain('b.receivableOverride = 1');
    expect(sql).toContain("b.docType = 'invoice'");
    // But a fully paid document still genuinely fell due that day — the whole
    // point of searching a past date is to review what was supposed to happen.
    expect(sql).not.toMatch(/totalAmount\s*-\s*b\.paidAmount\s*>/);
  });

  it('the task query drops rows with no due date and does not filter on status', async () => {
    await searchDatedAlerts('2026-06-01', '2026-06-30');
    const sql = listQuery(/FROM crm_tasks t/);
    expect(sql).toContain('t.dueDate IS NOT NULL');
    expect(sql).toContain("t.dueDate <> ''");
    expect(sql).toContain('t.dueDate BETWEEN ? AND ?');
    expect(sql).not.toMatch(/t\.status\s*=/);
    // LEFT JOIN so a task whose topic row was deleted outside the app still
    // appears, under the fallback heading, instead of vanishing.
    expect(sql).toContain('LEFT JOIN task_topics tp');
  });

  it('never queries the two dateless categories (D2)', async () => {
    await searchDatedAlerts('2026-06-01', '2026-06-30');
    // "ข้อมูลไม่ครบ" is a blank field with no date attached; "เอกสารค้าง" is
    // an AGE measured from saleDate, which is the day something was sold, not
    // the day anything falls due. Neither can be matched to a calendar day.
    for (const sql of topSql()) {
      expect(sql).not.toContain('sales_records');
      expect(sql).not.toMatch(/serialNumber\s*=\s*''/);
    }
  });

  it('every category has a capped list AND an uncapped COUNT twin', async () => {
    await searchDatedAlerts('2026-06-01', '2026-06-30');
    const lists = topSql().filter((s) => !/SELECT COUNT\(\*\)/.test(s));
    const counts = topSql().filter((s) => /SELECT COUNT\(\*\)/.test(s));
    expect(lists).toHaveLength(6);
    expect(counts).toHaveLength(6);
    for (const sql of lists) expect(sql).toContain(`LIMIT ${DATE_SEARCH_ROW_CAP}`);
    // The count is the TRUE total, so "และอีก N รายการ" is honest.
    for (const sql of counts) expect(sql).not.toContain('LIMIT');
  });

  it('reports the real total even when the list is capped', async () => {
    // 200 rows come back but 260 exist: the counter must say 260.
    const capped = Array.from({ length: DATE_SEARCH_ROW_CAP }, (_, i) => ({
      id: `s${i}`,
      scheduledDate: '2026-06-12',
      status: 'pending',
      scheduleType: 'service',
      equipmentId: 'e1',
    }));
    topQuery.mockImplementation((sql: string) => {
      const flat = String(sql).replace(/\s+/g, ' ');
      if (/COUNT\(\*\)/.test(flat) && /FROM service_schedules s WHERE s\.equipmentId IS NOT NULL/.test(flat)) {
        return Promise.resolve([[{ cnt: 260 }]]);
      }
      if (/FROM service_schedules s /.test(flat) && /s\.equipmentId IS NOT NULL/.test(flat)) {
        return Promise.resolve([capped]);
      }
      return Promise.resolve([[]]);
    });

    const result = await searchDatedAlerts('2026-06-01', '2026-06-30');
    expect(result.schedules.rows).toHaveLength(200);
    expect(result.schedules.total).toBe(260);
  });
});

describe('searchDatedAlerts — how rows come back', () => {
  /** Answer one category's list query with `rows`; everything else is empty. */
  function only(listPattern: RegExp, rows: unknown[]) {
    topQuery.mockImplementation((sql: string) => {
      const flat = String(sql).replace(/\s+/g, ' ');
      if (!/COUNT\(\*\)/.test(flat) && listPattern.test(flat)) {
        return Promise.resolve([rows]);
      }
      return Promise.resolve([[]]);
    });
  }

  it('carries the movability verdict and the Thai reason on every row', async () => {
    only(/FROM service_schedules s .*s\.equipmentId IS NOT NULL/, [
      { id: 's1', scheduledDate: '2026-06-12', status: 'pending', scheduleType: 'service', equipmentId: 'e1' },
      { id: 's2', scheduledDate: '2026-06-12', status: 'completed', scheduleType: 'service', equipmentId: 'e1' },
      { id: 's3', scheduledDate: '2026-06-12', status: 'cancelled', scheduleType: 'service', equipmentId: 'e1' },
    ]);
    const result = await searchDatedAlerts('2026-06-12', '2026-06-12');

    // Closed rows are RETURNED — status is a badge, not a filter. Hiding what
    // got done makes last week read as a week of failure.
    expect(result.schedules.rows).toHaveLength(3);
    expect(result.schedules.rows[0].movable).toBe(true);
    expect(result.schedules.rows[0].immovableReason).toBeNull();
    expect(result.schedules.rows[1].movable).toBe(false);
    expect(result.schedules.rows[1].immovableCode).toBe('closed');
    expect(result.schedules.rows[1].immovableReason).toMatch(/[฀-๿]/);
    expect(result.schedules.rows[2].immovableCode).toBe('closed');
  });

  it('marks warranty, calibration and receivable rows immovable with a way out', async () => {
    topQuery.mockImplementation((sql: string) => {
      const flat = String(sql).replace(/\s+/g, ' ');
      if (/COUNT\(\*\)/.test(flat)) return Promise.resolve([[]]);
      if (/e\.warrantyEndDate BETWEEN/.test(flat)) {
        return Promise.resolve([
          [{ id: 'e1', warrantyEndDate: '2026-06-12', status: 'Active', warrantyAlertEnabled: 0, productName: 'pH Meter', serialNumber: 'SN1' }],
        ]);
      }
      if (/DATE_ADD\(e\.calibrationDate/.test(flat)) {
        return Promise.resolve([
          [{ id: 'e2', calibrationDueDate: '2027-06-12', calibrationDate: '2026-06-12', status: 'Active', productName: 'Balance' }],
        ]);
      }
      if (/FROM billing_documents b/.test(flat)) {
        return Promise.resolve([
          [{ id: 'b1', docNo: 'INV-1', docType: 'invoice', dueDate: '2026-06-12', totalAmount: '100.00', paidAmount: '0.00', outstanding: '100.00' }],
        ]);
      }
      return Promise.resolve([[]]);
    });

    const result = await searchDatedAlerts('2026-06-12', '2027-06-12');
    for (const row of [
      result.warranties.rows[0],
      result.calibrations.rows[0],
      result.receivables.rows[0],
    ]) {
      expect(row.movable).toBe(false);
      expect(row.immovableCode).toBe('immovable_fact');
      expect(row.immovableReason).toMatch(/[฀-๿]/);
    }
    // The warranty row is badgeable with why it never reaches the feed.
    expect(result.warranties.rows[0].warrantyAlertEnabled).toBe(false);
    // Calibration is matched on the DUE date, and keeps the source date beside
    // it so the row can say where that due date came from.
    expect(result.calibrations.rows[0].matchedDate).toBe('2027-06-12');
    expect(result.calibrations.rows[0].calibrationDate).toBe('2026-06-12');
    // DECIMAL arrives from mysql2 as a string; coerced once, here.
    expect(result.receivables.rows[0].outstanding).toBe(100);
    expect(typeof result.receivables.rows[0].outstanding).toBe('number');
  });

  it('badges a paid-in-full receivable instead of dropping it', async () => {
    only(/FROM billing_documents b/, [
      { id: 'b1', docNo: 'INV-1', docType: 'invoice', dueDate: '2026-06-12', totalAmount: '100.00', paidAmount: '100.00', outstanding: '0.00' },
    ]);
    const result = await searchDatedAlerts('2026-06-12', '2026-06-12');
    expect(result.receivables.rows[0].status).toBe('paid');
    expect(result.receivables.rows[0].outstanding).toBe(0);
  });

  it('an overpaid document never reports a negative balance', async () => {
    only(/FROM billing_documents b/, [
      { id: 'b1', docNo: 'INV-1', docType: 'invoice', dueDate: '2026-06-12', totalAmount: '100.00', paidAmount: '150.00', outstanding: '-50.00' },
    ]);
    const result = await searchDatedAlerts('2026-06-12', '2026-06-12');
    expect(result.receivables.rows[0].outstanding).toBe(0);
  });

  it('a task whose topic row is gone still appears, under the fallback heading', async () => {
    only(/FROM crm_tasks t/, [
      { id: 't1', topicId: 99, title: 'โทรหาลูกค้า', dueDate: '2026-06-12', status: 'pending', topicName: null },
      { id: 't2', topicId: 1, title: 'ส่งใบเสนอราคา', dueDate: '2026-06-12', status: 'done', topicName: 'รอทำใบเสนอราคา', topicIcon: '📄', topicColor: 'amber' },
    ]);
    const result = await searchDatedAlerts('2026-06-12', '2026-06-12');

    expect(result.tasks.rows).toHaveLength(2);
    expect(result.tasks.rows[0].topicName).toBe('ไม่ระบุหัวข้อ');
    expect(result.tasks.rows[0].movable).toBe(true);
    // A done task is shown and badged, but not tickable — the way back is
    // "เปิดใหม่", which its reason says.
    expect(result.tasks.rows[1].movable).toBe(false);
    expect(result.tasks.rows[1].immovableCode).toBe('closed');
    expect(result.tasks.rows[1].immovableReason).toContain('เปิดใหม่');
    // The board never carries an alert snooze, and this path must not give it
    // one.
    expect(result.tasks.rows[1].snoozedUntil).toBeNull();
  });

  it('returns a snoozed appointment, badged and still tickable', async () => {
    only(/FROM service_schedules s .*s\.equipmentId IS NOT NULL/, [
      { id: 's1', scheduledDate: '2026-06-12', status: 'pending', scheduleType: 'service', equipmentId: 'e1', snoozeUntil: '2026-06-17T00:00:00.000Z' },
    ]);
    const result = await searchDatedAlerts('2026-06-12', '2026-06-12');
    expect(result.schedules.rows[0].snoozedUntil).toBe('2026-06-17T00:00:00.000Z');
    expect(result.schedules.rows[0].movable).toBe(true);
  });

  it('echoes the range it searched', async () => {
    const result = await searchDatedAlerts('2026-06-01', '2026-06-07');
    expect(result.from).toBe('2026-06-01');
    expect(result.to).toBe('2026-06-07');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// rescheduleDatedAlerts — the single transaction
// ════════════════════════════════════════════════════════════════════════════

/** Script the transaction connection with an in-memory pair of tables. */
function scriptTx(
  schedules: Array<{ id: string; scheduledDate: string; status: string }>,
  tasks: Array<{ id: string; dueDate: string | null; status: string }> = []
) {
  const scheduleRows = schedules.map((r) => ({ ...r }));
  const taskRows = tasks.map((r) => ({ ...r }));
  conn.query.mockImplementation((sql: string, params: unknown[] = []) => {
    const flat = String(sql).replace(/\s+/g, ' ');
    if (/^SELECT id, scheduledDate, status FROM service_schedules/.test(flat)) {
      return Promise.resolve([scheduleRows.filter((r) => params.includes(r.id))]);
    }
    if (/^SELECT id, dueDate, status FROM crm_tasks/.test(flat)) {
      return Promise.resolve([taskRows.filter((r) => params.includes(r.id))]);
    }
    if (/^UPDATE service_schedules SET scheduledDate/.test(flat)) {
      const row = scheduleRows.find((r) => r.id === params[1] && r.status === 'pending');
      if (row) row.scheduledDate = String(params[0]);
      return Promise.resolve([{ affectedRows: row ? 1 : 0 }]);
    }
    if (/^UPDATE crm_tasks SET dueDate/.test(flat)) {
      const row = taskRows.find((r) => r.id === params[1] && r.status === 'pending');
      if (row) row.dueDate = String(params[0]);
      return Promise.resolve([{ affectedRows: row ? 1 : 0 }]);
    }
    return Promise.resolve([[]]);
  });
  return { scheduleRows, taskRows };
}

describe('rescheduleDatedAlerts — one transaction, per-item refusals', () => {
  it('runs the whole batch inside exactly one withTransaction', async () => {
    scriptTx([
      { id: 's1', scheduledDate: '2026-06-12', status: 'pending' },
      { id: 's2', scheduledDate: '2026-06-13', status: 'pending' },
    ]);
    await rescheduleDatedAlerts({
      mode: 'shift',
      shiftDays: 7,
      items: [
        { kind: 'schedule', id: 's1', expectedDate: '2026-06-12' },
        { kind: 'customer_call', id: 's2', expectedDate: '2026-06-13' },
      ],
    });
    // Half the appointments moved and half not is a state an admin cannot
    // detect and cannot undo.
    expect(runTransaction).toHaveBeenCalledTimes(1);
  });

  it('shifts by ±N days, preserving the spacing between rows', async () => {
    const { scheduleRows } = scriptTx([
      { id: 's1', scheduledDate: '2026-01-28', status: 'pending' },
      { id: 's2', scheduledDate: '2026-01-31', status: 'pending' },
    ]);
    const report = await rescheduleDatedAlerts({
      mode: 'shift',
      shiftDays: 7,
      items: [
        { kind: 'schedule', id: 's1', expectedDate: '2026-01-28' },
        { kind: 'schedule', id: 's2', expectedDate: '2026-01-31' },
      ],
    });
    expect(report.movedCount).toBe(2);
    // Three days apart before, three days apart after — and the month-end
    // crossing is real, not a truncation.
    expect(scheduleRows[0].scheduledDate).toBe('2026-02-04');
    expect(scheduleRows[1].scheduledDate).toBe('2026-02-07');
    expect(report.results[1]).toMatchObject({
      status: 'moved',
      fromDate: '2026-01-31',
      toDate: '2026-02-07',
    });
  });

  it('sets every ticked row to one date in "set" mode, across both tables', async () => {
    const { scheduleRows, taskRows } = scriptTx(
      [{ id: 's1', scheduledDate: '2026-01-28', status: 'pending' }],
      [{ id: 't1', dueDate: '2026-03-02', status: 'pending' }]
    );
    const report = await rescheduleDatedAlerts({
      mode: 'set',
      targetDate: '2026-06-12',
      items: [
        { kind: 'schedule', id: 's1', expectedDate: '2026-01-28' },
        { kind: 'task', id: 't1', expectedDate: '2026-03-02' },
      ],
    });
    expect(report.movedCount).toBe(2);
    expect(scheduleRows[0].scheduledDate).toBe('2026-06-12');
    expect(taskRows[0].dueDate).toBe('2026-06-12');
    // Still ONE transaction even though it spans two tables.
    expect(runTransaction).toHaveBeenCalledTimes(1);
  });

  it('writes narrow UPDATEs — one named date column, guarded by status', async () => {
    scriptTx(
      [{ id: 's1', scheduledDate: '2026-06-12', status: 'pending' }],
      [{ id: 't1', dueDate: '2026-06-12', status: 'pending' }]
    );
    await rescheduleDatedAlerts({
      mode: 'shift',
      shiftDays: 7,
      items: [
        { kind: 'schedule', id: 's1', expectedDate: '2026-06-12' },
        { kind: 'task', id: 't1', expectedDate: '2026-06-12' },
      ],
    });
    const updates = connSql().filter((s) => /^UPDATE/.test(s));
    expect(updates).toEqual([
      "UPDATE service_schedules SET scheduledDate = ? WHERE id = ? AND status = 'pending' AND scheduledDate = ?",
      "UPDATE crm_tasks SET dueDate = ? WHERE id = ? AND status = 'pending' AND dueDate = ?",
    ]);
    // Never updateSchedule(), which merges the whole row and rewrites notes /
    // scheduleType / assignedToAdminId along with the date.
    for (const sql of updates) {
      expect(sql).not.toMatch(/notes|scheduleType|assignedToAdminId|status\s*=\s*\?/);
    }
  });

  // ── Two admins, one appointment ───────────────────────────────────────────
  // The read decides what the move is allowed to do — the staleness test, and
  // the +N days arithmetic that counts from the date it read. With no lock and
  // no date in the WHERE, A (+7) and B (+3) both read 12 มิ.ย., both passed the
  // staleness test, both wrote, and both were told "ย้ายแล้ว" while only the
  // last write survived. A's screen reported a date the appointment is not on.
  //
  // This bites: drop `FOR UPDATE` and the two assertions below fail; drop the
  // date from the WHERE and the compare-and-set assertions fail.
  it('locks the rows it read and writes compare-and-set, so a concurrent move cannot be lost', async () => {
    scriptTx(
      [{ id: 's1', scheduledDate: '2026-06-12', status: 'pending' }],
      [{ id: 't1', dueDate: '2026-06-12', status: 'pending' }]
    );
    await rescheduleDatedAlerts({
      mode: 'shift',
      shiftDays: 7,
      items: [
        { kind: 'schedule', id: 's1', expectedDate: '2026-06-12' },
        { kind: 'task', id: 't1', expectedDate: '2026-06-12' },
      ],
    });

    const reads = connSql().filter((s) => /^SELECT/.test(s));
    expect(reads.length).toBe(2);
    for (const sql of reads) expect(sql).toMatch(/FOR UPDATE$/);

    // The date read is carried into the write, and it is the date that was
    // actually read — not the client's `expectedDate`, which a caller controls.
    const updateCalls = conn.query.mock.calls.filter(([sql]) =>
      /^UPDATE/.test(String(sql).replace(/\s+/g, ' ').trim())
    );
    expect(updateCalls.length).toBe(2);
    for (const [, params] of updateCalls) {
      expect((params as unknown[])[2]).toBe('2026-06-12');
    }
  });

  it('reads all ids per table in ONE grouped SELECT, never one query per item', async () => {
    scriptTx([
      { id: 's1', scheduledDate: '2026-06-12', status: 'pending' },
      { id: 's2', scheduledDate: '2026-06-12', status: 'pending' },
      { id: 's3', scheduledDate: '2026-06-12', status: 'pending' },
    ]);
    await rescheduleDatedAlerts({
      mode: 'shift',
      shiftDays: 1,
      items: [
        { kind: 'schedule', id: 's1', expectedDate: '2026-06-12' },
        { kind: 'schedule', id: 's2', expectedDate: '2026-06-12' },
        { kind: 'customer_call', id: 's3', expectedDate: '2026-06-12' },
      ],
    });
    const selects = connSql().filter((s) => /^SELECT/.test(s));
    expect(selects).toHaveLength(1);
    expect(selects[0]).toContain('WHERE id IN (?, ?, ?)');
  });

  it('reports unchanged without issuing an UPDATE when the date already matches', async () => {
    scriptTx([{ id: 's1', scheduledDate: '2026-06-12', status: 'pending' }]);
    const report = await rescheduleDatedAlerts({
      mode: 'set',
      targetDate: '2026-06-12',
      items: [{ kind: 'schedule', id: 's1', expectedDate: '2026-06-12' }],
    });
    expect(report.unchangedCount).toBe(1);
    expect(report.movedCount).toBe(0);
    // So a summary cannot claim "ย้ายแล้ว 12 รายการ" when three never moved.
    expect(connSql().filter((s) => /^UPDATE/.test(s))).toHaveLength(0);
  });

  it('allows a shift into the past — deliberately (D5)', async () => {
    const { taskRows } = scriptTx([], [{ id: 't1', dueDate: '2026-06-13', status: 'pending' }]);
    const report = await rescheduleDatedAlerts({
      mode: 'shift',
      shiftDays: -5,
      items: [{ kind: 'task', id: 't1', expectedDate: '2026-06-13' }],
    });
    // An admin catching up on a backlog has every reason to pull work forward.
    // The confirm dialog names how many land before today; the store does not
    // block it.
    expect(report.movedCount).toBe(1);
    expect(taskRows[0].dueDate).toBe('2026-06-08');
  });
});

describe('rescheduleDatedAlerts — refusals are per item, never per batch', () => {
  it('refuses immovable facts without composing any SQL for them', async () => {
    scriptTx([
      { id: 's1', scheduledDate: '2026-06-12', status: 'pending' },
      { id: 's2', scheduledDate: '2026-06-12', status: 'pending' },
    ]);
    const report = await rescheduleDatedAlerts({
      mode: 'shift',
      shiftDays: 7,
      items: [
        { kind: 'schedule', id: 's1', expectedDate: '2026-06-12' },
        { kind: 'warranty', id: 'e1', expectedDate: '2026-06-12' },
        { kind: 'receivable', id: 'b1', expectedDate: '2026-06-12' },
        { kind: 'calibration', id: 'e2', expectedDate: '2026-06-12' },
        { kind: 'schedule', id: 's2', expectedDate: '2026-06-12' },
      ],
    });

    expect(report.movedCount).toBe(2);
    expect(report.refusedCount).toBe(3);
    for (const i of [1, 2, 3]) {
      expect(report.results[i].status).toBe('refused');
      expect(report.results[i].code).toBe('immovable_fact');
      expect(report.results[i].reason).toMatch(/[฀-๿]/);
    }
    // THE control: nothing on this path names either table, in a read or a
    // write. The greyed checkbox is only the advance warning.
    for (const sql of connSql()) {
      expect(sql).not.toContain('customer_equipments');
      expect(sql).not.toContain('billing_documents');
    }
  });

  it('refuses an unknown kind per item instead of failing the batch', async () => {
    scriptTx([{ id: 's1', scheduledDate: '2026-06-12', status: 'pending' }]);
    const report = await rescheduleDatedAlerts({
      mode: 'shift',
      shiftDays: 7,
      items: [
        { kind: 'wat_is_this', id: 'x1', expectedDate: '2026-06-12' },
        { kind: 'schedule', id: 's1', expectedDate: '2026-06-12' },
      ],
    });
    expect(report.results[0].code).toBe('immovable_fact');
    expect(report.results[1].status).toBe('moved');
  });

  it('refuses a row closed since the search as `closed`, and moves the rest', async () => {
    scriptTx([
      { id: 's1', scheduledDate: '2026-06-12', status: 'completed' },
      { id: 's2', scheduledDate: '2026-06-12', status: 'cancelled' },
      { id: 's3', scheduledDate: '2026-06-12', status: 'pending' },
    ], [{ id: 't1', dueDate: '2026-06-12', status: 'done' }]);
    const report = await rescheduleDatedAlerts({
      mode: 'shift',
      shiftDays: 7,
      items: [
        { kind: 'schedule', id: 's1', expectedDate: '2026-06-12' },
        { kind: 'schedule', id: 's2', expectedDate: '2026-06-12' },
        { kind: 'task', id: 't1', expectedDate: '2026-06-12' },
        { kind: 'schedule', id: 's3', expectedDate: '2026-06-12' },
      ],
    });
    expect(report.results.map((r) => r.code)).toEqual(['closed', 'closed', 'closed', null]);
    expect(report.results[3].status).toBe('moved');
    // Only the one movable row was written.
    expect(connSql().filter((s) => /^UPDATE/.test(s))).toHaveLength(1);
  });

  it('refuses a task with no due date as `no_date`', async () => {
    scriptTx([], [{ id: 't1', dueDate: null, status: 'pending' }]);
    const report = await rescheduleDatedAlerts({
      mode: 'shift',
      shiftDays: 7,
      items: [{ kind: 'task', id: 't1', expectedDate: '' }],
    });
    expect(report.results[0].code).toBe('no_date');
    expect(connSql().filter((s) => /^UPDATE/.test(s))).toHaveLength(0);
  });

  it('refuses a missing row as `not_found`', async () => {
    scriptTx([]);
    const report = await rescheduleDatedAlerts({
      mode: 'shift',
      shiftDays: 7,
      items: [{ kind: 'schedule', id: 'ghost', expectedDate: '2026-06-12' }],
    });
    expect(report.results[0].code).toBe('not_found');
    expect(report.results[0].fromDate).toBeNull();
  });

  it('refuses a stale expectedDate, and still moves the rows that agree', async () => {
    const { scheduleRows } = scriptTx([
      { id: 's1', scheduledDate: '2026-06-20', status: 'pending' },
      { id: 's2', scheduledDate: '2026-06-12', status: 'pending' },
    ]);
    const report = await rescheduleDatedAlerts({
      mode: 'shift',
      shiftDays: 7,
      items: [
        { kind: 'schedule', id: 's1', expectedDate: '2026-06-12' }, // moved elsewhere since
        { kind: 'schedule', id: 's2', expectedDate: '2026-06-12' },
      ],
    });
    expect(report.results[0].code).toBe('stale');
    expect(report.results[0].reason).toContain('2026-06-20');
    expect(scheduleRows[0].scheduledDate).toBe('2026-06-20'); // untouched
    expect(report.results[1].status).toBe('moved');
    expect(scheduleRows[1].scheduledDate).toBe('2026-06-19');
  });

  it('refuses `invalid_result` rather than writing a malformed date', async () => {
    // A stored date that is not YYYY-MM-DD cannot be shifted into one.
    scriptTx([{ id: 's1', scheduledDate: '12/06/2026', status: 'pending' }]);
    const report = await rescheduleDatedAlerts({
      mode: 'shift',
      shiftDays: 7,
      items: [{ kind: 'schedule', id: 's1', expectedDate: '12/06/2026' }],
    });
    expect(report.results[0].code).toBe('invalid_result');
    expect(connSql().filter((s) => /^UPDATE/.test(s))).toHaveLength(0);
  });

  it('turns affectedRows = 0 into THIS item`s refusal, not the batch`s failure', async () => {
    // The status flipped between the read and the write.
    scriptTx([
      { id: 's1', scheduledDate: '2026-06-12', status: 'pending' },
      { id: 's2', scheduledDate: '2026-06-12', status: 'pending' },
    ]);
    const original = conn.query.getMockImplementation()!;
    let updates = 0;
    conn.query.mockImplementation((sql: string, params: unknown[] = []) => {
      if (/^\s*UPDATE service_schedules/.test(sql) && updates++ === 0) {
        return Promise.resolve([{ affectedRows: 0 }]);
      }
      return original(sql, params);
    });

    const report = await rescheduleDatedAlerts({
      mode: 'shift',
      shiftDays: 7,
      items: [
        { kind: 'schedule', id: 's1', expectedDate: '2026-06-12' },
        { kind: 'schedule', id: 's2', expectedDate: '2026-06-12' },
      ],
    });
    expect(report.results[0]).toMatchObject({ status: 'refused', code: 'closed' });
    expect(report.results[1].status).toBe('moved');
  });

  it('returns one result per item, in submission order, never short', async () => {
    scriptTx([{ id: 's1', scheduledDate: '2026-06-12', status: 'pending' }]);
    const items = [
      { kind: 'warranty', id: 'e1', expectedDate: '2026-06-12' },
      { kind: 'schedule', id: 's1', expectedDate: '2026-06-12' },
      { kind: 'nonsense', id: 'x', expectedDate: '2026-06-12' },
      { kind: 'schedule', id: 'ghost', expectedDate: '2026-06-12' },
    ];
    const report = await rescheduleDatedAlerts({ mode: 'shift', shiftDays: 7, items });
    expect(report.results).toHaveLength(items.length);
    expect(report.results.map((r) => r.id)).toEqual(items.map((i) => i.id));
    expect(report.movedCount + report.unchangedCount + report.refusedCount).toBe(items.length);
  });
});

describe('rescheduleDatedAlerts — atomicity and replay safety', () => {
  it('rolls the whole batch back when a write fails part-way through', async () => {
    // Fail at row 3 of 5: nothing may be left moved.
    const rows = Array.from({ length: 5 }, (_, i) => ({
      id: `s${i}`,
      scheduledDate: '2026-06-12',
      status: 'pending',
    }));
    const committed = new Map(rows.map((r) => [r.id, r.scheduledDate]));
    let updates = 0;
    conn.query.mockImplementation((sql: string, params: unknown[] = []) => {
      const flat = String(sql).replace(/\s+/g, ' ');
      if (/^SELECT id, scheduledDate, status FROM service_schedules/.test(flat)) {
        return Promise.resolve([rows.filter((r) => params.includes(r.id))]);
      }
      if (/^UPDATE service_schedules/.test(flat)) {
        if (updates++ === 2) return Promise.reject(new Error('ER_LOCK_WAIT_TIMEOUT'));
        return Promise.resolve([{ affectedRows: 1 }]);
      }
      return Promise.resolve([[]]);
    });
    // Model db.ts: a thrown error rolls back and, for a non-transient error,
    // propagates immediately.
    runTransaction.mockImplementation(async (fn: (c: typeof conn) => Promise<unknown>) => {
      try {
        return await fn(conn);
      } catch (error) {
        committed.clear(); // rollback: discard everything this attempt did
        for (const r of rows) committed.set(r.id, '2026-06-12');
        throw error;
      }
    });

    await expect(
      rescheduleDatedAlerts({
        mode: 'shift',
        shiftDays: 7,
        items: rows.map((r) => ({
          kind: 'schedule',
          id: r.id,
          expectedDate: '2026-06-12',
        })),
      })
    ).rejects.toThrow('ER_LOCK_WAIT_TIMEOUT');

    // Not one row survives the failure with a new date.
    for (const date of committed.values()) expect(date).toBe('2026-06-12');
  });

  it('a retried callback never double-shifts and never duplicates the report', async () => {
    // THE bug this guards: a shift is RELATIVE, so applying it twice turns +7
    // into +14. The retry re-reads inside the transaction, sees the already
    // shifted date, and refuses everything as `stale` — the report is then
    // wrong while the data is right, which is the correct side to fail on.
    const rows = [
      { id: 's1', scheduledDate: '2026-06-12', status: 'pending' },
      { id: 's2', scheduledDate: '2026-06-13', status: 'pending' },
    ];
    conn.query.mockImplementation((sql: string, params: unknown[] = []) => {
      const flat = String(sql).replace(/\s+/g, ' ');
      if (/^SELECT id, scheduledDate, status FROM service_schedules/.test(flat)) {
        return Promise.resolve([rows.filter((r) => params.includes(r.id)).map((r) => ({ ...r }))]);
      }
      if (/^UPDATE service_schedules/.test(flat)) {
        const row = rows.find((r) => r.id === params[1]);
        if (row) row.scheduledDate = String(params[0]);
        return Promise.resolve([{ affectedRows: 1 }]);
      }
      return Promise.resolve([[]]);
    });

    // Attempt 1 runs fully (committing its writes), then the ack is "lost" and
    // db.ts retries the callback — exactly the replay withTransaction can do.
    let callbackRuns = 0;
    runTransaction.mockImplementation(async (fn: (c: typeof conn) => Promise<unknown>) => {
      callbackRuns++;
      await fn(conn); // attempt 1: commits, ack lost
      callbackRuns++;
      return fn(conn); // attempt 2: the replay
    });

    const report = await rescheduleDatedAlerts({
      mode: 'shift',
      shiftDays: 7,
      items: [
        { kind: 'schedule', id: 's1', expectedDate: '2026-06-12' },
        { kind: 'schedule', id: 's2', expectedDate: '2026-06-13' },
      ],
    });

    // The callback really did run twice — this test would prove nothing if the
    // replay had been skipped.
    expect(callbackRuns).toBe(2);
    // Shifted ONCE. +7, never +14.
    expect(rows[0].scheduledDate).toBe('2026-06-19');
    expect(rows[1].scheduledDate).toBe('2026-06-20');
    // The report is rebuilt from scratch each attempt: two items in, two
    // results out, not four.
    expect(report.results).toHaveLength(2);
    expect(report.results.every((r) => r.code === 'stale')).toBe(true);
  });

  it('a duplicated id inside one request is refused the second time, not shifted twice', async () => {
    const { scheduleRows } = scriptTx([
      { id: 's1', scheduledDate: '2026-06-12', status: 'pending' },
    ]);
    const report = await rescheduleDatedAlerts({
      mode: 'shift',
      shiftDays: 7,
      items: [
        { kind: 'schedule', id: 's1', expectedDate: '2026-06-12' },
        { kind: 'schedule', id: 's1', expectedDate: '2026-06-12' },
      ],
    });
    expect(scheduleRows[0].scheduledDate).toBe('2026-06-19'); // +7, not +14
    expect(report.results[0].status).toBe('moved');
    expect(report.results[1].code).toBe('stale');
  });

  it('touches nothing but the date column — no snoozes, no logs, no statuses', async () => {
    scriptTx(
      [{ id: 's1', scheduledDate: '2026-06-12', status: 'pending' }],
      [{ id: 't1', dueDate: '2026-06-12', status: 'pending' }]
    );
    await rescheduleDatedAlerts({
      mode: 'shift',
      shiftDays: 7,
      items: [
        { kind: 'schedule', id: 's1', expectedDate: '2026-06-12' },
        { kind: 'task', id: 't1', expectedDate: '2026-06-12' },
      ],
    });
    for (const sql of connSql()) {
      // Moving a date is not cancelling a snooze, and an undeclared write to
      // another table is a side effect nobody expects.
      expect(sql).not.toContain('alert_snoozes');
      expect(sql).not.toContain('service_logs');
      expect(sql).not.toContain('completedAt');
      expect(sql).not.toContain('customer_equipments');
      expect(sql).not.toContain('billing_documents');
    }
  });
});

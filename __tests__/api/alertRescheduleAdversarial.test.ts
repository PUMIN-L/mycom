// @vitest-environment node
/**
 * ADVERSARIAL PROBE — the bulk edit moves REAL appointment dates, many rows per
 * click, with no per-row confirmation to catch a mistake. Everything below is
 * written from the attacker's side: a hand-built request, a wrong type, a
 * replayed transaction, a range nobody would type on purpose.
 *
 * The database is mocked at the DRIVER boundary, so every claim here is made
 * about the SQL that actually reached mysql2 — not about what a store function
 * said it did.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const conn = { query: vi.fn() };
const topQuery = vi.fn();
const runTransaction = vi.fn();

vi.mock('@/app/lib/db', () => ({
  query: (...args: unknown[]) => topQuery(...args),
  withTransaction: (...args: unknown[]) => runTransaction(...args),
}));

vi.mock('@/app/lib/session', () => ({ getSession: vi.fn() }));
import { getSession } from '@/app/lib/session';

import { GET as SEARCH } from '@/app/api/admin/alerts/search/route';
import { POST as RESCHEDULE } from '@/app/api/admin/alerts/reschedule/route';
import {
  IMMOVABLE_REASONS,
  computeTargetDate,
  evaluateMovability,
  selectAllPlan,
} from '@/app/lib/alertDateSearch';
import type { DatedAlertRow } from '@/app/lib/alertDateSearch';

const admin = { userId: '1', username: 'admin', expiresAt: new Date() } as never;

const sqlOf = (call: unknown[]) => String(call[0]).replace(/\s+/g, ' ');
const allSql = () => [
  ...topQuery.mock.calls.map(sqlOf),
  ...conn.query.mock.calls.map(sqlOf),
];

function post(body: unknown) {
  return new NextRequest('http://localhost:3000/api/admin/alerts/reschedule', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}
function get(qs: string) {
  return new NextRequest(`http://localhost:3000/api/admin/alerts/search${qs}`);
}

/** In-memory service_schedules + crm_tasks behind the transaction connection. */
function scriptTx(
  schedules: Array<{ id: string; scheduledDate: string; status: string }>,
  tasks: Array<{ id: string; dueDate: string | null; status: string }> = []
) {
  const scheduleRows = schedules.map((r) => ({ ...r }));
  const taskRows = tasks.map((r) => ({ ...r }));
  conn.query.mockImplementation((sql: string, params: unknown[] = []) => {
    const flat = String(sql).replace(/\s+/g, ' ');
    if (/^SELECT id, scheduledDate, status FROM service_schedules/.test(flat)) {
      return Promise.resolve([
        scheduleRows.filter((r) => params.includes(r.id)).map((r) => ({ ...r })),
      ]);
    }
    if (/^SELECT id, dueDate, status FROM crm_tasks/.test(flat)) {
      return Promise.resolve([taskRows.filter((r) => params.includes(r.id)).map((r) => ({ ...r }))]);
    }
    if (/^UPDATE service_schedules/.test(flat)) {
      const row = scheduleRows.find((r) => r.id === params[1] && r.status === 'pending');
      if (row) row.scheduledDate = String(params[0]);
      return Promise.resolve([{ affectedRows: row ? 1 : 0 }]);
    }
    if (/^UPDATE crm_tasks/.test(flat)) {
      const row = taskRows.find((r) => r.id === params[1] && r.status === 'pending');
      if (row) row.dueDate = String(params[0]);
      return Promise.resolve([{ affectedRows: row ? 1 : 0 }]);
    }
    return Promise.resolve([[]]);
  });
  return { scheduleRows, taskRows };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSession).mockResolvedValue(admin);
  topQuery.mockReset().mockImplementation(() => Promise.resolve([[]]));
  conn.query.mockReset().mockImplementation(() => Promise.resolve([[]]));
  runTransaction
    .mockReset()
    .mockImplementation(async (fn: (c: typeof conn) => Promise<unknown>) => fn(conn));
});

// ════════════════════════════════════════════════════════════════════════════
// 3. THE REFUSALS ARE THE FEATURE — a hand-built request naming all three
// ════════════════════════════════════════════════════════════════════════════

describe('a hand-crafted request naming a warranty, a calibration and an invoice', () => {
  /** Exactly the body a determined admin (or a script) would POST with curl,
   *  bypassing the greyed-out checkbox entirely. */
  const handCrafted = {
    mode: 'shift' as const,
    shiftDays: 7,
    items: [
      { kind: 'warranty', id: 'eq-500', expectedDate: '2026-06-12' },
      { kind: 'calibration', id: 'eq-500', expectedDate: '2026-06-12' },
      { kind: 'receivable', id: 'inv-900', expectedDate: '2026-06-12' },
    ],
  };

  it('refuses all three, individually, with the reason that names a way out', async () => {
    scriptTx([]);
    const res = await RESCHEDULE(post(handCrafted));
    const body = await res.json();

    // Every item refused → 400, but with the REPORT shape, not a bare error.
    expect(res.status).toBe(400);
    expect(body.movedCount).toBe(0);
    expect(body.refusedCount).toBe(3);
    expect(body.results).toHaveLength(3);

    // Per item, in submission order, each with its OWN reason — not one
    // batch-level "ผิดพลาด".
    expect(body.results.map((r: { id: string }) => r.id)).toEqual([
      'eq-500',
      'eq-500',
      'inv-900',
    ]);
    for (const r of body.results) {
      expect(r.status).toBe('refused');
      expect(r.code).toBe('immovable_fact');
      expect(r.toDate).toBeNull();
      expect(r.reason.length).toBeGreaterThan(20);
    }
    // The three reasons are DIFFERENT: a warranty, a calibration and an invoice
    // are refused for three different reasons and point at three different
    // screens. One generic sentence for all three would be a shrug.
    const reasons = body.results.map((r: { reason: string }) => r.reason);
    expect(new Set(reasons).size).toBe(3);
    expect(reasons[0]).toContain('ข้อมูลเครื่อง');
    expect(reasons[1]).toContain('วันสอบเทียบ');
    expect(reasons[2]).toContain('/billing/receivables');
  });

  it('does not fail SILENTLY — the refusal is loud and itemised, not a 204', async () => {
    scriptTx([]);
    const res = await RESCHEDULE(post(handCrafted));
    expect(res.status).not.toBe(200);
    expect(res.status).not.toBe(204);
    const body = await res.json();
    // Nothing here reports success of any kind.
    expect(body.movedCount + body.unchangedCount).toBe(0);
  });

  it('issues NO SQL AT ALL for the three fact rows — not even a SELECT', async () => {
    scriptTx([]);
    await RESCHEDULE(post(handCrafted));
    const sql = allSql();
    // The real control is the ABSENCE of a statement, not a disabled checkbox.
    for (const s of sql) {
      expect(s).not.toContain('customer_equipments');
      expect(s).not.toContain('billing_documents');
      expect(s).not.toContain('warrantyEndDate');
      expect(s).not.toContain('calibrationDate');
    }
    expect(sql.filter((s) => /^UPDATE/i.test(s))).toHaveLength(0);
    // The ids never reach a bound parameter either.
    const params = conn.query.mock.calls.flatMap((c) => (c[1] as unknown[]) ?? []);
    expect(params).not.toContain('eq-500');
    expect(params).not.toContain('inv-900');
  });

  it('a MIXED batch moves the movable ones and refuses the rest, per item', async () => {
    const { scheduleRows, taskRows } = scriptTx(
      [
        { id: 's1', scheduledDate: '2026-06-12', status: 'pending' },
        { id: 's2', scheduledDate: '2026-06-15', status: 'pending' },
      ],
      [{ id: 't1', dueDate: '2026-06-12', status: 'pending' }]
    );

    const res = await RESCHEDULE(
      post({
        mode: 'shift',
        shiftDays: 7,
        items: [
          { kind: 'schedule', id: 's1', expectedDate: '2026-06-12' },
          { kind: 'warranty', id: 'eq-500', expectedDate: '2026-06-12' },
          { kind: 'customer_call', id: 's2', expectedDate: '2026-06-15' },
          { kind: 'calibration', id: 'eq-501', expectedDate: '2026-06-12' },
          { kind: 'task', id: 't1', expectedDate: '2026-06-12' },
          { kind: 'receivable', id: 'inv-900', expectedDate: '2026-06-12' },
        ],
      })
    );
    const body = await res.json();

    // Partial success is a 200 WITH the report — not a failure, and not a
    // pretend-success either.
    expect(res.status).toBe(200);
    expect(body.movedCount).toBe(3);
    expect(body.refusedCount).toBe(3);

    // The movable rows really moved…
    expect(scheduleRows.find((r) => r.id === 's1')!.scheduledDate).toBe('2026-06-19');
    expect(scheduleRows.find((r) => r.id === 's2')!.scheduledDate).toBe('2026-06-22');
    expect(taskRows[0].dueDate).toBe('2026-06-19');

    // …and the report keeps SUBMISSION ORDER, so a report never has to be
    // aligned by hand against what was ticked.
    expect(body.results.map((r: { status: string }) => r.status)).toEqual([
      'moved',
      'refused',
      'moved',
      'refused',
      'moved',
      'refused',
    ]);
    // Each refusal still carries its own sentence.
    expect(body.results[1].reason).toBe(IMMOVABLE_REASONS.warranty);
    expect(body.results[3].reason).toBe(IMMOVABLE_REASONS.calibration);
    expect(body.results[5].reason).toBe(IMMOVABLE_REASONS.receivable);
  });

  it('"moving everything" is impossible: no immovable kind reaches an UPDATE', async () => {
    scriptTx([{ id: 's1', scheduledDate: '2026-06-12', status: 'pending' }]);
    await RESCHEDULE(
      post({
        mode: 'set',
        targetDate: '2027-01-01',
        items: [
          { kind: 'schedule', id: 's1', expectedDate: '2026-06-12' },
          { kind: 'warranty', id: 'eq-1', expectedDate: '2026-06-12' },
          { kind: 'calibration', id: 'eq-1', expectedDate: '2026-06-12' },
          { kind: 'receivable', id: 'inv-1', expectedDate: '2026-06-12' },
        ],
      })
    );
    const updates = allSql().filter((s) => /^UPDATE/i.test(s));
    // Exactly one UPDATE for four submitted items.
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatch(/^UPDATE service_schedules SET scheduledDate = \? WHERE id = \?/);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// The UI and the API decide this with the SAME function
// ════════════════════════════════════════════════════════════════════════════

describe('the greyed checkbox and the API refusal come from one function', () => {
  it('the string the table renders is byte-for-byte the string the API returns', async () => {
    // 1. What the SEARCH hands the table for a warranty row.
    topQuery.mockImplementation((sql: string) => {
      const flat = String(sql).replace(/\s+/g, ' ');
      if (/COUNT\(\*\)/.test(flat)) return Promise.resolve([[{ cnt: 1 }]]);
      if (/FROM customer_equipments e LEFT JOIN customers/.test(flat) && /warrantyEndDate IS NOT NULL/.test(flat)) {
        return Promise.resolve([
          [
            {
              id: 'eq-500',
              warrantyEndDate: '2026-06-12',
              status: 'Active',
              serialNumber: 'SN-1',
              productName: 'Analyzer',
              customerName: 'ลูกค้า ก',
              companyName: 'บริษัท ก',
              warrantyAlertEnabled: 1,
            },
          ],
        ]);
      }
      return Promise.resolve([[]]);
    });
    const searchRes = await SEARCH(get('?from=2026-06-12&to=2026-06-12'));
    const search = await searchRes.json();
    const tableRow = search.warranties.rows[0];

    expect(tableRow.movable).toBe(false);
    expect(tableRow.immovableCode).toBe('immovable_fact');

    // 2. What the RESCHEDULE route says about the very same row.
    topQuery.mockReset().mockImplementation(() => Promise.resolve([[]]));
    scriptTx([]);
    const res = await RESCHEDULE(
      post({
        mode: 'shift',
        shiftDays: 7,
        items: [{ kind: 'warranty', id: 'eq-500', expectedDate: '2026-06-12' }],
      })
    );
    const report = await res.json();

    // Same sentence, same code, from `evaluateMovability` on both sides. If the
    // two ever drifted, an admin would tick a box and be refused with wording
    // he had never seen.
    expect(report.results[0].reason).toBe(tableRow.immovableReason);
    expect(report.results[0].code).toBe(tableRow.immovableCode);
    expect(tableRow.immovableReason).toBe(IMMOVABLE_REASONS.warranty);
  });

  it('the panel imports the shared rule instead of re-testing `kind` by hand', async () => {
    const { readFileSync } = await import('node:fs');
    const path = await import('node:path');
    const src = readFileSync(
      path.join(process.cwd(), 'app/components/AlertDateSearchPanel.tsx'),
      'utf8'
    );
    expect(src).toContain('isRowMovable');
    expect(src).toContain('selectAllPlan');
    // No second, hand-written copy of the rule in the browser. Comments are
    // stripped first: the panel DOCUMENTS the rule it refuses to duplicate, and
    // a prose mention of `kind === "warranty"` is the opposite of the defect.
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter((line) => !/^\s*(\/\/|\*)/.test(line))
      .join('\n');
    expect(code).not.toMatch(/kind\s*===\s*['"]warranty['"]/);
    expect(code).not.toMatch(/kind\s*===\s*['"]calibration['"]/);
    expect(code).not.toMatch(/kind\s*===\s*['"]receivable['"]/);
    // The panel also never derives movability from a status string by hand.
    expect(code).not.toMatch(/status\s*===\s*['"]completed['"]/);
    expect(code).not.toMatch(/status\s*===\s*['"]done['"]/);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 4. THE ARITHMETIC
// ════════════════════════════════════════════════════════════════════════════

describe('the arithmetic, end to end through the route', () => {
  const YYYYMMDD = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

  it('+7 across 31 Jan, across 31 Dec, onto 29 Feb (leap) and past it (non-leap)', async () => {
    const { scheduleRows } = scriptTx([
      { id: 'monthEnd', scheduledDate: '2026-01-31', status: 'pending' },
      { id: 'yearEnd', scheduledDate: '2026-12-31', status: 'pending' },
      { id: 'leap', scheduledDate: '2028-02-22', status: 'pending' },
      { id: 'nonLeap', scheduledDate: '2027-02-22', status: 'pending' },
    ]);
    await RESCHEDULE(
      post({
        mode: 'shift',
        shiftDays: 7,
        items: [
          { kind: 'schedule', id: 'monthEnd', expectedDate: '2026-01-31' },
          { kind: 'schedule', id: 'yearEnd', expectedDate: '2026-12-31' },
          { kind: 'schedule', id: 'leap', expectedDate: '2028-02-22' },
          { kind: 'schedule', id: 'nonLeap', expectedDate: '2027-02-22' },
        ],
      })
    );
    const by = (id: string) => scheduleRows.find((r) => r.id === id)!.scheduledDate;

    expect(by('monthEnd')).toBe('2026-02-07'); // Jan has 31 days
    expect(by('yearEnd')).toBe('2027-01-07'); // the YEAR rolls, not just the month
    expect(by('leap')).toBe('2028-02-29'); // 2028 HAS a 29 Feb
    expect(by('nonLeap')).toBe('2027-03-01'); // 2027 does NOT — it skips to March

    // Every value written to a column that is compared LEXICALLY is a
    // zero-padded four-digit-year date. "2026-2-7" would sort before
    // "2026-12-31" and poison every range query that reads the column.
    const written = allSql()
      .map((s, i) => ({ s, p: conn.query.mock.calls[i - topQuery.mock.calls.length]?.[1] }))
      .filter((e) => /^UPDATE/i.test(e.s));
    for (const row of scheduleRows) expect(row.scheduledDate).toMatch(YYYYMMDD);
    expect(written.length).toBeGreaterThan(0);
  });

  it('-30 days reaches into the past, across a year start', async () => {
    const { scheduleRows } = scriptTx([
      { id: 'a', scheduledDate: '2026-01-15', status: 'pending' },
      { id: 'b', scheduledDate: '2026-03-15', status: 'pending' },
    ]);
    await RESCHEDULE(
      post({
        mode: 'shift',
        shiftDays: -30,
        items: [
          { kind: 'schedule', id: 'a', expectedDate: '2026-01-15' },
          { kind: 'schedule', id: 'b', expectedDate: '2026-03-15' },
        ],
      })
    );
    expect(scheduleRows[0].scheduledDate).toBe('2025-12-16'); // back over new year
    expect(scheduleRows[1].scheduledDate).toBe('2026-02-13'); // Feb 2026 = 28 days
    for (const r of scheduleRows) expect(r.scheduledDate).toMatch(YYYYMMDD);
  });

  it('a shift of 0 is refused by the route — nothing is written at all', async () => {
    const { scheduleRows } = scriptTx([
      { id: 'a', scheduledDate: '2026-01-15', status: 'pending' },
    ]);
    const res = await RESCHEDULE(
      post({
        mode: 'shift',
        shiftDays: 0,
        items: [{ kind: 'schedule', id: 'a', expectedDate: '2026-01-15' }],
      })
    );
    expect(res.status).toBe(400);
    // A shift of 0 must not be reported as "12 รายการ unchanged" — it is a
    // request that means nothing, and the screen has to say so.
    expect((await res.json()).error).toContain('0');
    expect(scheduleRows[0].scheduledDate).toBe('2026-01-15');
    expect(allSql().filter((s) => /^UPDATE/i.test(s))).toHaveLength(0);
  });

  it('the pure function agrees with the route on every boundary, and pads', () => {
    const cases: Array<[string, number, string]> = [
      ['2026-01-31', 7, '2026-02-07'],
      ['2026-12-31', 7, '2027-01-07'],
      ['2028-02-22', 7, '2028-02-29'],
      ['2027-02-22', 7, '2027-03-01'],
      ['2028-02-29', 1, '2028-03-01'],
      ['2026-01-15', -30, '2025-12-16'],
      ['2026-03-01', -1, '2026-02-28'],
      ['2028-03-01', -1, '2028-02-29'],
      ['2026-08-28', 7, '2026-09-04'], // the padding case: never "2026-9-4"
    ];
    for (const [from, days, expected] of cases) {
      const got = computeTargetDate('shift', { matchedDate: from }, { shiftDays: days });
      expect(got).toBe(expected);
      expect(got).toMatch(YYYYMMDD);
    }
    // Zero is not a move.
    expect(computeTargetDate('shift', { matchedDate: '2026-01-31' }, { shiftDays: 0 })).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 6. ATTACK IT
// ════════════════════════════════════════════════════════════════════════════

describe('attacks on the bulk edit', () => {
  it('an empty selection is refused before the transaction opens', async () => {
    const res = await RESCHEDULE(post({ mode: 'shift', shiftDays: 7, items: [] }));
    expect(res.status).toBe(400);
    expect(runTransaction).not.toHaveBeenCalled();
  });

  it('items missing entirely, or not an array, is refused the same way', async () => {
    for (const items of [undefined, null, 'all', 42, { 0: 'x' }]) {
      const res = await RESCHEDULE(post({ mode: 'shift', shiftDays: 7, items }));
      expect(res.status).toBe(400);
    }
    expect(runTransaction).not.toHaveBeenCalled();
  });

  it('a range whose end is before its start is refused, NOT silently swapped', async () => {
    const res = await SEARCH(get('?from=2026-06-30&to=2026-06-01'));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('กลับหัว');
    // Swapping would hand back a result for a range nobody asked for.
    expect(topQuery).not.toHaveBeenCalled();
  });

  it('a malformed date issues no query and never falls back to "today"', async () => {
    for (const qs of [
      '?from=12/06/2026&to=12/06/2026',
      '?from=2026-6-1&to=2026-06-30',
      '?from=yesterday&to=today',
      '?to=2026-06-30',
      '',
    ]) {
      const res = await SEARCH(get(qs));
      expect(res.status).toBe(400);
    }
    expect(topQuery).not.toHaveBeenCalled();
  });

  it('a 1000-year range is refused, naming the cap and the width it was given', async () => {
    const res = await SEARCH(get('?from=1026-01-01&to=2026-01-01'));
    expect(res.status).toBe(400);
    const error = (await res.json()).error;
    expect(error).toContain('366');
    // The width it was actually given, so the refusal is not a riddle. 1000
    // years inclusive = 365244 days (242 leap years in 1026-2026).
    expect(error).toContain('365244');
    expect(topQuery).not.toHaveBeenCalled();
  });

  it('an id that does not exist is `not_found`, and the others still move', async () => {
    const { scheduleRows } = scriptTx([
      { id: 's1', scheduledDate: '2026-06-12', status: 'pending' },
    ]);
    const body = await (
      await RESCHEDULE(
        post({
          mode: 'shift',
          shiftDays: 7,
          items: [
            { kind: 'schedule', id: 'ghost', expectedDate: '2026-06-12' },
            { kind: 'schedule', id: 's1', expectedDate: '2026-06-12' },
          ],
        })
      )
    ).json();
    expect(body.results[0].code).toBe('not_found');
    expect(body.results[1].status).toBe('moved');
    expect(scheduleRows[0].scheduledDate).toBe('2026-06-19');
  });

  it('an id of the wrong TYPE never crashes and never matches a row', async () => {
    scriptTx([{ id: 's1', scheduledDate: '2026-06-12', status: 'pending' }]);
    const res = await RESCHEDULE(
      post({
        mode: 'shift',
        shiftDays: 7,
        items: [
          { kind: 'schedule', id: 12345, expectedDate: '2026-06-12' },
          { kind: 'schedule', id: null, expectedDate: '2026-06-12' },
          { kind: 'schedule', id: { evil: true }, expectedDate: '2026-06-12' },
          { kind: 'schedule', id: ['a', 'b'], expectedDate: '2026-06-12' },
          { kind: 42, id: 's1', expectedDate: '2026-06-12' },
          'not an object at all',
        ],
      })
    );
    // No 500. Every junk item is classified, not thrown on.
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.results).toHaveLength(6);
    expect(body.movedCount).toBe(0);
    for (const r of body.results) expect(r.status).toBe('refused');
    // A numeric-looking kind is an unknown kind, refused as a fact.
    expect(body.results[4].code).toBe('immovable_fact');
  });

  it('a duplicated id is moved ONCE — the second copy is refused as stale', async () => {
    const { scheduleRows } = scriptTx([
      { id: 's1', scheduledDate: '2026-06-12', status: 'pending' },
    ]);
    const body = await (
      await RESCHEDULE(
        post({
          mode: 'shift',
          shiftDays: 7,
          items: [
            { kind: 'schedule', id: 's1', expectedDate: '2026-06-12' },
            { kind: 'schedule', id: 's1', expectedDate: '2026-06-12' },
            { kind: 'schedule', id: 's1', expectedDate: '2026-06-12' },
          ],
        })
      )
    ).json();
    // +7 once, NOT +21.
    expect(scheduleRows[0].scheduledDate).toBe('2026-06-19');
    expect(body.movedCount).toBe(1);
    expect(body.refusedCount).toBe(2);
    expect(allSql().filter((s) => /^UPDATE/i.test(s))).toHaveLength(1);
  });

  it('a row already completed is refused even though the client insisted', async () => {
    const { scheduleRows, taskRows } = scriptTx(
      [
        { id: 'done1', scheduledDate: '2026-06-12', status: 'completed' },
        { id: 'cancel1', scheduledDate: '2026-06-12', status: 'cancelled' },
      ],
      [{ id: 't1', dueDate: '2026-06-12', status: 'done' }]
    );
    const body = await (
      await RESCHEDULE(
        post({
          mode: 'shift',
          shiftDays: 7,
          items: [
            { kind: 'schedule', id: 'done1', expectedDate: '2026-06-12' },
            { kind: 'schedule', id: 'cancel1', expectedDate: '2026-06-12' },
            { kind: 'task', id: 't1', expectedDate: '2026-06-12' },
          ],
        })
      )
    ).json();
    // The verdict comes from the status READ FROM THE DATABASE, not from
    // anything the client claimed about the row.
    expect(body.results.every((r: { code: string }) => r.code === 'closed')).toBe(true);
    expect(scheduleRows[0].scheduledDate).toBe('2026-06-12');
    expect(scheduleRows[1].scheduledDate).toBe('2026-06-12');
    expect(taskRows[0].dueDate).toBe('2026-06-12');
    expect(allSql().filter((s) => /^UPDATE/i.test(s))).toHaveLength(0);
  });

  it('select-all on a result full of immovable rows ticks only what can move', () => {
    const row = (kind: string, id: string, status: string, date = '2026-06-12') =>
      ({
        kind,
        id,
        status,
        matchedDate: date,
        ...evaluateMovability({ kind, status, matchedDate: date }),
        immovableReason: evaluateMovability({ kind, status, matchedDate: date }).reason,
        immovableCode: evaluateMovability({ kind, status, matchedDate: date }).code,
      }) as unknown as DatedAlertRow;

    const rows = [
      row('schedule', 's1', 'pending'),
      row('warranty', 'eq1', 'Active'),
      row('calibration', 'eq2', 'Active'),
      row('receivable', 'inv1', 'unpaid'),
      row('schedule', 's2', 'completed'),
      row('task', 't1', 'pending'),
      row('task', 't2', 'pending', ''), // no due date
      row('customer_call', 's3', 'pending'),
    ];

    const plan = selectAllPlan(rows, 'all');
    expect(plan.scopeCount).toBe(8);
    expect(plan.eligibleCount).toBe(3);
    expect(plan.ids).toEqual(['s1', 't1', 's3']);
    // Ticking a row that will later be refused teaches an admin to stop reading
    // warnings, so select-all never ticks one.
    expect(plan.ids).not.toContain('eq1');
    expect(plan.ids).not.toContain('inv1');
    expect(plan.ids).not.toContain('s2');
    expect(plan.ids).not.toContain('t2');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 5. IDEMPOTENCE — through the ROUTE, with a real retrying withTransaction
// ════════════════════════════════════════════════════════════════════════════

describe('replay safety with a withTransaction that really retries', () => {
  it('a committed-then-lost-ack replay leaves the data shifted exactly once', async () => {
    const rows = [
      { id: 's1', scheduledDate: '2026-06-12', status: 'pending' },
      { id: 's2', scheduledDate: '2026-06-19', status: 'pending' },
    ];
    conn.query.mockImplementation((sql: string, params: unknown[] = []) => {
      const flat = String(sql).replace(/\s+/g, ' ');
      if (/^SELECT id, scheduledDate, status FROM service_schedules/.test(flat)) {
        return Promise.resolve([
          rows.filter((r) => params.includes(r.id)).map((r) => ({ ...r })),
        ]);
      }
      if (/^UPDATE service_schedules/.test(flat)) {
        const row = rows.find((r) => r.id === params[1]);
        if (row) row.scheduledDate = String(params[0]);
        return Promise.resolve([{ affectedRows: 1 }]);
      }
      return Promise.resolve([[]]);
    });

    // db.ts: `await fn(conn)` then commit throws PROTOCOL_CONNECTION_LOST, the
    // work having actually landed; the loop replays the SAME callback.
    let attempts = 0;
    runTransaction.mockImplementation(async (fn: (c: typeof conn) => Promise<unknown>) => {
      attempts++;
      await fn(conn); // attempt 1 — committed, ack lost
      attempts++;
      return fn(conn); // attempt 2 — the replay
    });

    const body = await (
      await RESCHEDULE(
        post({
          mode: 'shift',
          shiftDays: 7,
          items: [
            { kind: 'schedule', id: 's1', expectedDate: '2026-06-12' },
            { kind: 'schedule', id: 's2', expectedDate: '2026-06-19' },
          ],
        })
      )
    ).json();

    expect(attempts).toBe(2); // the replay really happened
    expect(rows[0].scheduledDate).toBe('2026-06-19'); // +7 — never +14
    expect(rows[1].scheduledDate).toBe('2026-06-26'); // +7 — never +14
    // The report is rebuilt per attempt: 2 items in, 2 results out, not 4.
    expect(body.results).toHaveLength(2);
    expect(body.results.every((r: { code: string }) => r.code === 'stale')).toBe(true);
  });

  it('three attempts still shift once — the guard does not decay with retries', async () => {
    const rows = [{ id: 's1', scheduledDate: '2026-06-12', status: 'pending' }];
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
    runTransaction.mockImplementation(async (fn: (c: typeof conn) => Promise<unknown>) => {
      await fn(conn);
      await fn(conn);
      return fn(conn); // MAX_ATTEMPTS in db.ts is 3
    });

    await RESCHEDULE(
      post({
        mode: 'shift',
        shiftDays: 7,
        items: [{ kind: 'schedule', id: 's1', expectedDate: '2026-06-12' }],
      })
    );
    expect(rows[0].scheduledDate).toBe('2026-06-19'); // not 2026-07-03
    expect(allSql().filter((s) => /^UPDATE/i.test(s))).toHaveLength(1);
  });

  it('a UI-level retry of the same request cannot double-shift either', async () => {
    // The admin's browser loses the response and he clicks "เลื่อนวัน" again
    // with the SAME expectedDate values (he has not re-searched). This is the
    // realistic version of the bug, and it must fail closed.
    const rows = [{ id: 's1', scheduledDate: '2026-06-12', status: 'pending' }];
    const script = () =>
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

    const body = { mode: 'shift', shiftDays: 7, items: [{ kind: 'schedule', id: 's1', expectedDate: '2026-06-12' }] };
    script();
    await RESCHEDULE(post(body));
    expect(rows[0].scheduledDate).toBe('2026-06-19');

    script();
    const second = await RESCHEDULE(post(body));
    expect(rows[0].scheduledDate).toBe('2026-06-19'); // STILL +7, not +14
    expect(second.status).toBe(400);
    expect((await second.json()).results[0].code).toBe('stale');
  });
});

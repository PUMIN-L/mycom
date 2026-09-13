// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// The database is mocked at the driver boundary, NOT at the store boundary, on
// purpose: the central claim of this feature — that the reschedule path can
// write exactly two columns — is only worth anything if it is proved from the
// SQL that actually reaches the driver. Mocking the store would let the route
// pass this file while writing anything it liked.
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
import { BULK_RESCHEDULE_MAX_ITEMS, DATE_SEARCH_MAX_RANGE_DAYS } from '@/app/lib/alertDateSearch';

const admin = { userId: '1', username: 'admin', expiresAt: new Date() } as never;

const sqlOf = (call: unknown[]) => String(call[0]).replace(/\s+/g, ' ');
/** Every statement that reached the driver, from both the pool and the tx. */
const allSql = () => [
  ...topQuery.mock.calls.map(sqlOf),
  ...conn.query.mock.calls.map(sqlOf),
];
const updates = () => allSql().filter((s) => /^UPDATE/i.test(s));

function searchRequest(qs: string) {
  return new NextRequest(`http://localhost:3000/api/admin/alerts/search${qs}`);
}
function rescheduleRequest(body: unknown) {
  return new NextRequest('http://localhost:3000/api/admin/alerts/reschedule', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** An in-memory service_schedules / crm_tasks pair for the transaction. */
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
// GET /api/admin/alerts/search
// ════════════════════════════════════════════════════════════════════════════

describe('GET /api/admin/alerts/search', () => {
  it('401s for anonymous, before any query', async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    const res = await SEARCH(searchRequest('?from=2026-06-12&to=2026-06-12'));
    expect(res.status).toBe(401);
    expect(allSql()).toHaveLength(0);
  });

  it('returns all six categories, each with rows and a true total', async () => {
    const res = await SEARCH(searchRequest('?from=2026-06-12&to=2026-06-12'));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.from).toBe('2026-06-12');
    expect(body.to).toBe('2026-06-12');
    for (const key of [
      'schedules',
      'customerCalls',
      'tasks',
      'warranties',
      'calibrations',
      'receivables',
    ]) {
      expect(body[key], key).toEqual({ rows: [], total: 0 });
    }
  });

  it('finds last month`s appointment — the case the feed cannot show at all', async () => {
    topQuery.mockImplementation((sql: string) => {
      const flat = String(sql).replace(/\s+/g, ' ');
      if (/COUNT\(\*\)/.test(flat)) return Promise.resolve([[{ cnt: 1 }]]);
      if (/FROM service_schedules s /.test(flat) && /s\.equipmentId IS NOT NULL/.test(flat)) {
        return Promise.resolve([
          [{ id: 's1', scheduledDate: '2026-05-11', status: 'pending', scheduleType: 'service', equipmentId: 'e1' }],
        ]);
      }
      return Promise.resolve([[]]);
    });

    const res = await SEARCH(searchRequest('?from=2026-05-11&to=2026-05-11'));
    const body = await res.json();
    // The feed's schedule query has no lower bound at all, so this row is
    // invisible there. Here it comes back, movable, with no reason attached.
    expect(body.schedules.rows[0].id).toBe('s1');
    expect(body.schedules.rows[0].movable).toBe(true);
    expect(body.schedules.rows[0].immovableReason).toBeNull();
  });

  it('computes movable/immovableReason server-side, so the table cannot disagree', async () => {
    topQuery.mockImplementation((sql: string) => {
      const flat = String(sql).replace(/\s+/g, ' ');
      if (/COUNT\(\*\)/.test(flat)) return Promise.resolve([[{ cnt: 1 }]]);
      if (/e\.warrantyEndDate BETWEEN/.test(flat)) {
        return Promise.resolve([
          [{ id: 'e1', warrantyEndDate: '2026-06-12', status: 'Active', warrantyAlertEnabled: 1, productName: 'pH Meter' }],
        ]);
      }
      return Promise.resolve([[]]);
    });
    const res = await SEARCH(searchRequest('?from=2026-06-12&to=2026-06-12'));
    const row = (await res.json()).warranties.rows[0];
    expect(row.movable).toBe(false);
    expect(row.immovableCode).toBe('immovable_fact');
    expect(row.immovableReason).toMatch(/[฀-๿]/);
    // Names a real way out, never a bare "cannot be edited".
    expect(row.immovableReason).toContain('ข้อมูลเครื่อง');
  });

  const badRanges: Array<[string, string]> = [
    ['inverted range', '?from=2026-06-20&to=2026-06-12'],
    ['range wider than the cap', '?from=2026-01-01&to=2027-02-04'],
    ['day-first format', '?from=12-06-2026&to=2026-06-12'],
    ['unpadded month/day', '?from=2026-6-12&to=2026-06-12'],
    ['missing from', '?to=2026-06-12'],
    ['missing to', '?from=2026-06-12'],
    ['both missing', ''],
  ];

  it.each(badRanges)('400s on %s, in Thai, with NO query issued', async (_label, qs) => {
    const res = await SEARCH(searchRequest(qs));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/[฀-๿]/);
    // It must not quietly fall back to "today" and answer a question nobody
    // asked.
    expect(allSql()).toHaveLength(0);
  });

  it('names the cap and the requested width when the range is too wide', async () => {
    const res = await SEARCH(searchRequest('?from=2026-01-01&to=2027-02-04'));
    const { error } = await res.json();
    expect(error).toContain(String(DATE_SEARCH_MAX_RANGE_DAYS));
    expect(error).toContain('400');
  });

  it('accepts a single day and searches exactly that day, never a month', async () => {
    await SEARCH(searchRequest('?from=2026-06-12&to=2026-06-12'));
    for (const call of topQuery.mock.calls) {
      const params = call[1] as unknown[];
      const dates = params.filter((p) => typeof p === 'string');
      // Both ends of every range are the SAME day. A search for one day that
      // returns a month is the failure this asserts against.
      expect(dates).toEqual(['2026-06-12', '2026-06-12']);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// POST /api/admin/alerts/reschedule
// ════════════════════════════════════════════════════════════════════════════

describe('POST /api/admin/alerts/reschedule — envelope validation', () => {
  it('401s for anonymous, before any statement', async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    const res = await RESCHEDULE(
      rescheduleRequest({ mode: 'shift', shiftDays: 7, items: [{ kind: 'schedule', id: 's1', expectedDate: '2026-06-12' }] })
    );
    expect(res.status).toBe(401);
    expect(allSql()).toHaveLength(0);
  });

  const badEnvelopes: Array<[string, unknown]> = [
    ['unknown mode', { mode: 'teleport', items: [{ kind: 'schedule', id: 's1', expectedDate: '2026-06-12' }] }],
    ['missing mode', { items: [{ kind: 'schedule', id: 's1', expectedDate: '2026-06-12' }] }],
    ['items not an array', { mode: 'shift', shiftDays: 7, items: 'all of them' }],
    ['items empty', { mode: 'shift', shiftDays: 7, items: [] }],
    ['missing items', { mode: 'shift', shiftDays: 7 }],
    ['set with a malformed date', { mode: 'set', targetDate: '12-06-2026', items: [{ kind: 'schedule', id: 's1', expectedDate: '2026-06-12' }] }],
    ['set with an unpadded date', { mode: 'set', targetDate: '2026-6-12', items: [{ kind: 'schedule', id: 's1', expectedDate: '2026-06-12' }] }],
    ['set with no date', { mode: 'set', items: [{ kind: 'schedule', id: 's1', expectedDate: '2026-06-12' }] }],
    ['shift of 0', { mode: 'shift', shiftDays: 0, items: [{ kind: 'schedule', id: 's1', expectedDate: '2026-06-12' }] }],
    ['shift past the cap', { mode: 'shift', shiftDays: 4000, items: [{ kind: 'schedule', id: 's1', expectedDate: '2026-06-12' }] }],
    ['negative shift past the cap', { mode: 'shift', shiftDays: -4000, items: [{ kind: 'schedule', id: 's1', expectedDate: '2026-06-12' }] }],
    ['non-integer shift', { mode: 'shift', shiftDays: 1.5, items: [{ kind: 'schedule', id: 's1', expectedDate: '2026-06-12' }] }],
    ['non-numeric shift', { mode: 'shift', shiftDays: 'seven', items: [{ kind: 'schedule', id: 's1', expectedDate: '2026-06-12' }] }],
  ];

  it.each(badEnvelopes)('400s on %s, in Thai, writing nothing', async (_label, body) => {
    const res = await RESCHEDULE(rescheduleRequest(body));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/[฀-๿]/);
    // A malformed envelope is a PLAIN 400 — there is no per-item report to
    // give when the request itself does not parse.
    expect(json.results).toBeUndefined();
    expect(updates()).toHaveLength(0);
  });

  it('400s on a body that is not JSON at all', async () => {
    const req = new NextRequest('http://localhost:3000/api/admin/alerts/reschedule', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json',
    });
    const res = await RESCHEDULE(req);
    expect(res.status).toBe(400);
    expect(updates()).toHaveLength(0);
  });

  it('REFUSES an over-cap batch outright — never does the first 200 of 201', async () => {
    const items = Array.from({ length: BULK_RESCHEDULE_MAX_ITEMS + 1 }, (_, i) => ({
      kind: 'schedule',
      id: `s${i}`,
      expectedDate: '2026-06-12',
    }));
    const res = await RESCHEDULE(rescheduleRequest({ mode: 'shift', shiftDays: 7, items }));

    expect(res.status).toBe(400);
    const { error } = await res.json();
    expect(error).toContain(String(BULK_RESCHEDULE_MAX_ITEMS));
    expect(error).toContain('201');
    // Silent truncation is the worst possible answer here: the admin reads
    // "สำเร็จ", walks away believing all 201 moved, and finds out by missing
    // an appointment. Not one statement is issued.
    expect(allSql()).toHaveLength(0);
    expect(runTransaction).not.toHaveBeenCalled();
  });

  it('accepts a batch exactly at the cap', async () => {
    const rows = Array.from({ length: BULK_RESCHEDULE_MAX_ITEMS }, (_, i) => ({
      id: `s${i}`,
      scheduledDate: '2026-06-12',
      status: 'pending',
    }));
    scriptTx(rows);
    const res = await RESCHEDULE(
      rescheduleRequest({
        mode: 'shift',
        shiftDays: 7,
        items: rows.map((r) => ({ kind: 'schedule', id: r.id, expectedDate: '2026-06-12' })),
      })
    );
    expect(res.status).toBe(200);
    expect((await res.json()).movedCount).toBe(BULK_RESCHEDULE_MAX_ITEMS);
  });
});

describe('POST /api/admin/alerts/reschedule — the refusal that matters', () => {
  it('moves the schedules, refuses the fact rows, and returns 200 with a report', async () => {
    const { scheduleRows } = scriptTx([
      { id: 's1', scheduledDate: '2026-06-12', status: 'pending' },
      { id: 's2', scheduledDate: '2026-06-13', status: 'pending' },
    ]);

    const res = await RESCHEDULE(
      rescheduleRequest({
        mode: 'shift',
        shiftDays: 7,
        items: [
          { kind: 'schedule', id: 's1', expectedDate: '2026-06-12' },
          { kind: 'warranty', id: 'e1', expectedDate: '2026-06-12' },
          { kind: 'receivable', id: 'b1', expectedDate: '2026-06-12' },
          { kind: 'schedule', id: 's2', expectedDate: '2026-06-13' },
        ],
      })
    );

    // Partial success is success, with a report attached.
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.movedCount).toBe(2);
    expect(body.refusedCount).toBe(2);
    expect(body.unchangedCount).toBe(0);
    expect(scheduleRows[0].scheduledDate).toBe('2026-06-19');
    expect(scheduleRows[1].scheduledDate).toBe('2026-06-20');

    expect(body.results[1]).toMatchObject({ status: 'refused', code: 'immovable_fact' });
    expect(body.results[2]).toMatchObject({ status: 'refused', code: 'immovable_fact' });
    expect(body.results[1].reason).toMatch(/[฀-๿]/);
    expect(body.results[2].reason).toContain('/billing/receivables');
  });

  it('PROVES from the issued SQL that neither fact table is ever written', async () => {
    // This is the test the spec's central requirement rests on. The greyed
    // checkbox is a courtesy; this is the control.
    scriptTx(
      [{ id: 's1', scheduledDate: '2026-06-12', status: 'pending' }],
      [{ id: 't1', dueDate: '2026-06-12', status: 'pending' }]
    );
    await RESCHEDULE(
      rescheduleRequest({
        mode: 'set',
        targetDate: '2026-07-01',
        items: [
          { kind: 'schedule', id: 's1', expectedDate: '2026-06-12' },
          { kind: 'task', id: 't1', expectedDate: '2026-06-12' },
          { kind: 'warranty', id: 'e1', expectedDate: '2026-06-12' },
          { kind: 'calibration', id: 'e2', expectedDate: '2027-06-12' },
          { kind: 'receivable', id: 'b1', expectedDate: '2026-06-12' },
        ],
      })
    );

    // No statement on this path names either table — not even a SELECT.
    for (const sql of allSql()) {
      expect(sql).not.toContain('customer_equipments');
      expect(sql).not.toContain('billing_documents');
    }
    // And the only writes are the two permitted columns.
    expect(updates()).toEqual([
      "UPDATE service_schedules SET scheduledDate = ? WHERE id = ? AND status = 'pending' AND scheduledDate = ?",
      "UPDATE crm_tasks SET dueDate = ? WHERE id = ? AND status = 'pending' AND dueDate = ?",
    ]);
  });

  it('the route source contains no write to either fact table', () => {
    // Belt and braces, and cheap: the runtime assertion above can only prove
    // what these particular inputs exercised. This one reads the shipped files
    // and proves the statement does not exist to be reached.
    const files = [
      'app/api/admin/alerts/reschedule/route.ts',
      'app/lib/alertSearchStore.ts',
    ];
    for (const file of files) {
      const source = readFileSync(path.join(process.cwd(), file), 'utf8');
      // Strip comments: both files EXPLAIN this rule in prose, and the prose
      // must not be what satisfies (or breaks) the assertion.
      const code = source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      expect(code, file).not.toMatch(/UPDATE\s+customer_equipments/i);
      expect(code, file).not.toMatch(/UPDATE\s+billing_documents/i);
      expect(code, file).not.toMatch(/INSERT\s+INTO\s+customer_equipments/i);
      expect(code, file).not.toMatch(/INSERT\s+INTO\s+billing_documents/i);
      expect(code, file).not.toMatch(/DELETE\s+FROM\s+customer_equipments/i);
      expect(code, file).not.toMatch(/DELETE\s+FROM\s+billing_documents/i);
    }
  });

  it('400s with the SAME body shape when every item was refused', async () => {
    scriptTx([{ id: 's1', scheduledDate: '2026-06-12', status: 'completed' }]);
    const res = await RESCHEDULE(
      rescheduleRequest({
        mode: 'shift',
        shiftDays: 7,
        items: [
          { kind: 'warranty', id: 'e1', expectedDate: '2026-06-12' },
          { kind: 'schedule', id: 's1', expectedDate: '2026-06-12' },
        ],
      })
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    // Same shape as success, so the screen renders reasons rather than a
    // generic error — and certainly not a success toast for a batch where
    // nothing happened.
    expect(body.movedCount).toBe(0);
    expect(body.refusedCount).toBe(2);
    expect(body.results).toHaveLength(2);
    expect(body.results.every((r: { reason: string }) => /[฀-๿]/.test(r.reason))).toBe(true);
    expect(body.error).toBeUndefined();
    expect(updates()).toHaveLength(0);
  });

  it('refuses a closed row per item while moving the rest', async () => {
    const { scheduleRows, taskRows } = scriptTx(
      [
        { id: 's1', scheduledDate: '2026-06-12', status: 'completed' },
        { id: 's2', scheduledDate: '2026-06-12', status: 'cancelled' },
        { id: 's3', scheduledDate: '2026-06-12', status: 'pending' },
      ],
      [{ id: 't1', dueDate: '2026-06-12', status: 'done' }]
    );
    const res = await RESCHEDULE(
      rescheduleRequest({
        mode: 'shift',
        shiftDays: 7,
        items: [
          { kind: 'schedule', id: 's1', expectedDate: '2026-06-12' },
          { kind: 'schedule', id: 's2', expectedDate: '2026-06-12' },
          { kind: 'task', id: 't1', expectedDate: '2026-06-12' },
          { kind: 'schedule', id: 's3', expectedDate: '2026-06-12' },
        ],
      })
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results.map((r: { code: string | null }) => r.code)).toEqual([
      'closed',
      'closed',
      'closed',
      null,
    ]);
    // The reason for a done task points at the way back.
    expect(body.results[2].reason).toContain('เปิดใหม่');
    expect(scheduleRows[0].scheduledDate).toBe('2026-06-12'); // untouched
    expect(taskRows[0].dueDate).toBe('2026-06-12'); // untouched
    expect(scheduleRows[2].scheduledDate).toBe('2026-06-19'); // moved
  });

  it('refuses no_date, not_found and stale individually, in submission order', async () => {
    scriptTx(
      [{ id: 's1', scheduledDate: '2026-06-20', status: 'pending' }],
      [{ id: 't1', dueDate: null, status: 'pending' }]
    );
    const res = await RESCHEDULE(
      rescheduleRequest({
        mode: 'shift',
        shiftDays: 7,
        items: [
          { kind: 'task', id: 't1', expectedDate: '' },
          { kind: 'schedule', id: 'ghost', expectedDate: '2026-06-12' },
          { kind: 'schedule', id: 's1', expectedDate: '2026-06-12' },
        ],
      })
    );

    expect(res.status).toBe(400); // everything refused
    const body = await res.json();
    expect(body.results.map((r: { code: string }) => r.code)).toEqual([
      'no_date',
      'not_found',
      'stale',
    ]);
    // The stale reason tells him what to do about it.
    expect(body.results[2].reason).toContain('ค้นหาใหม่');
    expect(updates()).toHaveLength(0);
  });

  it('refuses an unknown kind per item and never 500s', async () => {
    scriptTx([{ id: 's1', scheduledDate: '2026-06-12', status: 'pending' }]);
    const res = await RESCHEDULE(
      rescheduleRequest({
        mode: 'shift',
        shiftDays: 7,
        items: [
          { kind: 'made_up', id: 'x1', expectedDate: '2026-06-12' },
          { kind: 'schedule', id: 's1', expectedDate: '2026-06-12' },
        ],
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results[0].code).toBe('immovable_fact');
    expect(body.results[1].status).toBe('moved');
  });

  it('reports unchanged separately from moved, so the summary cannot lie', async () => {
    scriptTx([
      { id: 's1', scheduledDate: '2026-06-12', status: 'pending' },
      { id: 's2', scheduledDate: '2026-07-01', status: 'pending' },
    ]);
    const res = await RESCHEDULE(
      rescheduleRequest({
        mode: 'set',
        targetDate: '2026-07-01',
        items: [
          { kind: 'schedule', id: 's1', expectedDate: '2026-06-12' },
          { kind: 'schedule', id: 's2', expectedDate: '2026-07-01' },
        ],
      })
    );
    const body = await res.json();
    expect(body.movedCount).toBe(1);
    expect(body.unchangedCount).toBe(1);
    // "ย้ายแล้ว 1 · ไม่เปลี่ยนแปลง 1 · ย้ายไม่ได้ 0" — three numbers, not one
    // word.
    expect(body.refusedCount).toBe(0);
    expect(updates()).toHaveLength(1);
  });

  it('a batch that is entirely unchanged is a 200, not an error', async () => {
    // Nothing was refused and nothing needed moving. That is a true and
    // unremarkable outcome, not a failure to report as one.
    scriptTx([{ id: 's1', scheduledDate: '2026-07-01', status: 'pending' }]);
    const res = await RESCHEDULE(
      rescheduleRequest({
        mode: 'set',
        targetDate: '2026-07-01',
        items: [{ kind: 'schedule', id: 's1', expectedDate: '2026-07-01' }],
      })
    );
    expect(res.status).toBe(200);
    expect((await res.json()).unchangedCount).toBe(1);
  });

  it('a mid-batch failure rolls back and reports nothing as moved', async () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({
      id: `s${i}`,
      scheduledDate: '2026-06-12',
      status: 'pending',
    }));
    let writes = 0;
    conn.query.mockImplementation((sql: string, params: unknown[] = []) => {
      const flat = String(sql).replace(/\s+/g, ' ');
      if (/^SELECT id, scheduledDate, status FROM service_schedules/.test(flat)) {
        return Promise.resolve([rows.filter((r) => params.includes(r.id))]);
      }
      if (/^UPDATE service_schedules/.test(flat)) {
        if (writes++ === 2) return Promise.reject(new Error('boom at row 3'));
        return Promise.resolve([{ affectedRows: 1 }]);
      }
      return Promise.resolve([[]]);
    });

    const res = await RESCHEDULE(
      rescheduleRequest({
        mode: 'shift',
        shiftDays: 7,
        items: rows.map((r) => ({ kind: 'schedule', id: r.id, expectedDate: '2026-06-12' })),
      })
    );

    // The error propagates out of the transaction, everything rolls back, and
    // withRoute turns it into a 500 with the Thai fallback — never a partial
    // success message.
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('เลื่อนวันที่ของรายการที่เลือกไม่สำเร็จ');
    expect(body.movedCount).toBeUndefined();
  });

  it('never touches alert_snoozes, service_logs, or any status column', async () => {
    scriptTx(
      [{ id: 's1', scheduledDate: '2026-06-12', status: 'pending' }],
      [{ id: 't1', dueDate: '2026-06-12', status: 'pending' }]
    );
    await RESCHEDULE(
      rescheduleRequest({
        mode: 'shift',
        shiftDays: 7,
        items: [
          { kind: 'schedule', id: 's1', expectedDate: '2026-06-12' },
          { kind: 'task', id: 't1', expectedDate: '2026-06-12' },
        ],
      })
    );
    for (const sql of allSql()) {
      // Moving a date is not cancelling a snooze — the snooze rows are left
      // exactly as they were, on purpose.
      expect(sql).not.toContain('alert_snoozes');
      expect(sql).not.toContain('service_logs');
      expect(sql).not.toContain('completedAt');
    }
  });
});

// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const conn = { query: vi.fn() };
const topQuery = vi.fn();
vi.mock('@/app/lib/db', () => ({
  query: (...args: unknown[]) => topQuery(...args),
  withTransaction: vi.fn(async (fn: (c: typeof conn) => Promise<unknown>) => fn(conn)),
}));

import {
  addExpense,
  updateExpense,
  deleteExpense,
  getExpense,
  addRecurringExpense,
  updateRecurringExpense,
  deleteRecurringExpense,
  getRecurringExpense,
  listRecurringExpenses,
  generateExpensesForMonth,
} from '@/app/lib/expenseStore';

beforeEach(() => {
  vi.clearAllMocks();
  conn.query.mockReset();
  topQuery.mockReset();
});

describe('addExpense / getExpense / updateExpense / deleteExpense', () => {
  it('inserts a sanitized row and returns it via a follow-up read', async () => {
    topQuery
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // INSERT
      .mockResolvedValueOnce([[{ id: 'e1', title: 'ค่าเช่า', amount: '15000.00', expenseDate: '2026-09-01', category: 'ค่าเช่า', note: '', createdAt: 'x' }]]); // getExpense

    const result = await addExpense({ title: '<b>ค่าเช่า</b>', amount: 15000, expenseDate: '2026-09-01', category: 'ค่าเช่า' });
    expect(result.title).toBe('ค่าเช่า'); // HTML stripped
    const insertCall = topQuery.mock.calls[0];
    expect(insertCall[0]).toContain('INSERT INTO expenses');
  });

  it('falls back to today when expenseDate is malformed', async () => {
    topQuery.mockResolvedValue([{ affectedRows: 1 }]);
    await addExpense({ title: 'x', amount: 1, expenseDate: 'not-a-date' });
    const [, params] = topQuery.mock.calls[0];
    expect(params[3]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('clamps a negative amount to 0', async () => {
    topQuery.mockResolvedValue([{ affectedRows: 1 }]);
    await addExpense({ title: 'x', amount: -50, expenseDate: '2026-09-01' });
    const [, params] = topQuery.mock.calls[0];
    expect(params[2]).toBe(0);
  });

  it('updateExpense returns null for a missing id without writing', async () => {
    topQuery.mockResolvedValueOnce([[]]); // getExpense finds nothing
    const result = await updateExpense('missing', { title: 'x' });
    expect(result).toBeNull();
    expect(topQuery).toHaveBeenCalledTimes(1);
  });

  it('deleteExpense reports whether a row was actually removed', async () => {
    topQuery.mockResolvedValue([{ affectedRows: 1 }]);
    expect(await deleteExpense('e1')).toBe(true);
    topQuery.mockResolvedValue([{ affectedRows: 0 }]);
    expect(await deleteExpense('missing')).toBe(false);
  });

  it('getExpense returns null when the row does not exist', async () => {
    topQuery.mockResolvedValue([[]]);
    expect(await getExpense('missing')).toBeNull();
  });
});

describe('recurring expense templates', () => {
  const row = (over: Record<string, unknown> = {}) => ({
    id: 'r1',
    title: 'ค่าเช่าออฟฟิศ',
    amount: '15000.00',
    category: 'ค่าเช่า',
    note: '',
    active: 1,
    lastGeneratedMonth: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...over,
  });

  it('addRecurringExpense inserts with lastGeneratedMonth NULL and normalizes the returned row', async () => {
    topQuery
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([[row()]]);

    const result = await addRecurringExpense({ title: 'ค่าเช่าออฟฟิศ', amount: 15000, category: 'ค่าเช่า' });
    expect(result.active).toBe(true); // coerced from DB's 1/0
    expect(result.lastGeneratedMonth).toBeNull();
    const insertSql = topQuery.mock.calls[0][0];
    expect(insertSql).toContain('INSERT INTO recurring_expenses');
    expect(insertSql).toContain('NULL');
  });

  it('updateRecurringExpense merges onto the existing row', async () => {
    topQuery
      .mockResolvedValueOnce([[row()]]) // existing
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // UPDATE
      .mockResolvedValueOnce([[row({ amount: '16000.00' })]]); // re-read

    const result = await updateRecurringExpense('r1', { amount: 16000 });
    expect(result?.amount).toBe(16000);
    const updateCall = topQuery.mock.calls[1];
    expect(updateCall[0]).toContain('UPDATE recurring_expenses SET');
  });

  it('updateRecurringExpense returns null for a missing template', async () => {
    topQuery.mockResolvedValueOnce([[]]);
    expect(await updateRecurringExpense('missing', { amount: 1 })).toBeNull();
  });

  it('deleteRecurringExpense reports success/failure by affected rows', async () => {
    topQuery.mockResolvedValue([{ affectedRows: 1 }]);
    expect(await deleteRecurringExpense('r1')).toBe(true);
    topQuery.mockResolvedValue([{ affectedRows: 0 }]);
    expect(await deleteRecurringExpense('missing')).toBe(false);
  });

  it('listRecurringExpenses normalizes every row', async () => {
    topQuery.mockResolvedValue([[row({ id: 'r1', active: 1 }), row({ id: 'r2', active: 0 })]]);
    const list = await listRecurringExpenses();
    expect(list.map((r) => r.active)).toEqual([true, false]);
  });
});

describe('generateExpensesForMonth', () => {
  it('creates one expense per active template not yet generated this month, atomically with the claim', async () => {
    topQuery.mockResolvedValueOnce([[
      { id: 'r1', title: 'ค่าเช่า', amount: '15000.00', category: 'ค่าเช่า', note: '', active: 1, lastGeneratedMonth: null, createdAt: 'x' },
      { id: 'r2', title: 'เงินเดือน', amount: '30000.00', category: 'เงินเดือน', note: '', active: 1, lastGeneratedMonth: null, createdAt: 'x' },
    ]]); // listRecurringExpenses
    conn.query.mockResolvedValue([{ affectedRows: 1 }]);

    const result = await generateExpensesForMonth('2026-09');

    expect(result.generated).toHaveLength(2);
    expect(result.skippedAlreadyGenerated).toEqual([]);
    expect(result.skippedInactive).toBe(0);
    expect(result.failed).toEqual([]);

    // Each template: one claim UPDATE, one INSERT into expenses.
    expect(conn.query).toHaveBeenCalledTimes(4);
    const insertCalls = conn.query.mock.calls.filter(([sql]) => String(sql).includes('INSERT INTO expenses'));
    expect(insertCalls).toHaveLength(2);
    expect(insertCalls[0][1]).toEqual(
      expect.arrayContaining(['ค่าเช่า', 15000, '2026-09-01', 'ค่าเช่า', '', 'r1'])
    );
  });

  it('skips an inactive template (no transaction attempted) and a template the claim UPDATE reports as already generated', async () => {
    topQuery.mockResolvedValueOnce([[
      { id: 'r1', title: 'ปิดใช้งาน', amount: '100.00', category: '', note: '', active: 0, lastGeneratedMonth: null, createdAt: 'x' },
      { id: 'r2', title: 'ทำไปแล้ว', amount: '100.00', category: '', note: '', active: 1, lastGeneratedMonth: '2026-09', createdAt: 'x' },
    ]]);
    // The claim UPDATE's WHERE excludes rows already generated this month,
    // so it affects 0 rows for r2 — that's what actually decides the skip,
    // not the in-memory lastGeneratedMonth snapshot.
    conn.query.mockResolvedValue([{ affectedRows: 0 }]);

    const result = await generateExpensesForMonth('2026-09');

    expect(result.generated).toEqual([]);
    expect(result.skippedInactive).toBe(1);
    expect(result.skippedAlreadyGenerated).toEqual(['ทำไปแล้ว']);
    expect(result.failed).toEqual([]);
    // r1 (inactive) never enters a transaction; r2 only runs the claim UPDATE
    // (no INSERT, since the claim lost).
    expect(conn.query).toHaveBeenCalledTimes(1);
  });

  it('treats a claim affecting 0 rows as already-generated even when the in-memory template still looks fresh (concurrent-caller safety)', async () => {
    // Simulates a race: another concurrent generate() call already committed
    // its claim for this exact template+month between listRecurringExpenses()
    // reading lastGeneratedMonth: null here and this call's own UPDATE.
    topQuery.mockResolvedValueOnce([[
      { id: 'r1', title: 'ค่าเช่า', amount: '15000.00', category: '', note: '', active: 1, lastGeneratedMonth: null, createdAt: 'x' },
    ]]);
    conn.query.mockResolvedValue([{ affectedRows: 0 }]);

    const result = await generateExpensesForMonth('2026-09');

    expect(result.generated).toEqual([]);
    expect(result.skippedAlreadyGenerated).toEqual(['ค่าเช่า']);
    // Only the claim ran — losing it must never fall through to an INSERT,
    // which is exactly what would create a duplicate expense row.
    expect(conn.query).toHaveBeenCalledTimes(1);
  });

  it('is safe to call twice in a row for the same month — the second call skips via the atomic claim', async () => {
    // First call: template is fresh, the claim UPDATE succeeds.
    topQuery.mockResolvedValueOnce([[
      { id: 'r1', title: 'ค่าเช่า', amount: '15000.00', category: '', note: '', active: 1, lastGeneratedMonth: null, createdAt: 'x' },
    ]]);
    conn.query.mockResolvedValue([{ affectedRows: 1 }]);
    const first = await generateExpensesForMonth('2026-09');
    expect(first.generated).toHaveLength(1);

    // Second call: the real DB row now has lastGeneratedMonth set, so the
    // claim UPDATE affects 0 rows this time.
    topQuery.mockResolvedValueOnce([[
      { id: 'r1', title: 'ค่าเช่า', amount: '15000.00', category: '', note: '', active: 1, lastGeneratedMonth: '2026-09', createdAt: 'x' },
    ]]);
    conn.query.mockReset();
    conn.query.mockResolvedValue([{ affectedRows: 0 }]);
    const second = await generateExpensesForMonth('2026-09');
    expect(second.generated).toEqual([]);
    expect(second.skippedAlreadyGenerated).toEqual(['ค่าเช่า']);
  });

  it('records a per-template failure without losing or aborting the rest of the batch', async () => {
    topQuery.mockResolvedValueOnce([[
      { id: 'r1', title: 'ค่าเช่า', amount: '15000.00', category: '', note: '', active: 1, lastGeneratedMonth: null, createdAt: 'x' },
      { id: 'r2', title: 'เงินเดือน', amount: '30000.00', category: '', note: '', active: 1, lastGeneratedMonth: null, createdAt: 'x' },
    ]]);
    conn.query
      .mockRejectedValueOnce(new Error('transient DB error')) // r1's claim throws
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // r2's claim succeeds
      .mockResolvedValueOnce([{ affectedRows: 1 }]); // r2's insert succeeds

    const result = await generateExpensesForMonth('2026-09');

    expect(result.failed).toEqual(['ค่าเช่า']);
    expect(result.generated).toEqual([{ id: expect.any(String), title: 'เงินเดือน', amount: 30000 }]);
  });
});

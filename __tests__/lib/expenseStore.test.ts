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
  /** Scripts one transaction connection against a tiny in-memory world.
   *  `expenses` holds the (recurringExpenseId, expenseDate) pairs that already
   *  exist; `missingTemplates` are ids whose recurring_expenses row is gone. */
  function mockTxWorld(world: {
    expenses?: { recurringExpenseId: string; expenseDate: string }[];
    missingTemplates?: string[];
  }) {
    const expenses = [...(world.expenses ?? [])];
    const missing = new Set(world.missingTemplates ?? []);

    conn.query.mockImplementation((sql: string, params: unknown[] = []) => {
      const text = String(sql);
      if (text.includes('FROM recurring_expenses') && text.includes('FOR UPDATE')) {
        const id = String(params[0]);
        return Promise.resolve([missing.has(id) ? [] : [{ id }]]);
      }
      if (text.includes('SELECT id FROM expenses')) {
        const [templateId, date] = params as string[];
        const hit = expenses.filter(
          (e) => e.recurringExpenseId === templateId && e.expenseDate === date
        );
        return Promise.resolve([hit.map(() => ({ id: 'existing' }))]);
      }
      if (text.includes('INSERT INTO expenses')) {
        // params: id, title, amount, expenseDate, category, note, createdAt, recurringExpenseId
        expenses.push({
          recurringExpenseId: String(params[7]),
          expenseDate: String(params[3]),
        });
        return Promise.resolve([{ affectedRows: 1 }]);
      }
      return Promise.resolve([{ affectedRows: 1 }]);
    });

    return expenses;
  }

  const template = (over: Record<string, unknown> = {}) => ({
    id: 'r1',
    title: 'ค่าเช่า',
    amount: '15000.00',
    category: 'ค่าเช่า',
    note: '',
    active: 1,
    lastGeneratedMonth: null,
    createdAt: 'x',
    ...over,
  });

  it('creates one expense per active template not yet generated for the month', async () => {
    topQuery.mockResolvedValueOnce([[
      template(),
      template({ id: 'r2', title: 'เงินเดือน', amount: '30000.00', category: 'เงินเดือน' }),
    ]]); // listRecurringExpenses
    mockTxWorld({});

    const result = await generateExpensesForMonth('2026-09');

    expect(result.generated).toHaveLength(2);
    expect(result.skippedAlreadyGenerated).toEqual([]);
    expect(result.skippedInactive).toBe(0);
    expect(result.failed).toEqual([]);

    const insertCalls = conn.query.mock.calls.filter(([sql]) =>
      String(sql).includes('INSERT INTO expenses')
    );
    expect(insertCalls).toHaveLength(2);
    expect(insertCalls[0][1]).toEqual(
      expect.arrayContaining(['ค่าเช่า', 15000, '2026-09-01', 'ค่าเช่า', '', 'r1'])
    );
  });

  it('skips an inactive template without opening a transaction at all', async () => {
    topQuery.mockResolvedValueOnce([[template({ title: 'ปิดใช้งาน', active: 0 })]]);
    mockTxWorld({});

    const result = await generateExpensesForMonth('2026-09');

    expect(result.generated).toEqual([]);
    expect(result.skippedInactive).toBe(1);
    expect(conn.query).not.toHaveBeenCalled();
  });

  it('decides "already generated" from the expenses ROW, not from lastGeneratedMonth', async () => {
    // The marker says a DIFFERENT month, which under the old guard was the
    // whole test — here the row for this month exists, and that is what counts.
    topQuery.mockResolvedValueOnce([[template({ title: 'ทำไปแล้ว', lastGeneratedMonth: '2026-11' })]]);
    mockTxWorld({ expenses: [{ recurringExpenseId: 'r1', expenseDate: '2026-09-01' }] });

    const result = await generateExpensesForMonth('2026-09');

    expect(result.generated).toEqual([]);
    expect(result.skippedAlreadyGenerated).toEqual(['ทำไปแล้ว']);
    expect(
      conn.query.mock.calls.filter(([sql]) => String(sql).includes('INSERT INTO expenses'))
    ).toHaveLength(0);
  });

  it('BACKFILLING AUGUST AFTER SEPTEMBER MUST NOT DUPLICATE SEPTEMBER', async () => {
    // The bug this guard replaced: lastGeneratedMonth holds ONE month, so
    // backfilling August overwrote the "2026-09" marker with "2026-08" and
    // re-armed September. A third call then inserted a SECOND 2026-09-01 row
    // for the same template — `expenses` has no unique key on
    // (recurringExpenseId, expenseDate), so nothing rejected it and the month
    // was silently double-counted on the dashboard.
    const world = mockTxWorld({});

    // 1. September.
    topQuery.mockResolvedValueOnce([[template()]]);
    expect((await generateExpensesForMonth('2026-09')).generated).toHaveLength(1);

    // 2. Backfill August. The marker in the real DB is now "2026-09"; the
    //    template row we read back reflects that.
    topQuery.mockResolvedValueOnce([[template({ lastGeneratedMonth: '2026-09' })]]);
    expect((await generateExpensesForMonth('2026-08')).generated).toHaveLength(1);

    // 3. September again — the step that used to insert the duplicate.
    topQuery.mockResolvedValueOnce([[template({ lastGeneratedMonth: '2026-09' })]]);
    const third = await generateExpensesForMonth('2026-09');
    expect(third.generated).toEqual([]);
    expect(third.skippedAlreadyGenerated).toEqual(['ค่าเช่า']);

    // Exactly one row per month, and no third row anywhere.
    expect(world).toEqual([
      { recurringExpenseId: 'r1', expenseDate: '2026-09-01' },
      { recurringExpenseId: 'r1', expenseDate: '2026-08-01' },
    ]);
  });

  it('never rewinds lastGeneratedMonth when an older month is backfilled', async () => {
    // The marker is a DISPLAY hint now ("latest month generated" — /expenses
    // badges the current month with it). Rewinding it to 2026-08 made the
    // September badge disappear as well as re-arming the duplicate.
    topQuery.mockResolvedValueOnce([[template({ lastGeneratedMonth: '2026-09' })]]);
    mockTxWorld({});

    await generateExpensesForMonth('2026-08');

    const markerCall = conn.query.mock.calls.find(([sql]) =>
      String(sql).includes('SET lastGeneratedMonth')
    )!;
    expect(String(markerCall[0])).toContain('lastGeneratedMonth < ?');
    expect(String(markerCall[0])).not.toContain('lastGeneratedMonth != ?');
    expect(markerCall[1]).toEqual(['2026-08', 'r1', '2026-08']);
  });

  it('takes the template row lock BEFORE it looks for the expense row', async () => {
    // That ordering is the whole concurrency story: two callers for the same
    // template serialize on the lock, so the loser sees the winner's committed
    // row instead of inserting a second one.
    topQuery.mockResolvedValueOnce([[template()]]);
    mockTxWorld({});

    await generateExpensesForMonth('2026-09');

    const order = conn.query.mock.calls.map(([sql]) => String(sql));
    const lockAt = order.findIndex((sql) => sql.includes('FOR UPDATE'));
    const checkAt = order.findIndex((sql) => sql.includes('SELECT id FROM expenses'));
    const insertAt = order.findIndex((sql) => sql.includes('INSERT INTO expenses'));
    expect(lockAt).toBeGreaterThanOrEqual(0);
    expect(lockAt).toBeLessThan(checkAt);
    expect(checkAt).toBeLessThan(insertAt);
  });

  it('is safe under a withTransaction retry whose first attempt actually committed', async () => {
    // withTransaction retries its callback on a transient connection loss,
    // INCLUDING after a commit whose acknowledgement was lost. The retry must
    // re-read the expenses table and skip, not insert a second row.
    topQuery.mockResolvedValueOnce([[template()]]);
    const world = mockTxWorld({});

    const { withTransaction } = await import('@/app/lib/db');
    vi.mocked(withTransaction).mockImplementationOnce(async (fn: any) => {
      await fn(conn); // first attempt: commits, ack lost
      return fn(conn); // retry
    });

    const result = await generateExpensesForMonth('2026-09');

    expect(world).toEqual([{ recurringExpenseId: 'r1', expenseDate: '2026-09-01' }]);
    expect(result.generated).toEqual([]);
    expect(result.skippedAlreadyGenerated).toEqual(['ค่าเช่า']);
  });

  it('reports a template deleted mid-run as a failure, never as "already generated"', async () => {
    topQuery.mockResolvedValueOnce([[template({ title: 'ถูกลบไปแล้ว' })]]);
    mockTxWorld({ missingTemplates: ['r1'] });
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await generateExpensesForMonth('2026-09');

    expect(result.generated).toEqual([]);
    expect(result.skippedAlreadyGenerated).toEqual([]);
    expect(result.failed).toEqual(['ถูกลบไปแล้ว']);
  });

  it('records a per-template failure without losing or aborting the rest of the batch', async () => {
    topQuery.mockResolvedValueOnce([[
      template(),
      template({ id: 'r2', title: 'เงินเดือน', amount: '30000.00' }),
    ]]);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    conn.query
      .mockRejectedValueOnce(new Error('transient DB error')) // r1's lock throws
      .mockResolvedValueOnce([[{ id: 'r2' }]]) // r2 locks
      .mockResolvedValueOnce([[]]) // r2 has no row for this month
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // r2 inserts
      .mockResolvedValueOnce([{ affectedRows: 1 }]); // r2's marker

    const result = await generateExpensesForMonth('2026-09');

    expect(result.failed).toEqual(['ค่าเช่า']);
    expect(result.generated).toEqual([
      { id: expect.any(String), title: 'เงินเดือน', amount: 30000 },
    ]);
  });
});

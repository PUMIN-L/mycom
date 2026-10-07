// @vitest-environment node
/**
 * POST / PUT /api/admin/expenses — the amount and the date are CHECKED, never
 * quietly fixed. expenseStore's own fallbacks turned "abc" into a ฿0 expense,
 * "1e3" into ฿1,000, a negative into ฿0, and a date that does not exist into
 * today, all with a 201. The money rule is the one every other amount uses
 * (lib/moneyAmount.ts parsePositiveMoney).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/admin/expenses/route';
import { PUT } from '@/app/api/admin/expenses/[id]/route';

vi.mock('@/app/lib/expenseStore', () => ({
  addExpense: vi.fn(async (data: unknown) => ({ id: 'e1', ...(data as object) })),
  listExpenses: vi.fn(),
  updateExpense: vi.fn(async (_id: string, data: unknown) => ({ id: 'e1', ...(data as object) })),
  deleteExpense: vi.fn(),
}));
import { addExpense, updateExpense } from '@/app/lib/expenseStore';

vi.mock('@/app/lib/session', () => ({ getSession: vi.fn() }));
import { getSession } from '@/app/lib/session';

const req = (url: string, method: string, body: unknown) =>
  new NextRequest(url, {
    method,
    headers: { origin: 'http://localhost:3000', host: 'localhost:3000' },
    body: JSON.stringify(body),
  });
const ctx = { params: Promise.resolve({ id: 'e1' }) };
const VALID = { title: 'ค่าไฟ', amount: 1500, expenseDate: '2026-10-01' };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSession).mockResolvedValue({ userId: '1', username: 'admin', expiresAt: new Date() } as never);
});

describe('POST /api/admin/expenses', () => {
  it('saves a valid expense, the amount settled to the satang', async () => {
    const res = await POST(req('http://localhost:3000/api/admin/expenses', 'POST', { ...VALID, amount: '1500.005' }));
    expect(res.status).toBe(201);
    expect(addExpense).toHaveBeenCalledWith(expect.objectContaining({ amount: 1500.01 }));
  });

  it.each([['abc'], ['1e3'], [-50], [0], [''], [null]])('refuses amount %s instead of guessing', async (amount) => {
    const res = await POST(req('http://localhost:3000/api/admin/expenses', 'POST', { ...VALID, amount }));
    expect(res.status).toBe(400);
    expect(addExpense).not.toHaveBeenCalled();
  });

  it.each([['2026-02-30'], ['2026-13-01'], ['01/10/2026'], [20261001]])('refuses date %s instead of saving today', async (expenseDate) => {
    const res = await POST(req('http://localhost:3000/api/admin/expenses', 'POST', { ...VALID, expenseDate }));
    expect(res.status).toBe(400);
    expect(addExpense).not.toHaveBeenCalled();
  });
});

describe('PUT /api/admin/expenses/[id]', () => {
  it('checks what is sent, and leaves out what is not', async () => {
    expect((await PUT(req('http://localhost:3000/api/admin/expenses/e1', 'PUT', { title: 'ค่าน้ำ' }), ctx)).status).toBe(200);
    expect(updateExpense).toHaveBeenLastCalledWith('e1', { title: 'ค่าน้ำ' });

    expect((await PUT(req('http://localhost:3000/api/admin/expenses/e1', 'PUT', { amount: '1e3' }), ctx)).status).toBe(400);
    expect((await PUT(req('http://localhost:3000/api/admin/expenses/e1', 'PUT', { expenseDate: '2026-02-30' }), ctx)).status).toBe(400);
    expect(updateExpense).toHaveBeenCalledTimes(1);

    expect((await PUT(req('http://localhost:3000/api/admin/expenses/e1', 'PUT', { amount: '99.999' }), ctx)).status).toBe(200);
    expect(updateExpense).toHaveBeenLastCalledWith('e1', { amount: 100 });
  });
});

// Every text field is text: a number or an object reached the sanitizer in
// expenseStore and came back as a bare 500, and an edit could blank the title
// the create form requires.
describe('expense text fields', () => {
  it.each([
    [{ ...VALID, title: 5 }],
    [{ ...VALID, title: '   ' }],
    [{ ...VALID, category: 7 }],
    [{ ...VALID, note: { a: 1 } }],
    [null],
    [[VALID]],
  ])('POST refuses %j with 400 — nothing saved', async (body) => {
    const res = await POST(req('http://localhost:3000/api/admin/expenses', 'POST', body));
    expect(res.status).toBe(400);
    expect(addExpense).not.toHaveBeenCalled();
  });

  it('POST accepts a missing or null category and note', async () => {
    expect((await POST(req('http://localhost:3000/api/admin/expenses', 'POST', { ...VALID, category: null, note: null }))).status).toBe(201);
  });

  it('PUT may leave the title out, but may not blank it or send it as a number', async () => {
    const put = (body: unknown) => PUT(req('http://localhost:3000/api/admin/expenses/e1', 'PUT', body), ctx);
    expect((await put({ note: 'x' })).status).toBe(200);
    expect((await put({ title: '' })).status).toBe(400);
    expect((await put({ title: 5 })).status).toBe(400);
    expect((await put({ category: [] })).status).toBe(400);
    expect(updateExpense).toHaveBeenCalledTimes(1);
  });
});

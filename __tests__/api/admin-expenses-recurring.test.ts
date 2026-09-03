// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST } from '@/app/api/admin/expenses/recurring/route';
import { PUT, DELETE } from '@/app/api/admin/expenses/recurring/[id]/route';
import { POST as generatePOST } from '@/app/api/admin/expenses/recurring/generate/route';

vi.mock('@/app/lib/expenseStore', () => ({
  addRecurringExpense: vi.fn(),
  updateRecurringExpense: vi.fn(),
  deleteRecurringExpense: vi.fn(),
  listRecurringExpenses: vi.fn(),
  generateExpensesForMonth: vi.fn(),
}));
import {
  addRecurringExpense,
  updateRecurringExpense,
  deleteRecurringExpense,
  listRecurringExpenses,
  generateExpensesForMonth,
} from '@/app/lib/expenseStore';

vi.mock('@/app/lib/session', () => ({ getSession: vi.fn() }));
import { getSession } from '@/app/lib/session';

const adminSession = { userId: '1', username: 'admin', expiresAt: new Date() } as any;
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

const req = (url: string, method: string, body?: any) =>
  new NextRequest(url, {
    method,
    headers: { origin: 'http://localhost:3000', host: 'localhost:3000' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSession).mockResolvedValue(adminSession);
});

describe('GET /api/admin/expenses/recurring', () => {
  it('rejects anonymous callers with 401', async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it('returns the template list for an admin', async () => {
    vi.mocked(listRecurringExpenses).mockResolvedValue([{ id: 'r1' }] as any);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ id: 'r1' }]);
  });
});

describe('POST /api/admin/expenses/recurring', () => {
  const body = { title: 'ค่าเช่า', amount: 15000, category: 'ค่าเช่า' };

  it('rejects a missing title', async () => {
    const res = await POST(req('http://localhost:3000/api/admin/expenses/recurring', 'POST', { amount: 100 }));
    expect(res.status).toBe(400);
    expect(addRecurringExpense).not.toHaveBeenCalled();
  });

  it('rejects a zero/negative amount', async () => {
    const res = await POST(req('http://localhost:3000/api/admin/expenses/recurring', 'POST', { title: 'x', amount: 0 }));
    expect(res.status).toBe(400);
    expect(addRecurringExpense).not.toHaveBeenCalled();
  });

  it('rejects a non-numeric amount instead of silently treating it as 0', async () => {
    const res = await POST(req('http://localhost:3000/api/admin/expenses/recurring', 'POST', { title: 'x', amount: 'abc' }));
    expect(res.status).toBe(400);
    expect(addRecurringExpense).not.toHaveBeenCalled();
  });

  it('creates a template and returns 201', async () => {
    vi.mocked(addRecurringExpense).mockResolvedValue({ id: 'r1', ...body } as any);
    const res = await POST(req('http://localhost:3000/api/admin/expenses/recurring', 'POST', body));
    expect(res.status).toBe(201);
    expect(addRecurringExpense).toHaveBeenCalledWith(body);
  });
});

describe('PUT /api/admin/expenses/recurring/[id]', () => {
  it('rejects a zero/negative amount', async () => {
    const res = await PUT(
      req('http://localhost:3000/api/admin/expenses/recurring/r1', 'PUT', { amount: -1 }),
      ctx('r1')
    );
    expect(res.status).toBe(400);
    expect(updateRecurringExpense).not.toHaveBeenCalled();
  });

  it('rejects a non-numeric amount instead of silently treating it as 0', async () => {
    const res = await PUT(
      req('http://localhost:3000/api/admin/expenses/recurring/r1', 'PUT', { amount: 'abc' }),
      ctx('r1')
    );
    expect(res.status).toBe(400);
    expect(updateRecurringExpense).not.toHaveBeenCalled();
  });

  it('404s when the template does not exist', async () => {
    vi.mocked(updateRecurringExpense).mockResolvedValue(null);
    const res = await PUT(
      req('http://localhost:3000/api/admin/expenses/recurring/missing', 'PUT', { title: 'x' }),
      ctx('missing')
    );
    expect(res.status).toBe(404);
  });

  it('updates and returns the template', async () => {
    vi.mocked(updateRecurringExpense).mockResolvedValue({ id: 'r1', amount: 16000 } as any);
    const res = await PUT(
      req('http://localhost:3000/api/admin/expenses/recurring/r1', 'PUT', { amount: 16000 }),
      ctx('r1')
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: 'r1', amount: 16000 });
  });
});

describe('DELETE /api/admin/expenses/recurring/[id]', () => {
  it('404s when nothing was deleted', async () => {
    vi.mocked(deleteRecurringExpense).mockResolvedValue(false);
    const res = await DELETE(req('http://localhost:3000/api/admin/expenses/recurring/missing', 'DELETE'), ctx('missing'));
    expect(res.status).toBe(404);
  });

  it('succeeds when a row was removed', async () => {
    vi.mocked(deleteRecurringExpense).mockResolvedValue(true);
    const res = await DELETE(req('http://localhost:3000/api/admin/expenses/recurring/r1', 'DELETE'), ctx('r1'));
    expect(res.status).toBe(200);
  });
});

describe('POST /api/admin/expenses/recurring/generate', () => {
  it('defaults to the current Bangkok month when no month is given', async () => {
    vi.mocked(generateExpensesForMonth).mockResolvedValue({
      month: '2026-09',
      generated: [],
      skippedAlreadyGenerated: [],
      skippedInactive: 0,
      failed: [],
    });
    const res = await generatePOST(req('http://localhost:3000/api/admin/expenses/recurring/generate', 'POST', {}));
    expect(res.status).toBe(200);
    expect(generateExpensesForMonth).toHaveBeenCalledWith(expect.stringMatching(/^\d{4}-(0[1-9]|1[0-2])$/));
  });

  it('uses an explicitly given month', async () => {
    vi.mocked(generateExpensesForMonth).mockResolvedValue({
      month: '2026-01',
      generated: [],
      skippedAlreadyGenerated: [],
      skippedInactive: 0,
      failed: [],
    });
    await generatePOST(req('http://localhost:3000/api/admin/expenses/recurring/generate', 'POST', { month: '2026-01' }));
    expect(generateExpensesForMonth).toHaveBeenCalledWith('2026-01');
  });

  it('rejects a malformed month', async () => {
    const res = await generatePOST(
      req('http://localhost:3000/api/admin/expenses/recurring/generate', 'POST', { month: 'not-a-month' })
    );
    expect(res.status).toBe(400);
    expect(generateExpensesForMonth).not.toHaveBeenCalled();
  });

  it('rejects a month with an out-of-range month component like 13', async () => {
    const res = await generatePOST(
      req('http://localhost:3000/api/admin/expenses/recurring/generate', 'POST', { month: '2026-13' })
    );
    expect(res.status).toBe(400);
    expect(generateExpensesForMonth).not.toHaveBeenCalled();
  });

  it('surfaces a partial failure to the caller instead of hiding it', async () => {
    vi.mocked(generateExpensesForMonth).mockResolvedValue({
      month: '2026-09',
      generated: [{ id: 'e1', title: 'เงินเดือน', amount: 30000 }],
      skippedAlreadyGenerated: [],
      skippedInactive: 0,
      failed: ['ค่าเช่า'],
    });
    const res = await generatePOST(req('http://localhost:3000/api/admin/expenses/recurring/generate', 'POST', {}));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ failed: ['ค่าเช่า'], generated: [{ id: 'e1', title: 'เงินเดือน', amount: 30000 }] });
  });

  it('rejects anonymous callers with 401', async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    const res = await generatePOST(req('http://localhost:3000/api/admin/expenses/recurring/generate', 'POST', {}));
    expect(res.status).toBe(401);
    expect(generateExpensesForMonth).not.toHaveBeenCalled();
  });
});

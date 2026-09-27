// @vitest-environment node
/**
 * POST /api/billing/[id]/payments — "บันทึกรับชำระ". The ledger itself (the
 * re-sum, voids) is __tests__/lib/billingPayments.test.ts; here, what the
 * route lets through and what amount it hands the store.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/app/lib/billingPayments', () => ({
  addBillingPayment: vi.fn(),
  listBillingPayments: vi.fn(),
}));
import { addBillingPayment, listBillingPayments } from '@/app/lib/billingPayments';

vi.mock('@/app/lib/billingStore', () => ({ getBillingDocument: vi.fn() }));
import { getBillingDocument } from '@/app/lib/billingStore';

vi.mock('@/app/lib/session', () => ({ getSession: vi.fn() }));
import { getSession } from '@/app/lib/session';

import { GET, POST } from '@/app/api/billing/[id]/payments/route';

const admin = { userId: '1', username: 'admin', expiresAt: new Date() } as never;
const ctx = { params: Promise.resolve({ id: 'inv-1' }) };

const post = (body: unknown) =>
  POST(
    new NextRequest('http://localhost/api/billing/inv-1/payments', {
      method: 'POST',
      headers: { origin: 'http://localhost', host: 'localhost' },
      body: JSON.stringify(body),
    }),
    ctx
  );

const valid = { amount: 30000, paidDate: '2026-09-06', method: 'โอนเงิน', ref: 'TRF-991' };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSession).mockResolvedValue(admin);
  vi.mocked(getBillingDocument).mockResolvedValue({ id: 'inv-1', totalAmount: 50000, cancelledAt: null } as never);
  vi.mocked(addBillingPayment).mockImplementation(async (p) => ({ paidAmount: p.amount }));
});

describe('POST /api/billing/[id]/payments', () => {
  it('rejects anonymous callers', async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    expect((await post(valid)).status).toBe(401);
    expect(addBillingPayment).not.toHaveBeenCalled();
  });

  it('records a payment and reports what is still owed', async () => {
    const res = await post(valid);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, paidAmount: 30000, outstanding: 20000 });
    expect(vi.mocked(addBillingPayment).mock.calls[0][0]).toMatchObject({
      billingDocumentId: 'inv-1',
      amount: 30000,
      paidDate: '2026-09-06',
      method: 'โอนเงิน',
      ref: 'TRF-991',
    });
  });

  // The bug: checked "> 0" BEFORE rounding, so 0.004 passed, rounded to 0,
  // and the store refused it — a bare 500 instead of saying what was wrong.
  it.each([0.004, 0.0049, '0.001'])('%p is ฿0.00 once rounded: a 400 that says so, nothing written', async (amount) => {
    const res = await post({ ...valid, amount });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('จำนวนเงินต้องอย่างน้อย 0.01 บาท');
    expect(addBillingPayment).not.toHaveBeenCalled();
  });

  it.each([0, -500, 'abc', '', null, true])('%p is refused', async (amount) => {
    const res = await post({ ...valid, amount });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('จำนวนเงินต้องมากกว่า 0');
    expect(addBillingPayment).not.toHaveBeenCalled();
  });

  it('refuses more than the DECIMAL(12,2) column holds, instead of a database error', async () => {
    const res = await post({ ...valid, amount: 10_000_000_000 });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('สูงเกินไป');
    expect(addBillingPayment).not.toHaveBeenCalled();
  });

  it('hands the store the amount settled to the satang — the one it checked', async () => {
    await post({ ...valid, amount: 1.005 });
    expect(vi.mocked(addBillingPayment).mock.calls[0][0].amount).toBe(1.01);
    await post({ ...valid, amount: '2500.499' });
    expect(vi.mocked(addBillingPayment).mock.calls[1][0].amount).toBe(2500.5);
  });

  it('still allows an overpayment', async () => {
    const res = await post({ ...valid, amount: 60000 });
    expect(res.status).toBe(200);
    expect((await res.json()).outstanding).toBe(0);
  });

  it('404s for a document that does not exist, and 409s for a cancelled one', async () => {
    vi.mocked(getBillingDocument).mockResolvedValueOnce(null as never);
    expect((await post(valid)).status).toBe(404);
    vi.mocked(getBillingDocument).mockResolvedValueOnce({ id: 'inv-1', totalAmount: 1, cancelledAt: '2026-09-01' } as never);
    expect((await post(valid)).status).toBe(409);
    expect(addBillingPayment).not.toHaveBeenCalled();
  });

  it('refuses a malformed date', async () => {
    expect((await post({ ...valid, paidDate: '6/9/2026' })).status).toBe(400);
    expect(addBillingPayment).not.toHaveBeenCalled();
  });
});

describe('GET /api/billing/[id]/payments', () => {
  it('returns the history for an admin, and nothing for anyone else', async () => {
    vi.mocked(listBillingPayments).mockResolvedValue([{ id: 'pay-1' }] as never);
    const res = await GET(new NextRequest('http://localhost/api/billing/inv-1/payments'), ctx);
    expect(await res.json()).toEqual([{ id: 'pay-1' }]);

    vi.mocked(getSession).mockResolvedValue(null);
    expect((await GET(new NextRequest('http://localhost/api/billing/inv-1/payments'), ctx)).status).toBe(401);
  });
});

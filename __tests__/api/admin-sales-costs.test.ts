// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/app/lib/salesDashboardStore', () => ({
  getSalesRecord: vi.fn(),
  getCostItems: vi.fn(),
  addCostItem: vi.fn(),
  updateCostItem: vi.fn(),
  deleteCostItem: vi.fn(),
}));
import {
  getSalesRecord,
  getCostItems,
  addCostItem,
  updateCostItem,
  deleteCostItem,
} from '@/app/lib/salesDashboardStore';

vi.mock('@/app/lib/session', () => ({ getSession: vi.fn() }));
import { getSession } from '@/app/lib/session';

const admin = { userId: '1', username: 'admin', expiresAt: new Date() } as any;
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const costCtx = (id: string, costId: string) => ({ params: Promise.resolve({ id, costId }) });

const req = (url: string, method: string, body?: any) =>
  new NextRequest(url, {
    method,
    headers: { origin: 'http://localhost:3000', host: 'localhost:3000' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

import { GET, POST } from '@/app/api/admin/sales/[id]/costs/route';
import { PUT, DELETE } from '@/app/api/admin/sales/[id]/costs/[costId]/route';

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSession).mockResolvedValue(admin);
  vi.mocked(getSalesRecord).mockResolvedValue({ id: 'sale-1', costAmount: 100 } as any);
});

describe('POST /api/admin/sales/[id]/costs', () => {
  it('rejects anonymous callers with 401', async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    const res = await POST(req('http://localhost:3000/api/admin/sales/sale-1/costs', 'POST', { amount: 100 }), ctx('sale-1'));
    expect(res.status).toBe(401);
  });

  it('rejects a zero/negative amount', async () => {
    const res = await POST(req('http://localhost:3000/api/admin/sales/sale-1/costs', 'POST', { amount: -1 }), ctx('sale-1'));
    expect(res.status).toBe(400);
    expect(addCostItem).not.toHaveBeenCalled();
  });

  it('rejects a non-numeric amount instead of silently treating it as 0', async () => {
    const res = await POST(req('http://localhost:3000/api/admin/sales/sale-1/costs', 'POST', { amount: 'abc' }), ctx('sale-1'));
    expect(res.status).toBe(400);
    expect(addCostItem).not.toHaveBeenCalled();
  });

  it('adds a cost item with a valid amount', async () => {
    vi.mocked(addCostItem).mockResolvedValue({ id: 'ci-1', amount: 100 } as any);
    const res = await POST(req('http://localhost:3000/api/admin/sales/sale-1/costs', 'POST', { amount: 100 }), ctx('sale-1'));
    expect(res.status).toBe(200);
    expect(addCostItem).toHaveBeenCalledWith('sale-1', { amount: 100 });
  });

  // 0.004 was "more than 0" and then a ฿0.00 cost row in DECIMAL(12,2).
  it('refuses an amount that is ฿0.00 once rounded, and stores the rounded amount', async () => {
    const tiny = await POST(req('http://localhost:3000/api/admin/sales/sale-1/costs', 'POST', { amount: 0.004 }), ctx('sale-1'));
    expect(tiny.status).toBe(400);
    expect(addCostItem).not.toHaveBeenCalled();

    vi.mocked(addCostItem).mockResolvedValue({ id: 'ci-1' } as never);
    await POST(req('http://localhost:3000/api/admin/sales/sale-1/costs', 'POST', { label: 'ค่ารถ', amount: 350.555 }), ctx('sale-1'));
    expect(addCostItem).toHaveBeenCalledWith('sale-1', { label: 'ค่ารถ', amount: 350.56 });
  });

  it('404s when the sale does not exist', async () => {
    vi.mocked(getSalesRecord).mockResolvedValue(null);
    const res = await POST(req('http://localhost:3000/api/admin/sales/missing/costs', 'POST', { amount: 100 }), ctx('missing'));
    expect(res.status).toBe(404);
  });
});

describe('PUT /api/admin/sales/[id]/costs/[costId]', () => {
  it('rejects a zero/negative amount', async () => {
    const res = await PUT(
      req('http://localhost:3000/api/admin/sales/sale-1/costs/ci-1', 'PUT', { amount: -5 }),
      costCtx('sale-1', 'ci-1')
    );
    expect(res.status).toBe(400);
    expect(updateCostItem).not.toHaveBeenCalled();
  });

  it('rejects a non-numeric amount instead of silently zeroing it', async () => {
    const res = await PUT(
      req('http://localhost:3000/api/admin/sales/sale-1/costs/ci-1', 'PUT', { amount: 'abc' }),
      costCtx('sale-1', 'ci-1')
    );
    expect(res.status).toBe(400);
    expect(updateCostItem).not.toHaveBeenCalled();
  });

  it('allows updating fields other than amount without requiring it', async () => {
    vi.mocked(updateCostItem).mockResolvedValue({ id: 'ci-1', label: 'ใหม่' } as any);
    const res = await PUT(
      req('http://localhost:3000/api/admin/sales/sale-1/costs/ci-1', 'PUT', { label: 'ใหม่' }),
      costCtx('sale-1', 'ci-1')
    );
    expect(res.status).toBe(200);
    expect(updateCostItem).toHaveBeenCalledWith('sale-1', 'ci-1', { label: 'ใหม่' });
  });

  it('updates with a valid amount', async () => {
    vi.mocked(updateCostItem).mockResolvedValue({ id: 'ci-1', amount: 200 } as any);
    const res = await PUT(
      req('http://localhost:3000/api/admin/sales/sale-1/costs/ci-1', 'PUT', { amount: 200 }),
      costCtx('sale-1', 'ci-1')
    );
    expect(res.status).toBe(200);
  });

  it('refuses an amount that is ฿0.00 once rounded, and stores the rounded amount', async () => {
    const tiny = await PUT(
      req('http://localhost:3000/api/admin/sales/sale-1/costs/ci-1', 'PUT', { amount: '0.001' }),
      costCtx('sale-1', 'ci-1')
    );
    expect(tiny.status).toBe(400);
    expect(updateCostItem).not.toHaveBeenCalled();

    vi.mocked(updateCostItem).mockResolvedValue({ id: 'ci-1' } as never);
    await PUT(req('http://localhost:3000/api/admin/sales/sale-1/costs/ci-1', 'PUT', { amount: 1.005 }), costCtx('sale-1', 'ci-1'));
    expect(updateCostItem).toHaveBeenCalledWith('sale-1', 'ci-1', { amount: 1.01 });
  });

  it('404s when the cost item does not exist', async () => {
    vi.mocked(updateCostItem).mockResolvedValue(null);
    const res = await PUT(
      req('http://localhost:3000/api/admin/sales/sale-1/costs/missing', 'PUT', { amount: 10 }),
      costCtx('sale-1', 'missing')
    );
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/admin/sales/[id]/costs/[costId]', () => {
  it('deletes a cost item — of the sale the URL names', async () => {
    vi.mocked(deleteCostItem).mockResolvedValue(true);
    const res = await DELETE(
      req('http://localhost:3000/api/admin/sales/sale-1/costs/ci-1', 'DELETE'),
      costCtx('sale-1', 'ci-1')
    );
    expect(res.status).toBe(200);
    expect(deleteCostItem).toHaveBeenCalledWith('sale-1', 'ci-1');
  });

  it('404s when nothing was deleted', async () => {
    vi.mocked(deleteCostItem).mockResolvedValue(false);
    const res = await DELETE(
      req('http://localhost:3000/api/admin/sales/sale-1/costs/missing', 'DELETE'),
      costCtx('sale-1', 'missing')
    );
    expect(res.status).toBe(404);
  });
});

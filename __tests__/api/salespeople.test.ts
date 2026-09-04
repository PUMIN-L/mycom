// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/app/lib/db', () => ({ query: vi.fn() }));
import { query } from '@/app/lib/db';

vi.mock('@/app/lib/salesStore', () => ({
  getSalesperson: vi.fn(),
  updateSalesperson: vi.fn(),
  deleteSalesperson: vi.fn(),
}));
import { deleteSalesperson } from '@/app/lib/salesStore';

vi.mock('@/app/lib/session', () => ({ getSession: vi.fn() }));
import { getSession } from '@/app/lib/session';

import { DELETE } from '@/app/api/salespeople/[id]/route';

const admin = { userId: '1', username: 'admin', expiresAt: new Date() } as any;
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (id: string) =>
  new NextRequest(`http://localhost:3000/api/salespeople/${id}`, {
    method: 'DELETE',
    headers: { origin: 'http://localhost:3000', host: 'localhost:3000' },
  });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSession).mockResolvedValue(admin);
});

describe('DELETE /api/salespeople/[id]', () => {
  it('rejects deletion when sales records still reference the salesperson', async () => {
    vi.mocked(query).mockResolvedValueOnce([[{ id: 'sale-1' }]] as any);
    const res = await DELETE(req('sp-1'), ctx('sp-1'));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: 'Cannot delete salesperson with linked sales records',
    });
    expect(deleteSalesperson).not.toHaveBeenCalled();
  });

  it('deletes the salesperson when no sales records reference them', async () => {
    vi.mocked(query).mockResolvedValueOnce([[]] as any);
    vi.mocked(deleteSalesperson).mockResolvedValue(true);
    const res = await DELETE(req('sp-1'), ctx('sp-1'));
    expect(res.status).toBe(200);
    expect(deleteSalesperson).toHaveBeenCalledWith('sp-1');
  });

  it('checks sales_records filtered by this salesperson id', async () => {
    vi.mocked(query).mockResolvedValueOnce([[]] as any);
    vi.mocked(deleteSalesperson).mockResolvedValue(true);
    await DELETE(req('sp-1'), ctx('sp-1'));
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(sql).toContain('FROM sales_records');
    expect(sql).toContain('salespersonId');
    expect(params).toEqual(['sp-1']);
  });
});

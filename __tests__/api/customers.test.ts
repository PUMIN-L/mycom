// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/app/lib/db', () => ({ query: vi.fn() }));
import { query } from '@/app/lib/db';

vi.mock('@/app/lib/session', () => ({ getSession: vi.fn() }));
import { getSession } from '@/app/lib/session';

import { POST } from '@/app/api/customers/route';
import { PUT, DELETE } from '@/app/api/customers/[id]/route';

const admin = { userId: '1', username: 'admin', expiresAt: new Date() } as any;
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const postReq = (body: unknown) =>
  new NextRequest('http://localhost:3000/api/customers', {
    method: 'POST',
    headers: { origin: 'http://localhost:3000', host: 'localhost:3000', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
const putReq = (id: string, body: unknown) =>
  new NextRequest(`http://localhost:3000/api/customers/${id}`, {
    method: 'PUT',
    headers: { origin: 'http://localhost:3000', host: 'localhost:3000', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
const deleteReq = (id: string) =>
  new NextRequest(`http://localhost:3000/api/customers/${id}`, {
    method: 'DELETE',
    headers: { origin: 'http://localhost:3000', host: 'localhost:3000' },
  });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSession).mockResolvedValue(admin);
});

describe('POST /api/customers', () => {
  it('inserts customerLog alongside note (both plain free-text fields, distinct columns)', async () => {
    vi.mocked(query).mockResolvedValueOnce([{ affectedRows: 1 }] as any);
    const res = await POST(postReq({
      companyId: 'co-1',
      name: 'สมชาย',
      note: 'หมายเหตุ',
      customerLog: 'บันทึกลูกค้า',
    }));
    expect(res.status).toBe(200);
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(sql).toContain('INSERT INTO customers');
    expect(sql).toContain('customerLog');
    expect(params).toContain('หมายเหตุ');
    expect(params).toContain('บันทึกลูกค้า');
  });

  it('truncates customerLog to 2000 characters like note', async () => {
    vi.mocked(query).mockResolvedValueOnce([{ affectedRows: 1 }] as any);
    const longLog = 'a'.repeat(3000);
    await POST(postReq({ companyId: 'co-1', name: 'สมชาย', customerLog: longLog }));
    const [, params] = vi.mocked(query).mock.calls[0];
    const savedLog = (params as unknown[]).find((p) => typeof p === 'string' && p.startsWith('aaa'));
    expect((savedLog as string).length).toBe(2000);
  });

  it('defaults customerLog to an empty string when omitted', async () => {
    vi.mocked(query).mockResolvedValueOnce([{ affectedRows: 1 }] as any);
    await POST(postReq({ companyId: 'co-1', name: 'สมชาย' }));
    const [, params] = vi.mocked(query).mock.calls[0];
    expect(params).toContain('');
  });
});

describe('PUT /api/customers/[id]', () => {
  it('updates customerLog alongside the other customer fields', async () => {
    vi.mocked(query).mockResolvedValueOnce([{ affectedRows: 1 }] as any);
    const res = await PUT(putReq('cust-1', {
      companyId: 'co-1',
      name: 'สมชาย',
      customerLog: 'อัปเดตบันทึก',
    }), ctx('cust-1'));
    expect(res.status).toBe(200);
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(sql).toContain('UPDATE customers SET');
    expect(sql).toContain('customerLog = ?');
    expect(params).toEqual(['co-1', 'สมชาย', '', '', '', '', 'อัปเดตบันทึก', 'cust-1']);
  });
});

describe('DELETE /api/customers/[id]', () => {
  it('rejects deletion when linked equipment exists', async () => {
    vi.mocked(query).mockResolvedValueOnce([[{ id: 'eq-1' }]] as any);
    const res = await DELETE(deleteReq('cust-1'), ctx('cust-1'));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Cannot delete customer with linked equipment' });
  });

  it('rejects deletion when linked sales records exist', async () => {
    vi.mocked(query)
      .mockResolvedValueOnce([[]] as any) // no equipment
      .mockResolvedValueOnce([[{ id: 'sale-1' }]] as any); // has sales record
    const res = await DELETE(deleteReq('cust-1'), ctx('cust-1'));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Cannot delete customer with linked sales records' });
  });

  it('rejects deletion when linked call schedules exist', async () => {
    vi.mocked(query)
      .mockResolvedValueOnce([[]] as any) // no equipment
      .mockResolvedValueOnce([[]] as any) // no sales records
      .mockResolvedValueOnce([[{ id: 'sch-1' }]] as any); // has schedule
    const res = await DELETE(deleteReq('cust-1'), ctx('cust-1'));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Cannot delete customer with linked call schedules' });
  });

  it('deletes the customer when nothing references it', async () => {
    vi.mocked(query)
      .mockResolvedValueOnce([[]] as any)
      .mockResolvedValueOnce([[]] as any)
      .mockResolvedValueOnce([[]] as any)
      .mockResolvedValueOnce([{ affectedRows: 1 }] as any);
    const res = await DELETE(deleteReq('cust-1'), ctx('cust-1'));
    expect(res.status).toBe(200);
    const lastCall = vi.mocked(query).mock.calls[3];
    expect(lastCall[0]).toContain('DELETE FROM customers');
    expect(lastCall[1]).toEqual(['cust-1']);
  });
});

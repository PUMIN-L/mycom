// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/app/lib/db', () => ({ query: vi.fn() }));
import { query } from '@/app/lib/db';

vi.mock('@/app/lib/salesStore', async (importOriginal) => ({
  // The real input check; the writes are fakes.
  salespersonInputError: (await importOriginal<typeof import('@/app/lib/salesStore')>()).salespersonInputError,
  getSalesperson: vi.fn(),
  updateSalesperson: vi.fn(),
  deleteSalesperson: vi.fn(),
  createSalesperson: vi.fn(async (data: unknown) => ({ id: 'sp-new', ...(data as object) })),
}));
import { deleteSalesperson, updateSalesperson, createSalesperson } from '@/app/lib/salesStore';

vi.mock('@/app/lib/session', () => ({ getSession: vi.fn() }));
import { getSession } from '@/app/lib/session';

import { DELETE, PUT } from '@/app/api/salespeople/[id]/route';
import { POST } from '@/app/api/salespeople/route';

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
      error: 'ลบพนักงานขายคนนี้ไม่ได้ เพราะยังมีรายการขายที่ผูกอยู่',
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

// Every field is text. A number or an object used to reach .trim() or the
// sanitizer and come back as a bare 500.
describe('POST / PUT /api/salespeople — fields that are not text', () => {
  const send = (url: string, method: string, body: unknown) =>
    new NextRequest(url, {
      method,
      headers: { origin: 'http://localhost:3000', host: 'localhost:3000' },
      body: JSON.stringify(body),
    });
  const post = (body: unknown) => POST(send('http://localhost:3000/api/salespeople', 'POST', body));
  const put = (body: unknown) => PUT(send('http://localhost:3000/api/salespeople/sp-1', 'PUT', body), ctx('sp-1'));

  it('POST: 400, not 500, for a name or a field that is not text — nothing saved', async () => {
    for (const body of [{ name: 123 }, { name: ['x'] }, { name: 'สมชาย', phone: 812345678 }, { name: 'สมชาย', note: {} }, null, []]) {
      const res = await post(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect((await (await post({ name: '   ' })).json()).error).toBe('กรุณากรอกชื่อ');
    expect((await (await post({ name: 'ก'.repeat(256) })).json()).error).toBe('ชื่อยาวเกิน 255 ตัวอักษร');
    expect(createSalesperson).not.toHaveBeenCalled();
  });

  it('POST: a good body is saved, with or without the optional fields', async () => {
    expect((await post({ name: 'สมชาย' })).status).toBe(201);
    expect((await post({ name: 'สมชาย', phone: '081', email: null, note: '' })).status).toBe(201);
    expect(createSalesperson).toHaveBeenCalledTimes(2);
  });

  it('PUT: the name may be left out but not blanked or sent as a number', async () => {
    vi.mocked(updateSalesperson).mockResolvedValue({ id: 'sp-1', name: 'สมชาย' } as never);
    expect((await put({ phone: '081' })).status).toBe(200);
    expect((await put({ name: 42 })).status).toBe(400);
    expect((await put({ name: '' })).status).toBe(400);
    expect((await put({ email: 5 })).status).toBe(400);
    expect(updateSalesperson).toHaveBeenCalledTimes(1);
  });
});

// @vitest-environment node
/**
 * POST /api/companies and PUT /api/companies/[id]. A field of the wrong type
 * used to reach sanitize-html — which throws on an object, array or boolean —
 * and come back as a 500; an edit of a company that does not exist answered
 * { success: true } having changed nothing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/app/lib/db', () => ({ query: vi.fn() }));
import { query } from '@/app/lib/db';
vi.mock('@/app/lib/session', () => ({ getSession: vi.fn() }));
import { getSession } from '@/app/lib/session';

import { POST } from '@/app/api/companies/route';
import { PUT } from '@/app/api/companies/[id]/route';

const admin = { userId: '1', username: 'admin', expiresAt: new Date() } as never;

const request = (method: string, body: unknown) =>
  new NextRequest('http://localhost:3000/api/companies/c1', {
    method,
    headers: { origin: 'http://localhost:3000', host: 'localhost:3000' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
const ctx = { params: Promise.resolve({ id: 'c1' }) };

const COMPANY = {
  name: 'บริษัท ทดสอบ จำกัด',
  addressNo: '99/1',
  moo: '',
  soi: '',
  road: 'งามวงศ์วาน',
  subDistrict: 'บางกระสอ',
  district: 'เมืองนนทบุรี',
  province: 'นนทบุรี',
  postalCode: '11000',
  phone: '02-000-0000',
  note: '',
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSession).mockResolvedValue(admin);
});

describe('PUT /api/companies/[id]', () => {
  it('saves the cleaned fields and answers success', async () => {
    vi.mocked(query).mockResolvedValue([{ affectedRows: 1 }] as never);
    const res = await PUT(request('PUT', COMPANY), ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(sql).toContain('UPDATE companies SET');
    expect(params).toEqual([
      COMPANY.name, '99/1', '', '', 'งามวงศ์วาน', 'บางกระสอ', 'เมืองนนทบุรี', 'นนทบุรี', '11000',
      '02-000-0000', '', 'c1',
    ]);
  });

  it('answers 404 for a company that does not exist, instead of "success"', async () => {
    vi.mocked(query).mockResolvedValue([{ affectedRows: 0 }] as never);
    const res = await PUT(request('PUT', COMPANY), ctx);
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('ไม่พบบริษัทนี้');
  });

  it.each([
    ['an object', { street: 'x' }],
    ['an array', ['99/1']],
    ['a boolean', true],
  ])('refuses a field that is %s with 400, writing nothing', async (_label, value) => {
    const res = await PUT(request('PUT', { ...COMPANY, road: value }), ctx);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('ช่อง "ถนน" ต้องเป็นข้อความ');
    expect(query).not.toHaveBeenCalled();
  });

  it('takes a number (a postal code sent as one) as its digits, and null as empty', async () => {
    vi.mocked(query).mockResolvedValue([{ affectedRows: 1 }] as never);
    await PUT(request('PUT', { ...COMPANY, postalCode: 11000, moo: null, soi: undefined }), ctx);
    const params = vi.mocked(query).mock.calls[0][1] as unknown[];
    expect(params[8]).toBe('11000');
    expect(params[2]).toBe('');
    expect(params[3]).toBe('');
  });

  it.each([
    ['missing', { ...COMPANY, name: undefined }],
    ['blank', { ...COMPANY, name: '   ' }],
    ['not text', { ...COMPANY, name: 5 }],
  ])('refuses a name that is %s', async (_label, body) => {
    const res = await PUT(request('PUT', body), ctx);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('กรุณากรอกชื่อบริษัท');
    expect(query).not.toHaveBeenCalled();
  });

  it('refuses a null or non-JSON body with 400, not 500', async () => {
    expect((await PUT(request('PUT', 'null'), ctx)).status).toBe(400);
    expect((await PUT(request('PUT', '{oops'), ctx)).status).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  it('requires a login', async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    expect((await PUT(request('PUT', COMPANY), ctx)).status).toBe(401);
  });
});

describe('POST /api/companies', () => {
  it('inserts the cleaned fields and answers the new id', async () => {
    vi.mocked(query).mockResolvedValue([{ affectedRows: 1 }] as never);
    const res = await POST(request('POST', COMPANY));
    expect(res.status).toBe(200);
    const { id } = await res.json();
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(sql).toContain('INSERT INTO companies');
    expect((params as unknown[])[0]).toBe(id);
    expect((params as unknown[]).slice(1, 12)).toEqual([
      COMPANY.name, '99/1', '', '', 'งามวงศ์วาน', 'บางกระสอ', 'เมืองนนทบุรี', 'นนทบุรี', '11000',
      '02-000-0000', '',
    ]);
  });

  it('refuses a field of the wrong type with 400, writing nothing', async () => {
    const res = await POST(request('POST', { ...COMPANY, note: { text: 'x' } }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('ช่อง "หมายเหตุ" ต้องเป็นข้อความ');
    expect(query).not.toHaveBeenCalled();
  });
});

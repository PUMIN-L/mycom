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
import { PUT, DELETE } from '@/app/api/companies/[id]/route';

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

describe('DELETE /api/companies/[id]', () => {
  const del = () => new NextRequest('http://localhost:3000/api/companies/c1', {
    method: 'DELETE',
    headers: { origin: 'http://localhost:3000', host: 'localhost:3000' },
  });

  it('refuses while customers still belong to it', async () => {
    vi.mocked(query).mockResolvedValueOnce([[{ id: 'cust-1' }]] as never);
    const res = await DELETE(del(), ctx);
    expect(res.status).toBe(400);
  });

  // ใบ Job reads the company's name live: a company left only on job sheets
  // must not be deletable, or those sheets name no company.
  it('refuses while job sheets name it', async () => {
    vi.mocked(query)
      .mockResolvedValueOnce([[]] as never) // no customers
      .mockResolvedValueOnce([[{ id: 'job-1' }]] as never); // a ใบ Job
    const res = await DELETE(del(), ctx);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('ลบบริษัทนี้ไม่ได้ เพราะยังมีใบ Job ที่ผูกกับบริษัทนี้อยู่');
    expect(vi.mocked(query).mock.calls.some((c) => String(c[0]).startsWith('DELETE'))).toBe(false);
  });

  it('deletes when nothing references it', async () => {
    vi.mocked(query)
      .mockResolvedValueOnce([[]] as never)
      .mockResolvedValueOnce([[]] as never)
      .mockResolvedValueOnce([{ affectedRows: 1 }] as never);
    const res = await DELETE(del(), ctx);
    expect(res.status).toBe(200);
    expect(String(vi.mocked(query).mock.calls[2][0])).toContain('DELETE FROM companies');
  });
});

// v50 — a customer's tax ID, branch and usual withholding, for the accounting
// module's tax invoices. Written only when sent: the PUT tests above send none
// and leave the columns out of the UPDATE.
describe('the tax fields', () => {
  it('stores a Thai tax ID as its digits, the head office as 00000, the withholding as a number', async () => {
    vi.mocked(query).mockResolvedValue([{ affectedRows: 1 }] as never);
    await POST(request('POST', { ...COMPANY, taxId: '0-1075-37000-11-4', branchCode: 'สำนักงานใหญ่', whtPercent: '3' }));
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(sql).toContain('taxId, branchCode, whtPercent');
    expect((params as unknown[]).slice(12, 15)).toEqual(['0107537000114', '00000', 3]);
  });

  it('adds a company with none as NULLs', async () => {
    vi.mocked(query).mockResolvedValue([{ affectedRows: 1 }] as never);
    await POST(request('POST', COMPANY));
    expect((vi.mocked(query).mock.calls[0][1] as unknown[]).slice(12, 15)).toEqual([null, null, null]);
  });

  it('keeps a number from abroad as typed, and a branch as five digits', async () => {
    vi.mocked(query).mockResolvedValue([{ affectedRows: 1 }] as never);
    await PUT(request('PUT', { ...COMPANY, taxId: ' TW-12345678 ', branchCode: 'สาขา 2', whtPercent: '' }), ctx);
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(sql).toContain('taxId = ?');
    expect(sql).toContain('branchCode = ?');
    expect(sql).toContain('whtPercent = ?');
    expect(params).toEqual([
      COMPANY.name, '99/1', '', '', 'งามวงศ์วาน', 'บางกระสอ', 'เมืองนนทบุรี', 'นนทบุรี', '11000',
      '02-000-0000', '', 'TW-12345678', '00002', null, 'c1',
    ]);
  });

  it('clears a tax ID sent empty', async () => {
    vi.mocked(query).mockResolvedValue([{ affectedRows: 1 }] as never);
    await PUT(request('PUT', { ...COMPANY, taxId: '' }), ctx);
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(sql).toContain('taxId = ?');
    expect(sql).not.toContain('branchCode = ?');
    expect((params as unknown[]).slice(-2)).toEqual([null, 'c1']);
  });

  it('refuses a branch that is not one, and a withholding outside 0–15%, writing nothing', async () => {
    for (const bad of [{ branchCode: 'สาขา' }, { branchCode: '123456' }, { whtPercent: 20 }, { whtPercent: true }, { taxId: { x: 1 } }]) {
      const res = await POST(request('POST', { ...COMPANY, ...bad }));
      expect(res.status, JSON.stringify(bad)).toBe(400);
    }
    expect(query).not.toHaveBeenCalled();
  });
});

// v57 — เซลล์ผู้ดูแล: the salesperson who looks after the company. Optional,
// one per company; written only when sent, and only someone on the list.
describe('the salesperson who looks after it', () => {
  const found = [[{ id: 'sp1' }]] as never;
  const none = [[]] as never;
  const done = [{ affectedRows: 1 }] as never;

  it('POST stores the chosen salesperson, after checking they exist', async () => {
    vi.mocked(query).mockResolvedValueOnce(found).mockResolvedValueOnce(done);
    const res = await POST(request('POST', { ...COMPANY, salespersonId: 'sp1' }));
    expect(res.status).toBe(200);
    const [lookup, lookupParams] = vi.mocked(query).mock.calls[0];
    expect(lookup).toContain('FROM salespeople');
    expect(lookupParams).toEqual(['sp1']);
    const [sql, params] = vi.mocked(query).mock.calls[1];
    expect(sql).toContain('salespersonId');
    expect((params as unknown[]).slice(15, 16)).toEqual(['sp1']);
  });

  it('POST without one stores NULL and looks nobody up', async () => {
    vi.mocked(query).mockResolvedValue(done);
    await POST(request('POST', COMPANY));
    expect(query).toHaveBeenCalledTimes(1);
    expect((vi.mocked(query).mock.calls[0][1] as unknown[]).slice(15, 16)).toEqual([null]);
  });

  it('PUT writes it when sent — and an empty one clears it, with no lookup', async () => {
    vi.mocked(query).mockResolvedValueOnce(found).mockResolvedValueOnce(done);
    await PUT(request('PUT', { ...COMPANY, salespersonId: 'sp1' }), ctx);
    const [sql, params] = vi.mocked(query).mock.calls[1];
    expect(sql).toContain('salespersonId = ?');
    expect((params as unknown[]).slice(-2)).toEqual(['sp1', 'c1']);

    vi.mocked(query).mockReset();
    vi.mocked(query).mockResolvedValue(done);
    await PUT(request('PUT', { ...COMPANY, salespersonId: '' }), ctx);
    expect(query).toHaveBeenCalledTimes(1);
    const [clearSql, clearParams] = vi.mocked(query).mock.calls[0];
    expect(clearSql).toContain('salespersonId = ?');
    expect((clearParams as unknown[]).slice(-2)).toEqual([null, 'c1']);
  });

  it('PUT leaves it alone when not sent (a caller that knows nothing of it)', async () => {
    vi.mocked(query).mockResolvedValue(done);
    await PUT(request('PUT', COMPANY), ctx);
    expect(vi.mocked(query).mock.calls[0][0]).not.toContain('salespersonId');
  });

  it('refuses someone not on the list with 400, writing nothing', async () => {
    vi.mocked(query).mockResolvedValueOnce(none);
    const res = await PUT(request('PUT', { ...COMPANY, salespersonId: 'sp-gone' }), ctx);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('ไม่พบพนักงานขายที่เลือก อาจถูกลบไปแล้ว กรุณาเลือกใหม่');
    expect(query).toHaveBeenCalledTimes(1);

    vi.mocked(query).mockReset();
    vi.mocked(query).mockResolvedValueOnce(none);
    const added = await POST(request('POST', { ...COMPANY, salespersonId: 'sp-gone' }));
    expect(added.status).toBe(400);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['a number', 5],
    ['an object', { id: 'sp1' }],
  ])('refuses a salesperson that is %s with 400', async (_label, value) => {
    const res = await PUT(request('PUT', { ...COMPANY, salespersonId: value }), ctx);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('ช่อง "เซลล์ผู้ดูแล" ไม่ถูกต้อง');
    expect(query).not.toHaveBeenCalled();
  });
});

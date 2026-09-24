// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// PUT runs read → snapshot → write inside one transaction (change
// add-customer-note-search phase 1), so `withTransaction` is scripted with a
// connection and the REAL transaction body runs. POST and DELETE still use the
// pool-level `query`.
const conn = { query: vi.fn() };
const runTransaction = vi.fn();
vi.mock('@/app/lib/db', () => ({
  query: vi.fn(),
  withTransaction: (...args: unknown[]) => runTransaction(...args),
}));
import { query } from '@/app/lib/db';

const sqlOf = (call: unknown[]) => String(call[0]).replace(/\s+/g, ' ');
const connSql = () => conn.query.mock.calls.map(sqlOf);
/** Real UPDATE statements only — `/UPDATE/` alone would also match the
 *  locking `SELECT … FOR UPDATE`, which is a read. */
const customerUpdates = () => connSql().filter((s) => /^UPDATE\b/i.test(s.trim()));

vi.mock('@/app/lib/session', () => ({ getSession: vi.fn() }));
import { getSession } from '@/app/lib/session';

import { POST } from '@/app/api/customers/route';
import { GET, PUT, DELETE } from '@/app/api/customers/[id]/route';

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
const getReq = (id: string) =>
  new NextRequest(`http://localhost:3000/api/customers/${id}`, {
    headers: { host: 'localhost:3000' },
  });

/** The transaction connection: the locking SELECT on `customers` returns
 *  `rows`, the revision-ceiling SELECT finds nothing over the ceiling, and
 *  everything else reports one affected row. */
function scriptTx(rows: unknown[]) {
  conn.query.mockReset().mockImplementation((sql: string) => {
    if (/^\s*SELECT/i.test(sql)) {
      return Promise.resolve([/FROM revisions/i.test(sql) ? [] : rows]);
    }
    return Promise.resolve([{ affectedRows: 1 }]);
  });
}

const revisionInserts = () => connSql().filter((s) => /INSERT INTO revisions/i.test(s));

/** A toISOString() stamp, as written to customers.noteUpdatedAt. */
const ISO = expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

const existingCustomer = {
  id: 'cust-1',
  companyId: 'co-1',
  name: 'สมชาย',
  department: '',
  phone: '',
  email: '',
  note: '6/9/26 โทรหา QC\n7/9/26 ติดตามใบเสนอราคา',
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSession).mockResolvedValue(admin);
  scriptTx([existingCustomer]);
  runTransaction
    .mockReset()
    .mockImplementation(async (fn: (c: typeof conn) => Promise<unknown>) => fn(conn));
});

// ── GET /api/customers/[id] — spec: open-customer-profile-in-place ─────────
//
// /crm/alerts opens CustomerDetailsModal without the full customer list in
// hand (unlike /customers, which already has one), so it needs one row by
// id rather than loading everyone — the exact thing this route exists to
// avoid needing, with ~6,000 customers on the way.
describe('GET /api/customers/[id]', () => {
  it('returns the one row, joined with the company name — same shape as the list route', async () => {
    vi.mocked(query).mockResolvedValueOnce([[{ ...existingCustomer, companyName: 'บริษัท ก' }]] as any);
    const res = await GET(getReq('cust-1'), ctx('cust-1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ...existingCustomer, companyName: 'บริษัท ก' });

    const sql = String(vi.mocked(query).mock.calls[0][0]).replace(/\s+/g, ' ');
    expect(sql).toContain('LEFT JOIN companies ON customers.companyId = companies.id');
    expect(sql).toContain('WHERE customers.id = ?');
    expect(vi.mocked(query).mock.calls[0][1]).toEqual(['cust-1']);
  });

  it('404s in Thai when the customer is gone', async () => {
    vi.mocked(query).mockResolvedValueOnce([[]] as any);
    const res = await GET(getReq('gone'), ctx('gone'));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toContain('ไม่พบลูกค้า');
  });

  it('401s an anonymous request before any query runs', async () => {
    vi.mocked(getSession).mockResolvedValueOnce(null as never);
    const res = await GET(getReq('cust-1'), ctx('cust-1'));
    expect(res.status).toBe(401);
    expect(query).not.toHaveBeenCalled();
  });
});

describe('POST /api/customers', () => {
  it('inserts note (the "บันทึกลูกค้า" field, stored as the note column)', async () => {
    vi.mocked(query).mockResolvedValueOnce([{ affectedRows: 1 }] as any);
    const res = await POST(postReq({
      companyId: 'co-1',
      name: 'สมชาย',
      note: 'บันทึกลูกค้า',
    }));
    expect(res.status).toBe(200);
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(sql).toContain('INSERT INTO customers');
    expect(params).toContain('บันทึกลูกค้า');
  });

  it('truncates note to 2000 characters', async () => {
    vi.mocked(query).mockResolvedValueOnce([{ affectedRows: 1 }] as any);
    const longNote = 'a'.repeat(3000);
    await POST(postReq({ companyId: 'co-1', name: 'สมชาย', note: longNote }));
    const [, params] = vi.mocked(query).mock.calls[0];
    const savedNote = (params as unknown[]).find((p) => typeof p === 'string' && p.startsWith('aaa'));
    expect((savedNote as string).length).toBe(2000);
  });

  it('defaults note to an empty string when omitted', async () => {
    vi.mocked(query).mockResolvedValueOnce([{ affectedRows: 1 }] as any);
    await POST(postReq({ companyId: 'co-1', name: 'สมชาย' }));
    const [, params] = vi.mocked(query).mock.calls[0];
    expect(params).toContain('');
  });
});

describe('PUT /api/customers/[id]', () => {
  it('updates note alongside the other customer fields', async () => {
    const res = await PUT(putReq('cust-1', {
      companyId: 'co-1',
      name: 'สมชาย',
      note: 'อัปเดตบันทึก',
    }), ctx('cust-1'));
    expect(res.status).toBe(200);
    const updateCall = conn.query.mock.calls.find((c) => /^UPDATE\b/i.test(sqlOf(c)))!;
    expect(String(updateCall[0])).toContain('UPDATE customers SET');
    expect(updateCall[1]).toEqual(['co-1', 'สมชาย', '', '', '', 'อัปเดตบันทึก', ISO, 'cust-1']);
  });

  // ── The undo. `customers.note` is the "บันทึกลูกค้า" call log: dated lines
  //    that accumulate for years. Until change add-customer-note-search there
  //    was no history behind this write at all, so a cleared textarea erased
  //    all of it with no way back — and the bulk search-and-replace was not
  //    allowed to exist on top of that.

  it('snapshots the PREVIOUS row into revisions before overwriting it', async () => {
    await PUT(putReq('cust-1', {
      companyId: 'co-1',
      name: 'สมชาย',
      note: 'บันทึกใหม่ที่เขียนทับของเดิม',
    }), ctx('cust-1'));

    const revision = conn.query.mock.calls.find((c) => /INSERT INTO revisions/i.test(sqlOf(c)))!;
    const params = revision[1] as unknown[];
    expect(params[1]).toBe('customer');
    expect(params[2]).toBe('cust-1');
    // The note BEFORE the edit — that is the whole point of the snapshot.
    expect(JSON.parse(params[3] as string).note).toBe(existingCustomer.note);
  });

  it('reads, snapshots, then writes — in that order, on one connection', async () => {
    await PUT(putReq('cust-1', { companyId: 'co-1', name: 'สมชาย', note: 'x' }), ctx('cust-1'));
    const order = connSql().map((s) =>
      /INSERT INTO revisions/i.test(s) ? 'revision'
        : /FROM revisions/i.test(s) ? 'trim'
        : /^UPDATE\b/i.test(s) ? 'update'
        : 'select'
    );
    // The ceiling trim rides the same transaction as the snapshot it follows,
    // so a rollback takes the deletion of real history with it.
    expect(order).toEqual(['select', 'revision', 'trim', 'update']);
    // The read holds the row so the snapshot is of the value being overwritten.
    expect(connSql()[0]).toContain('FOR UPDATE');
    // The snapshot goes through the transaction's connection, never the
    // pool-level query(), so it rolls back with everything else.
    expect(query).not.toHaveBeenCalled();
  });

  it('NO HISTORY MEANS NO WRITE: a failed snapshot leaves the note alone', async () => {
    conn.query.mockReset().mockImplementation((sql: string) => {
      if (/^\s*SELECT/i.test(sql)) return Promise.resolve([[existingCustomer]]);
      if (/INSERT INTO revisions/i.test(sql)) return Promise.reject(new Error('revisions write failed'));
      return Promise.resolve([{ affectedRows: 1 }]);
    });

    const res = await PUT(putReq('cust-1', {
      companyId: 'co-1',
      name: 'สมชาย',
      note: '',
    }), ctx('cust-1'));

    // The admin is told, in Thai, that the save did not happen...
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('บันทึกข้อมูลลูกค้าไม่สำเร็จ');
    // ...and no UPDATE was issued, so the years of call log are still there.
    expect(customerUpdates()).toEqual([]);
  });

  // ── NO CHANGE, NO SNAPSHOT ─────────────────────────────────────────────
  //    A customer revision restores exactly one column, `note`. A snapshot
  //    taken when the note did not change could only ever restore the value
  //    already in the row — history that can undo nothing. With ~6,000
  //    customers about to be imported, a pass over their phone numbers would
  //    otherwise have written tens of MB of it.

  it('writes NO revision when the note is unchanged, even though other fields are', async () => {
    const res = await PUT(putReq('cust-1', {
      companyId: 'co-2',
      name: 'สมชาย ใจดี',
      phone: '081-999-9999',
      note: existingCustomer.note,
    }), ctx('cust-1'));

    expect(res.status).toBe(200);
    expect(revisionInserts()).toEqual([]);
    // The edit itself still lands — this skips the history, not the save.
    expect(customerUpdates()).toHaveLength(1);
  });

  it('writes EXACTLY ONE revision when the note changes', async () => {
    await PUT(putReq('cust-1', {
      companyId: 'co-1',
      name: 'สมชาย',
      note: existingCustomer.note + '\n8/9/26 ปิดการขาย',
    }), ctx('cust-1'));
    expect(revisionInserts()).toHaveLength(1);
  });

  it('compares the note AFTER sanitizing and truncating — not the raw request body', async () => {
    // `sanitizePlainText(data.note).substring(0, 2000)` is what the UPDATE
    // writes. Compare the raw input instead and a save whose only difference
    // is markup the sanitizer strips still looks like a change, and still
    // writes a snapshot identical to the live row.
    scriptTx([{ ...existingCustomer, note: 'โทรหา QC' }]);
    const res = await PUT(putReq('cust-1', {
      companyId: 'co-1',
      name: 'สมชาย',
      note: '<b>โทรหา QC</b>',
    }), ctx('cust-1'));

    expect(res.status).toBe(200);
    const written = conn.query.mock.calls.find((c) => /^UPDATE\b/i.test(sqlOf(c)))![1] as unknown[];
    expect(written[5]).toBe('โทรหา QC');
    expect(revisionInserts()).toEqual([]);
  });

  it('treats a stored NULL note and an omitted note as the same empty note', async () => {
    scriptTx([{ ...existingCustomer, note: null }]);
    const res = await PUT(putReq('cust-1', { companyId: 'co-1', name: 'สมชาย' }), ctx('cust-1'));
    expect(res.status).toBe(200);
    expect(revisionInserts()).toEqual([]);
  });

  it('DOES snapshot when a note is cleared — that is the accident the history exists for', async () => {
    await PUT(putReq('cust-1', { companyId: 'co-1', name: 'สมชาย', note: '' }), ctx('cust-1'));
    expect(revisionInserts()).toHaveLength(1);
  });

  it('stores only the fields a customer restore can write back', async () => {
    await PUT(putReq('cust-1', { companyId: 'co-1', name: 'สมชาย', note: 'บันทึกใหม่' }), ctx('cust-1'));
    const revision = conn.query.mock.calls.find((c) => /INSERT INTO revisions/i.test(sqlOf(c)))!;
    const snapshot = JSON.parse((revision[1] as unknown[])[3] as string);
    expect(snapshot).toEqual({ name: existingCustomer.name, note: existingCustomer.note });
    // The restore writes `note` and nothing else, so these can never come back.
    for (const dead of ['id', 'companyId', 'department', 'phone', 'email']) {
      expect(Object.hasOwn(snapshot, dead)).toBe(false);
    }
  });

  it('skips the snapshot for a customer that does not exist, and still 200s', async () => {
    // Nothing to lose, so nothing to snapshot: a revision holding `null` would
    // put an entry in the history that restores a customer with no fields.
    scriptTx([]);
    const res = await PUT(putReq('ghost', { companyId: 'co-1', name: 'สมชาย' }), ctx('ghost'));
    expect(res.status).toBe(200);
    expect(connSql().some((s) => /INSERT INTO revisions/i.test(s))).toBe(false);
  });
});

// add-customer-note-updated-at — /customers sorts by when the NOTE last
// changed, so the stamp must move on exactly the "note really changed"
// condition the snapshot already uses, and on nothing else.
describe('customers.noteUpdatedAt', () => {
  const insertParams = () => vi.mocked(query).mock.calls[0][1] as unknown[];

  it('POST stamps a customer created WITH a note', async () => {
    vi.mocked(query).mockResolvedValueOnce([{ affectedRows: 1 }] as never);
    await POST(postReq({ companyId: 'co-1', name: 'สมชาย', note: 'โทรครั้งแรก' }));
    const [sql] = vi.mocked(query).mock.calls[0];
    expect(String(sql)).toContain('noteUpdatedAt');
    const params = insertParams();
    // Created and first-updated at the same instant.
    expect(params[params.length - 1]).toEqual(ISO);
    expect(params[params.length - 1]).toBe(params[params.length - 2]);
  });

  it('POST leaves it NULL for a customer created with no note', async () => {
    vi.mocked(query).mockResolvedValueOnce([{ affectedRows: 1 }] as never);
    await POST(postReq({ companyId: 'co-1', name: 'สมชาย' }));
    const params = insertParams();
    expect(params[params.length - 1]).toBeNull();
  });

  it('PUT stamps it when the note changes, and returns the stored value', async () => {
    const res = await PUT(putReq('cust-1', { ...existingCustomer, note: 'บรรทัดใหม่' }), ctx('cust-1'));
    const body = await res.json();

    const [update] = customerUpdates();
    expect(update).toContain('note = ?, noteUpdatedAt = ?');
    expect(body.noteUpdatedAt).toEqual(ISO);
    const params = conn.query.mock.calls.find((c) => /^UPDATE\b/i.test(sqlOf(c)))![1] as unknown[];
    expect(params).toContain(body.noteUpdatedAt);
  });

  it('PUT does NOT touch it when only other fields change — a phone fix is not activity', async () => {
    const stored = { ...existingCustomer, noteUpdatedAt: '2026-09-01T03:00:00.000Z' };
    scriptTx([stored]);
    const res = await PUT(
      putReq('cust-1', { ...existingCustomer, phone: '081-999-9999' }),
      ctx('cust-1')
    );

    const [update] = customerUpdates();
    expect(update).not.toContain('noteUpdatedAt');
    // The response still carries the (unchanged) stored stamp, so a caller
    // patching its list in place keeps the right position.
    expect((await res.json()).noteUpdatedAt).toBe('2026-09-01T03:00:00.000Z');
  });

  it('PUT clears it when the note is emptied — no note, nothing to date', async () => {
    const res = await PUT(putReq('cust-1', { ...existingCustomer, note: '' }), ctx('cust-1'));
    const params = conn.query.mock.calls.find((c) => /^UPDATE\b/i.test(sqlOf(c)))![1] as unknown[];
    expect(params).toEqual(['co-1', 'สมชาย', '', '', '', '', null, 'cust-1']);
    expect((await res.json()).noteUpdatedAt).toBeNull();
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

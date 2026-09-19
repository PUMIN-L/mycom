// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET as listGET } from '@/app/api/revisions/route';
import { POST as restorePOST } from '@/app/api/revisions/[id]/restore/route';

// Only the two READ helpers are stubbed. `saveRevision` stays REAL so the
// pre-restore snapshot shows up as an actual `INSERT INTO revisions` on the
// transaction's connection below — which is what lets these tests assert the
// read → snapshot → write ORDER instead of trusting a spy was called.
vi.mock('@/app/lib/revisionStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/app/lib/revisionStore')>();
  return { ...actual, listRevisions: vi.fn(), getRevision: vi.fn() };
});
import { listRevisions, getRevision } from '@/app/lib/revisionStore';

// The customer restore is the only case that touches the database directly
// (one column, in one transaction), so `withTransaction` is scripted with a
// connection and the REAL transaction body runs.
const conn = { query: vi.fn() };
const runTransaction = vi.fn();
vi.mock('@/app/lib/db', () => ({
  query: vi.fn(),
  withTransaction: (...args: unknown[]) => runTransaction(...args),
}));
import { query } from '@/app/lib/db';
vi.mock('@/app/lib/productStore', () => ({
  updateProduct: vi.fn(),
  getAllCategories: vi.fn(),
  getProduct: vi.fn(),
}));
import { updateProduct, getAllCategories, getProduct } from '@/app/lib/productStore';
vi.mock('@/app/lib/contentStore', () => {
  class ContentProductConflictError extends Error {
    constructor(public readonly productId: string) {
      super(`product ${productId} already has a content linked to it`);
      this.name = 'ContentProductConflictError';
    }
  }
  return {
    updateContent: vi.fn(),
    getContentByProductId: vi.fn(),
    ContentProductConflictError,
  };
});
import { updateContent, getContentByProductId, ContentProductConflictError } from '@/app/lib/contentStore';
vi.mock('@/app/lib/documentStore', () => ({
  updateDocument: vi.fn(),
  getDocument: vi.fn(),
}));
import { updateDocument, getDocument } from '@/app/lib/documentStore';
vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }));
import { revalidateTag } from 'next/cache';
vi.mock('@/app/lib/session', () => ({ getSession: vi.fn() }));
import { getSession } from '@/app/lib/session';

const admin = { userId: '1', username: 'admin', expiresAt: new Date() } as any;
const listReq = (qs: string) => new NextRequest('http://localhost/api/revisions' + qs);
const postReq = () =>
  new NextRequest('http://localhost/api/x', {
    method: 'POST',
    headers: { origin: 'http://localhost', host: 'localhost' },
  });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

const sqlOf = (call: unknown[]) => String(call[0]).replace(/\s+/g, ' ');
const connSql = () => conn.query.mock.calls.map(sqlOf);
/** Real UPDATE statements only — `/UPDATE/` alone would also match the
 *  locking `SELECT … FOR UPDATE`, which is a read. */
const customerUpdates = () =>
  conn.query.mock.calls.filter((c) => /^UPDATE\b/i.test(sqlOf(c).trim()));

/** The customer row as it stands in the database right now. */
const currentCustomer = {
  id: 'cust-1',
  companyId: 'co-1',
  name: 'สมชาย',
  department: 'จัดซื้อ',
  phone: '081-000-0000',
  email: 'somchai@example.com',
  note: '6/9/26 โทรหา QC เรื่องคาลิเปอร์\n7/9/26 ติดตามใบเสนอราคา',
};

/** A snapshot of that customer taken before a bulk replace rewrote the note. */
const customerRevision = (data: unknown = { ...currentCustomer, note: 'บันทึกเดิมก่อนถูกแทนที่' }) =>
  ({ id: 'rev-c1', entityType: 'customer', entityId: 'cust-1', data, createdAt: 't' }) as any;

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

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSession).mockResolvedValue(admin);
  // Default: the FK a snapshot points at still exists — tests for the
  // "it's been deleted since" case override these explicitly.
  vi.mocked(getProduct).mockResolvedValue({ id: 'p9' } as any);
  vi.mocked(getAllCategories).mockResolvedValue([{ id: 1 } as any]);
  scriptTx([currentCustomer]);
  runTransaction
    .mockReset()
    .mockImplementation(async (fn: (c: typeof conn) => Promise<unknown>) => fn(conn));
});

describe('GET /api/revisions', () => {
  it('rejects anonymous callers with 401', async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    const res = await listGET(listReq('?entityType=content&entityId=c1'));
    expect(res.status).toBe(401);
    expect(listRevisions).not.toHaveBeenCalled();
  });

  it('400 on an invalid entityType', async () => {
    const res = await listGET(listReq('?entityType=bogus&entityId=c1'));
    expect(res.status).toBe(400);
    expect(listRevisions).not.toHaveBeenCalled();
  });

  it('400 when entityId is missing', async () => {
    const res = await listGET(listReq('?entityType=content'));
    expect(res.status).toBe(400);
  });

  it('returns the history for a valid query', async () => {
    const rows = [{ id: 'r1', entityType: 'content', entityId: 'c1', data: {}, createdAt: 't' }];
    vi.mocked(listRevisions).mockResolvedValue(rows as any);
    const res = await listGET(listReq('?entityType=content&entityId=c1'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(rows);
    expect(listRevisions).toHaveBeenCalledWith('content', 'c1');
  });

  // The snapshots taken by the customer-note writes were unreadable through
  // this route while it accepted only three types: history existed in the
  // database and nowhere a person could reach it.
  it('lists customer revisions, the same shape as the other three', async () => {
    const rows = [
      { id: 'rev-c1', entityType: 'customer', entityId: 'cust-1', data: { note: 'เก่า' }, createdAt: 't' },
    ];
    vi.mocked(listRevisions).mockResolvedValue(rows as any);
    const res = await listGET(listReq('?entityType=customer&entityId=cust-1'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(rows);
    expect(listRevisions).toHaveBeenCalledWith('customer', 'cust-1');
  });

  it('still accepts every previously accepted entityType, unchanged', async () => {
    vi.mocked(listRevisions).mockResolvedValue([] as any);
    for (const entityType of ['product', 'content', 'document'] as const) {
      const res = await listGET(listReq(`?entityType=${entityType}&entityId=e1`));
      expect(res.status).toBe(200);
      expect(listRevisions).toHaveBeenCalledWith(entityType, 'e1');
    }
  });

  it('does not treat inherited Object keys as entity types', async () => {
    // The allowlist is an object; `"constructor" in obj` is true, so the check
    // has to be an own-property one.
    const res = await listGET(listReq('?entityType=constructor&entityId=c1'));
    expect(res.status).toBe(400);
    expect(listRevisions).not.toHaveBeenCalled();
  });
});

describe('POST /api/revisions/[id]/restore', () => {
  it('rejects anonymous callers with 401', async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    const res = await restorePOST(postReq() as any, ctx('r1'));
    expect(res.status).toBe(401);
    expect(getRevision).not.toHaveBeenCalled();
  });

  it('404 when the revision does not exist', async () => {
    vi.mocked(getRevision).mockResolvedValue(null);
    const res = await restorePOST(postReq() as any, ctx('nope'));
    expect(res.status).toBe(404);
  });

  it('restores a product revision and revalidates the products cache', async () => {
    vi.mocked(getRevision).mockResolvedValue({
      id: 'r1', entityType: 'product', entityId: 'p1', data: { title_en: 'old' }, createdAt: 't',
    } as any);
    vi.mocked(updateProduct).mockResolvedValue({ id: 'p1' } as any); // entity still exists
    const res = await restorePOST(postReq() as any, ctx('r1'));
    expect(res.status).toBe(200);
    expect(updateProduct).toHaveBeenCalledWith('p1', { title_en: 'old' });
    expect(revalidateTag).toHaveBeenCalledWith('products', { expire: 0 });
  });

  // This used to assert revalidateTag was NOT called: before getAllContentsMeta
  // was cached there was no content cache to bust, so busting one would have
  // been pointless. It now must be called — the cached content list lives under
  // the "products" tag (shared on purpose: hard-deleting a product cascades into
  // deleting its content, and that route only busts "products"). Skipping it
  // here would leave the sitemap advertising a restored-away /showcase/{id}.
  it('restores a content revision and revalidates the catalog cache', async () => {
    vi.mocked(getRevision).mockResolvedValue({
      id: 'r2', entityType: 'content', entityId: 'c1', data: { title: 'old' }, createdAt: 't',
    } as any);
    vi.mocked(updateContent).mockResolvedValue({ id: 'c1' } as any);
    const res = await restorePOST(postReq() as any, ctx('r2'));
    expect(res.status).toBe(200);
    expect(updateContent).toHaveBeenCalledWith('c1', { title: 'old' });
    expect(revalidateTag).toHaveBeenCalledWith('products', { expire: 0 });
  });

  it('restores a document revision (checks existence first)', async () => {
    vi.mocked(getRevision).mockResolvedValue({
      id: 'r3', entityType: 'document', entityId: 'd1', data: { title: 'old' }, createdAt: 't',
    } as any);
    vi.mocked(getDocument).mockResolvedValue({ id: 'd1' } as any);
    const res = await restorePOST(postReq() as any, ctx('r3'));
    expect(res.status).toBe(200);
    expect(updateDocument).toHaveBeenCalledWith('d1', { title: 'old' });
  });

  // Deleted-entity restores → a consistent 404 across all three types (was: false
  // 200 for product/content, 500 for document).
  it('404 when the product was deleted (updateProduct returns undefined)', async () => {
    vi.mocked(getRevision).mockResolvedValue({
      id: 'r1', entityType: 'product', entityId: 'p1', data: { title_en: 'x' }, createdAt: 't',
    } as any);
    vi.mocked(updateProduct).mockResolvedValue(undefined as any);
    const res = await restorePOST(postReq() as any, ctx('r1'));
    expect(res.status).toBe(404);
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it('404 when the content was deleted (updateContent returns undefined)', async () => {
    vi.mocked(getRevision).mockResolvedValue({
      id: 'r2', entityType: 'content', entityId: 'c1', data: { title: 'x' }, createdAt: 't',
    } as any);
    vi.mocked(getContentByProductId).mockResolvedValue(undefined as any);
    vi.mocked(updateContent).mockResolvedValue(undefined as any);
    const res = await restorePOST(postReq() as any, ctx('r2'));
    expect(res.status).toBe(404);
  });

  it('404 when the document was deleted (getDocument returns null)', async () => {
    vi.mocked(getRevision).mockResolvedValue({
      id: 'r3', entityType: 'document', entityId: 'd1', data: { title: 'x' }, createdAt: 't',
    } as any);
    vi.mocked(getDocument).mockResolvedValue(null as any);
    const res = await restorePOST(postReq() as any, ctx('r3'));
    expect(res.status).toBe(404);
    expect(updateDocument).not.toHaveBeenCalled();
  });

  // Restoring a content snapshot whose productId is now owned by ANOTHER content
  // must be rejected (one-content-per-product), like the PUT route does.
  it('409 when restoring a content whose productId is now linked to a different content', async () => {
    vi.mocked(getRevision).mockResolvedValue({
      id: 'r2', entityType: 'content', entityId: 'c1', data: { title: 'old', productId: 'p9' }, createdAt: 't',
    } as any);
    vi.mocked(getContentByProductId).mockResolvedValue({ id: 'c2' } as any); // owned by another
    const res = await restorePOST(postReq() as any, ctx('r2'));
    expect(res.status).toBe(409);
    expect(updateContent).not.toHaveBeenCalled();
  });

  it('allows restoring a content whose productId it still owns itself', async () => {
    vi.mocked(getRevision).mockResolvedValue({
      id: 'r2', entityType: 'content', entityId: 'c1', data: { title: 'old', productId: 'p9' }, createdAt: 't',
    } as any);
    vi.mocked(getContentByProductId).mockResolvedValue({ id: 'c1' } as any); // same content
    vi.mocked(updateContent).mockResolvedValue({ id: 'c1' } as any);
    const res = await restorePOST(postReq() as any, ctx('r2'));
    expect(res.status).toBe(200);
    expect(updateContent).toHaveBeenCalled();
  });

  // A snapshot's FK-referenced data can go stale between when it was taken
  // and when someone restores it — the category/product it pointed at may
  // have been deleted since. Restoring it as-is would silently re-link to a
  // dangling reference instead of failing loudly.
  it('400 when restoring a product whose snapshotted categoryId no longer exists', async () => {
    vi.mocked(getRevision).mockResolvedValue({
      id: 'r1', entityType: 'product', entityId: 'p1', data: { title_en: 'old', categoryId: 5 }, createdAt: 't',
    } as any);
    vi.mocked(getAllCategories).mockResolvedValue([{ id: 1 } as any, { id: 2 } as any]); // 5 is gone
    const res = await restorePOST(postReq() as any, ctx('r1'));
    expect(res.status).toBe(400);
    expect(updateProduct).not.toHaveBeenCalled();
  });

  it('restores a product whose snapshotted categoryId still exists', async () => {
    vi.mocked(getRevision).mockResolvedValue({
      id: 'r1', entityType: 'product', entityId: 'p1', data: { title_en: 'old', categoryId: 5 }, createdAt: 't',
    } as any);
    vi.mocked(getAllCategories).mockResolvedValue([{ id: 5 } as any]);
    vi.mocked(updateProduct).mockResolvedValue({ id: 'p1' } as any);
    const res = await restorePOST(postReq() as any, ctx('r1'));
    expect(res.status).toBe(200);
    expect(updateProduct).toHaveBeenCalledWith('p1', { title_en: 'old', categoryId: 5 });
  });

  it('400 when restoring a content whose snapshotted productId no longer exists', async () => {
    vi.mocked(getRevision).mockResolvedValue({
      id: 'r2', entityType: 'content', entityId: 'c1', data: { title: 'old', productId: 'p9' }, createdAt: 't',
    } as any);
    vi.mocked(getProduct).mockResolvedValue(undefined as any); // product deleted since
    const res = await restorePOST(postReq() as any, ctx('r2'));
    expect(res.status).toBe(400);
    expect(updateContent).not.toHaveBeenCalled();
    expect(getContentByProductId).not.toHaveBeenCalled();
  });

  it('translates a ContentProductConflictError from updateContent into a 409 (race the pre-check missed)', async () => {
    vi.mocked(getRevision).mockResolvedValue({
      id: 'r2', entityType: 'content', entityId: 'c1', data: { title: 'old', productId: 'p9' }, createdAt: 't',
    } as any);
    vi.mocked(getContentByProductId).mockResolvedValue(undefined as any); // pre-check saw it as free
    vi.mocked(updateContent).mockRejectedValue(new ContentProductConflictError('p9'));
    const res = await restorePOST(postReq() as any, ctx('r2'));
    expect(res.status).toBe(409);
  });
});

// ── The undo, made pullable ──────────────────────────────────────────────────
//
// `customers.note` is the "บันทึกลูกค้า" call log — dated lines that pile up
// for years. Change add-customer-note-search made every write to it snapshot
// the previous value first, which is the whole justification for letting a
// bulk search-and-replace exist. Until this case existed, those snapshots
// could not be put back: a safety net nobody can pull is decorative.
//
// ONE COLUMN. `note` is the only field either writer ever overwrites, so it is
// the only field a restore may write. Putting `name`/`phone`/`email`/
// `companyId` back from an old snapshot would revert edits nobody asked to
// revert, and could point the customer at a company that has since been
// deleted.
describe('POST /api/revisions/[id]/restore — customer notes', () => {
  it('writes back ONLY the note column', async () => {
    vi.mocked(getRevision).mockResolvedValue(customerRevision());
    const res = await restorePOST(postReq() as any, ctx('rev-c1'));

    expect(res.status).toBe(200);
    const updates = customerUpdates();
    expect(updates).toHaveLength(1);
    expect(sqlOf(updates[0])).toBe('UPDATE customers SET note = ? WHERE id = ?');
    expect(updates[0][1]).toEqual(['บันทึกเดิมก่อนถูกแทนที่', 'cust-1']);
    // Asserted from the SQL actually issued, not from a comment: none of the
    // other columns in the snapshot is in the statement's column list.
    for (const column of ['companyId', 'name', 'department', 'phone', 'email']) {
      expect(sqlOf(updates[0])).not.toContain(column);
    }
  });

  it('says in the response that only the note was restored', async () => {
    vi.mocked(getRevision).mockResolvedValue(customerRevision());
    const body = await (await restorePOST(postReq() as any, ctx('rev-c1'))).json();
    expect(body.success).toBe(true);
    expect(body.entityId).toBe('cust-1');
    expect(body.restoredFields).toEqual(['note']);
    expect(body.changed).toBe(true);
  });

  it('reads, snapshots, then writes — in that order, on one connection', async () => {
    vi.mocked(getRevision).mockResolvedValue(customerRevision());
    await restorePOST(postReq() as any, ctx('rev-c1'));

    const order = connSql().map((s) =>
      /INSERT INTO revisions/i.test(s) ? 'revision'
        : /FROM revisions/i.test(s) ? 'trim'
        : /^UPDATE\b/i.test(s) ? 'update'
        : 'select'
    );
    expect(order).toEqual(['select', 'revision', 'trim', 'update']);
    // The read holds the row, so the note that is snapshotted is the note that
    // gets overwritten.
    expect(connSql()[0]).toContain('FOR UPDATE');
    // Everything goes through the transaction's connection — never the
    // pool-level query() — so a failed snapshot rolls the UPDATE back with it.
    expect(query).not.toHaveBeenCalled();
  });

  it('snapshots the CURRENT note before overwriting it (an undo is undoable)', async () => {
    vi.mocked(getRevision).mockResolvedValue(customerRevision());
    await restorePOST(postReq() as any, ctx('rev-c1'));

    const revision = conn.query.mock.calls.find((c) => /INSERT INTO revisions/i.test(sqlOf(c)))!;
    const params = revision[1] as unknown[];
    expect(params[1]).toBe('customer');
    expect(params[2]).toBe('cust-1');
    const snapshot = JSON.parse(params[3] as string);
    // The value being replaced right now — otherwise it would be the one value
    // with no way back.
    expect(snapshot.note).toBe(currentCustomer.note);
    // ...plus the name, so the entry is legible on its own (entityId is a
    // UUID, and the customer may since have been deleted). Nothing else: this
    // restore writes ONE column, so the rest could never be put back.
    expect(snapshot).toEqual({ name: 'สมชาย', note: currentCustomer.note });
    expect(Object.hasOwn(snapshot, 'phone')).toBe(false);
    expect(Object.hasOwn(snapshot, 'companyId')).toBe(false);
  });

  // ⚠️ Full-row snapshots written BEFORE the payload was slimmed are already
  //    in production. Slimming what is WRITTEN must not make what was already
  //    written unreadable — the shape is self-describing (the restore keys off
  //    the presence of a `note` key), not versioned, precisely so both work.
  it('still restores an OLD full-row snapshot written before the payload was slimmed', async () => {
    vi.mocked(getRevision).mockResolvedValue(
      customerRevision({
        id: 'cust-1',
        companyId: 'co-OLD',
        name: 'ชื่อเก่า',
        department: 'แผนกเก่า',
        phone: '02-000-0000',
        email: 'old@example.com',
        note: 'บันทึกเก่าจากสแนปชอตเต็มแถว',
      })
    );
    const res = await restorePOST(postReq() as any, ctx('rev-c1'));

    expect(res.status).toBe(200);
    const updates = customerUpdates();
    expect(updates).toHaveLength(1);
    expect(sqlOf(updates[0])).toBe('UPDATE customers SET note = ? WHERE id = ?');
    expect(updates[0][1]).toEqual(['บันทึกเก่าจากสแนปชอตเต็มแถว', 'cust-1']);
    // The stale companyId/name/phone in that old snapshot stay exactly where
    // they are — read, never written.
    expect(sqlOf(updates[0])).not.toContain('companyId');
  });

  it('restores a NEW lean snapshot identically — no version flag needed', async () => {
    vi.mocked(getRevision).mockResolvedValue(
      customerRevision({ name: 'สมชาย', note: 'บันทึกจากสแนปชอตแบบใหม่' })
    );
    const res = await restorePOST(postReq() as any, ctx('rev-c1'));

    expect(res.status).toBe(200);
    expect(customerUpdates()[0][1]).toEqual(['บันทึกจากสแนปชอตแบบใหม่', 'cust-1']);
  });

  it('NO HISTORY MEANS NO WRITE: a failed snapshot leaves the note alone', async () => {
    vi.mocked(getRevision).mockResolvedValue(customerRevision());
    conn.query.mockReset().mockImplementation((sql: string) => {
      if (/^\s*SELECT/i.test(sql)) return Promise.resolve([[currentCustomer]]);
      if (/INSERT INTO revisions/i.test(sql)) return Promise.reject(new Error('revisions write failed'));
      return Promise.resolve([{ affectedRows: 1 }]);
    });

    const res = await restorePOST(postReq() as any, ctx('rev-c1'));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('กู้คืนเวอร์ชันไม่สำเร็จ');
    expect(customerUpdates()).toEqual([]);
  });

  it('404s when the customer row is gone — a restore does not resurrect it', async () => {
    vi.mocked(getRevision).mockResolvedValue(customerRevision());
    scriptTx([]); // deleted since the snapshot was taken

    const res = await restorePOST(postReq() as any, ctx('rev-c1'));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toContain('ไม่พบลูกค้ารายนี้แล้ว');
    expect(customerUpdates()).toEqual([]);
    expect(connSql().some((s) => /INSERT INTO revisions/i.test(s))).toBe(false);
  });

  // `sanitizePlainText(...).substring(0, 2000)` in the customer write routes
  // cuts the tail off and tells nobody. A restore that did that would half-put
  // back a call log and report success.
  it('REFUSES an over-long snapshot rather than truncating it', async () => {
    const tooLong = 'ก'.repeat(2001);
    vi.mocked(getRevision).mockResolvedValue(customerRevision({ ...currentCustomer, note: tooLong }));

    const res = await restorePOST(postReq() as any, ctx('rev-c1'));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('เกินเพดาน 2000 ตัวอักษร');
    // Refused before a transaction is even opened, so no statement ran.
    expect(runTransaction).not.toHaveBeenCalled();
  });

  it('restores a snapshot that is exactly at the ceiling', async () => {
    const atLimit = 'ก'.repeat(2000);
    vi.mocked(getRevision).mockResolvedValue(customerRevision({ ...currentCustomer, note: atLimit }));

    const res = await restorePOST(postReq() as any, ctx('rev-c1'));
    expect(res.status).toBe(200);
    expect(customerUpdates()[0][1]).toEqual([atLimit, 'cust-1']);
  });

  it('restores an empty note stored as SQL NULL', async () => {
    vi.mocked(getRevision).mockResolvedValue(customerRevision({ ...currentCustomer, note: null }));
    const res = await restorePOST(postReq() as any, ctx('rev-c1'));
    expect(res.status).toBe(200);
    expect(customerUpdates()[0][1]).toEqual(['', 'cust-1']);
  });

  it('refuses a snapshot with no note key — will not write "" over a live log', async () => {
    const withoutNote: Record<string, unknown> = { ...currentCustomer };
    delete withoutNote.note;
    vi.mocked(getRevision).mockResolvedValue(customerRevision(withoutNote));

    const res = await restorePOST(postReq() as any, ctx('rev-c1'));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('ไม่ได้เก็บบันทึกลูกค้าไว้');
    expect(runTransaction).not.toHaveBeenCalled();
  });

  it('refuses a snapshot whose data is not an object, or whose note is not text', async () => {
    for (const data of [null, 'not an object', [{ note: 'x' }]]) {
      vi.mocked(getRevision).mockResolvedValue(customerRevision(data));
      expect((await restorePOST(postReq() as any, ctx('rev-c1'))).status).toBe(400);
    }
    vi.mocked(getRevision).mockResolvedValue(customerRevision({ note: { nested: true } }));
    expect((await restorePOST(postReq() as any, ctx('rev-c1'))).status).toBe(400);
    expect(runTransaction).not.toHaveBeenCalled();
  });

  // Also what makes a replayed transaction safe: withTransaction retries the
  // whole callback, and a retry that re-reads an already-restored note must
  // not write a second snapshot.
  it('writes nothing when the note already matches the snapshot', async () => {
    vi.mocked(getRevision).mockResolvedValue(customerRevision({ ...currentCustomer }));

    const res = await restorePOST(postReq() as any, ctx('rev-c1'));
    expect(res.status).toBe(200);
    expect((await res.json()).changed).toBe(false);
    expect(customerUpdates()).toEqual([]);
    expect(connSql().some((s) => /INSERT INTO revisions/i.test(s))).toBe(false);
  });

  it('leaves the product/content/document paths alone (no customer transaction)', async () => {
    vi.mocked(updateProduct).mockResolvedValue({ id: 'p1' } as any);
    vi.mocked(updateContent).mockResolvedValue({ id: 'c1' } as any);
    vi.mocked(getDocument).mockResolvedValue({ id: 'd1' } as any);

    for (const [entityType, entityId] of [
      ['product', 'p1'],
      ['content', 'c1'],
      ['document', 'd1'],
    ] as const) {
      vi.mocked(getRevision).mockResolvedValue({
        id: 'r', entityType, entityId, data: { title: 'old' }, createdAt: 't',
      } as any);
      const res = await restorePOST(postReq() as any, ctx('r'));
      expect(res.status).toBe(200);
      // The shared response shape, with no `restoredFields` — those three
      // restore the whole entity through their stores, exactly as before.
      expect(await res.json()).toEqual({ success: true, entityId });
    }
    expect(runTransaction).not.toHaveBeenCalled();
    expect(conn.query).not.toHaveBeenCalled();
  });
});

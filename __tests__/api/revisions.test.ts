// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET as listGET } from '@/app/api/revisions/route';
import { POST as restorePOST } from '@/app/api/revisions/[id]/restore/route';

vi.mock('@/app/lib/revisionStore', () => ({ listRevisions: vi.fn(), getRevision: vi.fn() }));
import { listRevisions, getRevision } from '@/app/lib/revisionStore';
vi.mock('@/app/lib/productStore', () => ({ updateProduct: vi.fn() }));
import { updateProduct } from '@/app/lib/productStore';
vi.mock('@/app/lib/contentStore', () => ({
  updateContent: vi.fn(),
  getContentByProductId: vi.fn(),
}));
import { updateContent, getContentByProductId } from '@/app/lib/contentStore';
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

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSession).mockResolvedValue(admin);
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

  it('restores a content revision (no products revalidate)', async () => {
    vi.mocked(getRevision).mockResolvedValue({
      id: 'r2', entityType: 'content', entityId: 'c1', data: { title: 'old' }, createdAt: 't',
    } as any);
    vi.mocked(updateContent).mockResolvedValue({ id: 'c1' } as any);
    const res = await restorePOST(postReq() as any, ctx('r2'));
    expect(res.status).toBe(200);
    expect(updateContent).toHaveBeenCalledWith('c1', { title: 'old' });
    expect(revalidateTag).not.toHaveBeenCalled();
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
});

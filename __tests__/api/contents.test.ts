// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/contents/route';
import {
  GET as getById,
  PUT as putById,
  DELETE as deleteById,
} from '@/app/api/contents/[id]/route';
import { GET as getByProduct } from '@/app/api/contents/by-product/[productId]/route';

// Content store — every route reads/writes content through this module.
vi.mock('@/app/lib/contentStore', () => {
  class ContentProductConflictError extends Error {
    constructor(public readonly productId: string) {
      super(`product ${productId} already has a content linked to it`);
      this.name = 'ContentProductConflictError';
    }
  }
  return {
    addContent: vi.fn(),
    getContent: vi.fn(),
    getAllContents: vi.fn(),
    getContentByProductId: vi.fn(),
    updateContent: vi.fn(),
    deleteContent: vi.fn(),
    ContentProductConflictError,
  };
});
import {
  addContent,
  getContent,
  getAllContents,
  getContentByProductId,
  updateContent,
  deleteContent,
  ContentProductConflictError,
} from '@/app/lib/contentStore';

// DELETE cascades to Cloudinary image cleanup — mock it so no network happens.
vi.mock('@/app/lib/cloudinaryHelper', () => ({
  collectContentImageUrls: vi.fn(),
}));
vi.mock('@/app/lib/imageUsageHelper', () => ({
  safeDeleteCloudinaryImages: vi.fn(),
}));
import { collectContentImageUrls } from '@/app/lib/cloudinaryHelper';
import { safeDeleteCloudinaryImages } from '@/app/lib/imageUsageHelper';

vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }));

// Drive the REAL requireAuth by controlling getSession (null = anon).
vi.mock('@/app/lib/session', () => ({ getSession: vi.fn() }));
import { getSession } from '@/app/lib/session';

// Anonymous-visibility filtering (hides content linked to unpublished
// products) reads through productStore — default to "no products, nothing
// hidden" so existing tests don't have to know about this unless they're
// specifically exercising the hidden-product path.
vi.mock('@/app/lib/productStore', () => ({
  getAllProducts: vi.fn(),
  getProduct: vi.fn(),
  isProductPublic: (p: any) => !!p && p.isPublished !== false && !p.pendingDeleteAt,
}));
import { getAllProducts, getProduct } from '@/app/lib/productStore';

const adminSession = { userId: '1', username: 'admin', expiresAt: new Date() } as any;

const sampleContent = {
  id: 'c-1',
  title: 'Sample',
  blocks: [],
  createdAt: '2026-01-01',
  productId: 'p-1',
} as any;

// State-changing requests flow through the real same-origin (CSRF) guard.
const mutatingRequest = (method: string, body?: any) =>
  new NextRequest('http://localhost/api/contents', {
    method,
    headers: { origin: 'http://localhost', host: 'localhost' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

const getRequest = () => new NextRequest('http://localhost/api/contents');

describe('Contents API Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSession).mockResolvedValue(null); // default: anonymous
    vi.mocked(getAllProducts).mockResolvedValue([]); // default: nothing hidden
    vi.mocked(getProduct).mockResolvedValue(undefined);
  });

  describe('POST /api/contents (create)', () => {
    it('rejects anonymous callers with 401 and does not persist', async () => {
      vi.mocked(getSession).mockResolvedValue(null);
      const res = await POST(mutatingRequest('POST', { productId: 'p-1' }));
      expect(res.status).toBe(401);
      expect((await res.json()).error).toBe('Unauthorized');
      expect(addContent).not.toHaveBeenCalled();
    });

    it('rejects a request missing productId with 400', async () => {
      vi.mocked(getSession).mockResolvedValue(adminSession);
      const res = await POST(mutatingRequest('POST', { title: 'No product' }));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe('Product ID is required');
      expect(addContent).not.toHaveBeenCalled();
    });

    it('rejects a second content for a product that already has one (400)', async () => {
      vi.mocked(getSession).mockResolvedValue(adminSession);
      vi.mocked(getContentByProductId).mockResolvedValue(sampleContent);
      const res = await POST(mutatingRequest('POST', { productId: 'p-1' }));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe(
        'This product already has a content linked to it'
      );
      expect(addContent).not.toHaveBeenCalled();
    });

    it('creates content and returns 201', async () => {
      vi.mocked(getSession).mockResolvedValue(adminSession);
      vi.mocked(getContentByProductId).mockResolvedValue(undefined);
      vi.mocked(addContent).mockResolvedValue(sampleContent);

      const res = await POST(mutatingRequest('POST', { id: 'c-1', productId: 'p-1' }));
      expect(res.status).toBe(201);
      expect(await res.json()).toEqual(sampleContent);
      expect(addContent).toHaveBeenCalledTimes(1);
    });

    it('translates a ContentProductConflictError from the store into the same 400 (race the pre-check missed)', async () => {
      vi.mocked(getSession).mockResolvedValue(adminSession);
      vi.mocked(getContentByProductId).mockResolvedValue(undefined); // pre-check saw it as free
      vi.mocked(addContent).mockRejectedValue(new ContentProductConflictError('p-1'));

      const res = await POST(mutatingRequest('POST', { id: 'c-1', productId: 'p-1' }));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe('This product already has a content linked to it');
    });
  });

  describe('GET /api/contents/[id]', () => {
    it('returns all contents when id === "all" (public)', async () => {
      const all = [sampleContent];
      vi.mocked(getAllContents).mockResolvedValue(all);
      const res = await getById(getRequest(), { params: Promise.resolve({ id: 'all' }) });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(all);
      expect(getContent).not.toHaveBeenCalled();
    });

    it('returns a single content when found (public)', async () => {
      vi.mocked(getContent).mockResolvedValue(sampleContent);
      const res = await getById(getRequest(), { params: Promise.resolve({ id: 'c-1' }) });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(sampleContent);
    });

    it('returns 404 when the content does not exist', async () => {
      vi.mocked(getContent).mockResolvedValue(undefined);
      const res = await getById(getRequest(), { params: Promise.resolve({ id: 'missing' }) });
      expect(res.status).toBe(404);
      expect((await res.json()).error).toBe('Content not found');
    });

    it('filters out content linked to unpublished products for anonymous callers (id="all")', async () => {
      const hiddenContent = { ...sampleContent, id: 'c-2', productId: 'p-hidden' };
      vi.mocked(getAllContents).mockResolvedValue([sampleContent, hiddenContent]);
      vi.mocked(getAllProducts).mockResolvedValue([
        { id: 'p-1', isPublished: true, pendingDeleteAt: null } as any,
        { id: 'p-hidden', isPublished: false, pendingDeleteAt: null } as any,
      ]);
      const res = await getById(getRequest(), { params: Promise.resolve({ id: 'all' }) });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual([sampleContent]);
    });

    it('does not filter content for a logged-in admin (id="all")', async () => {
      const hiddenContent = { ...sampleContent, id: 'c-2', productId: 'p-hidden' };
      vi.mocked(getSession).mockResolvedValue(adminSession);
      vi.mocked(getAllContents).mockResolvedValue([sampleContent, hiddenContent]);
      const res = await getById(getRequest(), { params: Promise.resolve({ id: 'all' }) });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual([sampleContent, hiddenContent]);
      expect(getAllProducts).not.toHaveBeenCalled();
    });

    it('404s a single content whose linked product is unpublished, for anonymous callers', async () => {
      vi.mocked(getContent).mockResolvedValue(sampleContent); // productId: 'p-1'
      vi.mocked(getAllProducts).mockResolvedValue([
        { id: 'p-1', isPublished: false, pendingDeleteAt: null } as any,
      ]);
      const res = await getById(getRequest(), { params: Promise.resolve({ id: 'c-1' }) });
      expect(res.status).toBe(404);
    });

    it('still returns a single content whose linked product is unpublished, for a logged-in admin', async () => {
      vi.mocked(getSession).mockResolvedValue(adminSession);
      vi.mocked(getContent).mockResolvedValue(sampleContent);
      const res = await getById(getRequest(), { params: Promise.resolve({ id: 'c-1' }) });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(sampleContent);
      expect(getAllProducts).not.toHaveBeenCalled();
    });
  });

  describe('PUT /api/contents/[id] (update)', () => {
    it('rejects anonymous callers with 401 and does not persist', async () => {
      vi.mocked(getSession).mockResolvedValue(null);
      const res = await putById(mutatingRequest('PUT', { title: 'x' }), {
        params: Promise.resolve({ id: 'c-1' }),
      });
      expect(res.status).toBe(401);
      expect((await res.json()).error).toBe('Unauthorized');
      expect(updateContent).not.toHaveBeenCalled();
    });

    it('rejects reassigning a product already linked to another content (400)', async () => {
      vi.mocked(getSession).mockResolvedValue(adminSession);
      // Another content (different id) already owns this product.
      vi.mocked(getContentByProductId).mockResolvedValue({ ...sampleContent, id: 'other' });
      const res = await putById(mutatingRequest('PUT', { productId: 'p-1' }), {
        params: Promise.resolve({ id: 'c-1' }),
      });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe(
        'This product already has a content linked to it'
      );
      expect(updateContent).not.toHaveBeenCalled();
    });

    it('updates content and returns 200', async () => {
      vi.mocked(getSession).mockResolvedValue(adminSession);
      const updated = { ...sampleContent, title: 'Updated' };
      vi.mocked(updateContent).mockResolvedValue(updated);
      const res = await putById(mutatingRequest('PUT', { title: 'Updated' }), {
        params: Promise.resolve({ id: 'c-1' }),
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(updated);
      expect(updateContent).toHaveBeenCalledWith('c-1', { title: 'Updated' });
    });

    it('translates a ContentProductConflictError from the store into the same 400 (race the pre-check missed)', async () => {
      vi.mocked(getSession).mockResolvedValue(adminSession);
      vi.mocked(getContentByProductId).mockResolvedValue(undefined); // pre-check saw it as free
      vi.mocked(updateContent).mockRejectedValue(new ContentProductConflictError('p-1'));

      const res = await putById(mutatingRequest('PUT', { productId: 'p-1' }), {
        params: Promise.resolve({ id: 'c-1' }),
      });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe('This product already has a content linked to it');
    });

    it('returns 404 when updating a content that does not exist', async () => {
      vi.mocked(getSession).mockResolvedValue(adminSession);
      vi.mocked(updateContent).mockResolvedValue(undefined);
      const res = await putById(mutatingRequest('PUT', { title: 'x' }), {
        params: Promise.resolve({ id: 'missing' }),
      });
      expect(res.status).toBe(404);
      expect((await res.json()).error).toBe('Content not found');
    });
  });

  describe('DELETE /api/contents/[id]', () => {
    it('rejects anonymous callers with 401 and does not delete', async () => {
      vi.mocked(getSession).mockResolvedValue(null);
      const res = await deleteById(mutatingRequest('DELETE'), {
        params: Promise.resolve({ id: 'c-1' }),
      });
      expect(res.status).toBe(401);
      expect((await res.json()).error).toBe('Unauthorized');
      expect(deleteContent).not.toHaveBeenCalled();
    });

    it('returns 404 when the content does not exist', async () => {
      vi.mocked(getSession).mockResolvedValue(adminSession);
      vi.mocked(getContent).mockResolvedValue(undefined);
      const res = await deleteById(mutatingRequest('DELETE'), {
        params: Promise.resolve({ id: 'missing' }),
      });
      expect(res.status).toBe(404);
      expect((await res.json()).error).toBe('Content not found');
      expect(deleteContent).not.toHaveBeenCalled();
    });

    it('deletes the content and returns orphanedImages for client confirmation (200)', async () => {
      vi.mocked(getSession).mockResolvedValue(adminSession);
      vi.mocked(getContent).mockResolvedValue(sampleContent);
      vi.mocked(collectContentImageUrls).mockReturnValue(['https://res.cloudinary.com/img/a.png', 'https://res.cloudinary.com/img/b.png']);
      vi.mocked(deleteContent).mockResolvedValue(true);

      const res = await deleteById(mutatingRequest('DELETE'), {
        params: Promise.resolve({ id: 'c-1' }),
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.deletedImages).toBe(2);
      expect(json.orphanedImages).toEqual([
        'https://res.cloudinary.com/img/a.png',
        'https://res.cloudinary.com/img/b.png',
      ]);
      expect(deleteContent).toHaveBeenCalledWith('c-1');
      // Should NOT auto-delete from Cloudinary
      expect(safeDeleteCloudinaryImages).not.toHaveBeenCalled();
    });

    it('returns empty orphanedImages when there are no images', async () => {
      vi.mocked(getSession).mockResolvedValue(adminSession);
      vi.mocked(getContent).mockResolvedValue(sampleContent);
      vi.mocked(collectContentImageUrls).mockReturnValue([]);
      vi.mocked(deleteContent).mockResolvedValue(true);

      const res = await deleteById(mutatingRequest('DELETE'), {
        params: Promise.resolve({ id: 'c-1' }),
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.deletedImages).toBe(0);
      expect(json.orphanedImages).toEqual([]);
      expect(safeDeleteCloudinaryImages).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/contents/by-product/[productId]', () => {
    it('returns the content linked to a product (public)', async () => {
      vi.mocked(getContentByProductId).mockResolvedValue(sampleContent);
      vi.mocked(getProduct).mockResolvedValue({ id: 'p-1', isPublished: true, pendingDeleteAt: null } as any);
      const res = await getByProduct(getRequest(), {
        params: Promise.resolve({ productId: 'p-1' }),
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(sampleContent);
    });

    it('hides content linked to an unpublished product from anonymous callers (404)', async () => {
      vi.mocked(getContentByProductId).mockResolvedValue(sampleContent);
      vi.mocked(getProduct).mockResolvedValue({ id: 'p-1', isPublished: false, pendingDeleteAt: null } as any);
      const res = await getByProduct(getRequest(), {
        params: Promise.resolve({ productId: 'p-1' }),
      });
      expect(res.status).toBe(404);
    });

    it('still returns content linked to an unpublished product to a logged-in admin', async () => {
      vi.mocked(getSession).mockResolvedValue(adminSession);
      vi.mocked(getContentByProductId).mockResolvedValue(sampleContent);
      vi.mocked(getProduct).mockResolvedValue({ id: 'p-1', isPublished: false, pendingDeleteAt: null } as any);
      const res = await getByProduct(getRequest(), {
        params: Promise.resolve({ productId: 'p-1' }),
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(sampleContent);
    });

    it('returns 404 when no content is linked to the product', async () => {
      vi.mocked(getContentByProductId).mockResolvedValue(undefined);
      const res = await getByProduct(getRequest(), {
        params: Promise.resolve({ productId: 'nope' }),
      });
      expect(res.status).toBe(404);
      expect((await res.json()).error).toBe('No content found for this product');
    });
  });
});

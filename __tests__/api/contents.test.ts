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
vi.mock('@/app/lib/contentStore', () => ({
  addContent: vi.fn(),
  getContent: vi.fn(),
  getAllContents: vi.fn(),
  getContentByProductId: vi.fn(),
  updateContent: vi.fn(),
  deleteContent: vi.fn(),
}));
import {
  addContent,
  getContent,
  getAllContents,
  getContentByProductId,
  updateContent,
  deleteContent,
} from '@/app/lib/contentStore';

// DELETE cascades to Cloudinary image cleanup — mock it so no network happens.
vi.mock('@/app/lib/cloudinaryHelper', () => ({
  collectContentImageUrls: vi.fn(),
  deleteCloudinaryImages: vi.fn(),
}));
import {
  collectContentImageUrls,
  deleteCloudinaryImages,
} from '@/app/lib/cloudinaryHelper';

vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }));

// Drive the REAL requireAuth by controlling getSession (null = anon).
vi.mock('@/app/lib/session', () => ({ getSession: vi.fn() }));
import { getSession } from '@/app/lib/session';

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

    it('deletes the content and its Cloudinary images (200)', async () => {
      vi.mocked(getSession).mockResolvedValue(adminSession);
      vi.mocked(getContent).mockResolvedValue(sampleContent);
      vi.mocked(collectContentImageUrls).mockReturnValue(['https://img/a.png', 'https://img/b.png']);
      vi.mocked(deleteContent).mockResolvedValue(true);

      const res = await deleteById(mutatingRequest('DELETE'), {
        params: Promise.resolve({ id: 'c-1' }),
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ success: true, deletedImages: 2 });
      expect(deleteContent).toHaveBeenCalledWith('c-1');
      expect(deleteCloudinaryImages).toHaveBeenCalledWith([
        'https://img/a.png',
        'https://img/b.png',
      ]);
    });

    it('skips Cloudinary cleanup when there are no images', async () => {
      vi.mocked(getSession).mockResolvedValue(adminSession);
      vi.mocked(getContent).mockResolvedValue(sampleContent);
      vi.mocked(collectContentImageUrls).mockReturnValue([]);
      vi.mocked(deleteContent).mockResolvedValue(true);

      const res = await deleteById(mutatingRequest('DELETE'), {
        params: Promise.resolve({ id: 'c-1' }),
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ success: true, deletedImages: 0 });
      expect(deleteCloudinaryImages).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/contents/by-product/[productId]', () => {
    it('returns the content linked to a product (public)', async () => {
      vi.mocked(getContentByProductId).mockResolvedValue(sampleContent);
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

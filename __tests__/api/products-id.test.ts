// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, PUT, DELETE } from '@/app/api/products/[id]/route';

// Product store — only the functions these handlers touch.
vi.mock('@/app/lib/productStore', () => ({
  getProduct: vi.fn(),
  updateProduct: vi.fn(),
  deleteProduct: vi.fn(),
}));
import { getProduct, updateProduct, deleteProduct } from '@/app/lib/productStore';

// DELETE also cascades into linked contents + Cloudinary; keep those inert.
vi.mock('@/app/lib/contentStore', () => ({
  getAllContents: vi.fn(),
  deleteContent: vi.fn(),
}));
import { getAllContents } from '@/app/lib/contentStore';

vi.mock('@/app/lib/cloudinaryHelper', () => ({
  deleteCloudinaryImage: vi.fn(),
  deleteCloudinaryImages: vi.fn(),
  collectContentImageUrls: vi.fn(() => []),
}));

vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }));
import { revalidateTag } from 'next/cache';

// Drive the REAL requireAuth by controlling getSession (null = anonymous).
vi.mock('@/app/lib/session', () => ({ getSession: vi.fn() }));
import { getSession } from '@/app/lib/session';

const adminSession = { userId: '1', username: 'admin', expiresAt: new Date() } as any;

// State-changing requests exercise the real withRoute same-origin guard:
// matching origin + host headers so the CSRF check passes.
const mutatingRequest = (method: string, body?: any) =>
  new NextRequest('http://localhost:3000/api/products/1', {
    method,
    headers: { origin: 'http://localhost:3000', host: 'localhost:3000' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

describe('Products [id] API Route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSession).mockResolvedValue(null); // default: anonymous
  });

  describe('GET /api/products/[id]', () => {
    const getRequest = () => new NextRequest('http://localhost:3000/api/products/1');

    it('returns a published product (200) to anyone', async () => {
      const product = { id: '1', title_en: 'Visible', isPublished: true };
      vi.mocked(getProduct).mockResolvedValue(product as any);

      const res = await GET(getRequest(), ctx('1'));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(product);
    });

    it('returns 404 when the product does not exist', async () => {
      vi.mocked(getProduct).mockResolvedValue(undefined as any);

      const res = await GET(getRequest(), ctx('missing'));
      expect(res.status).toBe(404);
      expect((await res.json()).error).toBe('Product not found');
    });

    it('hides an unpublished product from anonymous callers as 404 (not 403)', async () => {
      vi.mocked(getSession).mockResolvedValue(null);
      vi.mocked(getProduct).mockResolvedValue({
        id: '2',
        title_en: 'Hidden',
        isPublished: false,
      } as any);

      const res = await GET(getRequest(), ctx('2'));
      expect(res.status).toBe(404);
      expect((await res.json()).error).toBe('Product not found');
    });

    it('returns an unpublished product (200) to a logged-in admin', async () => {
      vi.mocked(getSession).mockResolvedValue(adminSession);
      const product = { id: '2', title_en: 'Hidden', isPublished: false };
      vi.mocked(getProduct).mockResolvedValue(product as any);

      const res = await GET(getRequest(), ctx('2'));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(product);
    });
  });

  describe('PUT /api/products/[id]', () => {
    const body = { title_en: 'Updated' };

    it('rejects anonymous callers with 401 (real requireAuth path)', async () => {
      vi.mocked(getSession).mockResolvedValue(null);

      const res = await PUT(mutatingRequest('PUT', body), ctx('1'));
      expect(res.status).toBe(401);
      expect((await res.json()).error).toBe('Unauthorized');
      expect(updateProduct).not.toHaveBeenCalled();
      expect(revalidateTag).not.toHaveBeenCalled();
    });

    it('returns 404 when the product to update is not found', async () => {
      vi.mocked(getSession).mockResolvedValue(adminSession);
      vi.mocked(updateProduct).mockResolvedValue(undefined as any);

      const res = await PUT(mutatingRequest('PUT', body), ctx('missing'));
      expect(res.status).toBe(404);
      expect((await res.json()).error).toBe('Product not found');
      expect(revalidateTag).not.toHaveBeenCalled();
    });

    it('updates the product, revalidates cache, and returns 200', async () => {
      vi.mocked(getSession).mockResolvedValue(adminSession);
      const updated = { id: '1', title_en: 'Updated', isPublished: true };
      vi.mocked(updateProduct).mockResolvedValue(updated as any);

      const res = await PUT(mutatingRequest('PUT', body), ctx('1'));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(updated);
      expect(updateProduct).toHaveBeenCalledWith('1', body);
      expect(revalidateTag).toHaveBeenCalledWith('products', { expire: 0 });
    });
  });

  describe('DELETE /api/products/[id]', () => {
    it('rejects anonymous callers with 401 (real requireAuth path)', async () => {
      vi.mocked(getSession).mockResolvedValue(null);

      const res = await DELETE(mutatingRequest('DELETE'), ctx('1'));
      expect(res.status).toBe(401);
      expect((await res.json()).error).toBe('Unauthorized');
      expect(deleteProduct).not.toHaveBeenCalled();
      expect(revalidateTag).not.toHaveBeenCalled();
    });

    it('returns 404 when the product to delete is not found', async () => {
      vi.mocked(getSession).mockResolvedValue(adminSession);
      vi.mocked(getProduct).mockResolvedValue(undefined as any);

      const res = await DELETE(mutatingRequest('DELETE'), ctx('missing'));
      expect(res.status).toBe(404);
      expect((await res.json()).error).toBe('Product not found');
      expect(deleteProduct).not.toHaveBeenCalled();
      expect(revalidateTag).not.toHaveBeenCalled();
    });

    it('deletes the product, revalidates cache, and returns 200', async () => {
      vi.mocked(getSession).mockResolvedValue(adminSession);
      vi.mocked(getProduct).mockResolvedValue({
        id: '1',
        title_en: 'Doomed',
        image: 'https://example.com/local.png', // not Cloudinary → no image cleanup
      } as any);
      vi.mocked(getAllContents).mockResolvedValue([]); // no linked contents
      vi.mocked(deleteProduct).mockResolvedValue(true);

      const res = await DELETE(mutatingRequest('DELETE'), ctx('1'));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ success: true });
      expect(deleteProduct).toHaveBeenCalledWith('1');
      expect(revalidateTag).toHaveBeenCalledWith('products', { expire: 0 });
    });
  });
});

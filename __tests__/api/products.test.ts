// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST } from '@/app/api/products/route';

// Product store
vi.mock('@/app/lib/productStore', () => ({
  getAllProducts: vi.fn(),
  addProduct: vi.fn(),
}));
import { getAllProducts, addProduct } from '@/app/lib/productStore';

vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }));
import { revalidateTag } from 'next/cache';

// Drive auth through the REAL requireAuth/withRoute by controlling getSession
// (null = anonymous, object = logged-in admin) instead of stubbing requireAuth.
// This exercises the true 401 contract and the published-only filtering.
vi.mock('@/app/lib/session', () => ({ getSession: vi.fn() }));
import { getSession } from '@/app/lib/session';

const adminSession = { userId: '1', username: 'admin', expiresAt: new Date() } as any;

describe('Products API Route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSession).mockResolvedValue(null); // default: anonymous
  });

  describe('GET /api/products', () => {
    const products = [
      { id: '1', title_en: 'Visible', isPublished: true },
      { id: '2', title_en: 'Hidden', isPublished: false },
    ];

    it('returns only published products to anonymous callers', async () => {
      vi.mocked(getAllProducts).mockResolvedValue(products as any);
      const res = await GET();
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual([products[0]]);
    });

    it('returns all products (incl. unpublished) to a logged-in admin', async () => {
      vi.mocked(getSession).mockResolvedValue(adminSession);
      vi.mocked(getAllProducts).mockResolvedValue(products as any);
      const res = await GET();
      expect(await res.json()).toEqual(products);
    });
  });

  describe('POST /api/products', () => {
    const mockRequest = (body: any) =>
      new NextRequest('http://localhost', { method: 'POST', body: JSON.stringify(body) });

    const validProduct = {
      id: 'p-1',
      categoryId: 0,
      image: 'https://res.cloudinary.com/x/image/upload/v1/a.png',
      title_th: 'ชื่อ',
      title_en: 'Name',
      title_zh: '名',
      desc_th: '',
      desc_en: '',
      desc_zh: '',
    };

    it('rejects anonymous callers with 401 (real requireAuth path)', async () => {
      vi.mocked(getSession).mockResolvedValue(null);
      const res = await POST(mockRequest(validProduct));
      expect(res.status).toBe(401);
      expect((await res.json()).error).toBe('Unauthorized');
      expect(addProduct).not.toHaveBeenCalled();
    });

    it('rejects an authenticated request missing required fields with 400', async () => {
      vi.mocked(getSession).mockResolvedValue(adminSession);
      const res = await POST(mockRequest({ title_en: 'Only English' }));
      expect(res.status).toBe(400);
      expect(addProduct).not.toHaveBeenCalled();
    });

    it('creates a product, revalidates cache, and returns 201', async () => {
      vi.mocked(getSession).mockResolvedValue(adminSession);
      const created = { ...validProduct, createdAt: '2026-01-01', isPublished: true };
      vi.mocked(addProduct).mockResolvedValue(created as any);

      const res = await POST(mockRequest(validProduct));
      expect(res.status).toBe(201);
      expect(await res.json()).toEqual(created);
      expect(revalidateTag).toHaveBeenCalledWith('products', { expire: 0 });
      // createdAt must be assigned server-side, not taken from the client.
      const passed = vi.mocked(addProduct).mock.calls[0][0];
      expect(typeof passed.createdAt).toBe('string');
    });
  });
});

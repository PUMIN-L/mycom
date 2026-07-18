// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST } from '@/app/api/products/categories/route';
import {
  DELETE,
  PUT as PUT_CATEGORY,
} from '@/app/api/products/categories/[id]/route';
import { PUT as PUT_REORDER } from '@/app/api/products/categories/reorder/route';

// Product store — every category function the three route modules touch.
vi.mock('@/app/lib/productStore', () => ({
  getAllCategories: vi.fn(),
  addCategory: vi.fn(),
  deleteCategory: vi.fn(),
  updateCategory: vi.fn(),
  reorderCategories: vi.fn(),
  getProductsByCategory: vi.fn(),
}));
import {
  getAllCategories,
  addCategory,
  deleteCategory,
  updateCategory,
  reorderCategories,
  getProductsByCategory,
} from '@/app/lib/productStore';

vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }));
import { revalidateTag } from 'next/cache';

// Drive the REAL requireAuth by controlling getSession (null = anonymous).
vi.mock('@/app/lib/session', () => ({ getSession: vi.fn() }));
import { getSession } from '@/app/lib/session';

const adminSession = { userId: '1', username: 'admin', expiresAt: new Date() } as any;

// State-changing requests exercise the real withRoute same-origin guard:
// matching origin + host so the CSRF check passes.
const mutatingRequest = (url: string, method: string, body?: any) =>
  new NextRequest(url, {
    method,
    headers: { origin: 'http://localhost:3000', host: 'localhost:3000' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

const CATEGORIES_URL = 'http://localhost:3000/api/products/categories';
const CATEGORY_URL = 'http://localhost:3000/api/products/categories/5';
const REORDER_URL = 'http://localhost:3000/api/products/categories/reorder';

describe('Product Categories API Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSession).mockResolvedValue(null); // default: anonymous
  });

  describe('GET /api/products/categories', () => {
    it('returns all categories (public, 200)', async () => {
      const categories = [
        { id: 0, name_en: 'General', order: 0 },
        { id: 1, name_en: 'Books', order: 1 },
      ];
      vi.mocked(getAllCategories).mockResolvedValue(categories as any);

      const res = await GET();
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(categories);
    });
  });

  describe('POST /api/products/categories', () => {
    const validCategory = { name_th: 'ชื่อ', name_en: 'Name', name_zh: '名' };

    it('rejects anonymous callers with 401 (real requireAuth path)', async () => {
      vi.mocked(getSession).mockResolvedValue(null);

      const res = await POST(mutatingRequest(CATEGORIES_URL, 'POST', validCategory));
      expect(res.status).toBe(401);
      expect((await res.json()).error).toBe('Unauthorized');
      expect(addCategory).not.toHaveBeenCalled();
    });

    it('rejects an authenticated request missing required names with 400', async () => {
      vi.mocked(getSession).mockResolvedValue(adminSession);

      const res = await POST(
        mutatingRequest(CATEGORIES_URL, 'POST', { name_en: 'Only English' })
      );
      expect(res.status).toBe(400);
      expect(addCategory).not.toHaveBeenCalled();
      expect(revalidateTag).not.toHaveBeenCalled();
    });

    it('creates a category, revalidates cache, and returns 201', async () => {
      vi.mocked(getSession).mockResolvedValue(adminSession);
      const created = { id: 2, ...validCategory, order: 2 };
      vi.mocked(addCategory).mockResolvedValue(created as any);

      const res = await POST(mutatingRequest(CATEGORIES_URL, 'POST', validCategory));
      expect(res.status).toBe(201);
      expect(await res.json()).toEqual(created);
      expect(addCategory).toHaveBeenCalledWith(validCategory);
      expect(revalidateTag).toHaveBeenCalledWith('products', { expire: 0 });
    });
  });

  describe('DELETE /api/products/categories/[id]', () => {
    it('rejects anonymous callers with 401 (real requireAuth path)', async () => {
      vi.mocked(getSession).mockResolvedValue(null);

      const res = await DELETE(mutatingRequest(CATEGORY_URL, 'DELETE'), ctx('5'));
      expect(res.status).toBe(401);
      expect((await res.json()).error).toBe('Unauthorized');
      expect(deleteCategory).not.toHaveBeenCalled();
    });

    it('blocks deletion (400) while the category still contains products', async () => {
      vi.mocked(getSession).mockResolvedValue(adminSession);
      vi.mocked(getProductsByCategory).mockResolvedValue([{ id: 'p1' }] as any);

      const res = await DELETE(mutatingRequest(CATEGORY_URL, 'DELETE'), ctx('5'));
      expect(res.status).toBe(400);
      expect(deleteCategory).not.toHaveBeenCalled();
      expect(revalidateTag).not.toHaveBeenCalled();
    });

    it('returns 404 when the category to delete is not found', async () => {
      vi.mocked(getSession).mockResolvedValue(adminSession);
      vi.mocked(getProductsByCategory).mockResolvedValue([] as any);
      vi.mocked(deleteCategory).mockResolvedValue(false);

      const res = await DELETE(mutatingRequest(CATEGORY_URL, 'DELETE'), ctx('5'));
      expect(res.status).toBe(404);
      expect((await res.json()).error).toBe('Category not found');
      expect(revalidateTag).not.toHaveBeenCalled();
    });

    it('deletes the category, revalidates cache, and returns 200', async () => {
      vi.mocked(getSession).mockResolvedValue(adminSession);
      vi.mocked(getProductsByCategory).mockResolvedValue([] as any);
      vi.mocked(deleteCategory).mockResolvedValue(true);

      const res = await DELETE(mutatingRequest(CATEGORY_URL, 'DELETE'), ctx('5'));
      expect(res.status).toBe(200);
      expect(deleteCategory).toHaveBeenCalledWith(5);
      expect(revalidateTag).toHaveBeenCalledWith('products', { expire: 0 });
    });
  });

  describe('PUT /api/products/categories/[id]', () => {
    const body = { name_th: 'ชื่อ', name_en: 'Name', name_zh: '名' };

    it('rejects anonymous callers with 401 (real requireAuth path)', async () => {
      vi.mocked(getSession).mockResolvedValue(null);

      const res = await PUT_CATEGORY(mutatingRequest(CATEGORY_URL, 'PUT', body), ctx('5'));
      expect(res.status).toBe(401);
      expect((await res.json()).error).toBe('Unauthorized');
      expect(updateCategory).not.toHaveBeenCalled();
    });

    it('returns 404 when the category to update is not found', async () => {
      vi.mocked(getSession).mockResolvedValue(adminSession);
      vi.mocked(updateCategory).mockResolvedValue(false);

      const res = await PUT_CATEGORY(mutatingRequest(CATEGORY_URL, 'PUT', body), ctx('5'));
      expect(res.status).toBe(404);
      expect((await res.json()).error).toBe('Category not found');
      expect(revalidateTag).not.toHaveBeenCalled();
    });

    it('updates the category, revalidates cache, and returns 200', async () => {
      vi.mocked(getSession).mockResolvedValue(adminSession);
      vi.mocked(updateCategory).mockResolvedValue(true);

      const res = await PUT_CATEGORY(mutatingRequest(CATEGORY_URL, 'PUT', body), ctx('5'));
      expect(res.status).toBe(200);
      expect(updateCategory).toHaveBeenCalledWith(5, body);
      expect(revalidateTag).toHaveBeenCalledWith('products', { expire: 0 });
    });
  });

  describe('PUT /api/products/categories/reorder', () => {
    it('rejects anonymous callers with 401 (real requireAuth path)', async () => {
      vi.mocked(getSession).mockResolvedValue(null);

      const res = await PUT_REORDER(
        mutatingRequest(REORDER_URL, 'PUT', { categoryIds: [2, 1, 0] })
      );
      expect(res.status).toBe(401);
      expect((await res.json()).error).toBe('Unauthorized');
      expect(reorderCategories).not.toHaveBeenCalled();
    });

    it('rejects a bad payload (categoryIds not an array) with 400', async () => {
      vi.mocked(getSession).mockResolvedValue(adminSession);

      const res = await PUT_REORDER(
        mutatingRequest(REORDER_URL, 'PUT', { categoryIds: 'not-an-array' })
      );
      expect(res.status).toBe(400);
      expect(reorderCategories).not.toHaveBeenCalled();
      expect(revalidateTag).not.toHaveBeenCalled();
    });

    it('reorders categories, revalidates cache, and returns 200', async () => {
      vi.mocked(getSession).mockResolvedValue(adminSession);
      vi.mocked(reorderCategories).mockResolvedValue(true);

      const res = await PUT_REORDER(
        mutatingRequest(REORDER_URL, 'PUT', { categoryIds: [2, 1, 0] })
      );
      expect(res.status).toBe(200);
      expect(reorderCategories).toHaveBeenCalledWith([2, 1, 0]);
      expect(revalidateTag).toHaveBeenCalledWith('products', { expire: 0 });
    });
  });
});

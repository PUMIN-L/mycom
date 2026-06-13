// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST } from '@/app/api/products/route';

// Mock API Helpers
vi.mock('@/app/lib/apiHelpers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/app/lib/apiHelpers')>();
  return {
    ...actual,
    requireAuth: vi.fn(),
  };
});
import { requireAuth } from '@/app/lib/apiHelpers';

// Mock Product Store
vi.mock('@/app/lib/productStore', () => ({
  getAllProducts: vi.fn(),
  addProduct: vi.fn(),
}));
import { getAllProducts, addProduct } from '@/app/lib/productStore';

// Mock next/cache
vi.mock('next/cache', () => ({
  revalidateTag: vi.fn(),
}));
import { revalidateTag } from 'next/cache';

describe('Products API Route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/products', () => {
    it('returns a list of products', async () => {
      const mockProducts = [{ id: '1', title_en: 'Test Product' }];
      vi.mocked(getAllProducts).mockResolvedValue(mockProducts as any);

      const res = await GET();
      expect(res.status).toBe(200);
      
      const body = await res.json();
      expect(body).toEqual(mockProducts);
    });
  });

  describe('POST /api/products', () => {
    const mockRequest = (body: any) => {
      return new NextRequest('http://localhost', {
        method: 'POST',
        body: JSON.stringify(body),
      });
    };

    it('requires authentication', async () => {
      vi.mocked(requireAuth).mockRejectedValue(new Error('Unauthorized'));
      const req = mockRequest({ title_en: 'New Product' });

      const res = await POST(req);
      expect(res.status).toBe(500); // Because we threw a generic Error in the mock
      expect(requireAuth).toHaveBeenCalled();
    });

    it('creates a product, revalidates cache, and returns 201', async () => {
      vi.mocked(requireAuth).mockResolvedValue({} as any);
      const newProductData = { title_en: 'New Product' };
      const createdProduct = { id: '2', ...newProductData };
      
      vi.mocked(addProduct).mockResolvedValue(createdProduct as any);
      const req = mockRequest(newProductData);

      const res = await POST(req);
      expect(res.status).toBe(201);
      
      const body = await res.json();
      expect(body).toEqual(createdProduct);
      expect(revalidateTag).toHaveBeenCalledWith('products', 'max');
    });
  });
});

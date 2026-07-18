// @vitest-environment node
// Targeted branch-coverage tests for route handlers — the error/cascade/guard
// paths the per-route suites didn't reach (product-delete cascade, the
// quotation uploaded-image safety filter, isNaN/500 guards, extra validation).
// One file mocks every store it needs; each case drives the REAL withRoute +
// requireAuth. Keeps the logic-surface coverage honest without duplicating the
// happy-path suites.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

import { DELETE as deleteProductRoute } from '@/app/api/products/[id]/route';
import { POST as postProduct } from '@/app/api/products/route';
import { POST as postQuotation } from '@/app/api/quotations/route';
import {
  DELETE as deleteCategoryRoute,
  PUT as putCategoryRoute,
} from '@/app/api/products/categories/[id]/route';
import { PUT as reorderRoute } from '@/app/api/products/categories/reorder/route';
import { DELETE as deleteContentRoute } from '@/app/api/contents/[id]/route';
import { PUT as putContactEmail } from '@/app/api/settings/contact-email/route';

vi.mock('@/app/lib/productStore', () => ({
  getProduct: vi.fn(),
  deleteProduct: vi.fn(),
  addProduct: vi.fn(),
  deleteCategory: vi.fn(),
  reorderCategories: vi.fn(),
  getProductsByCategory: vi.fn(),
}));
import {
  getProduct,
  deleteProduct,
  addProduct,
  deleteCategory,
  reorderCategories,
  getProductsByCategory,
} from '@/app/lib/productStore';

vi.mock('@/app/lib/contentStore', () => ({
  getAllContents: vi.fn(),
  getContent: vi.fn(),
  deleteContent: vi.fn(),
}));
import { getAllContents, getContent, deleteContent } from '@/app/lib/contentStore';

vi.mock('@/app/lib/cloudinaryHelper', () => ({
  deleteCloudinaryImage: vi.fn(),
  deleteCloudinaryImages: vi.fn(),
  collectContentImageUrls: vi.fn(() => []),
}));
import {
  deleteCloudinaryImage,
  deleteCloudinaryImages,
  collectContentImageUrls,
} from '@/app/lib/cloudinaryHelper';

vi.mock('@/app/lib/quotationStore', () => ({
  saveQuotation: vi.fn(),
  reserveDocNo: vi.fn(),
  getDocNoOwner: vi.fn(),
}));
import { saveQuotation, getDocNoOwner } from '@/app/lib/quotationStore';

vi.mock('@/app/lib/settingsStore', () => ({
  getContactEmail: vi.fn(),
  setSetting: vi.fn(),
}));
import { setSetting } from '@/app/lib/settingsStore';

vi.mock('@/app/lib/mailer', () => ({
  sendContactRecipientChangedEmail: vi.fn(),
  isMailConfigured: vi.fn(() => true),
}));

vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }));

vi.mock('@/app/lib/session', () => ({ getSession: vi.fn() }));
import { getSession } from '@/app/lib/session';

const admin = { userId: '1', username: 'admin', expiresAt: new Date() } as any;

// State-changing requests must carry a matching origin+host to satisfy the real
// same-origin guard inside withRoute.
const req = (method: string, body?: unknown) =>
  new NextRequest('http://localhost/api/x', {
    method,
    headers: { origin: 'http://localhost', host: 'localhost' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSession).mockResolvedValue(admin); // default: logged in
});

describe('DELETE /api/products/[id] — cascade branches', () => {
  it('deletes only the linked content (filter predicate), purges its images, and the product image', async () => {
    vi.mocked(getProduct).mockResolvedValue({
      id: 'p1',
      image: 'https://res.cloudinary.com/x/image/upload/v1/prod.png',
    } as any);
    vi.mocked(getAllContents).mockResolvedValue([
      { id: 'c1', productId: 'p1' },
      { id: 'c2', productId: 'other' },
    ] as any);
    vi.mocked(collectContentImageUrls).mockReturnValue(['https://res.cloudinary.com/x/a.png']);
    vi.mocked(deleteProduct).mockResolvedValue(true);

    const res = await deleteProductRoute(req('DELETE') as any, ctx('p1'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    // Only the linked content (c1) is touched — c2 is filtered out.
    expect(deleteContent).toHaveBeenCalledTimes(1);
    expect(deleteContent).toHaveBeenCalledWith('c1');
    expect(deleteCloudinaryImages).toHaveBeenCalledWith(['https://res.cloudinary.com/x/a.png']);
    // The product's own Cloudinary image is purged too.
    expect(deleteCloudinaryImage).toHaveBeenCalledWith(
      'https://res.cloudinary.com/x/image/upload/v1/prod.png'
    );
  });

  it('returns 500 when deleteProduct reports the row was not removed', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(getProduct).mockResolvedValue({ id: 'p1', image: '' } as any);
    vi.mocked(getAllContents).mockResolvedValue([]);
    vi.mocked(deleteProduct).mockResolvedValue(false);

    const res = await deleteProductRoute(req('DELETE') as any, ctx('p1'));
    expect(res.status).toBe(500);
    expect(deleteCloudinaryImage).not.toHaveBeenCalled();
  });
});

describe('POST /api/quotations — uploadedImages safety filter', () => {
  it('keeps only URLs on our Cloudinary cloud and drops foreign/garbage entries', async () => {
    const prev = process.env.CLOUDINARY_CLOUD_NAME;
    process.env.CLOUDINARY_CLOUD_NAME = 'mycloud';
    try {
      vi.mocked(getDocNoOwner).mockResolvedValue(null);
      const res = await postQuotation(
        req('POST', {
          id: 'q1',
          docNo: 'QT20260719-22',
          data: { customerCompany: 'ACME' },
          uploadedImages: [
            'https://res.cloudinary.com/mycloud/image/upload/v1/keep.png',
            'https://evil.example/x.png', // foreign host → dropped
            12345, // non-string → dropped
          ],
        }) as any
      );
      expect(res.status).toBe(200);
      const saved = vi.mocked(saveQuotation).mock.calls[0][0];
      expect(saved.uploadedImages).toEqual([
        'https://res.cloudinary.com/mycloud/image/upload/v1/keep.png',
      ]);
    } finally {
      if (prev === undefined) delete process.env.CLOUDINARY_CLOUD_NAME;
      else process.env.CLOUDINARY_CLOUD_NAME = prev;
    }
  });
});

describe('category routes — invalid id + reorder failure', () => {
  it('DELETE with a non-numeric id → 400', async () => {
    const res = await deleteCategoryRoute(req('DELETE') as any, ctx('abc'));
    expect(res.status).toBe(400);
    expect(deleteCategory).not.toHaveBeenCalled();
    expect(getProductsByCategory).not.toHaveBeenCalled();
  });

  it('PUT with a non-numeric id → 400', async () => {
    const res = await putCategoryRoute(
      req('PUT', { name_th: 'a', name_en: 'b', name_zh: 'c' }) as any,
      ctx('xyz')
    );
    expect(res.status).toBe(400);
  });

  it('reorder → 500 when the store fails to persist the new order', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(reorderCategories).mockResolvedValue(false);
    const res = await reorderRoute(req('PUT', { categoryIds: [3, 1, 2] }) as any);
    expect(res.status).toBe(500);
  });
});

describe('POST /api/products — field validation branches', () => {
  const valid = { title_th: 'ก', title_en: 'A', title_zh: '甲' };

  it('rejects a non-number categoryId → 400', async () => {
    const res = await postProduct(
      req('POST', { ...valid, categoryId: 'zero', image: 'https://res.cloudinary.com/x/a.png' }) as any
    );
    expect(res.status).toBe(400);
    expect(addProduct).not.toHaveBeenCalled();
  });

  it('rejects a missing image → 400', async () => {
    const res = await postProduct(req('POST', { ...valid, categoryId: 0, image: '' }) as any);
    expect(res.status).toBe(400);
    expect(addProduct).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/contents/[id] — delete failure', () => {
  it('returns 500 when the content row could not be deleted', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(getContent).mockResolvedValue({ id: 'c1', productId: null } as any);
    vi.mocked(collectContentImageUrls).mockReturnValue([]);
    vi.mocked(deleteContent).mockResolvedValue(false);

    const res = await deleteContentRoute(req('DELETE') as any, ctx('c1'));
    expect(res.status).toBe(500);
    expect(deleteCloudinaryImages).not.toHaveBeenCalled();
  });
});

describe('PUT /api/settings/contact-email — over-length email', () => {
  it('rejects an email longer than 320 chars → 400', async () => {
    const tooLong = 'a'.repeat(315) + '@ex.com';
    const res = await putContactEmail(req('PUT', { email: tooLong }) as any);
    expect(res.status).toBe(400);
    expect(setSetting).not.toHaveBeenCalled();
  });
});

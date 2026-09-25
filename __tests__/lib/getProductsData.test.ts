// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

// getProductsData composes the category + product + content stores. Mock them.
vi.mock('@/app/lib/productStore', () => ({
  getAllCategories: vi.fn(),
  getAllProducts: vi.fn(),
  isProductPublic: (p: any) => p.isPublished !== false && !p.pendingDeleteAt,
}));
vi.mock('@/app/lib/contentStore', () => ({ getAllContentsMeta: vi.fn() }));
import { getAllCategories, getAllProducts } from '@/app/lib/productStore';
import { getAllContentsMeta } from '@/app/lib/contentStore';

// It wraps the fetch in next/cache's unstable_cache and React.cache. Make both
// pass-through so every call re-runs the real fetch logic against our mocks
// (no cross-request/cross-test memoization to fight).
vi.mock('next/cache', () => ({ unstable_cache: (fn: any) => fn }));
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return { ...actual, cache: (fn: any) => fn };
});

import { getProductsData } from '@/app/lib/getProductsData';

const cat = (id: string) => ({ id, name_en: `Cat ${id}` } as any);

describe('getProductsData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAllContentsMeta).mockResolvedValue([]);
  });

  it('returns empty arrays when both stores are empty', async () => {
    vi.mocked(getAllCategories).mockResolvedValue([]);
    vi.mocked(getAllProducts).mockResolvedValue([]);

    const data = await getProductsData();
    expect(data).toEqual({ categories: [], products: [], contentIdByProduct: {} });
  });

  it('combines categories with only published products (hides unpublished)', async () => {
    const categories = [cat('c1'), cat('c2')];
    const published = { id: 'p1', title_en: 'Shown', isPublished: true };
    const legacy = { id: 'p2', title_en: 'Legacy (no flag)' }; // isPublished undefined → shown
    const hidden = { id: 'p3', title_en: 'Hidden', isPublished: false };
    vi.mocked(getAllCategories).mockResolvedValue(categories as any);
    vi.mocked(getAllProducts).mockResolvedValue([published, legacy, hidden] as any);

    const data = await getProductsData();
    expect(data.categories).toEqual(categories);
    expect(data.products).toEqual([published, legacy]); // hidden filtered out
  });

  it('maps public products to their content pages — never a hidden product', async () => {
    vi.mocked(getAllCategories).mockResolvedValue([]);
    vi.mocked(getAllProducts).mockResolvedValue([
      { id: 'p1', isPublished: true },
      { id: 'p-hidden', isPublished: false },
      { id: 'p-doomed', isPublished: true, pendingDeleteAt: '2026-02-01' },
      { id: 'p-bare', isPublished: true },
    ] as never);
    vi.mocked(getAllContentsMeta).mockResolvedValue([
      { id: 'c-1', title: '', createdAt: '', productId: 'p1' },
      { id: 'c-hidden', title: '', createdAt: '', productId: 'p-hidden' },
      { id: 'c-doomed', title: '', createdAt: '', productId: 'p-doomed' },
    ]);

    const data = await getProductsData();
    // The map ships to every visitor: a hidden product's content id is not in it.
    expect(data.contentIdByProduct).toEqual({ p1: 'c-1' });
  });

  it('keeps the catalog when only the content read fails (links fall back to the gateway)', async () => {
    const product = { id: 'p1', isPublished: true };
    vi.mocked(getAllCategories).mockResolvedValue([cat('c1')]);
    vi.mocked(getAllProducts).mockResolvedValue([product] as never);
    vi.mocked(getAllContentsMeta).mockRejectedValue(new Error('db down'));

    const data = await getProductsData();
    expect(data.products).toEqual([product]);
    expect(data.contentIdByProduct).toEqual({});
  });

  it('returns empty arrays (never throws) when a store rejects', async () => {
    vi.mocked(getAllCategories).mockRejectedValue(new Error('db down'));
    vi.mocked(getAllProducts).mockResolvedValue([]);

    const data = await getProductsData();
    expect(data).toEqual({ categories: [], products: [], contentIdByProduct: {} });
  });
});

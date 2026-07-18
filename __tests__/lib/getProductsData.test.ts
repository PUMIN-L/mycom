// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

// getProductsData composes the category + product stores. Mock both.
vi.mock('@/app/lib/productStore', () => ({
  getAllCategories: vi.fn(),
  getAllProducts: vi.fn(),
}));
import { getAllCategories, getAllProducts } from '@/app/lib/productStore';

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
  });

  it('returns empty arrays when both stores are empty', async () => {
    vi.mocked(getAllCategories).mockResolvedValue([]);
    vi.mocked(getAllProducts).mockResolvedValue([]);

    const data = await getProductsData();
    expect(data).toEqual({ categories: [], products: [] });
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

  it('returns empty arrays (never throws) when a store rejects', async () => {
    vi.mocked(getAllCategories).mockRejectedValue(new Error('db down'));
    vi.mocked(getAllProducts).mockResolvedValue([]);

    const data = await getProductsData();
    expect(data).toEqual({ categories: [], products: [] });
  });
});

// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Records what productStore hands to unstable_cache at module-load time, so the
// assertions below check the REAL registration rather than a restated copy of it.
const { cacheRegistrations } = vi.hoisted(() => {
  const cacheRegistrations: Array<{ keys: string[]; options: Record<string, unknown> }> = [];
  return { cacheRegistrations };
});

vi.mock('next/cache', () => ({
  unstable_cache: (fn: unknown, keys: string[], options: Record<string, unknown>) => {
    cacheRegistrations.push({ keys, options });
    return fn;
  },
}));
vi.mock('@/app/lib/db', () => ({
  query: vi.fn(),
  withTransaction: vi.fn(),
  getDbConnection: vi.fn(),
}));
vi.mock('@/app/lib/revisionStore', () => ({ saveRevision: vi.fn() }));

import '@/app/lib/productStore';

const registrationFor = (key: string) =>
  cacheRegistrations.find((c) => c.keys.includes(key));

// The catalog reads are cached across requests, which is only safe because every
// write busts the same tag. These tests guard the two halves of that bargain.
describe('catalog cache registration', () => {
  it('caches both whole-table reads under the "products" tag', () => {
    // A wrong/missing tag is the dangerous failure: the admin saves, the public
    // page keeps serving the old catalog, and nothing looks broken until a
    // customer points it out.
    for (const key of ['products_all', 'categories_all']) {
      const registration = registrationFor(key);
      expect(registration, `no unstable_cache registration for ${key}`).toBeDefined();
      expect(registration!.options.tags).toContain('products');
    }
  });

  it('gives each read its own cache key, distinct from getProductsData', () => {
    // Same tag, different payload shapes — sharing a key would let one read
    // serve the other's cached value.
    const keys = cacheRegistrations.flatMap((c) => c.keys);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).not.toContain('products_data');
  });

  it('sets a TTL so a missed invalidation cannot go stale forever', () => {
    // Backstop for writes that never reach the API routes (direct SQL) or a
    // future route that forgets revalidateTag.
    for (const key of ['products_all', 'categories_all']) {
      expect(registrationFor(key)!.options.revalidate).toBeTypeOf('number');
    }
  });
});

function routeFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...routeFilesUnder(full));
    else if (entry === 'route.ts') out.push(full);
  }
  return out;
}

describe('every product/category write invalidates the catalog cache', () => {
  // Regression guard for the bug this whole change could introduce: add a route
  // that writes products, forget revalidateTag("products"), and the cached
  // catalog silently serves pre-edit data to every visitor. Derived from the
  // files on disk, so a route added later is covered without touching this test.
  it('has revalidateTag("products") in every mutating route under app/api/products', () => {
    const routes = routeFilesUnder(join(process.cwd(), 'app', 'api', 'products'));
    expect(routes.length).toBeGreaterThan(0);

    for (const file of routes) {
      const source = readFileSync(file, 'utf8');
      const mutates = /export const (POST|PUT|PATCH|DELETE)\b/.test(source);
      if (!mutates) continue;
      expect(
        source,
        `${file} writes product data but never calls revalidateTag("products") — ` +
          'the cached catalog would keep serving stale rows'
      ).toContain('revalidateTag("products"');
    }
  });
});

// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Records what the stores hand to unstable_cache at module-load time, so the
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
import '@/app/lib/contentStore';
import '@/app/lib/documentStore';

// Which tag each cached whole-table read hangs off. contents_meta shares
// "products" on purpose (hard-deleting a product cascades into deleting its
// content, and that route only busts "products"); documents has no such
// coupling — nothing links the two tables — so it gets its own.
const CACHED_READS = [
  { key: 'products_all', tag: 'products' },
  { key: 'categories_all', tag: 'products' },
  { key: 'contents_meta', tag: 'products' },
  { key: 'documents_all', tag: 'documents' },
];

const registrationFor = (key: string) =>
  cacheRegistrations.find((c) => c.keys.includes(key));

// The catalog reads are cached across requests, which is only safe because every
// write busts the same tag. These tests guard the two halves of that bargain.
describe('catalog cache registration', () => {
  it('registers every whole-table read under the tag its writers bust', () => {
    // A wrong/missing tag is the dangerous failure: the admin saves, the public
    // page keeps serving the old catalog, and nothing looks broken until a
    // customer points it out.
    for (const { key, tag } of CACHED_READS) {
      const registration = registrationFor(key);
      expect(registration, `no unstable_cache registration for ${key}`).toBeDefined();
      expect(
        registration!.options.tags,
        `${key} must be tagged "${tag}" — that is the tag its write paths revalidate`
      ).toContain(tag);
    }
  });

  it('gives each read its own cache key, distinct from getProductsData', () => {
    // Same tag, different payload shapes — sharing a key would let one read
    // serve the other's cached value.
    const keys = cacheRegistrations.flatMap((c) => c.keys);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).not.toContain('products_data');
    expect(keys).not.toContain('company_info');
  });

  it('sets a TTL so a missed invalidation cannot go stale forever', () => {
    // Backstop for writes that never reach the API routes (direct SQL) or a
    // future route that forgets revalidateTag.
    for (const { key } of CACHED_READS) {
      expect(registrationFor(key)!.options.revalidate).toBeTypeOf('number');
    }
  });
});

const repoFile = (...parts: string[]) => join(process.cwd(), ...parts);

function routeFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...routeFilesUnder(full));
    else if (entry === 'route.ts') out.push(full);
  }
  return out;
}

// Names are derived from the stores rather than listed here, so a mutator added
// later is covered without anyone remembering to update this test.
function exportedMutatorNames(file: string): string[] {
  const source = readFileSync(file, 'utf8');
  const matches = source.matchAll(
    /^export (?:async )?(?:function|const) ((?:add|update|delete|reorder|hardDelete)\w*)/gm
  );
  return [...matches].map((m) => m[1]);
}

describe('every catalog write invalidates the catalog cache', () => {
  // Regression guard for the bug this caching could introduce: write to products
  // or contents, forget revalidateTag("products"), and the cached catalog
  // silently serves pre-edit data to every visitor — including the sitemap,
  // which would then advertise /showcase/{id} URLs that 404 (the bug 5b0f220
  // fixed).
  //
  // Scans ALL of app/api, not just app/api/products or app/api/contents: two of
  // the five content write paths live elsewhere (the revision-restore route, and
  // the product hard-delete that cascades into deleting content).
  it('busts the right tag in every route that writes catalog data', () => {
    const groups = [
      { tag: 'products', mutators: ['productStore.ts', 'contentStore.ts', 'productDeleter.ts'] },
      { tag: 'documents', mutators: ['documentStore.ts'] },
    ].map((g) => ({
      tag: g.tag,
      names: g.mutators.flatMap((f) => exportedMutatorNames(repoFile('app', 'lib', f))),
    }));

    // Guard the derivation itself: a regex that silently stopped matching would
    // leave this whole scan passing vacuously. Naming known mutators means a
    // broken pattern fails here instead of going quiet.
    expect(groups.find((g) => g.tag === 'products')!.names).toEqual(
      expect.arrayContaining([
        'addContent',
        'updateContent',
        'deleteContent',
        'hardDeleteProduct',
        'updateProduct',
        'deleteProduct',
      ])
    );
    expect(groups.find((g) => g.tag === 'documents')!.names).toEqual(
      expect.arrayContaining(['addDocument', 'updateDocument', 'deleteDocument'])
    );

    const routes = routeFilesUnder(repoFile('app', 'api'));
    expect(routes.length).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const file of routes) {
      const source = readFileSync(file, 'utf8');
      for (const { tag, names } of groups) {
        const called = names.filter((name) => source.includes(`${name}(`));
        if (called.length === 0) continue;
        if (!source.includes(`revalidateTag("${tag}"`)) {
          offenders.push(`${file} calls ${called.join(', ')} but never busts "${tag}"`);
        }
      }
    }

    expect(
      offenders,
      'these routes write catalog data but never bust the cache, so readers ' +
        '(including sitemap.xml) would keep serving stale rows:\n' +
        offenders.join('\n')
    ).toEqual([]);
  });
});

describe('revision-restore invalidates per branch, not per file', () => {
  // The file-level scan above cannot catch this: the restore route mutates BOTH
  // products and contents in separate switch branches, so deleting the content
  // branch's revalidateTag leaves the file still containing the product one and
  // the scan stays green. Verified — that exact deletion passed the scan.
  //
  // This is the write path most likely to be missed (it lives outside
  // app/api/contents/**), so it gets its own branch-level guard.
  it('has revalidateTag inside every catalog branch of the restore switch', () => {
    const source = readFileSync(
      repoFile('app', 'api', 'revisions', '[id]', 'restore', 'route.ts'),
      'utf8'
    );

    const blocks = source.split(/^\s*case "/m).slice(1);
    expect(blocks.length).toBeGreaterThan(1);

    // Each branch writes a different table, so each owes a different tag.
    const branchMutators = [
      { call: 'updateProduct(', tag: 'products' },
      { call: 'updateContent(', tag: 'products' },
      { call: 'updateDocument(', tag: 'documents' },
    ];
    const checked: string[] = [];

    for (const block of blocks) {
      const name = block.slice(0, block.indexOf('"'));
      const writes = branchMutators.filter((m) => block.includes(m.call));
      if (writes.length === 0) continue;
      checked.push(name);
      for (const { tag } of writes) {
        expect(
          block.includes(`revalidateTag("${tag}"`),
          `restore route's case "${name}" writes catalog data but does not bust ` +
            `"${tag}" inside that branch`
        ).toBe(true);
      }
    }

    // Guard the guard: if the switch is refactored and these branches vanish,
    // the loop above would pass vacuously.
    expect(checked).toEqual(expect.arrayContaining(['product', 'content', 'document']));
  });
});

// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/app/lib/contentStore', () => ({ getAllContentsMeta: vi.fn() }));
vi.mock('@/app/lib/documentStore', () => ({ getAllDocuments: vi.fn() }));
vi.mock('@/app/lib/productStore', () => ({
  getAllProducts: vi.fn(),
  // The real predicate, so this test tracks a change to the visibility rule
  // instead of asserting against a second copy of it.
  isProductPublic: (p: { isPublished?: boolean; pendingDeleteAt?: string | null }) =>
    p.isPublished !== false && !p.pendingDeleteAt,
}));
vi.mock('@/app/lib/settingsStore', () => ({ isMaintenanceMode: vi.fn() }));

import sitemap from '@/app/sitemap';
import { SITE_URL } from '@/app/lib/site';
import { getAllContentsMeta } from '@/app/lib/contentStore';
import { getAllDocuments } from '@/app/lib/documentStore';
import { getAllProducts } from '@/app/lib/productStore';
import { isMaintenanceMode } from '@/app/lib/settingsStore';

const urls = (entries: { url: string }[]) => entries.map((e) => e.url);

describe('sitemap content routes vs product visibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAllDocuments).mockResolvedValue([]);
    vi.mocked(isMaintenanceMode).mockResolvedValue(false);
  });

  // The bug this file exists to prevent: the sitemap listed EVERY content,
  // while /showcase/[id] 404s for anonymous callers when the linked product is
  // unpublished or pending-delete (isHiddenFromAnonymous). Googlebot is always
  // anonymous, so those entries came back as "Submitted URL not found (404)".
  it('omits content linked to an unpublished or pending-delete product', async () => {
    vi.mocked(getAllContentsMeta).mockResolvedValue([
      { id: 'public', title: 'A', createdAt: '2026-01-01', productId: 'p-live' },
      { id: 'unpublished', title: 'B', createdAt: '2026-01-01', productId: 'p-hidden' },
      { id: 'pending-delete', title: 'C', createdAt: '2026-01-01', productId: 'p-doomed' },
    ] as never);
    vi.mocked(getAllProducts).mockResolvedValue([
      { id: 'p-live', isPublished: true, pendingDeleteAt: null },
      { id: 'p-hidden', isPublished: false, pendingDeleteAt: null },
      { id: 'p-doomed', isPublished: true, pendingDeleteAt: '2026-02-01' },
    ] as never);

    const found = urls(await sitemap());

    expect(found).toContain(`${SITE_URL}/showcase/public`);
    expect(found).not.toContain(`${SITE_URL}/showcase/unpublished`);
    expect(found).not.toContain(`${SITE_URL}/showcase/pending-delete`);
  });

  it('keeps content with no product link, and content whose product row is gone', async () => {
    // Matches isHiddenFromAnonymous: it hides a page only when the product
    // EXISTS and is not public. A dangling productId still renders, so
    // dropping it here would lose a live page from the index.
    vi.mocked(getAllContentsMeta).mockResolvedValue([
      { id: 'standalone', title: 'A', createdAt: '2026-01-01', productId: null },
      { id: 'dangling', title: 'B', createdAt: '2026-01-01', productId: 'p-deleted' },
    ] as never);
    vi.mocked(getAllProducts).mockResolvedValue([] as never);

    const found = urls(await sitemap());

    expect(found).toContain(`${SITE_URL}/showcase/standalone`);
    expect(found).toContain(`${SITE_URL}/showcase/dangling`);
  });

  it('emits no content routes when the products read fails', async () => {
    // A failed products read cannot vouch for visibility, so falling back to an
    // unfiltered list would re-introduce the 404s this filter removes.
    vi.mocked(getAllContentsMeta).mockResolvedValue([
      { id: 'c-1', title: 'A', createdAt: '2026-01-01', productId: 'p-1' },
    ] as never);
    vi.mocked(getAllProducts).mockRejectedValue(new Error('db down'));

    const found = urls(await sitemap());

    expect(found.some((u) => u.includes('/showcase/'))).toBe(false);
    // Static routes still ship — a partial sitemap beats a 500 ("couldn't fetch").
    expect(found).toContain(SITE_URL);
  });
});

// /catalog is one of MAINTENANCE_BLOCKED_PATHS, so while maintenance mode is on
// a crawler following it only reaches the "กำลังปรับปรุง" overlay. Asking Google
// to keep coming back weekly for that is what turns a long maintenance window
// into a ranking problem.
describe('sitemap /catalog vs maintenance mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAllContentsMeta).mockResolvedValue([] as never);
    vi.mocked(getAllProducts).mockResolvedValue([] as never);
    vi.mocked(getAllDocuments).mockResolvedValue([]);
    vi.mocked(isMaintenanceMode).mockResolvedValue(false);
  });

  // false is also what isMaintenanceMode() returns when the settings read
  // FAILS — it never rejects, and that fail-open is asserted in
  // __tests__/lib/settingsStore.test.ts rather than re-mocked here. So this
  // case doubles as "a settings-table blip leaves /catalog listed".
  it('lists /catalog while maintenance mode is off', async () => {
    expect(urls(await sitemap())).toContain(`${SITE_URL}/catalog`);
  });

  it('drops /catalog while maintenance mode is on', async () => {
    vi.mocked(isMaintenanceMode).mockResolvedValue(true);

    expect(urls(await sitemap())).not.toContain(`${SITE_URL}/catalog`);
  });

  it('keeps / and /contact listed during maintenance', async () => {
    // Blocked by the same overlay, but deliberately still indexed: the overlay
    // itself carries the business name and service list for exactly this window
    // (MaintenanceOverlay.tsx), so those URLs still return something worth
    // indexing. /catalog has no such copy, which is why only it is dropped.
    vi.mocked(isMaintenanceMode).mockResolvedValue(true);

    const found = urls(await sitemap());

    expect(found).toContain(SITE_URL);
    expect(found).toContain(`${SITE_URL}/contact`);
  });

});

// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/app/lib/contentStore', () => ({
  getAllContentsMeta: vi.fn(),
  getContentImageIndex: vi.fn(async () => ({})),
}));
vi.mock('@/app/lib/documentStore', () => ({
  getAllDocuments: vi.fn(),
  // The real rule — pure, nothing to fake. Without it the sitemap's catch
  // swallowed the TypeError and dropped every document, and these tests could
  // not see it.
  isDocumentPublic: (d: { isPublished?: boolean }) => d.isPublished !== false,
}));
vi.mock('@/app/lib/productStore', () => ({
  getAllProducts: vi.fn(),
  // The real predicate, so this test tracks a change to the visibility rule
  // instead of asserting against a second copy of it.
  isProductPublic: (p: { isPublished?: boolean; pendingDeleteAt?: string | null }) =>
    p.isPublished !== false && !p.pendingDeleteAt,
}));
vi.mock('@/app/lib/settingsStore', () => ({ isMaintenanceMode: vi.fn() }));
// The catalog pages read the PUBLIC catalog (it never throws). Empty unless a
// test says otherwise, so the content tests above see no category routes.
vi.mock('@/app/lib/getProductsData', () => ({
  getProductsData: vi.fn(async () => ({ categories: [], products: [], contentIdByProduct: {} })),
}));

import sitemap from '@/app/sitemap';
import { SITE_URL } from '@/app/lib/site';
import { getAllContentsMeta, getContentImageIndex } from '@/app/lib/contentStore';
import { getAllDocuments } from '@/app/lib/documentStore';
import { getAllProducts } from '@/app/lib/productStore';
import { isMaintenanceMode } from '@/app/lib/settingsStore';
import { getProductsData } from '@/app/lib/getProductsData';

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

describe('sitemap — catalog and service pages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAllContentsMeta).mockResolvedValue([] as never);
    vi.mocked(getAllProducts).mockResolvedValue([] as never);
    vi.mocked(getAllDocuments).mockResolvedValue([]);
    vi.mocked(isMaintenanceMode).mockResolvedValue(false);
    vi.mocked(getProductsData).mockResolvedValue({
      categories: [
        { id: 1, name_th: 'เครื่องชั่ง', name_en: 'Balances', name_zh: '', sortOrder: 0 },
        { id: 2, name_th: 'ว่าง', name_en: 'Empty', name_zh: '', sortOrder: 1 },
      ],
      products: [{ id: 'p1', categoryId: 1 }],
      contentIdByProduct: {},
    } as never);
  });

  it('lists /products, every service page, and each category with public products', async () => {
    const found = urls(await sitemap());
    expect(found).toContain(`${SITE_URL}/products`);
    expect(found).toContain(`${SITE_URL}/services/equipment-sales`);
    expect(found).toContain(`${SITE_URL}/services/calibration-repair`);
    expect(found).toContain(`${SITE_URL}/services/lab-design-construction`);
    expect(found).toContain(`${SITE_URL}/products/1-balances`);
    // No public products → the page 404s, so it must not be listed.
    expect(found.some((u) => u.includes('/products/2'))).toBe(false);
  });

  it('gives static pages no lastModified — "now" on every fetch told Google nothing', async () => {
    const entries = await sitemap();
    for (const path of ['', '/products', '/about', '/contact', '/catalog']) {
      const entry = entries.find((e) => e.url === `${SITE_URL}${path}`);
      expect(entry, path).toBeDefined();
      expect(entry!.lastModified, path).toBeUndefined();
    }
  });

  it('lists the catalog pages exactly once each', async () => {
    const found = urls(await sitemap());
    expect(new Set(found).size).toBe(found.length);
  });
});

describe('sitemap — lastmod of content pages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAllProducts).mockResolvedValue([] as never);
    vi.mocked(getAllDocuments).mockResolvedValue([]);
    vi.mocked(isMaintenanceMode).mockResolvedValue(false);
  });

  it('uses when the content last changed, else when it was created, never "now"', async () => {
    vi.mocked(getAllContentsMeta).mockResolvedValue([
      { id: 'edited', title: '', createdAt: '2026-01-01T00:00:00.000Z', productId: null, updatedAt: '2026-06-15T08:00:00.000Z' },
      { id: 'never-edited', title: '', createdAt: '2026-02-01T00:00:00.000Z', productId: null, updatedAt: null },
      { id: 'no-dates', title: '', createdAt: '', productId: null },
      { id: 'garbled', title: '', createdAt: 'not a date', productId: null },
    ] as never);

    const entries = await sitemap();
    const lastmod = (id: string) => entries.find((e) => e.url === `${SITE_URL}/showcase/${id}`)?.lastModified;

    expect(lastmod('edited')).toEqual(new Date('2026-06-15T08:00:00.000Z'));
    expect(lastmod('never-edited')).toEqual(new Date('2026-02-01T00:00:00.000Z'));
    expect(lastmod('no-dates')).toBeUndefined();
    expect(lastmod('garbled')).toBeUndefined();
  });
});

// The image sitemap: each URL lists the pictures that page shows, so product
// photos reach Google Images.
describe('sitemap — images', () => {
  const img = (name: string) => `https://res.cloudinary.com/demo/image/upload/v1/${name}.jpg`;
  const entry = async (url: string) => (await sitemap()).find((e) => e.url === url);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isMaintenanceMode).mockResolvedValue(false);
    vi.mocked(getAllProducts).mockResolvedValue([] as never);
    vi.mocked(getAllContentsMeta).mockResolvedValue([
      { id: 'c-pics', title: 'A', createdAt: '2026-01-01', productId: null },
      { id: 'c-none', title: 'B', createdAt: '2026-01-01', productId: null },
    ] as never);
    vi.mocked(getContentImageIndex).mockResolvedValue({ 'c-pics': [img('a'), img('b')] });
    vi.mocked(getAllDocuments).mockResolvedValue([
      { id: 'd-shown', coverUrl: img('cover-shown'), createdAt: '2026-01-01', isPublished: true },
      { id: 'd-hidden', coverUrl: img('cover-hidden'), createdAt: '2026-01-01', isPublished: false },
    ] as never);
    vi.mocked(getProductsData).mockResolvedValue({
      categories: [
        { id: 1, name_th: 'เครื่องชั่ง', name_en: 'Balance', name_zh: '天平' },
        { id: 2, name_th: 'ทดสอบ', name_en: 'Tester', name_zh: '测试' },
      ],
      products: [
        { id: 'p1', categoryId: 1, image: img('p1') },
        { id: 'p2', categoryId: 2, image: img('p2') },
        { id: 'p3', categoryId: 2, image: '' },
      ],
      contentIdByProduct: {},
    } as never);
  });

  it('a content page lists the pictures its blocks show; one without pictures has no images key', async () => {
    expect((await entry(`${SITE_URL}/showcase/c-pics`))!.images).toEqual([img('a'), img('b')]);
    expect(await entry(`${SITE_URL}/showcase/c-none`)).not.toHaveProperty('images');
  });

  it('/products lists every public product photo; a category page only its own', async () => {
    expect((await entry(`${SITE_URL}/products`))!.images).toEqual([img('p1'), img('p2')]);
    const all = await sitemap();
    const categoryImages = all.filter((e) => /\/products\/\d/.test(e.url)).map((e) => e.images);
    expect(categoryImages).toEqual([[img('p1')], [img('p2')]]);
  });

  it('/catalog lists the covers of the SHOWN catalogs only', async () => {
    expect((await entry(`${SITE_URL}/catalog`))!.images).toEqual([img('cover-shown')]);
    expect((await sitemap()).map((e) => e.url)).not.toContain(`${SITE_URL}/document/d-hidden`);
  });

  it('a failed read of the content images keeps the content pages, without pictures', async () => {
    vi.mocked(getContentImageIndex).mockRejectedValue(new Error('db down'));
    const pics = await entry(`${SITE_URL}/showcase/c-pics`);
    expect(pics).toBeDefined();
    expect(pics).not.toHaveProperty('images');
  });
});

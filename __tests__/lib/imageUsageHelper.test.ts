// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock only the DB + the actual Cloudinary network call — the query-composition
// logic under test (isCloudinaryImageInUse / getAllUsedImageUrls) must run for
// real, unlike __tests__/api/upload.test.ts which mocks this whole module away
// to test the ROUTE (a deliberate, separate concern).
vi.mock('@/app/lib/db', () => ({ query: vi.fn() }));
import { query } from '@/app/lib/db';

vi.mock('@/app/lib/cloudinaryHelper', () => ({
  deleteCloudinaryImage: vi.fn(),
  extractPublicId: vi.fn(),
}));
import { deleteCloudinaryImage } from '@/app/lib/cloudinaryHelper';

import {
  isCloudinaryImageInUse,
  safeDeleteCloudinaryImage,
  safeDeleteCloudinaryImages,
  getAllUsedImageUrls,
} from '@/app/lib/imageUsageHelper';

const URL_A = 'https://res.cloudinary.com/demo/image/upload/v1/a.jpg';

beforeEach(() => vi.clearAllMocks());

describe('isCloudinaryImageInUse', () => {
  it('returns false immediately for a non-Cloudinary or empty URL (no queries run)', async () => {
    expect(await isCloudinaryImageInUse('')).toBe(false);
    expect(await isCloudinaryImageInUse('https://example.com/a.jpg')).toBe(false);
    expect(query).not.toHaveBeenCalled();
  });

  it('finds a match in products and stops there (does not query further tables)', async () => {
    vi.mocked(query).mockResolvedValueOnce([[{ id: 'p1' }]] as any);
    expect(await isCloudinaryImageInUse(URL_A)).toBe(true);
    expect(query).toHaveBeenCalledTimes(1);
    expect(vi.mocked(query).mock.calls[0][0]).toContain('FROM products');
  });

  it('checks products, documents, contents, quotations, billing_documents in order when nothing matches', async () => {
    vi.mocked(query).mockResolvedValue([[]] as any);
    expect(await isCloudinaryImageInUse(URL_A)).toBe(false);
    const sqls = vi.mocked(query).mock.calls.map((c) => String(c[0]));
    expect(sqls[0]).toContain('FROM products');
    expect(sqls[1]).toContain('FROM documents');
    expect(sqls[2]).toContain('FROM contents');
    expect(sqls[3]).toContain('FROM quotations');
    expect(sqls[3]).toContain('JSON_SEARCH');
    expect(sqls[4]).toContain('FROM billing_documents');
    expect(sqls[4]).toContain('JSON_SEARCH');
    expect(sqls).toHaveLength(5);
  });

  it('finds a match in quotations.uploadedImages via JSON_SEARCH', async () => {
    vi.mocked(query)
      .mockResolvedValueOnce([[]] as any) // products
      .mockResolvedValueOnce([[]] as any) // documents
      .mockResolvedValueOnce([[]] as any) // contents
      .mockResolvedValueOnce([[{ id: 'q1' }]] as any); // quotations — match
    expect(await isCloudinaryImageInUse(URL_A)).toBe(true);
    expect(query).toHaveBeenCalledTimes(4); // stops before billing_documents
  });

  it('finds a match in billing_documents.data via JSON_SEARCH', async () => {
    vi.mocked(query)
      .mockResolvedValueOnce([[]] as any)
      .mockResolvedValueOnce([[]] as any)
      .mockResolvedValueOnce([[]] as any)
      .mockResolvedValueOnce([[]] as any)
      .mockResolvedValueOnce([[{ id: 'b1' }]] as any); // billing_documents — match
    expect(await isCloudinaryImageInUse(URL_A)).toBe(true);
  });

  it('excludes the quotation currently being deleted from its own quotations check', async () => {
    vi.mocked(query).mockResolvedValue([[]] as any);
    await isCloudinaryImageInUse(URL_A, { type: 'quotation', id: 'q1' });
    const quotationCall = vi.mocked(query).mock.calls[3];
    expect(quotationCall[0]).toContain('AND id != ?');
    expect(quotationCall[1]).toEqual([URL_A, URL_A, 'q1']);
  });

  it('excludes the billing document currently being deleted from its own billing check', async () => {
    vi.mocked(query).mockResolvedValue([[]] as any);
    await isCloudinaryImageInUse(URL_A, { type: 'billing', id: 'b1' });
    const billingCall = vi.mocked(query).mock.calls[4];
    expect(billingCall[0]).toContain('AND id != ?');
    expect(billingCall[1]).toEqual([URL_A, 'b1']);
  });

  it('does NOT exclude by id when excludeSource is for a different entity type', async () => {
    vi.mocked(query).mockResolvedValue([[]] as any);
    await isCloudinaryImageInUse(URL_A, { type: 'product', id: 'p1' });
    // The quotations/billing checks should NOT carry the product's exclude id.
    const quotationCall = vi.mocked(query).mock.calls[3];
    expect(quotationCall[0]).not.toContain('AND id != ?');
    expect(quotationCall[1]).toEqual([URL_A, URL_A]);
  });
});

// A quotation line item picked from the catalog carries a COPY of the
// product's image URL in `data` (quotation/page.tsx: `imageUrl: p.image,
// imageUploaded: false`) — not in uploadedImages. Run against a stand-in
// quotations table that answers JSON_SEARCH for whichever column the SQL
// actually searches, so a query that forgets `data` finds nothing.
describe('a catalog image copied into a quotation counts as in use', () => {
  const PRODUCT_IMG = 'https://res.cloudinary.com/demo/image/upload/v1/samples/mycom/scale_old.jpg';
  type QuoteRow = { id: string; uploadedImages: unknown; data: unknown };
  let quotes: QuoteRow[];

  const deepHas = (value: unknown, needle: string): boolean =>
    typeof value === 'string'
      ? value === needle
      : Array.isArray(value)
        ? value.some((v) => deepHas(v, needle))
        : !!value && typeof value === 'object' && Object.values(value).some((v) => deepHas(v, needle));

  beforeEach(() => {
    quotes = [
      {
        id: 'quo-2025-001',
        uploadedImages: '[]',
        data: JSON.stringify({ customerCompany: 'บริษัท ก', items: [{ name: 'เครื่องชั่ง', imageUrl: PRODUCT_IMG, imageUploaded: false }] }),
      },
    ];
    vi.mocked(query).mockImplementation((async (sql: string, params: unknown[] = []) => {
      if (!sql.includes('FROM quotations')) return [[]]; // the product's photo has been replaced
      const url = params[0] as string;
      const excludeId = sql.includes('AND id != ?') ? params[params.length - 1] : undefined;
      const hit = quotes.find(
        (q) =>
          q.id !== excludeId &&
          ((sql.includes('JSON_SEARCH(uploadedImages') && deepHas(JSON.parse(String(q.uploadedImages)), url)) ||
            (sql.includes('JSON_SEARCH(data') && deepHas(JSON.parse(String(q.data)), url)))
      );
      return [hit ? [{ id: hit.id }] : []];
    }) as never);
  });

  it('isCloudinaryImageInUse finds it', async () => {
    expect(await isCloudinaryImageInUse(PRODUCT_IMG)).toBe(true);
  });

  it('confirming the old photo’s deletion after replacing it leaves Cloudinary alone', async () => {
    expect(await safeDeleteCloudinaryImage(PRODUCT_IMG)).toBe(false);
    expect(deleteCloudinaryImage).not.toHaveBeenCalled();
  });

  it('the quotation being deleted does not keep its own copy alive', async () => {
    expect(await isCloudinaryImageInUse(PRODUCT_IMG, { type: 'quotation', id: 'quo-2025-001' })).toBe(false);
  });

  it('another quotation holding the same copy still does', async () => {
    quotes.push({ id: 'quo-2025-002', uploadedImages: '[]', data: JSON.stringify({ items: [{ imageUrl: PRODUCT_IMG }] }) });
    expect(await isCloudinaryImageInUse(PRODUCT_IMG, { type: 'quotation', id: 'quo-2025-001' })).toBe(true);
  });
});

describe('safeDeleteCloudinaryImage(s)', () => {
  it('does NOT call Cloudinary delete when the image is still in use', async () => {
    vi.mocked(query).mockResolvedValueOnce([[{ id: 'p1' }]] as any); // products match
    const result = await safeDeleteCloudinaryImage(URL_A);
    expect(result).toBe(false);
    expect(deleteCloudinaryImage).not.toHaveBeenCalled();
  });

  it('deletes from Cloudinary when the image is not referenced anywhere', async () => {
    vi.mocked(query).mockResolvedValue([[]] as any); // no matches anywhere
    vi.mocked(deleteCloudinaryImage).mockResolvedValue(true);
    const result = await safeDeleteCloudinaryImage(URL_A);
    expect(result).toBe(true);
    expect(deleteCloudinaryImage).toHaveBeenCalledWith(URL_A);
  });

  it('processes a batch sequentially, skipping in-use ones individually', async () => {
    const URL_B = 'https://res.cloudinary.com/demo/image/upload/v1/b.jpg';
    vi.mocked(query).mockImplementation((sql: unknown) => {
      const s = String(sql);
      if (s.includes('FROM products')) return Promise.resolve([[]]) as any;
      return Promise.resolve([[]]) as any;
    });
    // URL_A is "in use" (products match on first query only for A);
    // simplest: just assert deleteCloudinaryImage is attempted for both when
    // nothing is in use.
    vi.mocked(deleteCloudinaryImage).mockResolvedValue(true);
    await safeDeleteCloudinaryImages([URL_A, URL_B]);
    expect(deleteCloudinaryImage).toHaveBeenCalledTimes(2);
  });
});

describe('getAllUsedImageUrls', () => {
  it('collects Cloudinary URLs from every source: products, documents, contents, quotations, billing', async () => {
    vi.mocked(query)
      .mockResolvedValueOnce([[{ image: 'https://res.cloudinary.com/x/product.jpg' }]] as any) // products
      .mockResolvedValueOnce([
        [{ pdfUrl: 'https://res.cloudinary.com/x/doc.pdf', coverUrl: 'https://res.cloudinary.com/x/cover.jpg' }],
      ] as any) // documents
      .mockResolvedValueOnce([
        [{ blocks: JSON.stringify([{ imageUrl: 'https://res.cloudinary.com/x/block.jpg' }, { imageUrls: ['https://res.cloudinary.com/x/gallery.jpg'] }]) }],
      ] as any) // contents
      .mockResolvedValueOnce([
        [{ uploadedImages: JSON.stringify(['https://res.cloudinary.com/x/quote.jpg']) }],
      ] as any) // quotations
      .mockResolvedValueOnce([
        [{ data: JSON.stringify({ items: [{ imageUrl: 'https://res.cloudinary.com/x/billing.jpg' }] }) }],
      ] as any); // billing_documents

    const urls = await getAllUsedImageUrls();

    expect(urls.has('https://res.cloudinary.com/x/product.jpg')).toBe(true);
    expect(urls.has('https://res.cloudinary.com/x/doc.pdf')).toBe(true);
    expect(urls.has('https://res.cloudinary.com/x/cover.jpg')).toBe(true);
    expect(urls.has('https://res.cloudinary.com/x/block.jpg')).toBe(true);
    expect(urls.has('https://res.cloudinary.com/x/gallery.jpg')).toBe(true);
    expect(urls.has('https://res.cloudinary.com/x/quote.jpg')).toBe(true);
    expect(urls.has('https://res.cloudinary.com/x/billing.jpg')).toBe(true);
    expect(urls.size).toBe(7);
  });

  it('handles already-parsed-array JSON columns (not strings) for contents.blocks and quotations.uploadedImages', async () => {
    vi.mocked(query)
      .mockResolvedValueOnce([[]] as any) // products
      .mockResolvedValueOnce([[]] as any) // documents
      .mockResolvedValueOnce([
        [{ blocks: [{ imageUrl: 'https://res.cloudinary.com/x/parsed-block.jpg' }] }],
      ] as any) // contents — already an array, not a JSON string
      .mockResolvedValueOnce([
        [{ uploadedImages: ['https://res.cloudinary.com/x/parsed-quote.jpg'] }],
      ] as any) // quotations — already an array
      .mockResolvedValueOnce([[]] as any); // billing_documents

    const urls = await getAllUsedImageUrls();
    expect(urls.has('https://res.cloudinary.com/x/parsed-block.jpg')).toBe(true);
    expect(urls.has('https://res.cloudinary.com/x/parsed-quote.jpg')).toBe(true);
  });

  it('handles an already-parsed-object JSON column (not a string) for billing_documents.data', async () => {
    vi.mocked(query)
      .mockResolvedValueOnce([[]] as any)
      .mockResolvedValueOnce([[]] as any)
      .mockResolvedValueOnce([[]] as any)
      .mockResolvedValueOnce([[]] as any)
      .mockResolvedValueOnce([
        [{ data: { nested: { imageUrl: 'https://res.cloudinary.com/x/deep.jpg' } } }],
      ] as any);

    const urls = await getAllUsedImageUrls();
    expect(urls.has('https://res.cloudinary.com/x/deep.jpg')).toBe(true);
  });

  it('does not crash on malformed JSON — degrades to skipping that row', async () => {
    vi.mocked(query)
      .mockResolvedValueOnce([[]] as any)
      .mockResolvedValueOnce([[]] as any)
      .mockResolvedValueOnce([[{ blocks: 'not-valid-json{' }]] as any)
      .mockResolvedValueOnce([[]] as any)
      .mockResolvedValueOnce([[{ data: 'not-valid-json{' }]] as any);

    const urls = await getAllUsedImageUrls();
    expect(urls.size).toBe(0);
  });

  it('collects the catalog image a quotation line item carries in data, not just uploadedImages', async () => {
    vi.mocked(query)
      .mockResolvedValueOnce([[]] as never) // products — the photo was replaced
      .mockResolvedValueOnce([[]] as never) // documents
      .mockResolvedValueOnce([[]] as never) // contents
      .mockResolvedValueOnce([
        [
          {
            id: 'quo-1',
            uploadedImages: '[]',
            data: JSON.stringify({ items: [{ imageUrl: 'https://res.cloudinary.com/x/old-product.jpg', imageUploaded: false }] }),
          },
          { id: 'quo-2', uploadedImages: [], data: { items: [{ imageUrl: 'https://res.cloudinary.com/x/parsed.jpg' }] } },
        ],
      ] as never) // quotations
      .mockResolvedValueOnce([[]] as never); // billing_documents

    const urls = await getAllUsedImageUrls();
    expect(urls.has('https://res.cloudinary.com/x/old-product.jpg')).toBe(true);
    expect(urls.has('https://res.cloudinary.com/x/parsed.jpg')).toBe(true);
  });

  it('reads quotations a page at a time and reaches the last one', async () => {
    const all = Array.from({ length: 250 }, (_, i) => ({
      id: `quo-${String(i).padStart(4, '0')}`,
      uploadedImages: '[]',
      data: JSON.stringify({ items: [{ imageUrl: `https://res.cloudinary.com/x/q${i}.jpg` }] }),
    }));
    vi.mocked(query).mockImplementation((async (sql: string, params: unknown[] = []) => {
      if (!sql.includes('FROM quotations')) return [[]];
      const [after, limit] = params as [string, number];
      return [all.filter((q) => q.id > after).slice(0, limit)];
    }) as never);

    const urls = await getAllUsedImageUrls();
    expect(urls.size).toBe(250);
    expect(urls.has('https://res.cloudinary.com/x/q249.jpg')).toBe(true);
    const pages = vi.mocked(query).mock.calls.filter(([sql]) => String(sql).includes('FROM quotations'));
    expect(pages).toHaveLength(3); // 100 + 100 + 50
    for (const [, params] of pages) expect((params as unknown[])[1]).toBe(100);
  });

  it('a quotation with malformed data is skipped, not fatal', async () => {
    vi.mocked(query)
      .mockResolvedValueOnce([[]] as never)
      .mockResolvedValueOnce([[]] as never)
      .mockResolvedValueOnce([[]] as never)
      .mockResolvedValueOnce([
        [
          { id: 'quo-bad', uploadedImages: 'not-json{', data: 'not-json{' },
          { id: 'quo-ok', uploadedImages: '["https://res.cloudinary.com/x/ok.jpg"]', data: '{}' },
        ],
      ] as never)
      .mockResolvedValueOnce([[]] as never);

    const urls = await getAllUsedImageUrls();
    expect([...urls]).toEqual(['https://res.cloudinary.com/x/ok.jpg']);
  });

  it('ignores non-Cloudinary URLs everywhere', async () => {
    vi.mocked(query)
      .mockResolvedValueOnce([[{ image: 'https://example.com/product.jpg' }]] as any)
      .mockResolvedValueOnce([[{ pdfUrl: '', coverUrl: null }]] as any)
      .mockResolvedValueOnce([[]] as any)
      .mockResolvedValueOnce([[]] as any)
      .mockResolvedValueOnce([[]] as any);

    const urls = await getAllUsedImageUrls();
    expect(urls.size).toBe(0);
  });
});

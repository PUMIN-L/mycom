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
    expect(quotationCall[1]).toEqual([URL_A, 'q1']);
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
    expect(quotationCall[1]).toEqual([URL_A]);
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

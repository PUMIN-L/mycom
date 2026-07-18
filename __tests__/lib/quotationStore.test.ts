// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────────────
// query() resolves to a tuple [rows, fields]; DELETE resolves to
// [{ affectedRows: n }]. We only ever read the first tuple element in source.
vi.mock('@/app/lib/db', () => ({ query: vi.fn() }));
import { query } from '@/app/lib/db';

vi.mock('@/app/lib/cloudinaryHelper', () => ({ deleteCloudinaryImages: vi.fn() }));
import { deleteCloudinaryImages } from '@/app/lib/cloudinaryHelper';

// NOTE: quotationTotals is intentionally NOT mocked — the real money math runs.
import {
  saveQuotation,
  getDocNoOwner,
  reserveDocNo,
  listRecentDocNos,
  purgeOldDocNos,
  getQuotation,
  listQuotations,
  deleteQuotation,
  purgeExpiredQuotations,
} from '@/app/lib/quotationStore';

// A distinctive Cloudinary-style URL builder for readability.
const cld = (name: string) =>
  `https://res.cloudinary.com/demo/image/upload/v1/samples/mycom/${name}.jpg`;

/**
 * Route each query() call to a canned tuple result by branching on the SQL.
 * Used for the multi-query functions (deleteQuotation / purgeExpiredQuotations),
 * whose call order + branches matter.
 */
function mockQueryRouter(routes: {
  products?: unknown[];
  contents?: unknown[];
  quotationById?: unknown[];
  quotationsExpired?: unknown[];
  deleteResult?: { affectedRows?: number };
}) {
  vi.mocked(query).mockImplementation(((sql: string) => {
    if (/FROM products/.test(sql)) return [routes.products ?? []];
    if (/FROM contents/.test(sql)) return [routes.contents ?? []];
    if (/SELECT \*\s+FROM quotations/.test(sql)) return [routes.quotationById ?? []];
    if (/uploadedImages FROM quotations/.test(sql)) return [routes.quotationsExpired ?? []];
    if (/^\s*DELETE/.test(sql)) return [routes.deleteResult ?? { affectedRows: 0 }];
    return [[]];
  }) as any);
}

// Convenience: the [sql, params] of the Nth query() call.
const callAt = (i: number) => vi.mocked(query).mock.calls[i] as [string, unknown[]?];
// Index of the first DELETE query() call, or -1.
const deleteCallIndex = () =>
  vi.mocked(query).mock.calls.findIndex((c) => /^\s*DELETE/.test(String(c[0])));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('saveQuotation', () => {
  it('upserts with JSON.stringify of data/uploadedImages and ordered params', async () => {
    vi.mocked(query).mockResolvedValue([{ affectedRows: 1 }] as any);
    const rec = {
      id: 'q1',
      docNo: 'QT20260719-22',
      data: { customerCompany: 'ACME', items: [{ qty: 1, unitPrice: 10 }] },
      uploadedImages: [cld('a'), cld('b')],
      createdAt: '2026-07-19T00:00:00.000Z',
    };
    await saveQuotation(rec);

    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = callAt(0);
    expect(sql).toContain('INSERT INTO quotations');
    expect(sql).toContain('ON DUPLICATE KEY UPDATE');
    expect(params).toEqual([
      'q1',
      'QT20260719-22',
      JSON.stringify(rec.data),
      JSON.stringify(rec.uploadedImages),
      '2026-07-19T00:00:00.000Z',
    ]);
  });
});

describe('getDocNoOwner', () => {
  it('returns the owning quotationId (coerced to string) when reserved', async () => {
    // quotationId comes back as a number → must be String()-coerced.
    vi.mocked(query).mockResolvedValue([[{ quotationId: 42 }]] as any);
    const owner = await getDocNoOwner('QT20260719-22');
    expect(owner).toBe('42');
    const [sql, params] = callAt(0);
    expect(sql).toContain('FROM used_docnos');
    expect(params).toEqual(['QT20260719-22']);
  });

  it('returns null when the docNo is free', async () => {
    vi.mocked(query).mockResolvedValue([[]] as any);
    expect(await getDocNoOwner('QT20260719-99')).toBeNull();
  });
});

describe('reserveDocNo', () => {
  it('issues INSERT..ON DUPLICATE KEY UPDATE with ordered params', async () => {
    vi.mocked(query).mockResolvedValue([{ affectedRows: 1 }] as any);
    await reserveDocNo('QT20260719-22', 'q1', '2026-07-19T00:00:00.000Z');

    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = callAt(0);
    expect(sql).toContain('INSERT INTO used_docnos');
    expect(sql).toContain('ON DUPLICATE KEY UPDATE');
    expect(params).toEqual(['QT20260719-22', 'q1', '2026-07-19T00:00:00.000Z']);
  });
});

describe('listRecentDocNos', () => {
  it('maps rows and coerces quotationId to a string', async () => {
    vi.mocked(query).mockResolvedValue([
      [
        { docNo: 'QT20260719-22', quotationId: 7 },
        { docNo: 'QT20260719-23', quotationId: 'q2' },
      ],
    ] as any);
    expect(await listRecentDocNos()).toEqual([
      { docNo: 'QT20260719-22', quotationId: '7' },
      { docNo: 'QT20260719-23', quotationId: 'q2' },
    ]);
  });

  it('returns an empty array when the ledger is empty', async () => {
    vi.mocked(query).mockResolvedValue([[]] as any);
    expect(await listRecentDocNos()).toEqual([]);
  });
});

describe('purgeOldDocNos', () => {
  it('computes the cutoff from Date.now() and returns affectedRows', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-07-19T00:00:00.000Z'));
    try {
      vi.mocked(query).mockResolvedValue([{ affectedRows: 3 }] as any);
      const removed = await purgeOldDocNos(2);
      expect(removed).toBe(3);

      const cutoff = new Date(
        Date.parse('2026-07-19T00:00:00.000Z') - 2 * 24 * 60 * 60 * 1000
      ).toISOString();
      const [sql, params] = callAt(0);
      expect(sql).toContain('DELETE FROM used_docnos');
      expect(sql).toContain('createdAt < ?');
      expect(params).toEqual([cutoff]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('falls back to 0 when affectedRows is missing', async () => {
    vi.mocked(query).mockResolvedValue([{}] as any);
    expect(await purgeOldDocNos(2)).toBe(0);
  });
});

describe('getQuotation (rowToQuotation + parseJson)', () => {
  it('parses data/uploadedImages given as JSON strings', async () => {
    vi.mocked(query).mockResolvedValue([
      [
        {
          id: 'q1',
          docNo: 'QT20260719-22',
          data: JSON.stringify({ customerCompany: 'ACME' }),
          uploadedImages: JSON.stringify([cld('a')]),
          createdAt: '2026-07-19T00:00:00.000Z',
        },
      ],
    ] as any);
    const rec = await getQuotation('q1');
    expect(rec).toEqual({
      id: 'q1',
      docNo: 'QT20260719-22',
      data: { customerCompany: 'ACME' },
      uploadedImages: [cld('a')],
      createdAt: '2026-07-19T00:00:00.000Z',
    });
    expect(callAt(0)[1]).toEqual(['q1']);
  });

  it('passes through data/uploadedImages that are already parsed objects/arrays', async () => {
    vi.mocked(query).mockResolvedValue([
      [
        {
          id: 'q2',
          docNo: 'QT20260719-23',
          data: { customerContact: 'John' },
          uploadedImages: [cld('b'), cld('c')],
          createdAt: '2026-07-19T00:00:00.000Z',
        },
      ],
    ] as any);
    const rec = await getQuotation('q2');
    expect(rec!.data).toEqual({ customerContact: 'John' });
    expect(rec!.uploadedImages).toEqual([cld('b'), cld('c')]);
  });

  it('falls back to {} / [] / "" for null data, uploadedImages and docNo', async () => {
    vi.mocked(query).mockResolvedValue([
      [{ id: 'q3', docNo: null, data: null, uploadedImages: null, createdAt: 'x' }],
    ] as any);
    const rec = await getQuotation('q3');
    expect(rec).toEqual({ id: 'q3', docNo: '', data: {}, uploadedImages: [], createdAt: 'x' });
  });

  it('falls back to the default when a JSON string is malformed', async () => {
    vi.mocked(query).mockResolvedValue([
      [{ id: 'q4', docNo: 'D', data: '{not json', uploadedImages: 'nope', createdAt: 'x' }],
    ] as any);
    const rec = await getQuotation('q4');
    expect(rec!.data).toEqual({});
    expect(rec!.uploadedImages).toEqual([]);
  });

  it('returns null when the quotation does not exist', async () => {
    vi.mocked(query).mockResolvedValue([[]] as any);
    expect(await getQuotation('missing')).toBeNull();
  });
});

describe('listQuotations', () => {
  it('maps rows, computes total via real computeQuoteTotals, and falls back the customer field', async () => {
    vi.mocked(query).mockResolvedValue([
      [
        {
          id: 'q1',
          docNo: 'A',
          // subtotal 200, VAT 7% → grandTotal 214. customerCompany wins.
          data: JSON.stringify({
            items: [{ qty: 2, unitPrice: 100 }],
            vatEnabled: true,
            customerCompany: 'ACME',
            customerContact: 'ignored',
          }),
          createdAt: 'c1',
        },
        {
          id: 'q2',
          docNo: null, // → ''
          // no company → falls back to customerContact. No items → total 0.
          data: { customerContact: 'John' },
          createdAt: 'c2',
        },
        {
          id: 'q3',
          docNo: 'C',
          data: null, // → {} → customer '-', total 0
          createdAt: 'c3',
        },
      ],
    ] as any);

    const list = await listQuotations();
    expect(list).toEqual([
      { id: 'q1', docNo: 'A', createdAt: 'c1', customer: 'ACME', total: 214 },
      { id: 'q2', docNo: '', createdAt: 'c2', customer: 'John', total: 0 },
      { id: 'q3', docNo: 'C', createdAt: 'c3', customer: '-', total: 0 },
    ]);
    expect(String(callAt(0)[0])).toContain('ORDER BY createdAt DESC');
  });

  it('returns an empty array when there are no quotations', async () => {
    vi.mocked(query).mockResolvedValue([[]] as any);
    expect(await listQuotations()).toEqual([]);
  });
});

describe('deleteQuotation', () => {
  it('returns false and touches nothing else when the quotation does not exist', async () => {
    mockQueryRouter({ quotationById: [] });
    const ok = await deleteQuotation('nope');
    expect(ok).toBe(false);
    expect(deleteCloudinaryImages).not.toHaveBeenCalled();
    // Only the getQuotation SELECT ran; no DELETE issued.
    expect(query).toHaveBeenCalledTimes(1);
    expect(deleteCallIndex()).toBe(-1);
  });

  it('deletes orphaned uploaded images then the row, and returns true', async () => {
    mockQueryRouter({
      quotationById: [
        {
          id: 'q1',
          docNo: 'A',
          data: '{}',
          uploadedImages: JSON.stringify([cld('a'), cld('b')]),
          createdAt: 'x',
        },
      ],
      products: [],
      contents: [],
      deleteResult: { affectedRows: 1 },
    });

    const ok = await deleteQuotation('q1');
    expect(ok).toBe(true);
    expect(deleteCloudinaryImages).toHaveBeenCalledTimes(1);
    expect(deleteCloudinaryImages).toHaveBeenCalledWith([cld('a'), cld('b')]);
    // Row DELETE issued with the id.
    const di = deleteCallIndex();
    expect(di).toBeGreaterThanOrEqual(0);
    expect(String(callAt(di)[0])).toContain('DELETE FROM quotations WHERE id = ?');
    expect(callAt(di)[1]).toEqual(['q1']);
  });

  it('skips Cloudinary entirely when the quotation has no uploaded images', async () => {
    mockQueryRouter({
      quotationById: [
        { id: 'q1', docNo: 'A', data: '{}', uploadedImages: '[]', createdAt: 'x' },
      ],
      deleteResult: { affectedRows: 1 },
    });

    const ok = await deleteQuotation('q1');
    expect(ok).toBe(true);
    expect(deleteCloudinaryImages).not.toHaveBeenCalled();
    // No products/contents lookup happened (deleteQuoteImagesSafely returned early).
    expect(vi.mocked(query).mock.calls.some((c) => /FROM products/.test(String(c[0])))).toBe(false);
    // Row still deleted.
    expect(deleteCallIndex()).toBeGreaterThanOrEqual(0);
  });

  it('never calls Cloudinary when every uploaded image is still in use', async () => {
    const shared = cld('shared');
    mockQueryRouter({
      quotationById: [
        {
          id: 'q1',
          docNo: 'A',
          data: '{}',
          uploadedImages: JSON.stringify([shared]),
          createdAt: 'x',
        },
      ],
      products: [{ image: shared }],
      contents: [],
      deleteResult: { affectedRows: 1 },
    });

    expect(await deleteQuotation('q1')).toBe(true);
    expect(deleteCloudinaryImages).not.toHaveBeenCalled();
    expect(deleteCallIndex()).toBeGreaterThanOrEqual(0);
  });

  // ── THE SAFETY INVARIANT ──────────────────────────────────────────────────
  it('excludes a product-referenced URL from deletion (safety invariant), deletes only orphans, images BEFORE row', async () => {
    const shared = cld('shared-with-product');
    const orphan = cld('orphan');
    mockQueryRouter({
      quotationById: [
        {
          id: 'q1',
          docNo: 'A',
          data: '{}',
          uploadedImages: JSON.stringify([shared, orphan]),
          createdAt: 'x',
        },
      ],
      // One real product image + a null image (exercises the `if (p.image)` skip).
      products: [{ image: shared }, { image: null }],
      contents: [],
      deleteResult: { affectedRows: 1 },
    });

    expect(await deleteQuotation('q1')).toBe(true);
    // Only the truly-orphaned URL is destroyed — the shared product image is spared.
    expect(deleteCloudinaryImages).toHaveBeenCalledTimes(1);
    expect(deleteCloudinaryImages).toHaveBeenCalledWith([orphan]);

    // Images must be purged BEFORE the row is deleted.
    const imagesOrder = vi.mocked(deleteCloudinaryImages).mock.invocationCallOrder[0];
    const rowOrder = vi.mocked(query).mock.invocationCallOrder[deleteCallIndex()];
    expect(imagesOrder).toBeLessThan(rowOrder);
  });

  it('excludes content-referenced URLs (block imageUrl AND imageUrls[]) from deletion', async () => {
    const single = cld('content-single');
    const inArray = cld('content-array');
    const orphan = cld('content-orphan');
    mockQueryRouter({
      quotationById: [
        {
          id: 'q1',
          docNo: 'A',
          data: '{}',
          uploadedImages: JSON.stringify([single, inArray, orphan]),
          createdAt: 'x',
        },
      ],
      products: [],
      // blocks arrive as a JSON string; parseJson must decode it.
      contents: [
        {
          blocks: JSON.stringify([
            { imageUrl: single }, // string imageUrl → referenced
            { imageUrl: 123 }, // non-string → ignored by the type guard
            { imageUrls: [inArray, 999] }, // array; only the string is referenced
            { type: 'text' }, // no images at all
          ]),
        },
      ],
      deleteResult: { affectedRows: 1 },
    });

    expect(await deleteQuotation('q1')).toBe(true);
    expect(deleteCloudinaryImages).toHaveBeenCalledWith([orphan]);
  });
});

describe('purgeExpiredQuotations', () => {
  it('returns 0 and touches nothing when nothing is expired', async () => {
    mockQueryRouter({ quotationsExpired: [] });
    const n = await purgeExpiredQuotations(30);
    expect(n).toBe(0);
    expect(deleteCloudinaryImages).not.toHaveBeenCalled();
    expect(deleteCallIndex()).toBe(-1); // no row DELETE
    expect(query).toHaveBeenCalledTimes(1); // only the SELECT ran
  });

  it('computes cutoff, safe-deletes orphan images across rows, deletes rows, returns count', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-07-19T00:00:00.000Z'));
    try {
      const shared = cld('shared'); // referenced by a product → must survive
      mockQueryRouter({
        quotationsExpired: [
          { id: 'q1', uploadedImages: JSON.stringify([cld('a'), shared]) },
          { id: 'q2', uploadedImages: JSON.stringify([cld('b')]) },
        ],
        products: [{ image: shared }],
        contents: [],
        deleteResult: { affectedRows: 2 },
      });

      const n = await purgeExpiredQuotations(30);
      expect(n).toBe(2);

      const cutoff = new Date(
        Date.parse('2026-07-19T00:00:00.000Z') - 30 * 24 * 60 * 60 * 1000
      ).toISOString();

      // SELECT used the cutoff.
      const selectCall = vi
        .mocked(query)
        .mock.calls.find((c) => /uploadedImages FROM quotations/.test(String(c[0])));
      expect(selectCall![1]).toEqual([cutoff]);

      // Safety invariant honoured across the flat-mapped image list.
      expect(deleteCloudinaryImages).toHaveBeenCalledTimes(1);
      expect(deleteCloudinaryImages).toHaveBeenCalledWith([cld('a'), cld('b')]);

      // Rows deleted by the same cutoff.
      const di = deleteCallIndex();
      expect(String(callAt(di)[0])).toContain('DELETE FROM quotations WHERE createdAt < ?');
      expect(callAt(di)[1]).toEqual([cutoff]);

      // Images purged before the rows.
      const imagesOrder = vi.mocked(deleteCloudinaryImages).mock.invocationCallOrder[0];
      const rowOrder = vi.mocked(query).mock.invocationCallOrder[di];
      expect(imagesOrder).toBeLessThan(rowOrder);
    } finally {
      vi.useRealTimers();
    }
  });

  it('deletes rows but skips Cloudinary when expired quotations have no images', async () => {
    mockQueryRouter({
      quotationsExpired: [
        { id: 'q1', uploadedImages: '[]' },
        { id: 'q2', uploadedImages: null }, // parseJson → []
      ],
      deleteResult: { affectedRows: 2 },
    });

    const n = await purgeExpiredQuotations(30);
    expect(n).toBe(2);
    expect(deleteCloudinaryImages).not.toHaveBeenCalled();
    expect(deleteCallIndex()).toBeGreaterThanOrEqual(0);
  });
});

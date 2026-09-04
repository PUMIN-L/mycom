// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the DB layer. `query()` resolves to a tuple `[rows|result, fields]`, so
// callers destructure `const [rows] = await query(...)`. `withTransaction` runs
// a callback with a pooled connection.
// updateProduct snapshots the previous value via revisionStore before writing;
// stub it so it doesn't add a query the call-order assertions don't expect.
vi.mock('@/app/lib/revisionStore', () => ({ saveRevision: vi.fn() }));

vi.mock('@/app/lib/db', () => ({
  query: vi.fn(),
  withTransaction: vi.fn(),
  getDbConnection: vi.fn(),
}));
import { query, withTransaction } from '@/app/lib/db';

import {
  getAllCategories,
  addCategory,
  deleteCategory,
  updateCategory,
  reorderCategories,
  addProduct,
  getProduct,
  getAllProducts,
  getProductsByCategory,
  deleteProduct,
  updateProduct,
  reorderProducts,
  isProductPublic,
} from '@/app/lib/productStore';
import type { ProductData } from '@/app/lib/productStore';

// A DB row as SELECT * returns it (isPublished stored as 0/1 by MySQL BOOLEAN).
const makeRow = (over: Record<string, unknown> = {}) => ({
  id: 'p1',
  categoryId: 2,
  image: '/img/p1.png',
  title_th: 'ชื่อ',
  title_en: 'Name',
  title_zh: '名字',
  desc_th: 'desc th',
  desc_en: 'desc en',
  desc_zh: 'desc zh',
  createdAt: '2026-07-17T00:00:00.000Z',
  isPublished: 1,
  ...over,
});

describe('productStore', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  // ── Categories ──────────────────────────────────────────────────────────────

  describe('getAllCategories', () => {
    it('returns the rows ordered by sortOrder', async () => {
      const rows = [
        { id: 0, name_th: 'ก', name_en: 'A', name_zh: '甲', sortOrder: 0 },
        { id: 1, name_th: 'ข', name_en: 'B', name_zh: '乙', sortOrder: 1 },
      ];
      vi.mocked(query).mockResolvedValue([rows] as any);

      const result = await getAllCategories();

      expect(result).toEqual(rows);
      expect(vi.mocked(query).mock.calls[0][0]).toContain('ORDER BY sortOrder ASC');
    });

    it('returns an empty array when there are no categories', async () => {
      vi.mocked(query).mockResolvedValue([[]] as any);
      expect(await getAllCategories()).toEqual([]);
    });
  });

  describe('addCategory', () => {
    const cat = { name_th: 'ใหม่', name_en: 'New', name_zh: '新' };

    it('allocates id = MAX(id)+1 and inserts it, returning the new category', async () => {
      vi.mocked(query)
        .mockResolvedValueOnce([[{ maxId: 5 }]] as any) // SELECT MAX(id)
        .mockResolvedValueOnce([{ affectedRows: 1 }] as any); // INSERT

      const result = await addCategory(cat);

      expect(result).toEqual({
        id: 6,
        name_th: 'ใหม่',
        name_en: 'New',
        name_zh: '新',
        sortOrder: 6,
      });
      // First call reads the max, second call inserts with id === sortOrder === 6.
      expect(vi.mocked(query).mock.calls[0][0]).toContain('MAX(id)');
      expect(vi.mocked(query).mock.calls[1][0]).toContain('INSERT INTO product_categories');
      expect(vi.mocked(query).mock.calls[1][1]).toEqual([6, 'ใหม่', 'New', '新', 6]);
    });

    it('starts ids at 1 when the table is empty (MAX(id) is null)', async () => {
      vi.mocked(query)
        .mockResolvedValueOnce([[{ maxId: null }]] as any)
        .mockResolvedValueOnce([{ affectedRows: 1 }] as any);

      const result = await addCategory(cat);

      expect(result.id).toBe(1);
      expect(result.sortOrder).toBe(1);
      expect(vi.mocked(query).mock.calls[1][1]).toEqual([1, 'ใหม่', 'New', '新', 1]);
    });

    it('retries with a freshly-read max on a duplicate-key collision', async () => {
      vi.mocked(query)
        .mockResolvedValueOnce([[{ maxId: 5 }]] as any) // attempt 1: max
        .mockRejectedValueOnce({ code: 'ER_DUP_ENTRY' }) // attempt 1: insert loses race
        .mockResolvedValueOnce([[{ maxId: 6 }]] as any) // attempt 2: fresh max
        .mockResolvedValueOnce([{ affectedRows: 1 }] as any); // attempt 2: insert ok

      const result = await addCategory(cat);

      expect(result.id).toBe(7);
      expect(vi.mocked(query)).toHaveBeenCalledTimes(4);
    });

    it('rethrows a non-duplicate error without retrying', async () => {
      vi.mocked(query)
        .mockResolvedValueOnce([[{ maxId: 5 }]] as any)
        .mockRejectedValueOnce({ code: 'ER_SOMETHING_ELSE' });

      await expect(addCategory(cat)).rejects.toMatchObject({ code: 'ER_SOMETHING_ELSE' });
      // Did not loop again after the fatal error.
      expect(vi.mocked(query)).toHaveBeenCalledTimes(2);
    });

    it('throws after exhausting all attempts on repeated duplicate-key errors', async () => {
      vi.mocked(query).mockImplementation(async (sql: string) => {
        if (/MAX\(id\)/.test(sql)) return [[{ maxId: 0 }]] as any;
        throw { code: 'ER_DUP_ENTRY' };
      });

      await expect(addCategory(cat)).rejects.toMatchObject({ code: 'ER_DUP_ENTRY' });
    });
  });

  describe('deleteCategory', () => {
    it('returns true when a row was deleted', async () => {
      vi.mocked(query).mockResolvedValue([{ affectedRows: 1 }] as any);
      expect(await deleteCategory(3)).toBe(true);
      expect(vi.mocked(query).mock.calls[0][0]).toContain('DELETE FROM product_categories');
      expect(vi.mocked(query).mock.calls[0][1]).toEqual([3]);
    });

    it('returns false when no row matched', async () => {
      vi.mocked(query).mockResolvedValue([{ affectedRows: 0 }] as any);
      expect(await deleteCategory(999)).toBe(false);
    });
  });

  describe('updateCategory', () => {
    const names = { name_th: 'แก้', name_en: 'Edit', name_zh: '改' };

    it('returns true and passes params in [th, en, zh, id] order', async () => {
      vi.mocked(query).mockResolvedValue([{ affectedRows: 1 }] as any);

      expect(await updateCategory(4, names)).toBe(true);
      expect(vi.mocked(query).mock.calls[0][0]).toContain('UPDATE product_categories');
      expect(vi.mocked(query).mock.calls[0][1]).toEqual(['แก้', 'Edit', '改', 4]);
    });

    it('returns false when no row matched', async () => {
      vi.mocked(query).mockResolvedValue([{ affectedRows: 0 }] as any);
      expect(await updateCategory(404, names)).toBe(false);
    });
  });

  describe('reorderCategories', () => {
    it('updates sortOrder using a single CASE WHEN query', async () => {
      vi.mocked(query).mockResolvedValue(undefined as any);

      const result = await reorderCategories([10, 20, 30]);

      expect(result).toBe(true);
      expect(query).toHaveBeenCalledTimes(1);
      expect(vi.mocked(query).mock.calls[0][0]).toContain('CASE id');
      // [10, 0, 20, 1, 30, 2, 10, 20, 30]
      expect(vi.mocked(query).mock.calls[0][1]).toEqual([10, 0, 20, 1, 30, 2, 10, 20, 30]);
    });

    it('returns true and issues no updates for an empty list', async () => {
      vi.mocked(query).mockClear();

      expect(await reorderCategories([])).toBe(true);
      expect(query).not.toHaveBeenCalled();
    });

    it('returns false when the query fails', async () => {
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => { });
      vi.mocked(query).mockRejectedValue(new Error('query failed'));

      expect(await reorderCategories([1, 2])).toBe(false);
      errSpy.mockRestore();
    });
  });

  // ── Products ────────────────────────────────────────────────────────────────

  describe('getProduct', () => {
    it('maps a found row (isPublished 1 -> true) and queries by id', async () => {
      vi.mocked(query)
        .mockResolvedValueOnce([[makeRow()]] as any)
        .mockResolvedValueOnce([[]] as any);

      const product = await getProduct('p1');

      expect(product).toEqual({
        id: 'p1',
        categoryId: 2,
        image: '/img/p1.png',
        title_th: 'ชื่อ',
        title_en: 'Name',
        title_zh: '名字',
        desc_th: 'desc th',
        desc_en: 'desc en',
        desc_zh: 'desc zh',
        createdAt: '2026-07-17T00:00:00.000Z',
        isPublished: true,
        sortOrder: 0,
        bestSellerRank: null,
        showBestSellerBadge: true,
        pendingDeleteAt: null,
        supplierIds: [],
      });
      expect(vi.mocked(query).mock.calls[0][0]).toContain('WHERE id = ?');
      expect(vi.mocked(query).mock.calls[0][1]).toEqual(['p1']);
    });

    it('coerces isPublished 0 to false', async () => {
      vi.mocked(query)
        .mockResolvedValueOnce([[makeRow({ isPublished: 0 })]] as any)
        .mockResolvedValueOnce([[]] as any);
      expect((await getProduct('p1'))!.isPublished).toBe(false);
    });

    it('defaults isPublished to true when the column is absent', async () => {
      const row = makeRow();
      delete (row as Record<string, unknown>).isPublished;
      vi.mocked(query)
        .mockResolvedValueOnce([[row]] as any)
        .mockResolvedValueOnce([[]] as any);
      expect((await getProduct('p1'))!.isPublished).toBe(true);
    });

    it('falls back to empty strings for null descriptions', async () => {
      vi.mocked(query)
        .mockResolvedValueOnce([[makeRow({ desc_th: null, desc_en: null, desc_zh: null })]] as any)
        .mockResolvedValueOnce([[]] as any);

      const product = await getProduct('p1');
      expect(product!.desc_th).toBe('');
      expect(product!.desc_en).toBe('');
      expect(product!.desc_zh).toBe('');
    });

    it('returns undefined when no row is found', async () => {
      vi.mocked(query).mockResolvedValue([[]] as any);
      expect(await getProduct('missing')).toBeUndefined();
    });
  });

  describe('getAllProducts', () => {
    it('maps every row and orders by categoryId then createdAt', async () => {
      vi.mocked(query).mockResolvedValue([
        [makeRow({ id: 'a', isPublished: 1 }), makeRow({ id: 'b', isPublished: 0 })],
      ] as any);

      const products = await getAllProducts();

      expect(products).toHaveLength(2);
      expect(products[0].id).toBe('a');
      expect(products[0].isPublished).toBe(true);
      expect(products[1].isPublished).toBe(false);
      expect(vi.mocked(query).mock.calls[0][0]).toContain(
        'ORDER BY categoryId ASC, sortOrder ASC, createdAt ASC'
      );
    });

    it('returns an empty array when there are no products', async () => {
      vi.mocked(query).mockResolvedValue([[]] as any);
      expect(await getAllProducts()).toEqual([]);
    });
  });

  describe('getProductsByCategory', () => {
    it('filters by categoryId and maps the rows', async () => {
      vi.mocked(query).mockResolvedValue([[makeRow({ categoryId: 7 })]] as any);

      const products = await getProductsByCategory(7);

      expect(products).toHaveLength(1);
      expect(products[0].categoryId).toBe(7);
      expect(vi.mocked(query).mock.calls[0][0]).toContain('WHERE categoryId = ?');
      expect(vi.mocked(query).mock.calls[0][1]).toEqual([7]);
    });

    it('returns an empty array when the category has no products', async () => {
      vi.mocked(query).mockResolvedValue([[]] as any);
      expect(await getProductsByCategory(99)).toEqual([]);
    });
  });

  describe('addProduct', () => {
    const baseProduct: ProductData = {
      id: 'new-1',
      categoryId: 3,
      image: '/img/new.png',
      title_th: 'ท',
      title_en: 'T',
      title_zh: 'T',
      desc_th: 'plain th',
      desc_en: 'plain en',
      desc_zh: 'plain zh',
      createdAt: '2026-07-17T10:00:00.000Z',
      isPublished: true,
    };

    it('inserts all columns and returns the product with sanitized descriptions', async () => {
      const conn = { query: vi.fn().mockResolvedValue([{ affectedRows: 1 }] as any) };
      vi.mocked(withTransaction).mockImplementation(async (fn: any) => fn(conn));

      const result = await addProduct(baseProduct);

      expect(conn.query.mock.calls[0][0]).toContain('INSERT INTO products');
      expect(conn.query.mock.calls[0][1]).toEqual([
        'new-1',
        3,
        '/img/new.png',
        'ท',
        'T',
        'T',
        'plain th',
        'plain en',
        'plain zh',
        '2026-07-17T10:00:00.000Z',
        true,
        0,
        null,
        true,
      ]);
      expect(result).toEqual({ ...baseProduct, isPublished: true });
    });

    it('coerces isPublished to false when explicitly false', async () => {
      const conn = { query: vi.fn().mockResolvedValue([{ affectedRows: 1 }] as any) };
      vi.mocked(withTransaction).mockImplementation(async (fn: any) => fn(conn));

      const result = await addProduct({ ...baseProduct, isPublished: false });

      // 11th param is isPublished.
      expect(conn.query.mock.calls[0][1][10]).toBe(false);
      expect(result.isPublished).toBe(false);
    });

    it('defaults isPublished to true when undefined', async () => {
      const conn = { query: vi.fn().mockResolvedValue([{ affectedRows: 1 }] as any) };
      vi.mocked(withTransaction).mockImplementation(async (fn: any) => fn(conn));

      const { isPublished, ...noFlag } = baseProduct;
      const result = await addProduct(noFlag as ProductData);

      // 11th param is isPublished.
      expect(conn.query.mock.calls[0][1][10]).toBe(true);
      expect(result.isPublished).toBe(true);
    });

    it('sanitizes rich-text descriptions on write, stripping scripts', async () => {
      const conn = { query: vi.fn().mockResolvedValue([{ affectedRows: 1 }] as any) };
      vi.mocked(withTransaction).mockImplementation(async (fn: any) => fn(conn));

      const result = await addProduct({
        ...baseProduct,
        desc_th: '<p>safe</p><script>alert(1)</script>',
      });

      const storedDescTh = conn.query.mock.calls[0][1][6] as string;
      expect(storedDescTh).not.toContain('<script>');
      expect(storedDescTh).toContain('safe');
      expect(result.desc_th).not.toContain('<script>');
    });
  });

  describe('deleteProduct', () => {
    it('returns true when a row was deleted', async () => {
      vi.mocked(query).mockResolvedValue([{ affectedRows: 1 }] as any);
      expect(await deleteProduct('p1')).toBe(true);
      expect(vi.mocked(query).mock.calls[0][0]).toContain('DELETE FROM products');
      expect(vi.mocked(query).mock.calls[0][1]).toEqual(['p1']);
    });

    it('returns false when no row matched', async () => {
      vi.mocked(query).mockResolvedValue([{ affectedRows: 0 }] as any);
      expect(await deleteProduct('missing')).toBe(false);
    });
  });

  describe('updateProduct', () => {
    it('returns undefined and issues no UPDATE when the product does not exist', async () => {
      vi.mocked(query)
        .mockResolvedValueOnce([[]] as any)
        .mockResolvedValueOnce([[]] as any);

      const result = await updateProduct('missing', { title_en: 'x' });

      expect(result).toBeUndefined();
      // Only the existence SELECT ran; no UPDATE.
      expect(vi.mocked(query)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(query).mock.calls[0][0]).toContain('SELECT * FROM products');
    });

    it('updates only supplied columns and returns the re-read product', async () => {
      let isAfterUpdate = false;
      vi.mocked(query).mockImplementation(async (sql: string) => {
        if (sql.includes('SELECT * FROM products')) {
          return [[makeRow(isAfterUpdate ? { title_en: 'Updated', isPublished: 0 } : undefined)]] as any;
        }
        if (sql.includes('SELECT supplierId')) return [[]] as any;
        if (sql.includes('INSERT INTO revisions')) return [{ affectedRows: 1 }] as any;
        return [] as any;
      });

      const conn = { query: vi.fn().mockResolvedValue([{ affectedRows: 1 }] as any) };
      vi.mocked(withTransaction).mockImplementation(async (fn: any) => {
        isAfterUpdate = true;
        return fn(conn);
      });

      const result = await updateProduct('p1', { title_en: 'Updated', isPublished: false });

      const updateCall = conn.query.mock.calls[0];
      expect(updateCall[0]).toBe(
        'UPDATE products SET title_en = ?, isPublished = ? WHERE id = ?'
      );
      // supplied values in order, then the id last.
      expect(updateCall[1]).toEqual(['Updated', false, 'p1']);
      expect(result!.title_en).toBe('Updated');
      expect(result!.isPublished).toBe(false);
    });

    it('sanitizes description columns in the UPDATE', async () => {
      vi.mocked(query).mockImplementation(async (sql: string) => {
        if (sql.includes('SELECT * FROM products')) return [[makeRow()]] as any;
        if (sql.includes('SELECT supplierId')) return [[]] as any;
        if (sql.includes('INSERT INTO revisions')) return [{ affectedRows: 1 }] as any;
        return [] as any;
      });

      const conn = { query: vi.fn().mockResolvedValue([{ affectedRows: 1 }] as any) };
      vi.mocked(withTransaction).mockImplementation(async (fn: any) => fn(conn));

      await updateProduct('p1', { desc_en: '<p>ok</p><script>evil()</script>' });

      const updateCall = conn.query.mock.calls[0];
      expect(updateCall[0]).toBe('UPDATE products SET desc_en = ? WHERE id = ?');
      expect(updateCall[1]![0]).not.toContain('<script>');
      expect(updateCall[1]![0]).toContain('ok');
    });

    it('skips the UPDATE entirely when no fields are supplied', async () => {
      vi.mocked(query)
        .mockResolvedValueOnce([[makeRow()]] as any)
        .mockResolvedValueOnce([[]] as any)
        .mockResolvedValueOnce([[makeRow()]] as any)
        .mockResolvedValueOnce([[]] as any);

      const conn = { query: vi.fn().mockResolvedValue([{ affectedRows: 1 }] as any) };
      vi.mocked(withTransaction).mockImplementation(async (fn: any) => fn(conn));

      const result = await updateProduct('p1', {});

      // Two SELECTs in getProduct calls
      expect(conn.query).toHaveBeenCalledTimes(0);
      expect(result!.id).toBe('p1');
    });
  });

  describe('reorderProducts', () => {
    it('updates sortOrder using a single CASE WHEN query against the products table', async () => {
      vi.mocked(query).mockResolvedValue(undefined as any);

      const result = await reorderProducts(['p1', 'p2', 'p3']);

      expect(result).toBe(true);
      expect(query).toHaveBeenCalledTimes(1);
      const [sql, params] = vi.mocked(query).mock.calls[0];
      expect(sql).toContain('UPDATE products SET sortOrder');
      expect(sql).toContain('CASE id');
      expect(params).toEqual(['p1', 0, 'p2', 1, 'p3', 2, 'p1', 'p2', 'p3']);
    });

    it('returns true and issues no updates for an empty list', async () => {
      vi.mocked(query).mockClear();

      expect(await reorderProducts([])).toBe(true);
      expect(query).not.toHaveBeenCalled();
    });

    it('returns false when the query fails', async () => {
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => { });
      vi.mocked(query).mockRejectedValue(new Error('query failed'));

      expect(await reorderProducts(['p1', 'p2'])).toBe(false);
      errSpy.mockRestore();
    });
  });

  describe('isProductPublic', () => {
    it('is public when published and no pending delete', () => {
      expect(isProductPublic({ isPublished: true, pendingDeleteAt: null })).toBe(true);
    });

    it('is NOT public when isPublished is false', () => {
      expect(isProductPublic({ isPublished: false, pendingDeleteAt: null })).toBe(false);
    });

    it('is NOT public when a delete is pending, even if still marked published', () => {
      expect(isProductPublic({ isPublished: true, pendingDeleteAt: '2026-09-01' as any })).toBe(false);
    });

    it('treats a missing isPublished field as published (legacy rows)', () => {
      expect(isProductPublic({ isPublished: undefined as any, pendingDeleteAt: null })).toBe(true);
    });
  });
});

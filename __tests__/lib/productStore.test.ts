// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the DB layer. `query()` resolves to a tuple `[rows|result, fields]`, so
// callers destructure `const [rows] = await query(...)`. `withTransaction` runs
// a callback with a pooled connection.
// updateProduct snapshots the previous value via revisionStore before writing;
// stub it so it doesn't add a query the call-order assertions don't expect.
vi.mock('@/app/lib/revisionStore', () => ({ saveRevision: vi.fn() }));
import { saveRevision } from '@/app/lib/revisionStore';

vi.mock('@/app/lib/db', () => ({
  query: vi.fn(),
  withTransaction: vi.fn(),
  getDbConnection: vi.fn(),
}));
import { query, withTransaction } from '@/app/lib/db';

// getAllProducts / getAllCategories are wrapped in next/cache's unstable_cache
// (see productStore.ts). Make it pass-through so each call re-runs the real
// query against the mock above — otherwise the second call in a test would be
// served the first call's cached rows.
vi.mock('next/cache', () => ({ unstable_cache: (fn: any) => fn }));

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
  BestSellerRankConflictError,
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

    // baseProduct has no explicit sortOrder, so addProduct looks up the next
    // slot in its category first; this stubs that lookup and returns the
    // INSERT call regardless of how many other queries ran before it.
    const stubConnAppendingAt = (nextSort: number) => {
      const conn = {
        query: vi.fn().mockImplementation(async (sql: string) => {
          if (sql.includes('MAX(sortOrder)')) return [[{ nextSort }]] as any;
          return [{ affectedRows: 1 }] as any;
        }),
      };
      vi.mocked(withTransaction).mockImplementation(async (fn: any) => fn(conn));
      const insertCall = () =>
        conn.query.mock.calls.find((c) => (c[0] as string).includes('INSERT INTO products'))!;
      return { conn, insertCall };
    };

    it('inserts all columns and returns the product with sanitized descriptions', async () => {
      const { insertCall } = stubConnAppendingAt(0);

      const result = await addProduct(baseProduct);

      expect(insertCall()[1]).toEqual([
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
      expect(result).toEqual({ ...baseProduct, isPublished: true, sortOrder: 0 });
    });

    it('appends after the highest existing sortOrder in the same category instead of resetting to 0', async () => {
      const { insertCall } = stubConnAppendingAt(5);

      const result = await addProduct(baseProduct);

      expect(insertCall()[1][11]).toBe(5); // 12th param is sortOrder
      expect(result.sortOrder).toBe(5);
    });

    it('scopes the next-sortOrder lookup to the product\'s own category', async () => {
      const conn = { query: vi.fn().mockResolvedValue([[{ nextSort: 0 }]] as any) };
      vi.mocked(withTransaction).mockImplementation(async (fn: any) => fn(conn));

      await addProduct(baseProduct);

      const lookupCall = conn.query.mock.calls.find((c) => (c[0] as string).includes('MAX(sortOrder)'))!;
      expect(lookupCall[1]).toEqual([3]); // baseProduct.categoryId
    });

    it('uses an explicitly supplied sortOrder as-is, skipping the lookup', async () => {
      const conn = { query: vi.fn().mockResolvedValue([{ affectedRows: 1 }] as any) };
      vi.mocked(withTransaction).mockImplementation(async (fn: any) => fn(conn));

      const result = await addProduct({ ...baseProduct, sortOrder: 42 });

      expect(conn.query).toHaveBeenCalledTimes(1); // only the INSERT, no lookup
      expect(conn.query.mock.calls[0][1][11]).toBe(42);
      expect(result.sortOrder).toBe(42);
    });

    it('coerces isPublished to false when explicitly false', async () => {
      const { insertCall } = stubConnAppendingAt(0);

      const result = await addProduct({ ...baseProduct, isPublished: false });

      // 11th param is isPublished.
      expect(insertCall()[1][10]).toBe(false);
      expect(result.isPublished).toBe(false);
    });

    it('defaults isPublished to true when undefined', async () => {
      const { insertCall } = stubConnAppendingAt(0);

      const { isPublished, ...noFlag } = baseProduct;
      const result = await addProduct(noFlag as ProductData);

      // 11th param is isPublished.
      expect(insertCall()[1][10]).toBe(true);
      expect(result.isPublished).toBe(true);
    });

    it('sanitizes rich-text descriptions on write, stripping scripts', async () => {
      const { insertCall } = stubConnAppendingAt(0);

      const result = await addProduct({
        ...baseProduct,
        desc_th: '<p>safe</p><script>alert(1)</script>',
      });

      const storedDescTh = insertCall()[1][6] as string;
      expect(storedDescTh).not.toContain('<script>');
      expect(storedDescTh).toContain('safe');
      expect(result.desc_th).not.toContain('<script>');
    });

    it('rejects a bestSellerRank already held by another product instead of creating a duplicate', async () => {
      const conn = {
        query: vi.fn().mockImplementation(async (sql: string) => {
          if (sql.includes('MAX(sortOrder)')) return [[{ nextSort: 0 }]] as any;
          if (sql.includes('WHERE bestSellerRank = ?')) return [[{ id: 'other-product' }]] as any;
          return [{ affectedRows: 1 }] as any;
        }),
      };
      vi.mocked(withTransaction).mockImplementation(async (fn: any) => fn(conn));

      await expect(addProduct({ ...baseProduct, bestSellerRank: 1 })).rejects.toThrow(
        BestSellerRankConflictError
      );
      expect(conn.query.mock.calls.some((c) => (c[0] as string).includes('INSERT INTO products'))).toBe(false);
    });

    it('allows a bestSellerRank that no other product holds', async () => {
      const conn = {
        query: vi.fn().mockImplementation(async (sql: string) => {
          if (sql.includes('MAX(sortOrder)')) return [[{ nextSort: 0 }]] as any;
          if (sql.includes('WHERE bestSellerRank = ?')) return [[]] as any;
          return [{ affectedRows: 1 }] as any;
        }),
      };
      vi.mocked(withTransaction).mockImplementation(async (fn: any) => fn(conn));

      const result = await addProduct({ ...baseProduct, bestSellerRank: 1 });
      expect(result.bestSellerRank).toBe(1);
    });

    // ── The race the pre-check cannot see ────────────────────────────────
    // Two admins save rank 1 while nobody holds it. Both pre-checks read zero
    // rows — TiDB takes no gap lock on a row that does not exist, so
    // `FOR UPDATE` there locked nothing — and both used to INSERT. The
    // UNIQUE index added in db.ts v40 is what refuses the loser, and this
    // asserts the loser is told what actually happened rather than getting a
    // bare "บันทึกไม่สำเร็จ".
    //
    // This bites: drop the try/catch around the INSERT and a raw ER_DUP_ENTRY
    // escapes instead of BestSellerRankConflictError.
    it('reports the loser of a rank RACE as a rank conflict, not a database error', async () => {
      const dup = Object.assign(new Error('Duplicate entry'), { code: 'ER_DUP_ENTRY' });
      const conn = {
        query: vi.fn().mockImplementation(async (sql: string) => {
          if (sql.includes('MAX(sortOrder)')) return [[{ nextSort: 0 }]] as any;
          // The pre-check sees nothing: the other admin has not committed yet.
          if (sql.includes('WHERE bestSellerRank = ?')) return [[]] as any;
          // ...and by the time we INSERT, they have.
          if (sql.includes('INSERT INTO products')) throw dup;
          return [{ affectedRows: 1 }] as any;
        }),
      };
      vi.mocked(withTransaction).mockImplementation(async (fn: any) => fn(conn));

      await expect(addProduct({ ...baseProduct, bestSellerRank: 1 })).rejects.toThrow(
        BestSellerRankConflictError
      );
    });

    it('lets an unrelated duplicate-key error keep its own identity', async () => {
      const dup = Object.assign(new Error('Duplicate entry'), { code: 'ER_DUP_ENTRY' });
      const conn = {
        query: vi.fn().mockImplementation(async (sql: string) => {
          if (sql.includes('MAX(sortOrder)')) return [[{ nextSort: 0 }]] as any;
          if (sql.includes('INSERT INTO products')) throw dup;
          return [{ affectedRows: 1 }] as any;
        }),
      };
      vi.mocked(withTransaction).mockImplementation(async (fn: any) => fn(conn));

      // No rank was being set, so nothing here is a best-seller collision.
      await expect(
        addProduct({ ...baseProduct, bestSellerRank: null })
      ).rejects.not.toBeInstanceOf(BestSellerRankConflictError);
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

      // Snapshot runs through the transaction's own connection, not the
      // pool-level query — a retried attempt (withTransaction retries the
      // whole callback on a transient error) can't leave a duplicate behind.
      expect(saveRevision).toHaveBeenCalledWith('product', 'p1', expect.anything(), conn);
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

    it('rejects a bestSellerRank already held by a different product', async () => {
      vi.mocked(query).mockImplementation(async (sql: string) => {
        if (sql.includes('SELECT * FROM products')) return [[makeRow({ bestSellerRank: null })]] as any;
        if (sql.includes('SELECT supplierId')) return [[]] as any;
        return [] as any;
      });
      const conn = {
        query: vi.fn().mockImplementation(async (sql: string) => {
          if (sql.includes('WHERE bestSellerRank = ?')) return [[{ id: 'other-product' }]] as any;
          return [{ affectedRows: 1 }] as any;
        }),
      };
      vi.mocked(withTransaction).mockImplementation(async (fn: any) => fn(conn));

      await expect(updateProduct('p1', { bestSellerRank: 1 })).rejects.toThrow(
        BestSellerRankConflictError
      );
      expect(conn.query.mock.calls.some((c) => (c[0] as string).startsWith('UPDATE products'))).toBe(false);
    });

    it('excludes the product itself from the bestSellerRank collision check', async () => {
      vi.mocked(query).mockImplementation(async (sql: string) => {
        if (sql.includes('SELECT * FROM products')) return [[makeRow({ bestSellerRank: 1 })]] as any;
        if (sql.includes('SELECT supplierId')) return [[]] as any;
        return [] as any;
      });
      const conn = { query: vi.fn().mockResolvedValue([{ affectedRows: 1 }] as any) };
      vi.mocked(withTransaction).mockImplementation(async (fn: any) => fn(conn));

      // Re-saving the same rank the product already holds is a no-op change,
      // not a self-collision — the guard must skip the check entirely.
      await updateProduct('p1', { bestSellerRank: 1 });

      expect(conn.query.mock.calls.some((c) => (c[0] as string).includes('WHERE bestSellerRank = ?'))).toBe(false);
    });
  });

  // A revision is only worth writing when the value it snapshots differs from
  // the value about to be written over it. The edit form posts EVERY field on
  // every save, so `sets.length > 0` — the old condition — was true even for a
  // save that changed nothing, and each of those spent one of the
  // REVISION_KEEP.product = 20 slots this product's history has.
  describe('updateProduct — no change, no snapshot', () => {
    // getProduct reads the row and then its suppliers; withTransaction hands
    // the callback a conn whose rank check finds no other holder.
    const stubProduct = (row: Record<string, unknown>, supplierIds: string[] = []) => {
      vi.mocked(query).mockImplementation(async (sql: string) => {
        if (sql.includes('SELECT * FROM products')) return [[row]] as any;
        if (sql.includes('SELECT supplierId')) return [supplierIds.map((supplierId) => ({ supplierId }))] as any;
        return [] as any;
      });
      const conn = {
        query: vi.fn().mockImplementation(async (sql: string) => {
          if (sql.includes('WHERE bestSellerRank = ?')) return [[]] as any;
          return [{ affectedRows: 1 }] as any;
        }),
      };
      vi.mocked(withTransaction).mockImplementation(async (fn: any) => fn(conn));
      return conn;
    };

    const updateSql = (conn: { query: ReturnType<typeof vi.fn> }) =>
      conn.query.mock.calls.find((c) => (c[0] as string).startsWith('UPDATE products'));

    // What "opened the product and pressed save without touching it" posts —
    // makeRow()'s values, plus the defaults rowToProduct derives for the
    // columns that row leaves out (bestSellerRank null, badge on, published).
    const unchangedPayload: Partial<ProductData> = {
      categoryId: 2,
      image: '/img/p1.png',
      title_th: 'ชื่อ',
      title_en: 'Name',
      title_zh: '名字',
      desc_th: 'desc th',
      desc_en: 'desc en',
      desc_zh: 'desc zh',
      isPublished: true,
      bestSellerRank: null,
      showBestSellerBadge: true,
      supplierIds: [],
    };

    it('writes NO revision when every posted field already matches the row', async () => {
      const conn = stubProduct(makeRow());

      await updateProduct('p1', unchangedPayload);

      expect(saveRevision).not.toHaveBeenCalled();
      // Only history is skipped — the UPDATE is built exactly as before,
      // including the pendingDeleteAt = NULL that re-publishing appends.
      const update = updateSql(conn)!;
      expect(update[0]).toBe(
        'UPDATE products SET categoryId = ?, image = ?, title_th = ?, title_en = ?, title_zh = ?, ' +
          'desc_th = ?, desc_en = ?, desc_zh = ?, bestSellerRank = ?, showBestSellerBadge = ?, ' +
          'isPublished = ?, pendingDeleteAt = ? WHERE id = ?'
      );
      expect(update[1]).toEqual([2, '/img/p1.png', 'ชื่อ', 'Name', '名字', 'desc th', 'desc en', 'desc zh', null, true, true, null, 'p1']);
    });

    const realChanges: Array<[string, Partial<ProductData>]> = [
      ['categoryId', { categoryId: 9 }],
      ['image', { image: '/img/other.png' }],
      ['title_th', { title_th: 'ชื่อใหม่' }],
      ['title_en', { title_en: 'Renamed' }],
      ['title_zh', { title_zh: '新名字' }],
      ['desc_th', { desc_th: 'คำอธิบายใหม่' }],
      ['desc_en', { desc_en: 'new english description' }],
      ['desc_zh', { desc_zh: '新的说明' }],
      ['isPublished', { isPublished: false }],
      ['bestSellerRank', { bestSellerRank: 3 }],
      ['showBestSellerBadge', { showBestSellerBadge: false }],
      ['pendingDeleteAt', { pendingDeleteAt: '2026-09-01T00:00:00.000Z' }],
      // Not a column of `products`, but part of every snapshot and re-applied
      // by a restore — a save that changed only this is a real edit and must
      // keep its history.
      ['supplierIds', { supplierIds: ['s-1'] }],
    ];

    it.each(realChanges)(
      'writes exactly ONE revision when %s genuinely changes',
      async (_label, patch) => {
        const conn = stubProduct(makeRow());

        await updateProduct('p1', { ...unchangedPayload, ...patch });

        expect(saveRevision).toHaveBeenCalledTimes(1);
        // Snapshot of the PREVIOUS value, through the transaction's own
        // connection so a retried attempt can't leave a duplicate.
        expect(saveRevision).toHaveBeenCalledWith(
          'product',
          'p1',
          expect.objectContaining({ title_en: 'Name', desc_th: 'desc th' }),
          conn
        );
        expect(updateSql(conn)).toBeDefined();
      }
    );

    it('writes NO revision when the only difference is markup the sanitizer strips', async () => {
      const conn = stubProduct(makeRow());

      await updateProduct('p1', {
        ...unchangedPayload,
        desc_th: 'desc th<script>evil()</script>',
        title_en: 'Name<script>evil()</script>',
      });

      // What the UPDATE writes is identical to what is stored, so a snapshot
      // of it could restore nothing.
      expect(saveRevision).not.toHaveBeenCalled();
      const update = updateSql(conn)!;
      expect(update[1][5]).toBe('desc th');
      expect(update[1][3]).toBe('Name');
    });

    it('treats a stored NULL description and an incoming empty string as the same value', async () => {
      const conn = stubProduct(makeRow({ desc_th: null, desc_en: null, desc_zh: null }));

      await updateProduct('p1', { ...unchangedPayload, desc_th: '', desc_en: '', desc_zh: '' });

      // rowToProduct reads a NULL description back as "", so writing "" over
      // it changes nothing any reader of this row can see.
      expect(saveRevision).not.toHaveBeenCalled();
      expect(updateSql(conn)).toBeDefined();
    });

    it('writes NO revision when the supplier list is only reordered', async () => {
      const conn = stubProduct(makeRow(), ['s-1', 's-2']);

      await updateProduct('p1', { ...unchangedPayload, supplierIds: ['s-2', 's-1'] });

      // product_suppliers has no ordering column and getProduct reads it back
      // unordered, so the order of this array is not a value.
      expect(saveRevision).not.toHaveBeenCalled();
      expect(updateSql(conn)).toBeDefined();
    });

    it('writes NO revision when re-publishing a product that has no delete pending', async () => {
      const conn = stubProduct(makeRow({ pendingDeleteAt: null }));

      await updateProduct('p1', { ...unchangedPayload, isPublished: true });

      // The appended `pendingDeleteAt = NULL` writes NULL over NULL.
      expect(saveRevision).not.toHaveBeenCalled();
      expect(updateSql(conn)![0]).toContain('pendingDeleteAt = ?');
    });

    it('writes ONE revision when re-publishing DOES clear a pending delete', async () => {
      const conn = stubProduct(makeRow({ isPublished: 1, pendingDeleteAt: '2026-08-01T00:00:00.000Z' }));

      await updateProduct('p1', { ...unchangedPayload, isPublished: true });

      expect(saveRevision).toHaveBeenCalledTimes(1);
      expect(saveRevision).toHaveBeenCalledWith(
        'product',
        'p1',
        expect.objectContaining({ pendingDeleteAt: '2026-08-01T00:00:00.000Z' }),
        conn
      );
    });

    it('still runs the bestSellerRank collision check, and rejects before any snapshot', async () => {
      vi.mocked(query).mockImplementation(async (sql: string) => {
        if (sql.includes('SELECT * FROM products')) return [[makeRow({ bestSellerRank: null })]] as any;
        if (sql.includes('SELECT supplierId')) return [[]] as any;
        return [] as any;
      });
      const conn = {
        query: vi.fn().mockImplementation(async (sql: string) => {
          if (sql.includes('WHERE bestSellerRank = ?')) return [[{ id: 'other-product' }]] as any;
          return [{ affectedRows: 1 }] as any;
        }),
      };
      vi.mocked(withTransaction).mockImplementation(async (fn: any) => fn(conn));

      await expect(updateProduct('p1', { ...unchangedPayload, bestSellerRank: 1 })).rejects.toThrow(
        BestSellerRankConflictError
      );
      expect(saveRevision).not.toHaveBeenCalled();
      expect(conn.query.mock.calls.some((c) => (c[0] as string).startsWith('UPDATE products'))).toBe(false);
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

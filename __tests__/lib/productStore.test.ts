// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the DB layer. `query()` resolves to a tuple `[rows|result, fields]`, so
// callers destructure `const [rows] = await query(...)`. `withTransaction` runs
// a callback with a pooled connection.
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
    vi.clearAllMocks();
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
    it('updates sortOrder = array index for each id inside the transaction', async () => {
      const conn = { query: vi.fn().mockResolvedValue(undefined) };
      vi.mocked(withTransaction).mockImplementation(async (fn: any) => fn(conn));

      const result = await reorderCategories([10, 20, 30]);

      expect(result).toBe(true);
      expect(conn.query).toHaveBeenCalledTimes(3);
      // sortOrder is the position in the array, applied in order.
      expect(conn.query.mock.calls[0][1]).toEqual([0, 10]);
      expect(conn.query.mock.calls[1][1]).toEqual([1, 20]);
      expect(conn.query.mock.calls[2][1]).toEqual([2, 30]);
    });

    it('returns true and issues no updates for an empty list', async () => {
      const conn = { query: vi.fn().mockResolvedValue(undefined) };
      vi.mocked(withTransaction).mockImplementation(async (fn: any) => fn(conn));

      expect(await reorderCategories([])).toBe(true);
      expect(conn.query).not.toHaveBeenCalled();
    });

    it('returns false when the transaction fails (rolled back)', async () => {
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.mocked(withTransaction).mockRejectedValue(new Error('rollback'));

      expect(await reorderCategories([1, 2])).toBe(false);
      errSpy.mockRestore();
    });
  });

  // ── Products ────────────────────────────────────────────────────────────────

  describe('getProduct', () => {
    it('maps a found row (isPublished 1 -> true) and queries by id', async () => {
      vi.mocked(query).mockResolvedValue([[makeRow()]] as any);

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
      });
      expect(vi.mocked(query).mock.calls[0][0]).toContain('WHERE id = ?');
      expect(vi.mocked(query).mock.calls[0][1]).toEqual(['p1']);
    });

    it('coerces isPublished 0 to false', async () => {
      vi.mocked(query).mockResolvedValue([[makeRow({ isPublished: 0 })]] as any);
      expect((await getProduct('p1'))!.isPublished).toBe(false);
    });

    it('defaults isPublished to true when the column is absent', async () => {
      const row = makeRow();
      delete (row as Record<string, unknown>).isPublished;
      vi.mocked(query).mockResolvedValue([[row]] as any);
      expect((await getProduct('p1'))!.isPublished).toBe(true);
    });

    it('falls back to empty strings for null descriptions', async () => {
      vi.mocked(query).mockResolvedValue([
        [makeRow({ desc_th: null, desc_en: null, desc_zh: null })],
      ] as any);

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
        'ORDER BY categoryId ASC, createdAt ASC'
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
      vi.mocked(query).mockResolvedValue([{ affectedRows: 1 }] as any);

      const result = await addProduct(baseProduct);

      expect(vi.mocked(query).mock.calls[0][0]).toContain('INSERT INTO products');
      expect(vi.mocked(query).mock.calls[0][1]).toEqual([
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
      ]);
      expect(result).toEqual({ ...baseProduct, isPublished: true });
    });

    it('coerces isPublished to false when explicitly false', async () => {
      vi.mocked(query).mockResolvedValue([{ affectedRows: 1 }] as any);

      const result = await addProduct({ ...baseProduct, isPublished: false });

      // 11th param is isPublished.
      expect(vi.mocked(query).mock.calls[0][1]![10]).toBe(false);
      expect(result.isPublished).toBe(false);
    });

    it('defaults isPublished to true when undefined', async () => {
      vi.mocked(query).mockResolvedValue([{ affectedRows: 1 }] as any);

      const { isPublished, ...noFlag } = baseProduct;
      const result = await addProduct(noFlag as ProductData);

      expect(vi.mocked(query).mock.calls[0][1]![10]).toBe(true);
      expect(result.isPublished).toBe(true);
    });

    it('sanitizes rich-text descriptions on write, stripping scripts', async () => {
      vi.mocked(query).mockResolvedValue([{ affectedRows: 1 }] as any);

      const result = await addProduct({
        ...baseProduct,
        desc_th: '<p>safe</p><script>alert(1)</script>',
      });

      const storedDescTh = vi.mocked(query).mock.calls[0][1]![6] as string;
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
      vi.mocked(query).mockResolvedValue([[]] as any); // getProduct(existing) -> none

      const result = await updateProduct('missing', { title_en: 'x' });

      expect(result).toBeUndefined();
      // Only the existence SELECT ran; no UPDATE.
      expect(vi.mocked(query)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(query).mock.calls[0][0]).toContain('SELECT * FROM products');
    });

    it('updates only supplied columns and returns the re-read product', async () => {
      vi.mocked(query)
        .mockResolvedValueOnce([[makeRow()]] as any) // existence check
        .mockResolvedValueOnce([{ affectedRows: 1 }] as any) // UPDATE
        .mockResolvedValueOnce([[makeRow({ title_en: 'Updated', isPublished: 0 })]] as any); // re-read

      const result = await updateProduct('p1', { title_en: 'Updated', isPublished: false });

      const updateCall = vi.mocked(query).mock.calls[1];
      expect(updateCall[0]).toBe(
        'UPDATE products SET title_en = ?, isPublished = ? WHERE id = ?'
      );
      // supplied values in order, then the id last.
      expect(updateCall[1]).toEqual(['Updated', false, 'p1']);
      expect(result!.title_en).toBe('Updated');
      expect(result!.isPublished).toBe(false);
    });

    it('sanitizes description columns in the UPDATE', async () => {
      vi.mocked(query)
        .mockResolvedValueOnce([[makeRow()]] as any)
        .mockResolvedValueOnce([{ affectedRows: 1 }] as any)
        .mockResolvedValueOnce([[makeRow()]] as any);

      await updateProduct('p1', { desc_en: '<p>ok</p><script>evil()</script>' });

      const updateCall = vi.mocked(query).mock.calls[1];
      expect(updateCall[0]).toBe('UPDATE products SET desc_en = ? WHERE id = ?');
      expect(updateCall[1]![0]).not.toContain('<script>');
      expect(updateCall[1]![0]).toContain('ok');
    });

    it('skips the UPDATE entirely when no fields are supplied', async () => {
      vi.mocked(query)
        .mockResolvedValueOnce([[makeRow()]] as any) // existence check
        .mockResolvedValueOnce([[makeRow()]] as any); // re-read

      const result = await updateProduct('p1', {});

      // Two SELECTs, no UPDATE.
      expect(vi.mocked(query)).toHaveBeenCalledTimes(2);
      expect(vi.mocked(query).mock.calls.every((c) => !/UPDATE/.test(c[0] as string))).toBe(
        true
      );
      expect(result!.id).toBe('p1');
    });
  });
});

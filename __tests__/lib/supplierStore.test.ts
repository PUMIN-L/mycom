// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/app/lib/db', () => ({ query: vi.fn() }));
import { query } from '@/app/lib/db';

import {
  getAllSuppliers,
  getSupplier,
  createSupplier,
  updateSupplier,
  deleteSupplier,
} from '@/app/lib/supplierStore';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('supplierStore', () => {
  describe('createSupplier', () => {
    it('sanitizes and truncates fields to the DB column limits instead of erroring on oversized input', async () => {
      vi.mocked(query)
        .mockResolvedValueOnce([{ affectedRows: 1 }] as any) // INSERT
        .mockResolvedValueOnce([[{ id: 's1' }]] as any) // getSupplier: SELECT * FROM suppliers
        .mockResolvedValueOnce([[]] as any); // getSupplier: linked products

      const longName = 'A'.repeat(300);
      const longPhone = '1'.repeat(300);
      const longNote = 'x'.repeat(6000);

      await createSupplier({
        companyName: longName,
        contactName: '<b>Bob</b>',
        phone: longPhone,
        note: longNote,
      });

      const insertCall = vi.mocked(query).mock.calls[0];
      expect(insertCall[0]).toContain('INSERT INTO suppliers');
      const params = insertCall[1] as unknown[];
      // [id, companyName, contactName, phone, note, createdAt]
      expect((params[1] as string).length).toBe(255);
      expect(params[2]).toBe('Bob'); // HTML stripped
      expect((params[3] as string).length).toBe(255);
      expect((params[4] as string).length).toBe(5000);
    });
  });

  describe('updateSupplier', () => {
    it('truncates an oversized field on update too', async () => {
      vi.mocked(query)
        .mockResolvedValueOnce([{ affectedRows: 1 }] as any) // UPDATE
        .mockResolvedValueOnce([[{ id: 's1' }]] as any) // getSupplier
        .mockResolvedValueOnce([[]] as any);

      await updateSupplier('s1', { companyName: 'B'.repeat(400) });

      const updateCall = vi.mocked(query).mock.calls[0];
      expect(updateCall[0]).toContain('UPDATE suppliers SET');
      const values = updateCall[1] as unknown[];
      expect((values[0] as string).length).toBe(255);
    });
  });

  describe('getAllSuppliers / getSupplier / deleteSupplier', () => {
    it('getAllSuppliers attaches linked products per supplier', async () => {
      vi.mocked(query)
        .mockResolvedValueOnce([[{ id: 's1' }, { id: 's2' }]] as any)
        .mockResolvedValueOnce([[{ supplierId: 's1', id: 'p1', title_th: 'สินค้า', title_en: 'Product' }]] as any);

      const suppliers = await getAllSuppliers();
      expect(suppliers[0].linkedProducts).toEqual([{ id: 'p1', title_th: 'สินค้า', title_en: 'Product' }]);
      expect(suppliers[1].linkedProducts).toEqual([]);
    });

    it('getAllSuppliers skips the link query entirely when there are no suppliers', async () => {
      vi.mocked(query).mockResolvedValueOnce([[]] as any);
      const suppliers = await getAllSuppliers();
      expect(suppliers).toEqual([]);
      expect(query).toHaveBeenCalledTimes(1);
    });

    it('getSupplier returns null when not found', async () => {
      vi.mocked(query).mockResolvedValueOnce([[]] as any);
      expect(await getSupplier('missing')).toBeNull();
    });

    it('deleteSupplier reports success/failure by affected rows', async () => {
      vi.mocked(query).mockResolvedValue([{ affectedRows: 1 }] as any);
      expect(await deleteSupplier('s1')).toBe(true);
      vi.mocked(query).mockResolvedValue([{ affectedRows: 0 }] as any);
      expect(await deleteSupplier('missing')).toBe(false);
    });
  });
});

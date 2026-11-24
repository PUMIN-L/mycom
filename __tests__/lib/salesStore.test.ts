// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const conn = { query: vi.fn() };
vi.mock('@/app/lib/db', () => ({ query: vi.fn(), withTransaction: vi.fn(async (fn: (c: typeof conn) => unknown) => fn(conn)) }));
import { query } from '@/app/lib/db';

import {
  getAllSalespeople,
  getSalesperson,
  createSalesperson,
  updateSalesperson,
  deleteSalesperson,
} from '@/app/lib/salesStore';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('salesStore', () => {
  describe('createSalesperson', () => {
    it('sanitizes and truncates fields to the DB column limits instead of erroring on oversized input', async () => {
      vi.mocked(query)
        .mockResolvedValueOnce([{ affectedRows: 1 }] as any) // INSERT
        .mockResolvedValueOnce([[{ id: 'sp1' }]] as any); // getSalesperson

      await createSalesperson({
        name: 'A'.repeat(300),
        phone: '1'.repeat(300),
        email: '<b>a</b>@' + 'x'.repeat(300) + '.com',
        note: 'y'.repeat(6000),
      });

      const insertCall = vi.mocked(query).mock.calls[0];
      expect(insertCall[0]).toContain('INSERT INTO salespeople');
      const params = insertCall[1] as unknown[];
      // [id, name, phone, email, note, createdAt]
      expect((params[1] as string).length).toBe(255);
      expect((params[2] as string).length).toBe(255);
      expect((params[3] as string).length).toBe(255);
      expect((params[4] as string).length).toBe(5000);
    });
  });

  describe('updateSalesperson', () => {
    it('truncates an oversized field on update too', async () => {
      vi.mocked(query)
        .mockResolvedValueOnce([{ affectedRows: 1 }] as any) // UPDATE
        .mockResolvedValueOnce([[{ id: 'sp1' }]] as any); // getSalesperson

      await updateSalesperson('sp1', { name: 'B'.repeat(400) });

      const updateCall = vi.mocked(query).mock.calls[0];
      expect(updateCall[0]).toContain('UPDATE salespeople SET');
      const values = updateCall[1] as unknown[];
      expect((values[0] as string).length).toBe(255);
    });
  });

  describe('getAllSalespeople / getSalesperson / deleteSalesperson', () => {
    it('getAllSalespeople returns the raw row list', async () => {
      vi.mocked(query).mockResolvedValueOnce([[{ id: 'sp1' }, { id: 'sp2' }]] as any);
      expect(await getAllSalespeople()).toHaveLength(2);
    });

    it('getSalesperson returns null when not found', async () => {
      vi.mocked(query).mockResolvedValueOnce([[]] as any);
      expect(await getSalesperson('missing')).toBeNull();
    });

    it('deleteSalesperson reports success/failure by affected rows', async () => {
      conn.query.mockResolvedValue([{ affectedRows: 1 }]);
      expect(await deleteSalesperson('sp1')).toBe(true);
      conn.query.mockResolvedValue([{ affectedRows: 0 }]);
      expect(await deleteSalesperson('missing')).toBe(false);
    });

    it('deleteSalesperson leaves the companies they looked after with nobody, in the same transaction', async () => {
      conn.query.mockResolvedValue([{ affectedRows: 1 }]);
      await deleteSalesperson('sp1');
      const sql = conn.query.mock.calls.map(([s]) => String(s).replace(/\s+/g, ' '));
      expect(sql[0]).toBe('UPDATE companies SET salespersonId = NULL WHERE salespersonId = ?');
      expect(conn.query.mock.calls[0][1]).toEqual(['sp1']);
      expect(sql[1]).toBe('DELETE FROM salespeople WHERE id = ?');
      expect(query).not.toHaveBeenCalled();
    });
  });
});

// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/app/lib/salesDashboardStore', () => ({
  listSalesRecords: vi.fn(),
  addSalesRecord: vi.fn(),
  getSalesRecord: vi.fn(),
  updateSalesRecord: vi.fn(),
  deleteSalesRecord: vi.fn(),
}));
import {
  listSalesRecords,
  addSalesRecord,
  getSalesRecord,
  updateSalesRecord,
  deleteSalesRecord,
} from '@/app/lib/salesDashboardStore';

vi.mock('@/app/lib/session', () => ({ getSession: vi.fn() }));
import { getSession } from '@/app/lib/session';

const admin = { userId: '1', username: 'admin', expiresAt: new Date() } as any;

import { GET as listSales, POST as createSale } from '@/app/api/admin/sales/route';
import {
  GET as getSale,
  PUT as updateSale,
  DELETE as deleteSale,
} from '@/app/api/admin/sales/[id]/route';

describe('Admin Sales API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSession).mockResolvedValue(null);
  });

  describe('GET /api/admin/sales', () => {
    it('returns 401 if unauthenticated', async () => {
      const res = await listSales(new NextRequest('http://localhost:3000/api/admin/sales'));
      expect(res.status).toBe(401);
    });

    it('returns list of sales records for authenticated user', async () => {
      vi.mocked(getSession).mockResolvedValue(admin);
      const records = [{ id: '1', totalAmount: 5000 }];
      vi.mocked(listSalesRecords).mockResolvedValue(records as any);

      const res = await listSales(new NextRequest('http://localhost:3000/api/admin/sales'));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(records);
    });
  });

  describe('POST /api/admin/sales', () => {
    it('returns 401 if unauthenticated', async () => {
      const res = await createSale(
        new NextRequest('http://localhost:3000/api/admin/sales', {
          method: 'POST',
          body: JSON.stringify({}),
        })
      );
      expect(res.status).toBe(401);
    });

    it('validates required saleDate and product', async () => {
      vi.mocked(getSession).mockResolvedValue(admin);

      // Missing saleDate
      let res = await createSale(
        new NextRequest('http://localhost:3000/api/admin/sales', {
          method: 'POST',
          body: JSON.stringify({ productName: 'Scale' }),
        })
      );
      expect(res.status).toBe(400);

      // Missing product
      res = await createSale(
        new NextRequest('http://localhost:3000/api/admin/sales', {
          method: 'POST',
          body: JSON.stringify({ saleDate: '2026-08-22' }),
        })
      );
      expect(res.status).toBe(400);
    });

    it('creates sale record on valid payload', async () => {
      vi.mocked(getSession).mockResolvedValue(admin);
      const created = { id: 'rec-1', totalAmount: 1000, saleDate: '2026-08-22' };
      vi.mocked(addSalesRecord).mockResolvedValue(created as any);

      const res = await createSale(
        new NextRequest('http://localhost:3000/api/admin/sales', {
          method: 'POST',
          body: JSON.stringify({
            saleDate: '2026-08-22',
            productName: 'Scale A',
            qty: 2,
            unitPrice: 500,
          }),
        })
      );
      expect(res.status).toBe(201);
      expect(await res.json()).toEqual(created);
    });
  });

  describe('GET /api/admin/sales/[id]', () => {
    it('returns 404 when not found', async () => {
      vi.mocked(getSession).mockResolvedValue(admin);
      vi.mocked(getSalesRecord).mockResolvedValue(null);

      const res = await getSale(
        new NextRequest('http://localhost:3000/api/admin/sales/999'),
        { params: Promise.resolve({ id: '999' }) }
      );
      expect(res.status).toBe(404);
    });
  });

  describe('PUT /api/admin/sales/[id]', () => {
    it('validates invalid saleDate format if provided', async () => {
      vi.mocked(getSession).mockResolvedValue(admin);

      const res = await updateSale(
        new NextRequest('http://localhost:3000/api/admin/sales/1', {
          method: 'PUT',
          body: JSON.stringify({ saleDate: 'invalid-date' }),
        }),
        { params: Promise.resolve({ id: '1' }) }
      );
      expect(res.status).toBe(400);
    });

    it('updates sale record successfully', async () => {
      vi.mocked(getSession).mockResolvedValue(admin);
      const updated = { id: '1', qty: 5 };
      vi.mocked(updateSalesRecord).mockResolvedValue(updated as any);

      const res = await updateSale(
        new NextRequest('http://localhost:3000/api/admin/sales/1', {
          method: 'PUT',
          body: JSON.stringify({ qty: 5 }),
        }),
        { params: Promise.resolve({ id: '1' }) }
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(updated);
    });
  });

  describe('DELETE /api/admin/sales/[id]', () => {
    it('deletes record successfully', async () => {
      vi.mocked(getSession).mockResolvedValue(admin);
      vi.mocked(deleteSalesRecord).mockResolvedValue(true);

      const res = await deleteSale(
        new NextRequest('http://localhost:3000/api/admin/sales/1', {
          method: 'DELETE',
        }),
        { params: Promise.resolve({ id: '1' }) }
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ success: true });
    });
  });
});

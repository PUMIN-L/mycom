// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/app/lib/db', () => ({ query: vi.fn() }));
import { query } from '@/app/lib/db';
import {
  addSalesRecord,
  getSalesRecord,
  updateSalesRecord,
  deleteSalesRecord,
  listSalesRecords,
  getDashboardOverview,
  getRevenueByMonth,
  getRevenueByQuarter,
  getRevenueByCategory,
  getTopProducts,
  getTopCustomers,
  getSalespersonLeaderboard,
  getSmartInsights,
} from '@/app/lib/salesDashboardStore';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('salesDashboardStore', () => {
  describe('CRUD Operations', () => {
    it('addSalesRecord inserts sanitized record and computes totalAmount if not provided', async () => {
      vi.mocked(query)
        .mockResolvedValueOnce([{ affectedRows: 1 }] as any) // INSERT
        .mockResolvedValueOnce([
          [
            {
              id: 'rec-1',
              salespersonId: 'sp-1',
              customerId: 'c-1',
              companyId: 'co-1',
              productId: 'p-1',
              productName: 'Scale A',
              categoryId: 1,
              qty: 2,
              unitPrice: 500,
              totalAmount: 1000,
              saleDate: '2026-08-22',
              quotationRef: 'QT-001',
              equipmentId: null,
              note: 'test note',
              createdAt: '2026-08-22T00:00:00.000Z',
            },
          ],
        ] as any); // getSalesRecord

      const res = await addSalesRecord({
        salespersonId: 'sp-1',
        customerId: 'c-1',
        companyId: 'co-1',
        productId: 'p-1',
        productName: '<b>Scale A</b>',
        categoryId: 1,
        qty: 2,
        unitPrice: 500,
        saleDate: '2026-08-22',
        quotationRef: 'QT-001',
        note: 'test note',
      });

      expect(res.id).toBe('rec-1');
      const insertCall = vi.mocked(query).mock.calls[0];
      expect(insertCall[0]).toContain('INSERT INTO sales_records');
      // productName should be sanitized
      expect(insertCall[1]![5]).toBe('Scale A');
      // totalAmount should be 2 * 500 = 1000
      expect(insertCall[1]![9]).toBe(1000);
    });

    it('getSalesRecord returns null when not found', async () => {
      vi.mocked(query).mockResolvedValueOnce([[]] as any);
      const res = await getSalesRecord('non-existent');
      expect(res).toBeNull();
    });

    it('updateSalesRecord updates and returns updated record', async () => {
      vi.mocked(query)
        .mockResolvedValueOnce([
          [
            {
              id: 'rec-1',
              salespersonId: 'sp-1',
              customerId: 'c-1',
              companyId: 'co-1',
              productId: 'p-1',
              productName: 'Scale A',
              categoryId: 1,
              qty: 1,
              unitPrice: 500,
              totalAmount: 500,
              saleDate: '2026-08-22',
              quotationRef: '',
              equipmentId: null,
              note: '',
              createdAt: '2026-08-22T00:00:00.000Z',
            },
          ],
        ] as any) // existing record check
        .mockResolvedValueOnce([{ affectedRows: 1 }] as any) // UPDATE
        .mockResolvedValueOnce([
          [
            {
              id: 'rec-1',
              salespersonId: 'sp-1',
              customerId: 'c-1',
              companyId: 'co-1',
              productId: 'p-1',
              productName: 'Scale A Updated',
              categoryId: 1,
              qty: 3,
              unitPrice: 500,
              totalAmount: 1500,
              saleDate: '2026-08-22',
              quotationRef: '',
              equipmentId: null,
              note: '',
              createdAt: '2026-08-22T00:00:00.000Z',
            },
          ],
        ] as any); // reload

      const updated = await updateSalesRecord('rec-1', {
        productName: 'Scale A Updated',
        qty: 3,
      });

      expect(updated?.productName).toBe('Scale A Updated');
      expect(updated?.totalAmount).toBe(1500);
    });

    it('updateSalesRecord returns null if record does not exist', async () => {
      vi.mocked(query).mockResolvedValueOnce([[]] as any);
      const res = await updateSalesRecord('non-existent', { qty: 2 });
      expect(res).toBeNull();
    });

    it('deleteSalesRecord deletes row and returns true on success', async () => {
      vi.mocked(query).mockResolvedValueOnce([{ affectedRows: 1 }] as any);
      const res = await deleteSalesRecord('rec-1');
      expect(res).toBe(true);
    });

    it('listSalesRecords applies filters properly', async () => {
      vi.mocked(query).mockResolvedValueOnce([
        [{ id: 'rec-1', totalAmount: 1000 }],
      ] as any);

      const rows = await listSalesRecords({
        salespersonId: 'sp-1',
        customerId: 'c-1',
        categoryId: 2,
        dateFrom: '2026-01-01',
        dateTo: '2026-12-31',
      });

      expect(rows.length).toBe(1);
      const sqlCall = vi.mocked(query).mock.calls[0];
      expect(sqlCall[0]).toContain('WHERE sr.salespersonId = ? AND sr.customerId = ? AND sr.categoryId = ? AND sr.saleDate >= ? AND sr.saleDate <= ?');
      expect(sqlCall[1]).toEqual(['sp-1', 'c-1', 2, '2026-01-01', '2026-12-31']);
    });
  });

  describe('Aggregations & Insights', () => {
    it('getRevenueByMonth returns 12 months with filled zero for missing months', async () => {
      vi.mocked(query)
        .mockResolvedValueOnce([
          [{ period: '2026-01', revenue: 50000, cost: 0, deals: 5 }],
        ] as any)
        .mockResolvedValueOnce([
          [{ period: '2026-01', expenses: 0 }],
        ] as any);

      const months = await getRevenueByMonth(2026);
      expect(months.length).toBe(12);
      expect(months[0]).toEqual({ period: '2026-01', revenue: 50000, deals: 5, cost: 0, profit: 50000, margin: 100 });
      expect(months[1]).toEqual({ period: '2026-02', revenue: 0, deals: 0, cost: 0, profit: 0, margin: 0 });
    });

    it('getRevenueByQuarter returns 4 quarters', async () => {
      vi.mocked(query)
        .mockResolvedValueOnce([
          [{ period: '2026-Q1', revenue: 150000, cost: 0, deals: 12 }],
        ] as any)
        .mockResolvedValueOnce([
          [{ period: '2026-Q1', expenses: 0 }],
        ] as any);

      const quarters = await getRevenueByQuarter(2026);
      expect(quarters.length).toBe(4);
      expect(quarters[0]).toEqual({ period: '2026-Q1', revenue: 150000, deals: 12, cost: 0, profit: 150000, margin: 100 });
      expect(quarters[1]).toEqual({ period: '2026-Q2', revenue: 0, deals: 0, cost: 0, profit: 0, margin: 0 });
    });

    it('getSalespersonLeaderboard calculates percentage and avgDealSize', async () => {
      vi.mocked(query).mockResolvedValueOnce([
        [
          { id: 'sp-1', name: 'Alice', revenue: 80000, deals: 4 },
          { id: 'sp-2', name: 'Bob', revenue: 20000, deals: 2 },
        ],
      ] as any);

      const leaderboard = await getSalespersonLeaderboard();
      expect(leaderboard.length).toBe(2);
      expect(leaderboard[0].percentage).toBe(80);
      expect(leaderboard[0].avgDealSize).toBe(20000);
      expect(leaderboard[1].percentage).toBe(20);
      expect(leaderboard[1].avgDealSize).toBe(10000);
    });

    it('getSmartInsights generates rule-based suggestions', async () => {
      vi.mocked(query)
        .mockResolvedValueOnce([[{ rev: 100000 }]] as any) // current month rev
        .mockResolvedValueOnce([[{ rev: 80000 }]] as any)  // prev month rev
        .mockResolvedValueOnce([[{ cnt: 3 }]] as any)       // dormant customers
        .mockResolvedValueOnce([[{ name: 'เครื่องชั่ง', rev: 60000 }]] as any) // top cat
        .mockResolvedValueOnce([[{ total: 10, repeaters: 4 }]] as any) // repeat rate
        .mockResolvedValueOnce([[{ cnt: 2 }]] as any);     // expiring warranties

      const insights = await getSmartInsights();
      expect(insights.some((i) => i.title.includes('เพิ่มขึ้น 25%'))).toBe(true);
      expect(insights.some((i) => i.title.includes('3 ลูกค้าไม่ได้ซื้อ'))).toBe(true);
      expect(insights.some((i) => i.title.includes('เครื่องชั่ง'))).toBe(true);
      expect(insights.some((i) => i.title.includes('Repeat Customer Rate: 40%'))).toBe(true);
      expect(insights.some((i) => i.title.includes('2 เครื่องประกันจะหมด'))).toBe(true);
    });
  });
});

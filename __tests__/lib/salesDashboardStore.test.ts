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
  getRevenueByDay,
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
        .mockResolvedValueOnce([[]] as any) // equipments check
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
        ] as any) // reload
        .mockResolvedValueOnce([[]] as any);

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

      const months = await getRevenueByMonth('2026-01-01', '2027-01-01');
      expect(months.length).toBe(12);
      expect(months[0]).toEqual({ period: '2026-01', revenue: 50000, deals: 5, cost: 0, expense: 0, profit: 50000, margin: 100 });
      expect(months[1]).toEqual({ period: '2026-02', revenue: 0, deals: 0, cost: 0, expense: 0, profit: 0, margin: 0 });
    });

    it('getRevenueByMonth computes profit/margin correctly with non-zero cost AND expense', async () => {
      vi.mocked(query)
        .mockResolvedValueOnce([
          [{ period: '2026-01', revenue: 50000, cost: 10000, deals: 5 }],
        ] as any)
        .mockResolvedValueOnce([
          [{ period: '2026-01', expenses: 5000 }],
        ] as any);

      const months = await getRevenueByMonth('2026-01-01', '2026-02-01');
      // profit = revenue - cost - expense = 50000 - 10000 - 5000 = 35000
      // margin = round(35000 / 50000 * 10000) / 100 = 70
      expect(months[0]).toEqual({ period: '2026-01', revenue: 50000, deals: 5, cost: 10000, expense: 5000, profit: 35000, margin: 70 });
    });

    it('getRevenueByMonth queries with a %Y-%m period format', async () => {
      vi.mocked(query).mockResolvedValue([[]] as any);
      await getRevenueByMonth('2026-01-01', '2026-02-01');
      const salesSql = vi.mocked(query).mock.calls[0][0] as string;
      expect(salesSql).toContain("DATE_FORMAT(saleDate, '%Y-%m')");
      expect(salesSql).not.toContain('%Y-%m-%d');
    });

    it('getRevenueByDay returns one row per calendar day with correct profit/margin', async () => {
      vi.mocked(query)
        .mockResolvedValueOnce([
          [{ period: '2026-08-01', revenue: 1000, cost: 200, deals: 1 }],
        ] as any)
        .mockResolvedValueOnce([
          [{ period: '2026-08-01', expenses: 100 }],
        ] as any);

      const days = await getRevenueByDay('2026-08-01', '2026-08-03');
      expect(days.length).toBe(2);
      expect(days[0]).toEqual({ period: '2026-08-01', revenue: 1000, deals: 1, cost: 200, expense: 100, profit: 700, margin: 70 });
      expect(days[1]).toEqual({ period: '2026-08-02', revenue: 0, deals: 0, cost: 0, expense: 0, profit: 0, margin: 0 });
    });

    it('getRevenueByDay queries with a %Y-%m-%d period format', async () => {
      vi.mocked(query).mockResolvedValue([[]] as any);
      await getRevenueByDay('2026-08-01', '2026-08-02');
      const salesSql = vi.mocked(query).mock.calls[0][0] as string;
      expect(salesSql).toContain("DATE_FORMAT(saleDate, '%Y-%m-%d')");
    });

    it('getRevenueByQuarter returns 4 quarters with no duplicate period labels', async () => {
      vi.mocked(query)
        .mockResolvedValueOnce([
          [{ period: '2026-Q1', revenue: 150000, cost: 0, deals: 12 }],
        ] as any)
        .mockResolvedValueOnce([
          [{ period: '2026-Q1', expenses: 0 }],
        ] as any);

      const quarters = await getRevenueByQuarter('2026-01-01', '2027-01-01');
      expect(quarters.length).toBe(4);
      expect(quarters[0]).toEqual({ period: '2026-Q1', revenue: 150000, deals: 12, cost: 0, expense: 0, profit: 150000, margin: 100 });
      expect(quarters[1]).toEqual({ period: '2026-Q2', revenue: 0, deals: 0, cost: 0, expense: 0, profit: 0, margin: 0 });
      expect(new Set(quarters.map((q) => q.period)).size).toBe(quarters.length);
    });

    it('getRevenueByQuarter queries with a YEAR/QUARTER period format', async () => {
      vi.mocked(query).mockResolvedValue([[]] as any);
      await getRevenueByQuarter('2026-01-01', '2026-04-01');
      const salesSql = vi.mocked(query).mock.calls[0][0] as string;
      expect(salesSql).toContain("CONCAT(YEAR(saleDate), '-Q', QUARTER(saleDate))");
    });

    it('getRevenueByCategory computes percentages and applies date filters', async () => {
      vi.mocked(query).mockResolvedValueOnce([
        [
          { id: 1, name: 'เครื่องชั่ง', revenue: 80000, qty: 10, deals: 4 },
          { id: 2, name: 'อะไหล่', revenue: 20000, qty: 5, deals: 2 },
        ],
      ] as any);

      const categories = await getRevenueByCategory('2026-01-01', '2026-12-31');
      expect(categories[0]).toMatchObject({ id: '1', revenue: 80000, percentage: 80 });
      expect(categories[1]).toMatchObject({ id: '2', revenue: 20000, percentage: 20 });

      const [sql, params] = vi.mocked(query).mock.calls[0];
      expect(sql).toContain('sr.saleDate >= ?');
      expect(sql).toContain('sr.saleDate <= ?');
      expect(params).toEqual(['2026-01-01', '2026-12-31']);
    });

    it('getRevenueByCategory returns 0% for every row when total revenue is 0', async () => {
      vi.mocked(query).mockResolvedValueOnce([
        [{ id: 1, name: 'ไม่ระบุหมวด', revenue: 0, qty: 0, deals: 0 }],
      ] as any);
      const categories = await getRevenueByCategory();
      expect(categories[0].percentage).toBe(0);
    });

    it('getTopProducts clamps the limit and queries without a table alias on saleDate', async () => {
      vi.mocked(query).mockResolvedValueOnce([
        [{ id: 'p-1', name: 'Scale A', revenue: 100000, qty: 20, deals: 8 }],
      ] as any);

      const products = await getTopProducts(0); // 0 -> clamped to 1... but limit only affects SQL LIMIT param
      expect(products[0]).toMatchObject({ id: 'p-1', name: 'Scale A', percentage: 100 });

      const [sql, params] = vi.mocked(query).mock.calls[0] as [string, unknown[]];
      expect(sql).not.toContain('sr.saleDate');
      expect(sql).toContain('FROM sales_records');
      expect(params[params.length - 1]).toBe(10); // limit=0 is falsy -> Number(0)||10 default
    });

    it('getTopProducts clamps an over-large limit to 100', async () => {
      vi.mocked(query).mockResolvedValueOnce([[]] as any);
      await getTopProducts(99999);
      const params = vi.mocked(query).mock.calls[0][1] as unknown[];
      expect(params[params.length - 1]).toBe(100);
    });

    it('getTopProducts falls back to placeholder id/name when missing', async () => {
      vi.mocked(query).mockResolvedValueOnce([
        [{ id: null, name: null, revenue: 500, qty: 1, deals: 1 }],
      ] as any);
      const products = await getTopProducts();
      expect(products[0].id).toBe('unspecified');
      expect(products[0].name).toBe('ไม่ระบุสินค้า');
    });

    it('getTopCustomers computes percentages using the sr.-aliased date column', async () => {
      vi.mocked(query).mockResolvedValueOnce([
        [
          { id: 'co-1', name: 'บริษัท เอ', revenue: 60000, qty: 6, deals: 3 },
          { id: 'co-2', name: 'บริษัท บี', revenue: 40000, qty: 4, deals: 2 },
        ],
      ] as any);

      const customers = await getTopCustomers(5, '2026-01-01', '2026-12-31');
      expect(customers[0]).toMatchObject({ id: 'co-1', percentage: 60 });
      expect(customers[1]).toMatchObject({ id: 'co-2', percentage: 40 });

      const [sql] = vi.mocked(query).mock.calls[0];
      expect(sql).toContain('sr.saleDate >= ?');
    });

    it('getTopCustomers falls back to a placeholder name when missing', async () => {
      vi.mocked(query).mockResolvedValueOnce([
        [{ id: null, name: null, revenue: 100, qty: 1, deals: 1 }],
      ] as any);
      const customers = await getTopCustomers();
      expect(customers[0].name).toBe('ไม่ระบุ');
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

      const insights = await getSmartInsights('2026-08-01', '2026-09-01', '2026-07-01', '2026-08-01', 'เดือนนี้');
      expect(insights.some((i) => i.title.includes('เพิ่มขึ้น 25%'))).toBe(true);
      expect(insights.some((i) => i.title.includes('3 ลูกค้าไม่ได้ซื้อ'))).toBe(true);
      expect(insights.some((i) => i.title.includes('เครื่องชั่ง'))).toBe(true);
      expect(insights.some((i) => i.title.includes('Repeat Customer Rate: 40%'))).toBe(true);
      expect(insights.some((i) => i.title.includes('2 เครื่องประกันจะหมด'))).toBe(true);
    });
  });
});

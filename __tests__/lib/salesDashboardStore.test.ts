// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const conn = { query: vi.fn() };
vi.mock('@/app/lib/db', () => ({
  query: vi.fn(),
  withTransaction: vi.fn(async (fn: (c: typeof conn) => Promise<unknown>) => fn(conn)),
}));
import { query, withTransaction } from '@/app/lib/db';
import {
  addSalesRecord,
  getSalesRecord,
  updateSalesRecord,
  deleteSalesRecord,
  listSalesRecords,
  getDashboardOverview,
  getPeriodDateRange,
  getRevenueByMonth,
  getRevenueByDay,
  getRevenueByQuarter,
  getRevenueByCategory,
  getTopProducts,
  getTopCustomers,
  getSalespersonLeaderboard,
  getSmartInsights,
  recalcCostAmount,
  getCostItems,
  addCostItem,
  updateCostItem,
  deleteCostItem,
} from '@/app/lib/salesDashboardStore';

beforeEach(() => {
  vi.clearAllMocks();
  conn.query.mockReset();
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

  describe('getPeriodDateRange', () => {
    it('defaults to the Bangkok calendar month, not the server-local one, near a UTC day/month boundary', () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      try {
        // 2026-01-31T20:00:00Z is already 2026-02-01 03:00 in Bangkok.
        vi.setSystemTime(new Date('2026-01-31T20:00:00Z'));
        const range = getPeriodDateRange('month');
        expect(range.curStart).toBe('2026-02-01');
      } finally {
        vi.useRealTimers();
      }
    });

    it('defaults to the Bangkok calendar year near a UTC year boundary', () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      try {
        // 2025-12-31T20:00:00Z is already 2026-01-01 03:00 in Bangkok.
        vi.setSystemTime(new Date('2025-12-31T20:00:00Z'));
        const range = getPeriodDateRange('year');
        expect(range.curStart).toBe('2026-01-01');
      } finally {
        vi.useRealTimers();
      }
    });

    it('respects an explicit periodValue regardless of the current date', () => {
      const range = getPeriodDateRange('month', '2026-03');
      expect(range).toMatchObject({ curStart: '2026-03-01', curEnd: '2026-04-01', prevStart: '2026-02-01' });
    });
  });

  describe('getDashboardOverview', () => {
    // 9 sequential queries: curRows, curExpRows, prevRows, prevExpRows,
    // curCust, prevCust, curQuot, prevQuot, expWarranty.
    const mockAllQueries = (overrides: Partial<Record<string, any>> = {}) => {
      vi.mocked(query)
        .mockResolvedValueOnce([[{ revenue: overrides.curRevenue ?? 0, deals: overrides.curDeals ?? 0, cost: overrides.curCost ?? 0 }]] as any)
        .mockResolvedValueOnce([[{ expenses: overrides.curExp ?? 0 }]] as any)
        .mockResolvedValueOnce([[{ revenue: overrides.prevRevenue ?? 0, deals: overrides.prevDeals ?? 0, cost: overrides.prevCost ?? 0 }]] as any)
        .mockResolvedValueOnce([[{ expenses: overrides.prevExp ?? 0 }]] as any)
        .mockResolvedValueOnce([[{ cnt: overrides.curCust ?? 0 }]] as any)
        .mockResolvedValueOnce([[{ cnt: overrides.prevCust ?? 0 }]] as any)
        .mockResolvedValueOnce([[{ cnt: overrides.curQuot ?? 0 }]] as any)
        .mockResolvedValueOnce([[{ cnt: overrides.prevQuot ?? 0 }]] as any)
        .mockResolvedValueOnce([[{ cnt: overrides.expiring ?? 0 }]] as any);
    };

    it('computes revenue/cost/profit and new-customer counts for both periods', async () => {
      mockAllQueries({ curRevenue: 100000, curCost: 20000, curExp: 5000, curDeals: 10, curCust: 3, curQuot: 8, expiring: 2 });

      const result = await getDashboardOverview('2026-08-01', '2026-09-01', '2026-07-01', '2026-08-01');

      expect(result.currentPeriod).toEqual({
        revenue: 100000, deals: 10, newCustomers: 3, quotations: 8, cost: 25000, profit: 75000,
      });
      expect(result.expiringWarranties).toBe(2);
    });

    it('counts ONLY quotation docNos (QT prefix), not invoices/billing notes/receipts sharing the same ledger', async () => {
      mockAllQueries();

      await getDashboardOverview('2026-08-01', '2026-09-01', '2026-07-01', '2026-08-01');

      const quotCalls = vi.mocked(query).mock.calls.filter(([sql]) => String(sql).includes('used_docnos'));
      expect(quotCalls).toHaveLength(2); // current + previous period
      for (const [sql] of quotCalls) {
        expect(sql).toContain("docNo LIKE 'QT%'");
      }
    });

    it('uses the Bangkok calendar date for the warranty-expiry window, not the server-local one', async () => {
      // 2026-01-01T20:00:00Z is already 2026-01-02 03:00 in Bangkok (UTC+7).
      vi.useFakeTimers({ toFake: ['Date'] });
      try {
        vi.setSystemTime(new Date('2026-01-01T20:00:00Z'));
        mockAllQueries();

        await getDashboardOverview('2026-08-01', '2026-09-01', '2026-07-01', '2026-08-01');

        const warrantyCall = vi.mocked(query).mock.calls.find(([sql]) => String(sql).includes('customer_equipments'));
        expect(warrantyCall?.[1]).toEqual(['2026-01-02', '2026-02-01']);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('Cost Items', () => {
    // recalcCostAmount locks the sale row (SELECT ... FOR UPDATE) before
    // summing+writing costAmount, so two concurrent cost-item edits on the
    // SAME sale can't interleave their read-modify-write and leave
    // costAmount out of sync with the true sum of sale_cost_items.
    it('recalcCostAmount locks the sale row, sums the items, and writes costAmount atomically', async () => {
      conn.query
        .mockResolvedValueOnce([[{ id: 'sale-1' }]]) // SELECT ... FOR UPDATE
        .mockResolvedValueOnce([[{ total: '300.00' }]]) // SELECT SUM
        .mockResolvedValueOnce([{ affectedRows: 1 }]); // UPDATE costAmount

      const total = await recalcCostAmount('sale-1');

      expect(total).toBe(300);
      expect(withTransaction).toHaveBeenCalledTimes(1);
      expect(conn.query.mock.calls[0][0]).toContain('FOR UPDATE');
      expect(conn.query.mock.calls[1][0]).toContain('SUM(amount)');
      expect(conn.query.mock.calls[2][0]).toContain('UPDATE sales_records');
      expect(conn.query.mock.calls[2][1]).toEqual([300, 'sale-1']);
    });

    it('recalcCostAmount treats no cost items as a total of 0', async () => {
      conn.query
        .mockResolvedValueOnce([[{ id: 'sale-1' }]])
        .mockResolvedValueOnce([[{ total: '0.00' }]])
        .mockResolvedValueOnce([{ affectedRows: 1 }]);

      expect(await recalcCostAmount('sale-1')).toBe(0);
    });

    it('addCostItem inserts a sanitized item and recalculates costAmount', async () => {
      vi.mocked(query)
        .mockResolvedValueOnce([{ affectedRows: 1 }] as any) // INSERT sale_cost_items
        .mockResolvedValueOnce([[{ id: 'ci-1', salesRecordId: 'sale-1', costType: 'transport', label: 'ค่ารถ', amount: 100, note: '' }]] as any); // final SELECT
      conn.query
        .mockResolvedValueOnce([[{ id: 'sale-1' }]])
        .mockResolvedValueOnce([[{ total: '100.00' }]])
        .mockResolvedValueOnce([{ affectedRows: 1 }]);

      const item = await addCostItem('sale-1', { costType: 'transport', label: '<b>ค่ารถ</b>', amount: 100 });

      expect(item.id).toBe('ci-1');
      const insertCall = vi.mocked(query).mock.calls[0];
      expect(insertCall[0]).toContain('INSERT INTO sale_cost_items');
      expect(insertCall[1]![2]).toBe('transport');
      expect(insertCall[1]![3]).toBe('ค่ารถ'); // HTML stripped
      expect(withTransaction).toHaveBeenCalledTimes(1); // recalc ran exactly once
    });

    it('addCostItem falls back to "other" for an invalid costType', async () => {
      vi.mocked(query)
        .mockResolvedValueOnce([{ affectedRows: 1 }] as any)
        .mockResolvedValueOnce([[{ id: 'ci-1' }]] as any);
      conn.query
        .mockResolvedValueOnce([[{ id: 'sale-1' }]])
        .mockResolvedValueOnce([[{ total: '0.00' }]])
        .mockResolvedValueOnce([{ affectedRows: 1 }]);

      await addCostItem('sale-1', { costType: 'not-a-real-type' as any, amount: 1 });
      expect(vi.mocked(query).mock.calls[0][1]![2]).toBe('other');
    });

    it('updateCostItem merges onto the existing item and recalculates costAmount', async () => {
      vi.mocked(query)
        .mockResolvedValueOnce([[{ id: 'ci-1', salesRecordId: 'sale-1', costType: 'other', label: 'x', amount: 50, note: '' }]] as any) // existing
        .mockResolvedValueOnce([{ affectedRows: 1 }] as any) // UPDATE
        .mockResolvedValueOnce([[{ id: 'ci-1', amount: 75 }]] as any); // final SELECT
      conn.query
        .mockResolvedValueOnce([[{ id: 'sale-1' }]])
        .mockResolvedValueOnce([[{ total: '75.00' }]])
        .mockResolvedValueOnce([{ affectedRows: 1 }]);

      const item = await updateCostItem('ci-1', { amount: 75 });
      expect(item?.amount).toBe(75);
      expect(withTransaction).toHaveBeenCalledTimes(1);
    });

    it('updateCostItem returns null for a missing item without recalculating', async () => {
      vi.mocked(query).mockResolvedValueOnce([[]] as any);
      const result = await updateCostItem('missing', { amount: 1 });
      expect(result).toBeNull();
      expect(withTransaction).not.toHaveBeenCalled();
    });

    it('deleteCostItem removes the item and recalculates costAmount for its sale', async () => {
      vi.mocked(query)
        .mockResolvedValueOnce([[{ salesRecordId: 'sale-1' }]] as any) // existing lookup
        .mockResolvedValueOnce([{ affectedRows: 1 }] as any); // DELETE
      conn.query
        .mockResolvedValueOnce([[{ id: 'sale-1' }]])
        .mockResolvedValueOnce([[{ total: '0.00' }]])
        .mockResolvedValueOnce([{ affectedRows: 1 }]);

      const result = await deleteCostItem('ci-1');
      expect(result).toBe(true);
      expect(withTransaction).toHaveBeenCalledTimes(1);
    });

    it('deleteCostItem does not recalculate when nothing was deleted', async () => {
      vi.mocked(query)
        .mockResolvedValueOnce([[]] as any) // existing lookup finds nothing
        .mockResolvedValueOnce([{ affectedRows: 0 }] as any); // DELETE affects nothing

      const result = await deleteCostItem('missing');
      expect(result).toBe(false);
      expect(withTransaction).not.toHaveBeenCalled();
    });

    it('getCostItems returns items ordered by createdAt', async () => {
      vi.mocked(query).mockResolvedValueOnce([[{ id: 'ci-1' }, { id: 'ci-2' }]] as any);
      const items = await getCostItems('sale-1');
      expect(items).toHaveLength(2);
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
      // profit = revenue - cost - rawExpense = 50000 - 10000 - 5000 = 35000
      // margin = round(35000 / 50000 * 10000) / 100 = 70
      // the "expense" field combines cost + rawExpense (10000 + 5000 = 15000)
      // so the dashboard chart's "รายจ่าย" series reads as total company
      // outflow, matching the overview card and the Expenses page total.
      expect(months[0]).toEqual({ period: '2026-01', revenue: 50000, deals: 5, cost: 10000, expense: 15000, profit: 35000, margin: 70 });
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
      // expense field = cost + rawExpense = 200 + 100 = 300 (combined total)
      expect(days[0]).toEqual({ period: '2026-08-01', revenue: 1000, deals: 1, cost: 200, expense: 300, profit: 700, margin: 70 });
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

    it('uses the Bangkok calendar month for the dormant-customer 6-month cutoff, not the server-local one', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      try {
        // 2026-01-31T20:00:00Z is already 2026-02-01 in Bangkok, one calendar
        // month later than the server's own UTC date at that instant.
        vi.setSystemTime(new Date('2026-01-31T20:00:00Z'));
        vi.mocked(query)
          .mockResolvedValueOnce([[{ rev: 0 }]] as any)
          .mockResolvedValueOnce([[{ rev: 0 }]] as any)
          .mockResolvedValueOnce([[{ cnt: 0 }]] as any)
          .mockResolvedValueOnce([[{}]] as any)
          .mockResolvedValueOnce([[{ total: 0, repeaters: 0 }]] as any)
          .mockResolvedValueOnce([[{ cnt: 0 }]] as any);

        await getSmartInsights('2026-08-01', '2026-09-01', '2026-07-01', '2026-08-01', 'เดือนนี้');

        const dormantCall = vi.mocked(query).mock.calls.find(([sql]) => String(sql).includes('sales_records') && String(sql).includes('NOT IN'));
        // 6 months before Bangkok's 2026-02-01 is 2025-08-01, not 2025-07-01
        // (which is what the server's own UTC date at that instant would give).
        expect(dormantCall?.[1]).toEqual(['2025-08-01']);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});

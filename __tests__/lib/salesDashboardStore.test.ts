// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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
  createSaleWithLineItems,
  syncCostItems,
  ProductCostIsPerLineError,
  ProductCostNotAttributableError,
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
        // The UPDATE itself now runs on the transaction connection (it has to
        // carry the edit down to the sale's line item atomically), so it is no
        // longer one of the module-level `query` calls.
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
      conn.query.mockImplementation(async (sql: string) =>
        sql.includes('FROM sales_record_items') ? [[{ id: 'sri-1' }]] : [[]]
      );

      const updated = await updateSalesRecord('rec-1', {
        productName: 'Scale A Updated',
        qty: 3,
      });

      expect(updated?.productName).toBe('Scale A Updated');
      expect(updated?.totalAmount).toBe(1500);
    });

    it('carries a scalar edit down to the sale\'s single line item, in the same transaction', async () => {
      const existing = {
        id: 'rec-1', salespersonId: 'sp-1', customerId: 'c-1', companyId: 'co-1',
        productId: 'p-1', productName: 'Scale A', categoryId: 1, qty: 1,
        unitPrice: 500, totalAmount: 500, costAmount: 0, saleDate: '2026-08-22',
        quotationRef: '', equipmentId: null, note: '', createdAt: '2026-08-22T00:00:00.000Z',
      };
      vi.mocked(query)
        .mockResolvedValueOnce([[existing]] as any) // existing record
        .mockResolvedValueOnce([[]] as any) // equipments
        .mockResolvedValueOnce([[{ ...existing, qty: 3, totalAmount: 1500 }]] as any) // reload
        .mockResolvedValueOnce([[]] as any);
      conn.query.mockImplementation(async (sql: string) =>
        sql.includes('FROM sales_record_items') ? [[{ id: 'sri-1' }]] : [[]]
      );

      await updateSalesRecord('rec-1', {
        productName: 'Scale A Updated',
        qty: 3,
        totalAmount: 1500,
      });

      const sqls = conn.query.mock.calls.map((c) => String(c[0]));
      expect(sqls.some((s) => s.includes('FOR UPDATE'))).toBe(true);
      // Without this the reports (which read line items since v33) would keep
      // showing the OLD product and amount forever while the sale row shows
      // the new one — SUM(items.totalAmount) must stay equal to the sale total.
      const lineUpdate = conn.query.mock.calls.find(
        (c) => String(c[0]).includes('UPDATE sales_record_items')
      );
      expect(lineUpdate).toBeDefined();
      expect(lineUpdate![1]).toEqual(['p-1', 'Scale A Updated', 1, 3, 500, 1500, 'sri-1']);
    });

    it('leaves a MULTI-line bill\'s items untouched — scalars cannot describe it', async () => {
      const existing = {
        id: 'rec-1', salespersonId: '', customerId: '', companyId: '',
        productId: 'p-1', productName: 'Scale A', categoryId: 1, qty: 3,
        unitPrice: 500, totalAmount: 1500, costAmount: 0, saleDate: '2026-08-22',
        quotationRef: '', equipmentId: null, note: '', createdAt: '2026-08-22T00:00:00.000Z',
      };
      vi.mocked(query)
        .mockResolvedValueOnce([[existing]] as any)
        .mockResolvedValueOnce([[]] as any)
        .mockResolvedValueOnce([[existing]] as any)
        .mockResolvedValueOnce([[]] as any);
      conn.query.mockImplementation(async (sql: string) =>
        sql.includes('FROM sales_record_items')
          ? [[{ id: 'sri-1' }, { id: 'sri-2' }]]
          : [[]]
      );

      await updateSalesRecord('rec-1', { qty: 4 });

      const sqls = conn.query.mock.calls.map((c) => String(c[0]));
      expect(sqls.some((s) => s.includes('UPDATE sales_record_items'))).toBe(false);
      expect(sqls.some((s) => s.includes('INSERT INTO sales_record_items'))).toBe(false);
      expect(sqls.some((s) => s.includes('DELETE'))).toBe(false);
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

    it('getCostItems returns the bill-level items ordered by createdAt', async () => {
      vi.mocked(query)
        .mockResolvedValueOnce([[{ id: 'ci-1' }, { id: 'ci-2' }]] as any)
        .mockResolvedValueOnce([[{ productCost: 0, createdAt: null }]] as any);
      const items = await getCostItems('sale-1');
      expect(items).toHaveLength(2);
      // The SELECT hides legacy product_cost rows: their money is on the line
      // item, so showing them would let a form re-submit a stale number.
      expect(String(vi.mocked(query).mock.calls[0][0])).toContain("costType <> 'product_cost'");
    });

    it('getCostItems reports the per-line product cost as ONE ต้นทุนสินค้า entry', async () => {
      vi.mocked(query)
        .mockResolvedValueOnce([[{ id: 'ci-1', costType: 'transport', amount: 3000 }]] as any)
        .mockResolvedValueOnce([[{ productCost: '12000.00', createdAt: '2026-03-10T00:00:00.000Z' }]] as any);

      const items = await getCostItems('sale-1');

      // What the cost calculator shows is exactly what costAmount counts.
      expect(items[0]).toMatchObject({
        salesRecordId: 'sale-1',
        costType: 'product_cost',
        label: 'ต้นทุนสินค้า',
        amount: 12000,
      });
      expect(items.map((i) => i.costType)).toEqual(['product_cost', 'transport']);
    });

    it('addCostItem refuses a bill-level product_cost and writes nothing', async () => {
      await expect(
        addCostItem('sale-1', { costType: 'product_cost', amount: 12000 })
      ).rejects.toThrow(ProductCostIsPerLineError);
      expect(query).not.toHaveBeenCalled();
      expect(withTransaction).not.toHaveBeenCalled();
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

    it('getTopProducts clamps the limit and groups from line items with no date filter', async () => {
      vi.mocked(query).mockResolvedValueOnce([
        [{ id: 'p-1', name: 'Scale A', revenue: 100000, qty: 20, deals: 8 }],
      ] as any);

      const products = await getTopProducts(0); // 0 -> clamped to 1... but limit only affects SQL LIMIT param
      expect(products[0]).toMatchObject({ id: 'p-1', name: 'Scale A', percentage: 100 });

      const [sql, params] = vi.mocked(query).mock.calls[0] as [string, unknown[]];
      expect(sql).not.toContain('sr.saleDate'); // no range passed -> no WHERE clause
      expect(sql).toContain('FROM sales_record_items sri');
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

// ─────────────────────────────────────────────────────────────────────────────
// schema v33: line items — reports, atomicity and the cost definition
// (tasks 9.4, 9.5, 9.6, 9.7, 9.14, 9.15)
//
// The DB is mocked, so these suites stand in a small simulator for the two
// pieces of behaviour the real server owns: the GROUP BY semantics of the two
// report queries, and transaction rollback/retry. The simulator is driven by
// the SQL text the store actually emits (LEFT JOIN vs INNER JOIN, the
// `costType <> 'product_cost'` filter, the date column), so a store change that
// drops one of those makes these tests fail rather than pass vacuously.
// ─────────────────────────────────────────────────────────────────────────────

/** A historical sale as it exists BEFORE v33: product/category on the sale row. */
interface FakeSale {
  id: string;
  saleDate: string;
  productId: string;
  productName: string;
  categoryId: number | null;
  qty: number;
  totalAmount: number;
}

/** A `sales_record_items` row joined to its parent sale's saleDate. */
interface FakeLine {
  salesRecordId: string;
  saleDate: string;
  productId: string;
  productName: string;
  categoryId: number | null;
  qty: number;
  totalAmount: number;
}

const CATEGORY_NAMES: Record<number, string> = {
  1: 'เครื่องชั่ง',
  2: 'เครื่องมือวิทยาศาสตร์',
  3: 'อะไหล่',
};

/**
 * The v33 bootstrap backfill: exactly ONE line item per historical sale,
 * copying that sale's own scalar columns. Mirrors the
 * `INSERT ... SELECT ... WHERE NOT EXISTS` in db.ts.
 */
function backfillLineItems(sales: FakeSale[]): FakeLine[] {
  return sales.map((s) => ({
    salesRecordId: s.id,
    saleDate: s.saleDate,
    productId: s.productId,
    productName: s.productName,
    categoryId: s.categoryId,
    qty: s.qty,
    totalAmount: s.totalAmount,
  }));
}

interface AggRow { id: unknown; name: unknown; revenue: number; qty: number; deals: number }

/** GROUP BY over line items: deals = COUNT(DISTINCT salesRecordId). */
function aggregateLines(
  lines: FakeLine[],
  keyOf: (l: FakeLine) => string,
  idOf: (l: FakeLine) => unknown,
  nameOf: (l: FakeLine) => unknown
): AggRow[] {
  const groups = new Map<string, { id: unknown; name: unknown; revenue: number; qty: number; deals: Set<string> }>();
  for (const l of lines) {
    const key = keyOf(l);
    const g = groups.get(key) ?? { id: idOf(l), name: nameOf(l), revenue: 0, qty: 0, deals: new Set<string>() };
    g.revenue += l.totalAmount;
    g.qty += l.qty;
    g.deals.add(l.salesRecordId);
    groups.set(key, g);
  }
  return [...groups.values()]
    .map((g) => ({ id: g.id, name: g.name, revenue: g.revenue, qty: g.qty, deals: g.deals.size }))
    .sort((a, b) => b.revenue - a.revenue);
}

/** GROUP BY over sales rows — the PRE-v33 query, where deals = COUNT(*). */
function aggregateSales(
  sales: FakeSale[],
  keyOf: (s: FakeSale) => string,
  idOf: (s: FakeSale) => unknown,
  nameOf: (s: FakeSale) => unknown
): AggRow[] {
  const groups = new Map<string, AggRow>();
  for (const s of sales) {
    const key = keyOf(s);
    const g = groups.get(key) ?? { id: idOf(s), name: nameOf(s), revenue: 0, qty: 0, deals: 0 };
    g.revenue += s.totalAmount;
    g.qty += s.qty;
    g.deals += 1;
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => b.revenue - a.revenue);
}

const categoryNameOf = (categoryId: number | null) =>
  (categoryId !== null && CATEGORY_NAMES[categoryId]) || 'ไม่ระบุหมวด';

/** The TopItem mapping the dashboard has always applied — unchanged by v33. */
function toTopItems(rows: AggRow[], fallback: { id: string; name: string }) {
  const total = rows.reduce((s, r) => s + r.revenue, 0);
  return rows.map((r) => ({
    id: String(r.id ?? fallback.id) || fallback.id,
    name: (r.name as string) || fallback.name,
    revenue: r.revenue,
    qty: r.qty,
    deals: r.deals,
    percentage: total > 0 ? Math.round((r.revenue / total) * 10000) / 100 : 0,
  }));
}

const PRODUCT_FALLBACK = { id: 'unspecified', name: 'ไม่ระบุสินค้า' };
const CATEGORY_FALLBACK = { id: 'unknown', name: 'ไม่ระบุหมวด' };

/**
 * Answer `getTopProducts` / `getRevenueByCategory` from an in-memory set of
 * line items, applying the date range from the SQL the store built.
 */
function installReportQueries(lines: FakeLine[]) {
  vi.mocked(query).mockImplementation((async (sql: unknown, params: unknown[] = []) => {
    const text = String(sql);
    if (!text.includes('FROM sales_record_items sri')) {
      throw new Error(`report query must read line items, got: ${text}`);
    }
    let rows = lines;
    let p = 0;
    if (text.includes('sr.saleDate >= ?')) {
      const from = String(params[p++]);
      rows = rows.filter((l) => l.saleDate >= from);
    }
    if (text.includes('sr.saleDate <= ?')) {
      const to = String(params[p++]);
      rows = rows.filter((l) => l.saleDate <= to);
    }
    if (text.includes('sri.productId AS id')) {
      const limit = Number(params[params.length - 1]);
      const agg = aggregateLines(
        rows,
        (l) => `${l.productId}\u0000${l.productName}`,
        (l) => l.productId,
        (l) => l.productName
      );
      return [agg.slice(0, limit)];
    }
    return [
      aggregateLines(
        rows,
        (l) => String(l.categoryId ?? ''),
        (l) => l.categoryId,
        (l) => categoryNameOf(l.categoryId)
      ),
    ];
  }) as never);
}

// ── Fake transactional DB (atomicity + cost suites) ──────────────────────────

interface FakeTables {
  sales_records: Record<string, any>[];
  sales_record_items: Record<string, any>[];
  customer_equipments: Record<string, any>[];
  sale_cost_items: Record<string, any>[];
}

const SALES_RECORD_COLS = [
  'id', 'salespersonId', 'customerId', 'companyId', 'productId', 'productName',
  'categoryId', 'qty', 'unitPrice', 'totalAmount', 'costAmount', 'saleType',
  'saleDate', 'quotationRef', 'poRef', 'deliveryRef', 'invoiceRef', 'receiptRef',
  'warrantyStartDate', 'warrantyEndDate', 'equipmentId', 'note', 'createdAt', 'quotationId',
];
const LINE_ITEM_COLS = [
  'id', 'salesRecordId', 'productId', 'productName', 'categoryId', 'qty',
  'unitPrice', 'totalAmount', 'costAmount', 'quotationItemId', 'sortOrder', 'createdAt',
];
const EQUIPMENT_COLS = [
  'id', 'salesRecordId', 'customerId', 'productId', 'productName', 'serialNumber',
  'quotationNumber', 'warrantyCertNumber', 'warrantyType', 'warrantyStartDate',
  'warrantyEndDate', 'status', 'createdAt',
];
const COST_ITEM_COLS = ['id', 'salesRecordId', 'costType', 'label', 'amount', 'note', 'createdAt'];

function rowFrom(cols: string[], params: unknown[]): Record<string, any> {
  const row: Record<string, any> = {};
  cols.forEach((c, i) => { row[c] = params[i]; });
  return row;
}

function createFakeDb(seed: Partial<FakeTables> = {}) {
  const tables: FakeTables = {
    sales_records: [],
    sales_record_items: [],
    customer_equipments: [],
    sale_cost_items: [],
    ...JSON.parse(JSON.stringify(seed)),
  };
  /** Every id ever written, INCLUDING rolled-back attempts. */
  const allInsertedIds: string[] = [];
  /** Index into allInsertedIds where each transaction attempt began. */
  const attemptMarks: number[] = [];
  let equipmentInserts = 0;
  let failure: { at: number; error: unknown } | null = null;

  const sum = (rows: Record<string, any>[], field: string) =>
    rows.reduce((s, r) => s + Number(r[field] || 0), 0);

  async function run(sql: string, params: unknown[] = []): Promise<unknown> {
    const text = String(sql);
    const p = params as any[];

    if (text.includes('INSERT INTO sales_record_items')) {
      // syncSingleLineItemToScalars binds quotationItemId/sortOrder as SQL
      // literals, so its 10 params cover the 12 columns minus those two.
      const row = text.includes('NULL, 0, ?')
        ? { ...rowFrom(LINE_ITEM_COLS.slice(0, 9), p), quotationItemId: null, sortOrder: 0, createdAt: p[9] }
        : rowFrom(LINE_ITEM_COLS, p);
      tables.sales_record_items.push(row);
      allInsertedIds.push(row.id);
      return [{ affectedRows: 1 }];
    }
    if (text.includes('INSERT INTO sales_records')) {
      const row = rowFrom(SALES_RECORD_COLS, p);
      tables.sales_records.push(row);
      allInsertedIds.push(row.id);
      return [{ affectedRows: 1 }];
    }
    if (text.includes('INSERT INTO customer_equipments')) {
      equipmentInserts += 1;
      if (failure && failure.at === equipmentInserts) {
        const err = failure.error;
        failure = null; // fail once, so a retry can get through
        throw err;
      }
      const row = rowFrom(EQUIPMENT_COLS, p);
      tables.customer_equipments.push(row);
      allInsertedIds.push(row.id);
      return [{ affectedRows: 1 }];
    }
    if (text.includes('INSERT INTO sale_cost_items')) {
      const row = rowFrom(COST_ITEM_COLS, p);
      tables.sale_cost_items.push(row);
      allInsertedIds.push(row.id);
      return [{ affectedRows: 1 }];
    }
    if (text.includes('UPDATE sales_record_items SET costAmount')) {
      const row = tables.sales_record_items.find((r) => r.id === p[1]);
      if (row) row.costAmount = p[0];
      return [{ affectedRows: row ? 1 : 0 }];
    }
    if (text.includes('UPDATE sales_record_items')) {
      const row = tables.sales_record_items.find((r) => r.id === p[6]);
      if (row) {
        Object.assign(row, {
          productId: p[0], productName: p[1], categoryId: p[2],
          qty: p[3], unitPrice: p[4], totalAmount: p[5],
        });
      }
      return [{ affectedRows: row ? 1 : 0 }];
    }
    if (text.includes('FROM sales_record_items') && text.includes('SELECT id')) {
      // Both the `SELECT id` of syncSingleLineItemToScalars and the
      // `SELECT id, costAmount` of resolveProductCostLine.
      return [
        tables.sales_record_items
          .filter((r) => r.salesRecordId === p[0])
          .map((r) => ({ id: r.id, costAmount: r.costAmount })),
      ];
    }
    if (text.includes('AS other')) {
      return [
        [
          {
            other: sum(
              tables.sale_cost_items.filter(
                (r) => r.salesRecordId === p[0] && r.costType !== 'product_cost'
              ),
              'amount'
            ),
          },
        ],
      ];
    }
    if (text.includes('DELETE FROM sales_record_items')) {
      tables.sales_record_items = tables.sales_record_items.filter((r) => r.salesRecordId !== p[0]);
      return [{ affectedRows: 1 }];
    }
    if (text.includes('DELETE FROM sale_cost_items')) {
      const keepsLegacy = text.includes("costType <> 'product_cost'");
      tables.sale_cost_items = tables.sale_cost_items.filter(
        (r) => r.salesRecordId !== p[0] || (keepsLegacy && r.costType === 'product_cost')
      );
      return [{ affectedRows: 1 }];
    }
    if (text.includes('FOR UPDATE')) {
      return [tables.sales_records.filter((r) => r.id === p[0]).map((r) => ({ id: r.id }))];
    }
    if (text.includes('AS lineCount')) {
      const mine = tables.sales_record_items.filter((r) => r.salesRecordId === p[0]);
      return [[{ lineCount: mine.length, totalAmount: sum(mine, 'totalAmount'), qty: sum(mine, 'qty') }]];
    }
    if (text.includes('AS total')) {
      const excludesLegacy = text.includes("costType <> 'product_cost'");
      const lineCost = sum(
        tables.sales_record_items.filter((r) => r.salesRecordId === p[0]),
        'costAmount'
      );
      const billCost = sum(
        tables.sale_cost_items.filter(
          (r) => r.salesRecordId === p[1] && (!excludesLegacy || r.costType !== 'product_cost')
        ),
        'amount'
      );
      return [[{ total: (lineCost + billCost).toFixed(2) }]]; // DECIMAL comes back as a string
    }
    if (text.includes('UPDATE sales_records SET totalAmount')) {
      const row = tables.sales_records.find((r) => r.id === p[3]);
      if (row) Object.assign(row, { totalAmount: p[0], qty: p[1], costAmount: p[2] });
      return [{ affectedRows: row ? 1 : 0 }];
    }
    if (text.includes('UPDATE sales_records SET costAmount')) {
      const row = tables.sales_records.find((r) => r.id === p[1]);
      if (row) row.costAmount = p[0];
      return [{ affectedRows: row ? 1 : 0 }];
    }
    if (text.includes("UPDATE customer_equipments SET salesRecordId = ''")) {
      const row = tables.customer_equipments.find((r) => r.id === p[0]);
      if (row) row.salesRecordId = '';
      return [{ affectedRows: row ? 1 : 0 }];
    }
    if (text.includes('UPDATE customer_equipments SET')) {
      const row = tables.customer_equipments.find((r) => r.id === p[10]);
      if (row) Object.assign(row, { customerId: p[0], productId: p[1], productName: p[2], serialNumber: p[3] });
      return [{ affectedRows: row ? 1 : 0 }];
    }
    if (text.includes('SELECT id, serialNumber FROM customer_equipments')) {
      return [
        tables.customer_equipments
          .filter((r) => r.salesRecordId === p[0])
          .map((r) => ({ id: r.id, serialNumber: r.serialNumber })),
      ];
    }
    if (text.includes('SELECT id, productId FROM customer_equipments')) {
      return [
        tables.customer_equipments
          .filter((r) => r.salesRecordId === p[0])
          .map((r) => ({ id: r.id, productId: r.productId })),
      ];
    }
    throw new Error(`fake DB: unhandled SQL: ${text}`);
  }

  return {
    tables,
    allInsertedIds,
    attemptMarks,
    conn: { query: (sql: string, params?: unknown[]) => run(sql, params) },
    run,
    /** Make the Nth equipment INSERT of the whole run throw, exactly once. */
    failEquipmentInsertAt(at: number, error: unknown) {
      failure = { at, error };
    },
    snapshot: () => JSON.stringify(tables),
    restore(snap: string) {
      Object.assign(tables, JSON.parse(snap));
    },
    liveIds: () => [
      ...tables.sales_records.map((r) => r.id),
      ...tables.sales_record_items.map((r) => r.id),
      ...tables.customer_equipments.map((r) => r.id),
    ],
  };
}

type FakeDb = ReturnType<typeof createFakeDb>;

/**
 * Stand-in for the real `withTransaction`: rolls the whole snapshot back on
 * failure and retries a TRANSIENT error up to 3 attempts, exactly like db.ts.
 */
function installFakeTransaction(db: FakeDb) {
  vi.mocked(withTransaction).mockImplementation((async (fn: (c: unknown) => Promise<unknown>) => {
    const MAX_ATTEMPTS = 3;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const snapshot = db.snapshot();
      db.attemptMarks.push(db.allInsertedIds.length);
      try {
        return await fn(db.conn);
      } catch (error) {
        db.restore(snapshot); // ROLLBACK
        const transient = (error as { code?: string })?.code === 'PROTOCOL_CONNECTION_LOST';
        if (!transient || attempt === MAX_ATTEMPTS) throw error;
      }
    }
    throw new Error('unreachable');
  }) as never);
}

/** Non-transactional reads (`getSalesRecord`, catalog lookups) off the same tables. */
function installFakeQuery(db: FakeDb) {
  vi.mocked(query).mockImplementation((async (sql: unknown, params: unknown[] = []) => {
    const text = String(sql);
    const p = params as any[];
    if (text.includes('SELECT title_th')) return [[]];
    if (text.includes('WHERE sr.id = ?')) {
      return [db.tables.sales_records.filter((r) => r.id === p[0])];
    }
    if (text.includes('SELECT serialNumber FROM customer_equipments')) {
      return [
        db.tables.customer_equipments
          .filter((r) => r.salesRecordId === p[0])
          .map((r) => ({ serialNumber: r.serialNumber })),
      ];
    }
    if (text.includes('AS productCost')) {
      const mine = db.tables.sales_record_items.filter((r) => r.salesRecordId === p[0]);
      return [[{
        productCost: mine.reduce((s, r) => s + Number(r.costAmount || 0), 0),
        createdAt: mine.map((r) => r.createdAt).sort()[0] ?? null,
      }]];
    }
    if (text.includes('FROM sale_cost_items')) {
      const hidesLegacy = text.includes("costType <> 'product_cost'");
      return [
        db.tables.sale_cost_items.filter(
          (r) => r.salesRecordId === p[0] && (!hidesLegacy || r.costType !== 'product_cost')
        ),
      ];
    }
    throw new Error(`fake DB (query): unhandled SQL: ${text}`);
  }) as never);
}

describe('salesDashboardStore — schema v33 line items', () => {
  afterEach(() => {
    // These suites replace the module mocks' implementations; put the file's
    // defaults back so the suites above keep their queued-value behaviour.
    vi.mocked(query).mockReset();
    vi.mocked(withTransaction).mockImplementation((async (fn: (c: typeof conn) => Promise<unknown>) =>
      fn(conn)) as never);
  });

  describe('9.4 backfill regression — historical charts must not move by one baht', () => {
    // Deliberately mixed: the same product sold on two separate bills, two
    // categories, and a service sale with no product/category at all.
    const HISTORICAL: FakeSale[] = [
      { id: 'sale-1', saleDate: '2026-03-02', productId: 'p-1', productName: 'เครื่องชั่ง XA-220', categoryId: 1, qty: 1, totalAmount: 120000 },
      { id: 'sale-2', saleDate: '2026-03-10', productId: 'p-2', productName: 'เครื่องชั่ง PS-1000', categoryId: 1, qty: 2, totalAmount: 90000 },
      { id: 'sale-3', saleDate: '2026-03-18', productId: 'p-1', productName: 'เครื่องชั่ง XA-220', categoryId: 1, qty: 1, totalAmount: 120000 },
      { id: 'sale-4', saleDate: '2026-03-22', productId: 'p-3', productName: 'ตู้อบ OV-50', categoryId: 2, qty: 1, totalAmount: 90000 },
      { id: 'sale-5', saleDate: '2026-03-28', productId: '', productName: '', categoryId: null, qty: 1, totalAmount: 50000 },
      { id: 'sale-6', saleDate: '2026-02-11', productId: 'p-1', productName: 'เครื่องชั่ง XA-220', categoryId: 1, qty: 1, totalAmount: 120000 },
    ];

    /** What the PRE-v33 sale-level `getTopProducts` returned for this data. */
    function legacyTopProducts(sales: FakeSale[]) {
      return toTopItems(
        aggregateSales(sales, (s) => `${s.productId}\u0000${s.productName}`, (s) => s.productId, (s) => s.productName),
        PRODUCT_FALLBACK
      );
    }
    /** What the PRE-v33 sale-level `getRevenueByCategory` returned. */
    function legacyRevenueByCategory(sales: FakeSale[]) {
      return toTopItems(
        aggregateSales(sales, (s) => String(s.categoryId ?? ''), (s) => s.categoryId, (s) => categoryNameOf(s.categoryId)),
        CATEGORY_FALLBACK
      );
    }

    const inMarch = (s: FakeSale) => s.saleDate >= '2026-03-01' && s.saleDate <= '2026-03-31';

    it('getTopProducts over backfilled line items equals the old sale-level numbers', async () => {
      installReportQueries(backfillLineItems(HISTORICAL));

      const after = await getTopProducts(10, '2026-03-01', '2026-03-31');

      expect(after).toEqual(legacyTopProducts(HISTORICAL.filter(inMarch)));
      // Spot-check the actual figures so a bug in BOTH sides can't cancel out.
      expect(after.map((r) => [r.id, r.revenue, r.qty, r.deals])).toEqual([
        ['p-1', 240000, 2, 2], // one product, two separate bills -> 2 deals, as COUNT(*) gave
        ['p-2', 90000, 2, 1],
        ['p-3', 90000, 1, 1],
        ['unspecified', 50000, 1, 1],
      ]);
    });

    it('getRevenueByCategory over backfilled line items equals the old sale-level numbers', async () => {
      installReportQueries(backfillLineItems(HISTORICAL));

      const after = await getRevenueByCategory('2026-03-01', '2026-03-31');

      expect(after).toEqual(legacyRevenueByCategory(HISTORICAL.filter(inMarch)));
      expect(after.map((r) => [r.id, r.name, r.revenue, r.deals])).toEqual([
        ['1', 'เครื่องชั่ง', 330000, 3],
        ['2', 'เครื่องมือวิทยาศาสตร์', 90000, 1],
        ['unknown', 'ไม่ระบุหมวด', 50000, 1],
      ]);
    });

    it('still filters on the PARENT sale saleDate, so February stays out of March', async () => {
      installReportQueries(backfillLineItems(HISTORICAL));

      const march = await getTopProducts(10, '2026-03-01', '2026-03-31');
      const marchRevenue = march.reduce((s, r) => s + r.revenue, 0);
      expect(marchRevenue).toBe(
        HISTORICAL.filter(inMarch).reduce((s, r) => s + r.totalAmount, 0)
      );

      const [sql, params] = vi.mocked(query).mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('LEFT JOIN sales_records sr ON sri.salesRecordId = sr.id');
      expect(sql).toContain('sr.saleDate >= ?');
      expect(params.slice(0, 2)).toEqual(['2026-03-01', '2026-03-31']);
    });
  });

  describe('9.5 one bill, three products in three categories', () => {
    const BILL: FakeLine[] = [
      { salesRecordId: 'sale-multi', saleDate: '2026-03-10', productId: 'p-1', productName: 'เครื่องชั่ง XA-220', categoryId: 1, qty: 1, totalAmount: 120000 },
      { salesRecordId: 'sale-multi', saleDate: '2026-03-10', productId: 'p-3', productName: 'ตู้อบ OV-50', categoryId: 2, qty: 1, totalAmount: 90000 },
      { salesRecordId: 'sale-multi', saleDate: '2026-03-10', productId: 'p-9', productName: 'ชุดอะไหล่ K-12', categoryId: 3, qty: 2, totalAmount: 90000 },
    ];
    const BILL_TOTAL = 300000;

    it('credits every category its own share instead of the first one taking the bill', async () => {
      installReportQueries(BILL);

      const categories = await getRevenueByCategory('2026-03-01', '2026-03-31');

      expect(categories).toHaveLength(3);
      expect(categories.map((c) => [c.id, c.revenue])).toEqual([
        ['1', 120000],
        ['2', 90000],
        ['3', 90000],
      ]);
      // One bill = one deal for each of its categories, never three deals.
      expect(categories.every((c) => c.deals === 1)).toBe(true);
      expect(categories.reduce((s, c) => s + c.revenue, 0)).toBe(BILL_TOTAL);
      expect(categories.reduce((s, c) => s + c.percentage, 0)).toBe(100);

      const sql = String(vi.mocked(query).mock.calls[0][0]);
      expect(sql).toContain('COUNT(DISTINCT sri.salesRecordId) AS deals');
      expect(sql).toContain('GROUP BY sri.categoryId');
    });

    it('credits every product its own share, with the right qty', async () => {
      installReportQueries(BILL);

      const products = await getTopProducts(10, '2026-03-01', '2026-03-31');

      expect(products.map((p) => [p.id, p.revenue, p.qty, p.deals])).toEqual([
        ['p-1', 120000, 1, 1],
        ['p-3', 90000, 1, 1],
        ['p-9', 90000, 2, 1],
      ]);
      expect(products.reduce((s, p) => s + p.revenue, 0)).toBe(BILL_TOTAL);

      const sql = String(vi.mocked(query).mock.calls[0][0]);
      expect(sql).toContain('COUNT(DISTINCT sri.salesRecordId) AS deals');
      expect(sql).toContain('GROUP BY sri.productId, sri.productName');
    });
  });

  describe('9.14 lines with no product / no category', () => {
    const LINES: FakeLine[] = [
      { salesRecordId: 'sale-a', saleDate: '2026-03-04', productId: 'p-1', productName: 'เครื่องชั่ง XA-220', categoryId: 1, qty: 1, totalAmount: 120000 },
      // typed-in product: no catalog link and no category at all
      { salesRecordId: 'sale-a', saleDate: '2026-03-04', productId: '', productName: '', categoryId: null, qty: 1, totalAmount: 50000 },
      // linked product whose category was deleted from the catalog later
      { salesRecordId: 'sale-b', saleDate: '2026-03-20', productId: 'p-7', productName: 'ปั๊มสุญญากาศ VP-9', categoryId: null, qty: 1, totalAmount: 30000 },
    ];
    /** SUM(sales_records.totalAmount) for the same window. */
    const PERIOD_REVENUE = 200000;

    it('keeps them in the "ไม่ระบุสินค้า" bucket and the report total still equals period revenue', async () => {
      installReportQueries(LINES);

      const products = await getTopProducts(10, '2026-03-01', '2026-03-31');

      const unspecified = products.find((p) => p.id === 'unspecified');
      expect(unspecified).toMatchObject({ name: 'ไม่ระบุสินค้า', revenue: 50000, qty: 1, deals: 1 });
      // A line with no category but a real product keeps its own name/row.
      expect(products.find((p) => p.id === 'p-7')?.revenue).toBe(30000);
      expect(products.reduce((s, p) => s + p.revenue, 0)).toBe(PERIOD_REVENUE);
    });

    it('keeps them in the "ไม่ระบุหมวด" bucket and the report total still equals period revenue', async () => {
      installReportQueries(LINES);

      const categories = await getRevenueByCategory('2026-03-01', '2026-03-31');

      const unknown = categories.find((c) => c.id === 'unknown');
      // Both uncategorised lines land here — 50,000 + 30,000 across two bills.
      expect(unknown).toMatchObject({ name: 'ไม่ระบุหมวด', revenue: 80000, qty: 2, deals: 2 });
      expect(categories.reduce((s, c) => s + c.revenue, 0)).toBe(PERIOD_REVENUE);
      expect(categories.reduce((s, c) => s + c.percentage, 0)).toBe(100);
    });

    it('uses LEFT JOINs only — no INNER JOIN or productId filter that would drop revenue', async () => {
      installReportQueries(LINES);

      await getTopProducts(10);
      await getRevenueByCategory();

      for (const [sql] of vi.mocked(query).mock.calls) {
        const text = String(sql);
        expect(text).not.toMatch(/INNER JOIN/i);
        expect(text).not.toContain("productId <> ''");
        expect(text).toContain('LEFT JOIN sales_records sr');
      }
      const categorySql = String(vi.mocked(query).mock.calls[1][0]);
      expect(categorySql).toContain('LEFT JOIN product_categories pc');
      expect(categorySql).toContain("COALESCE(pc.name_th, 'ไม่ระบุหมวด')");
    });
  });

  describe('9.6 / 9.7 createSaleWithLineItems is all-or-nothing', () => {
    const INPUT = {
      sale: { salespersonId: 'sp-1', customerId: 'c-1', companyId: 'co-1', saleDate: '2026-03-10' },
      items: [
        { productId: 'p-1', productName: 'เครื่องชั่ง XA-220', categoryId: 1, qty: 1, unitPrice: 120000, costAmount: 80000 },
        { productId: 'p-2', productName: 'เครื่องชั่ง PS-1000', categoryId: 1, qty: 1, unitPrice: 45000, costAmount: 30000 },
      ],
      equipments: [{ serialNumber: 'SN-A' }, { serialNumber: 'SN-B' }],
    };

    it('9.6 leaves NOTHING behind when the second equipment insert fails', async () => {
      const db = createFakeDb();
      installFakeTransaction(db);
      installFakeQuery(db);
      const boom = new Error('Data too long for column serialNumber');
      db.failEquipmentInsertAt(2, boom);

      await expect(createSaleWithLineItems(INPUT)).rejects.toThrow(boom);

      // Rolled back: not a sale row, not a line item, not even the FIRST machine
      // that had already been inserted before the failure.
      expect(db.tables.sales_records).toEqual([]);
      expect(db.tables.sales_record_items).toEqual([]);
      expect(db.tables.customer_equipments).toEqual([]);
      // A non-transient error is not retried — the admin retries by hand.
      expect(db.attemptMarks).toHaveLength(1);
    });

    it('9.7 a retry after a transient connection loss writes no duplicate ids or rows', async () => {
      const db = createFakeDb();
      installFakeTransaction(db);
      installFakeQuery(db);
      const transient = Object.assign(new Error('Connection lost'), { code: 'PROTOCOL_CONNECTION_LOST' });
      db.failEquipmentInsertAt(2, transient); // first attempt only

      const sale = await createSaleWithLineItems(INPUT);

      expect(db.attemptMarks).toHaveLength(2); // rolled back once, then succeeded
      expect(db.tables.sales_records).toHaveLength(1);
      expect(db.tables.sales_record_items).toHaveLength(2);
      expect(db.tables.customer_equipments).toHaveLength(2);

      const live = db.liveIds();
      expect(new Set(live).size).toBe(live.length);
      // Every UUID is minted INSIDE the callback, so the abandoned attempt's ids
      // are gone for good rather than replayed onto the committed rows.
      const abandoned = db.allInsertedIds.slice(db.attemptMarks[0], db.attemptMarks[1]);
      expect(abandoned.length).toBeGreaterThan(0);
      for (const id of live) expect(abandoned).not.toContain(id);

      // The committed sale's cached scalars are the sums over its line items.
      expect(sale).toMatchObject({ id: db.tables.sales_records[0].id, totalAmount: 165000, qty: 2, costAmount: 110000 });
    });
  });

  describe('9.15 costAmount counts product cost exactly once', () => {
    // An older sale carrying BOTH: line items from the v33 backfill and the
    // legacy `product_cost` row that same money came from, plus real bill-level
    // costs (ค่ารถ / ค่าคอม).
    const seedDb = () =>
      createFakeDb({
        sales_records: [
          { id: 'sale-1', saleDate: '2026-03-10', qty: 4, totalAmount: 300000, costAmount: 0 },
        ],
        sales_record_items: [
          { id: 'li-1', salesRecordId: 'sale-1', qty: 1, totalAmount: 120000, costAmount: 80000 },
          { id: 'li-2', salesRecordId: 'sale-1', qty: 2, totalAmount: 90000, costAmount: 60000 },
          { id: 'li-3', salesRecordId: 'sale-1', qty: 1, totalAmount: 90000, costAmount: 55000 },
        ],
        sale_cost_items: [
          { id: 'ci-legacy', salesRecordId: 'sale-1', costType: 'product_cost', label: 'ต้นทุนสินค้า', amount: 195000 },
          { id: 'ci-1', salesRecordId: 'sale-1', costType: 'transport', label: 'ค่ารถ', amount: 3000 },
          { id: 'ci-2', salesRecordId: 'sale-1', costType: 'commission', label: 'ค่าคอมมิชชั่น', amount: 9000 },
        ],
      });

    // 195,000 product cost (line items) + 12,000 bill-level — the legacy
    // product_cost row is NOT added on top, or the sale would report 402,000.
    const EXPECTED_COST = 207000;

    it('recalcCostAmount sums line items + non-product_cost bill items only', async () => {
      const db = seedDb();
      installFakeTransaction(db);
      installFakeQuery(db);

      const total = await recalcCostAmount('sale-1');

      expect(total).toBe(EXPECTED_COST);
      expect(db.tables.sales_records[0].costAmount).toBe(EXPECTED_COST);
      // Never deleted, just not summed.
      expect(db.tables.sale_cost_items.filter((r) => r.costType === 'product_cost')).toHaveLength(1);
    });

    it('syncCostItems keeps the legacy product_cost row and refuses to write a new one', async () => {
      const db = seedDb();
      installFakeTransaction(db);
      installFakeQuery(db);

      const written = await syncCostItems('sale-1', [
        { costType: 'transport', label: 'ค่ารถ', amount: 3000 },
        { costType: 'commission', label: 'ค่าคอมมิชชั่น', amount: 9000 },
        { costType: 'product_cost', label: 'ต้นทุนสินค้า', amount: 195000 },
      ]);

      expect(written.map((i) => i.costType)).toEqual(['transport', 'commission']);
      expect(db.tables.sale_cost_items.filter((r) => r.costType === 'product_cost')).toEqual([
        expect.objectContaining({ id: 'ci-legacy', amount: 195000 }),
      ]);
      expect(db.tables.sales_records[0].costAmount).toBe(EXPECTED_COST);
    });

    it('RevenueByPeriod.cost for that month is the same 207,000', async () => {
      const db = seedDb();
      installFakeTransaction(db);
      installFakeQuery(db);
      await recalcCostAmount('sale-1');
      const persisted = db.tables.sales_records[0];

      // getRevenueByMonth reads SUM(costAmount) at the SALE level (never joining
      // line items, which would multiply revenue by the number of lines).
      vi.mocked(query).mockReset();
      vi.mocked(query)
        .mockResolvedValueOnce([[{ period: '2026-03', revenue: persisted.totalAmount, cost: persisted.costAmount, deals: 1 }]] as never)
        .mockResolvedValueOnce([[]] as never);

      const [march] = await getRevenueByMonth('2026-03-01', '2026-04-01');

      expect(march).toEqual({
        period: '2026-03',
        revenue: 300000,
        deals: 1,
        cost: EXPECTED_COST,
        expense: EXPECTED_COST, // cost + 0 company expenses
        profit: 93000,
        margin: 31,
      });
    });
  });

  // ── 9.16 ────────────────────────────────────────────────────────────────
  // The Phase 2 per-line "ต้นทุนสินค้า" UI does not exist yet: the sale form in
  // production still creates cost rows whose costType defaults to
  // `product_cost` and PUTs them all to /costs/sync. That money is what the
  // owner means by "ทุกค่าใช้จ่ายที่ใส่ตอนบันทึกการขาย เอามารวมเป็นต้นทุนสินค้าทั้งหมด" —
  // it must land on the sale's line item, counted exactly once, never dropped.
  describe('9.16 a bill-level product_cost submission is bridged onto the line item', () => {
    /** The legacy shape: one sale, one line item, nothing typed yet. */
    const oneLineDb = () =>
      createFakeDb({
        sales_records: [
          { id: 'sale-1', saleDate: '2026-03-10', productId: 'p-1', productName: 'เครื่องชั่ง XA-220', categoryId: 1, qty: 1, unitPrice: 50000, totalAmount: 50000, costAmount: 0 },
        ],
        sales_record_items: [
          { id: 'li-1', salesRecordId: 'sale-1', productId: 'p-1', productName: 'เครื่องชั่ง XA-220', categoryId: 1, qty: 1, unitPrice: 50000, totalAmount: 50000, costAmount: 0, quotationItemId: null, sortOrder: 0, createdAt: '2026-03-10T00:00:00.000Z' },
        ],
        sale_cost_items: [],
      });

    /** Exactly what app/dashboard/page.tsx PUTs today. */
    const FORM_PAYLOAD = [
      { costType: 'product_cost', label: 'ต้นทุนสินค้า', amount: 12000 },
      { costType: 'transport', label: 'ค่ารถ', amount: 3000 },
    ];

    /** Record every statement the transaction runs, then run it for real. */
    function recordSql(db: FakeDb): string[] {
      const seen: string[] = [];
      const inner = db.conn.query;
      db.conn.query = (sql: string, params?: unknown[]) => {
        seen.push(String(sql));
        return inner(sql, params);
      };
      return seen;
    }

    it('sums the product_cost rows onto the single line item — 12,000 + 3,000 = 15,000, nothing dropped', async () => {
      const db = oneLineDb();
      installFakeTransaction(db);
      installFakeQuery(db);

      const written = await syncCostItems('sale-1', FORM_PAYLOAD);

      // The 12,000 the user typed now lives where the new model keeps product
      // cost, and the 3,000 stays a bill-level row.
      expect(db.tables.sales_record_items[0].costAmount).toBe(12000);
      expect(written.map((i) => [i.costType, i.amount])).toEqual([['transport', 3000]]);
      expect(db.tables.sale_cost_items.map((r) => r.costType)).toEqual(['transport']);
      // ...and the cached total is the sum of both, not 3,000.
      expect(db.tables.sales_records[0].costAmount).toBe(15000);
    });

    it('is idempotent — saving the same cost sheet twice leaves 15,000, not 27,000', async () => {
      const db = oneLineDb();
      installFakeTransaction(db);
      installFakeQuery(db);

      await syncCostItems('sale-1', FORM_PAYLOAD);
      await syncCostItems('sale-1', FORM_PAYLOAD);

      expect(db.tables.sales_record_items[0].costAmount).toBe(12000);
      expect(db.tables.sales_record_items).toHaveLength(1);
      expect(db.tables.sale_cost_items).toHaveLength(1); // no pile-up of ค่ารถ
      expect(db.tables.sales_records[0].costAmount).toBe(15000);
    });

    it('round-trips: the sheet getCostItems reports re-saves to the same numbers', async () => {
      const db = oneLineDb();
      installFakeTransaction(db);
      installFakeQuery(db);

      await syncCostItems('sale-1', FORM_PAYLOAD);

      // What the edit form reloads — the write-READ-write the UI does on every
      // edit, which is where a stale read silently reverts a correction.
      const reloaded = await getCostItems('sale-1');
      expect(reloaded.map((i) => [i.costType, i.amount])).toEqual([
        ['product_cost', 12000],
        ['transport', 3000],
      ]);

      // The operator changes ONLY ค่ารถ and saves the sheet back.
      await syncCostItems('sale-1', [
        ...reloaded.filter((i) => i.costType !== 'transport'),
        { costType: 'transport', label: 'ค่ารถ', amount: 4000 },
      ]);

      expect(db.tables.sales_record_items[0].costAmount).toBe(12000);
      expect(db.tables.sales_records[0].costAmount).toBe(16000);
    });

    it('a correction to ต้นทุนสินค้า sticks — it is not reverted by the next save', async () => {
      const db = oneLineDb();
      installFakeTransaction(db);
      installFakeQuery(db);

      await syncCostItems('sale-1', FORM_PAYLOAD);
      // 12,000 was wrong; the real product cost is 8,000.
      await syncCostItems('sale-1', [
        { costType: 'product_cost', label: 'ต้นทุนสินค้า', amount: 8000 },
        { costType: 'transport', label: 'ค่ารถ', amount: 3000 },
      ]);
      expect(db.tables.sales_records[0].costAmount).toBe(11000);

      // Reopen later and save an unrelated edit: the reloaded sheet carries the
      // CORRECTED 8,000, not the number it was first saved with.
      const reloaded = await getCostItems('sale-1');
      expect(reloaded.find((i) => i.costType === 'product_cost')?.amount).toBe(8000);
      await syncCostItems('sale-1', reloaded);

      expect(db.tables.sales_record_items[0].costAmount).toBe(8000);
      expect(db.tables.sales_records[0].costAmount).toBe(11000);
    });

    it('a sheet with no ต้นทุนสินค้า clears it to 0 — the amount is not a one-way ratchet', async () => {
      const db = oneLineDb();
      installFakeTransaction(db);
      installFakeQuery(db);

      await syncCostItems('sale-1', FORM_PAYLOAD);
      // The goods turn out to be consignment: the operator removes the
      // ต้นทุนสินค้า row from the calculator and saves.
      await syncCostItems('sale-1', [{ costType: 'transport', label: 'ค่ารถ', amount: 3000 }]);

      expect(db.tables.sales_record_items[0].costAmount).toBe(0);
      expect(db.tables.sales_records[0].costAmount).toBe(3000);
      expect(await getCostItems('sale-1')).toHaveLength(1); // ค่ารถ only
    });

    it('maps the alerts-modal costType "product" onto product_cost instead of the counted "other" bucket', async () => {
      const db = oneLineDb();
      installFakeTransaction(db);
      installFakeQuery(db);

      // SalesRecordEditModal's dropdown value for 📦 ต้นทุนค่าสินค้า.
      await syncCostItems('sale-1', [
        { costType: 'product', label: 'ต้นทุนสินค้า', amount: 12000 },
        { costType: 'transport', label: 'ค่ารถ', amount: 3000 },
      ]);

      // On the line, not stored as a bill-level "other" row that would be
      // counted a SECOND time on top of it.
      expect(db.tables.sales_record_items[0].costAmount).toBe(12000);
      expect(db.tables.sale_cost_items.map((r) => r.costType)).toEqual(['transport']);
      expect(db.tables.sales_records[0].costAmount).toBe(15000);
    });

    it('self-heals a sale with ZERO line items (legacy addSalesRecord / pre-backfill) and still totals correctly', async () => {
      const db = createFakeDb({
        sales_records: [
          { id: 'sale-legacy', saleDate: '2026-03-10', productId: 'p-1', productName: 'เครื่องชั่ง XA-220', categoryId: 1, qty: 1, unitPrice: 50000, totalAmount: 50000, costAmount: 0 },
        ],
        sales_record_items: [],
        sale_cost_items: [],
      });
      installFakeTransaction(db);
      installFakeQuery(db);

      await syncCostItems('sale-legacy', FORM_PAYLOAD);

      // One line mirroring the sale's scalars, carrying the product cost.
      expect(db.tables.sales_record_items).toHaveLength(1);
      expect(db.tables.sales_record_items[0]).toMatchObject({
        salesRecordId: 'sale-legacy',
        productId: 'p-1',
        productName: 'เครื่องชั่ง XA-220',
        totalAmount: 50000,
        costAmount: 12000,
      });
      expect(db.tables.sales_records[0].costAmount).toBe(15000);
    });

    const multiLineDb = () =>
      createFakeDb({
        sales_records: [
          { id: 'sale-multi', saleDate: '2026-03-10', qty: 2, totalAmount: 210000, costAmount: 143000 },
        ],
        sales_record_items: [
          { id: 'li-1', salesRecordId: 'sale-multi', qty: 1, totalAmount: 120000, costAmount: 80000, sortOrder: 0 },
          { id: 'li-2', salesRecordId: 'sale-multi', qty: 1, totalAmount: 90000, costAmount: 60000, sortOrder: 1 },
        ],
        sale_cost_items: [
          { id: 'ci-1', salesRecordId: 'sale-multi', costType: 'transport', label: 'ค่ารถ', amount: 3000 },
        ],
      });

    it('REFUSES a bill-level ต้นทุนสินค้า on a MULTI-line bill rather than dropping or splitting it', async () => {
      const db = multiLineDb();
      installFakeTransaction(db);
      installFakeQuery(db);

      // 12,000 cannot be attributed to li-1 or li-2 without inventing a split,
      // and silently ignoring it would throw the user's money away.
      await expect(syncCostItems('sale-multi', FORM_PAYLOAD)).rejects.toThrow(
        ProductCostNotAttributableError
      );

      // Rolled back: per-line costs, the cost sheet and the total are untouched.
      expect(db.tables.sales_record_items.map((r) => r.costAmount)).toEqual([80000, 60000]);
      expect(db.tables.sale_cost_items.map((r) => r.id)).toEqual(['ci-1']);
      expect(db.tables.sales_records[0].costAmount).toBe(143000);
    });

    it('a MULTI-line bill can still save its bill-level costs — the unchanged product cost round-trips', async () => {
      const db = multiLineDb();
      installFakeTransaction(db);
      installFakeQuery(db);
      const sqls = recordSql(db);

      // The sheet the edit form loaded reports the per-line total as one entry;
      // re-submitting it unchanged is a no-op, so ค่ารถ can still be edited.
      const reloaded = await getCostItems('sale-multi');
      expect(reloaded.find((i) => i.costType === 'product_cost')?.amount).toBe(140000);
      await syncCostItems('sale-multi', [
        ...reloaded.filter((i) => i.costType !== 'transport'),
        { costType: 'transport', label: 'ค่ารถ', amount: 5000 },
      ]);

      expect(db.tables.sales_record_items.map((r) => r.costAmount)).toEqual([80000, 60000]);
      expect(sqls.some((s) => s.includes('UPDATE sales_record_items'))).toBe(false);
      expect(sqls.some((s) => s.includes('INSERT INTO sales_record_items'))).toBe(false);
      expect(db.tables.sales_records[0].costAmount).toBe(145000);
    });

    it('never DELETEs a legacy product_cost row and never counts its money twice', async () => {
      const db = createFakeDb({
        sales_records: [
          { id: 'sale-1', saleDate: '2026-03-10', productId: 'p-1', productName: 'เครื่องชั่ง XA-220', categoryId: 1, qty: 1, unitPrice: 50000, totalAmount: 50000, costAmount: 15000 },
        ],
        // The v33 backfill already copied the legacy row's 12,000 onto the line.
        sales_record_items: [
          { id: 'li-1', salesRecordId: 'sale-1', productId: 'p-1', productName: 'เครื่องชั่ง XA-220', categoryId: 1, qty: 1, unitPrice: 50000, totalAmount: 50000, costAmount: 12000, quotationItemId: null, sortOrder: 0, createdAt: '2026-03-10T00:00:00.000Z' },
        ],
        sale_cost_items: [
          { id: 'ci-legacy', salesRecordId: 'sale-1', costType: 'product_cost', label: 'ต้นทุนสินค้า', amount: 12000 },
          { id: 'ci-1', salesRecordId: 'sale-1', costType: 'transport', label: 'ค่ารถ', amount: 3000 },
        ],
      });
      installFakeTransaction(db);
      installFakeQuery(db);

      // The legacy row is history: it is NOT what the edit form loads, because
      // re-submitting it would pin the sale to its pre-Phase-1 number forever.
      // What the form loads is the amount actually counted — from the line.
      const loaded = await getCostItems('sale-1');
      expect(loaded.map((i) => [i.id, i.costType, i.amount])).toEqual([
        ['product-cost:sale-1', 'product_cost', 12000],
        ['ci-1', 'transport', 3000],
      ]);

      // The operator corrects ต้นทุนสินค้า to 20,000 and saves.
      await syncCostItems('sale-1', [
        { costType: 'product_cost', label: 'ต้นทุนสินค้า', amount: 20000 },
        { costType: 'transport', label: 'ค่ารถ', amount: 3000 },
      ]);

      // Kept as history, exactly once, with its amount intact — and never
      // summed, so it cannot double-count or revert the correction.
      expect(db.tables.sale_cost_items.filter((r) => r.costType === 'product_cost')).toEqual([
        expect.objectContaining({ id: 'ci-legacy', amount: 12000 }),
      ]);
      expect(db.tables.sales_record_items[0].costAmount).toBe(20000);
      expect(db.tables.sales_records[0].costAmount).toBe(23000);

      // Reopening shows 20,000, not the stale 12,000, so the next save keeps it.
      const reloaded = await getCostItems('sale-1');
      expect(reloaded.find((i) => i.costType === 'product_cost')?.amount).toBe(20000);
      await syncCostItems('sale-1', reloaded);
      expect(db.tables.sales_records[0].costAmount).toBe(23000);
    });

    it('addCostItem: a bill-level product_cost is refused, not stored-and-uncounted', async () => {
      const db = oneLineDb();
      installFakeTransaction(db);
      installFakeQuery(db);

      // A sale has ONE product-cost bucket and it is not a sale_cost_items row.
      // "Add 12,000 to it" also has no safe retry, so it is refused outright
      // rather than written somewhere the sum does not read.
      await expect(
        addCostItem('sale-1', { costType: 'product_cost', label: 'ต้นทุนสินค้า', amount: 12000 })
      ).rejects.toThrow(ProductCostIsPerLineError);

      expect(db.tables.sale_cost_items).toHaveLength(0);
      expect(db.tables.sales_record_items[0].costAmount).toBe(0);
    });

    it('updateCostItem on the ต้นทุนสินค้า entry SETs the line cost absolutely', async () => {
      const db = oneLineDb();
      installFakeTransaction(db);
      installFakeQuery(db);

      await syncCostItems('sale-1', FORM_PAYLOAD);
      const updated = await updateCostItem('product-cost:sale-1', { amount: 9000 });

      // SET, not add: applying the same request twice leaves 9,000, so a
      // withTransaction retry (or a second tab) cannot stack the amounts.
      expect(updated?.amount).toBe(9000);
      await updateCostItem('product-cost:sale-1', { amount: 9000 });
      expect(db.tables.sales_record_items[0].costAmount).toBe(9000);
      expect(db.tables.sales_records[0].costAmount).toBe(12000);
    });

    it('deleteCostItem on the ต้นทุนสินค้า entry clears the line cost to 0', async () => {
      const db = oneLineDb();
      installFakeTransaction(db);
      installFakeQuery(db);

      await syncCostItems('sale-1', FORM_PAYLOAD);
      expect(await deleteCostItem('product-cost:sale-1')).toBe(true);

      expect(db.tables.sales_record_items[0].costAmount).toBe(0);
      expect(db.tables.sales_records[0].costAmount).toBe(3000); // ค่ารถ only
    });

    it('deleteCostItem: dropping a LEGACY product_cost row does not move the total', async () => {
      const db = createFakeDb({
        sales_records: [
          { id: 'sale-1', saleDate: '2026-03-10', productId: 'p-1', productName: 'x', categoryId: 1, qty: 1, unitPrice: 50000, totalAmount: 50000, costAmount: 23000 },
        ],
        // The operator already corrected the product cost to 20,000; the legacy
        // row still reads 12,000 and is counted by nothing.
        sales_record_items: [
          { id: 'li-1', salesRecordId: 'sale-1', qty: 1, totalAmount: 50000, costAmount: 20000, sortOrder: 0 },
        ],
        sale_cost_items: [
          { id: 'ci-legacy', salesRecordId: 'sale-1', costType: 'product_cost', label: 'ต้นทุนสินค้า', amount: 12000 },
          { id: 'ci-1', salesRecordId: 'sale-1', costType: 'transport', label: 'ค่ารถ', amount: 3000 },
        ],
      });
      installFakeTransaction(db);
      vi.mocked(query).mockImplementation((async (sql: unknown, params: unknown[] = []) => {
        const text = String(sql);
        const p = params as any[];
        if (text.includes('SELECT salesRecordId, costType, amount')) {
          return [db.tables.sale_cost_items.filter((r) => r.id === p[0])];
        }
        if (text.includes('DELETE FROM sale_cost_items WHERE id = ?')) {
          const before = db.tables.sale_cost_items.length;
          db.tables.sale_cost_items = db.tables.sale_cost_items.filter((r) => r.id !== p[0]);
          return [{ affectedRows: before - db.tables.sale_cost_items.length }];
        }
        throw new Error(`unhandled SQL: ${text}`);
      }) as never);

      expect(await deleteCostItem('ci-legacy')).toBe(true);

      // A row that summed to 0 must move the total by 0 — the 20,000 belongs to
      // the line, not to the row that was deleted.
      expect(db.tables.sales_record_items[0].costAmount).toBe(20000);
      expect(db.tables.sales_records[0].costAmount).toBe(23000);
    });
  });
});

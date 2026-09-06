// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

// One transaction connection whose queries are scripted per test, matching the
// house pattern (billingSave.test.ts / crmStore.test.ts). No MySQL is involved:
// these tests assert the SQL that is issued and the params it carries.
const conn = { query: vi.fn() };
const topQuery = vi.fn();
vi.mock('@/app/lib/db', () => ({
  query: (...args: unknown[]) => topQuery(...args),
  withTransaction: vi.fn(async (fn: (c: typeof conn) => Promise<unknown>) => fn(conn)),
}));

import { withTransaction } from '@/app/lib/db';
import {
  addBillingPayment,
  voidBillingPayment,
  recomputePaidAmount,
  syncReceiptPayment,
  countLiveBillingPayments,
  listBillingPayments,
  BillingPaymentNotVoidableError,
} from '@/app/lib/billingPayments';

beforeEach(() => {
  vi.clearAllMocks();
  conn.query.mockReset();
  topQuery.mockReset();
});

const sqlOf = (call: unknown[]) => String(call[0]).replace(/\s+/g, ' ').trim();
const calls = () => conn.query.mock.calls;

const payment = {
  id: 'pay-1',
  billingDocumentId: 'inv-1',
  amount: 30000,
  paidDate: '2026-09-06',
  method: 'โอนเงิน',
  ref: 'TRF-991',
  createdAt: '2026-09-06T03:00:00.000Z',
};

describe('addBillingPayment', () => {
  it('INSERTs the payment and re-sums paidAmount inside ONE transaction', async () => {
    conn.query
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // INSERT billing_payments
      .mockResolvedValueOnce([[{ paid: '30000.00' }]]) // SUM
      .mockResolvedValueOnce([{ affectedRows: 1 }]); // UPDATE billing_documents

    const result = await addBillingPayment(payment);

    expect(withTransaction).toHaveBeenCalledTimes(1);
    expect(conn.query).toHaveBeenCalledTimes(3);
    expect(sqlOf(calls()[0])).toContain('INSERT INTO billing_payments');
    expect(calls()[0][1]).toEqual([
      'pay-1',
      'inv-1',
      30000,
      '2026-09-06',
      'โอนเงิน',
      'TRF-991',
      null,
      null,
      '2026-09-06T03:00:00.000Z',
    ]);
    // DECIMAL comes back as a string; the store must hand back a number.
    expect(result.paidAmount).toBe(30000);
  });

  it('re-sums as a FULL COALESCE(SUM(...)) over non-voided rows — never an increment', async () => {
    // `paidAmount = paidAmount + ?` looks equivalent and becomes permanent,
    // unexplainable drift the first time a request is retried.
    conn.query
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([[{ paid: '30000.00' }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    await addBillingPayment(payment);

    const sumSql = sqlOf(calls()[1]);
    expect(sumSql).toContain('COALESCE(SUM(amount), 0)');
    expect(sumSql).toContain('FROM billing_payments');
    expect(sumSql).toContain('billingDocumentId = ?');
    expect(sumSql).toContain('voidedAt IS NULL');
    expect(calls()[1][1]).toEqual(['inv-1']);

    const updateSql = sqlOf(calls()[2]);
    expect(updateSql).toBe('UPDATE billing_documents SET paidAmount = ? WHERE id = ?');
    expect(updateSql).not.toContain('paidAmount +');
    expect(calls()[2][1]).toEqual([30000, 'inv-1']);
  });

  it('writes the cache as an absolute value, so re-running it is idempotent', async () => {
    conn.query
      .mockResolvedValueOnce([[{ paid: '100000.00' }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    const paid = await recomputePaidAmount(conn as never, 'inv-9');
    expect(paid).toBe(100000);
    expect(calls()[1][1]).toEqual([100000, 'inv-9']);
  });

  it('treats a document with no payment rows as ฿0, not NaN', async () => {
    conn.query
      .mockResolvedValueOnce([[{ paid: null }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    expect(await recomputePaidAmount(conn as never, 'inv-9')).toBe(0);
  });
});

describe('voidBillingPayment — corrections NEVER delete', () => {
  it('stamps voidedAt/voidReason and re-sums, all in one transaction, with no DELETE', async () => {
    conn.query
      .mockResolvedValueOnce([[{ billingDocumentId: 'inv-1', voidedAt: null }]]) // lock
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // UPDATE void
      .mockResolvedValueOnce([[{ paid: '0.00' }]]) // SUM
      .mockResolvedValueOnce([{ affectedRows: 1 }]); // UPDATE cache

    const result = await voidBillingPayment('pay-1', 'พิมพ์ยอดผิด', '2026-09-06T04:00:00.000Z');

    expect(withTransaction).toHaveBeenCalledTimes(1);
    expect(sqlOf(calls()[0])).toContain('FOR UPDATE');
    expect(sqlOf(calls()[1])).toBe(
      'UPDATE billing_payments SET voidedAt = ?, voidReason = ? WHERE id = ?'
    );
    expect(calls()[1][1]).toEqual(['2026-09-06T04:00:00.000Z', 'พิมพ์ยอดผิด', 'pay-1']);
    expect(calls().some(([sql]) => /DELETE/i.test(String(sql)))).toBe(false);
    expect(result).toEqual({ billingDocumentId: 'inv-1', paidAmount: 0 });
  });

  it('refuses to void a payment that is already voided, instead of silently succeeding', async () => {
    conn.query.mockResolvedValueOnce([
      [{ billingDocumentId: 'inv-1', voidedAt: '2026-09-01T00:00:00.000Z' }],
    ]);
    await expect(voidBillingPayment('pay-1', 'x', 'now')).rejects.toBeInstanceOf(
      BillingPaymentNotVoidableError
    );
    expect(conn.query).toHaveBeenCalledTimes(1);
  });

  it('refuses when the payment does not exist at all', async () => {
    conn.query.mockResolvedValueOnce([[]]);
    await expect(voidBillingPayment('missing', 'x', 'now')).rejects.toBeInstanceOf(
      BillingPaymentNotVoidableError
    );
  });
});

describe('syncReceiptPayment — issuing a receipt records the payment, in one action', () => {
  const receipt = {
    id: 'rc-1',
    settlesDocId: 'inv-1',
    amount: 107000,
    paidDate: '2026-09-06',
    method: 'โอนเงิน',
    ref: 'TRF-1',
    createdAt: '2026-09-06T03:00:00.000Z',
  };

  it('upserts ONE payment keyed by the receipt id, so re-saving the receipt cannot mint a second one', async () => {
    conn.query
      .mockResolvedValueOnce([[]]) // no existing payment
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // upsert
      .mockResolvedValueOnce([[{ paid: '107000.00' }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    await syncReceiptPayment(conn as never, receipt);

    const upsert = sqlOf(calls()[1]);
    expect(upsert).toContain('INSERT INTO billing_payments');
    expect(upsert).toContain('ON DUPLICATE KEY UPDATE');
    // The payment's id IS the receipt's id — that is what makes it idempotent.
    expect(calls()[1][1][0]).toBe('rc-1');
    expect(calls()[1][1][1]).toBe('inv-1');
    expect(calls()[1][1][2]).toBe(107000);
  });

  it('re-sums BOTH invoices when a receipt is re-pointed, so the old one is not left over-credited', async () => {
    conn.query
      .mockResolvedValueOnce([[{ billingDocumentId: 'inv-OLD', voidedAt: null }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // upsert (moves the row)
      .mockResolvedValueOnce([[{ paid: '0.00' }]]) // re-sum OLD
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([[{ paid: '107000.00' }]]) // re-sum NEW
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    await syncReceiptPayment(conn as never, receipt);

    const cacheWrites = calls()
      .filter(([sql]) => String(sql).includes('SET paidAmount = ?'))
      .map(([, params]) => (params as unknown[])[1]);
    expect(cacheWrites).toEqual(['inv-OLD', 'inv-1']);
  });

  it('VOIDS (never deletes) the implied payment when the receipt is unlinked from its invoice', async () => {
    conn.query
      .mockResolvedValueOnce([[{ billingDocumentId: 'inv-1', voidedAt: null }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // void
      .mockResolvedValueOnce([[{ paid: '0.00' }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    await syncReceiptPayment(conn as never, { ...receipt, settlesDocId: null });

    expect(sqlOf(calls()[1])).toContain('SET voidedAt = ?, voidReason = ?');
    expect(calls().some(([sql]) => /DELETE/i.test(String(sql)))).toBe(false);
  });

  it('does nothing at all for an unlinked receipt that never implied a payment', async () => {
    conn.query.mockResolvedValueOnce([[]]);
    await syncReceiptPayment(conn as never, { ...receipt, settlesDocId: null });
    expect(conn.query).toHaveBeenCalledTimes(1);
  });
});

describe('reads', () => {
  it('counts only LIVE payments (the delete ban and the history disclosure both hang off this)', async () => {
    topQuery.mockResolvedValueOnce([[{ cnt: 2 }]]);
    expect(await countLiveBillingPayments('inv-1')).toBe(2);
    expect(sqlOf(topQuery.mock.calls[0])).toContain('voidedAt IS NULL');
  });

  it('lists the history INCLUDING voided rows — they render struck through, so they must not be filtered out', async () => {
    topQuery.mockResolvedValueOnce([
      [
        { id: 'p1', billingDocumentId: 'inv-1', amount: '30000.00', paidDate: '2026-08-01', method: 'โอนเงิน', ref: '', voidedAt: null, createdAt: 'x' },
        { id: 'p2', billingDocumentId: 'inv-1', amount: '5.00', paidDate: '2026-08-02', method: 'เงินสด', ref: '', voidedAt: '2026-08-03', voidReason: 'พิมพ์ผิด', createdAt: 'y' },
      ],
    ]);
    const rows = await listBillingPayments('inv-1');
    expect(rows).toHaveLength(2);
    expect(sqlOf(topQuery.mock.calls[0])).not.toContain('voidedAt IS NULL');
    // DECIMAL strings must arrive as numbers so no caller adds them as text.
    expect(rows[0].amount).toBe(30000);
    expect(rows[1].voidReason).toBe('พิมพ์ผิด');
  });
});

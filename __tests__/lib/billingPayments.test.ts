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
  InvalidPaymentAmountError,
  voidBillingPayment,
  recomputePaidAmount,
  syncReceiptPayment,
  voidSupersededReceiptPayment,
  countLiveBillingPayments,
  listBillingPayments,
  BillingPaymentNotVoidableError,
  RECEIPT_UNLINKED_VOID_REASON,
  RECEIPT_CANCELLED_VOID_REASON,
  RECEIPT_SUPERSEDED_VOID_REASON,
} from '@/app/lib/billingPayments';

beforeEach(() => {
  vi.clearAllMocks();
  conn.query.mockReset();
  topQuery.mockReset();
});

const sqlOf = (call: unknown[]) => String(call[0]).replace(/\s+/g, ' ').trim();

/** EVERY statement the connection saw, lock included. */
const rawCalls = () => conn.query.mock.calls;

/**
 * The statements that DO something, with the invoice row-lock filtered out.
 *
 * `syncReceiptPayment` takes `SELECT id FROM billing_documents ... FOR UPDATE`
 * before it writes, so that `deleteBillingDocument` cannot count zero payments
 * and delete the invoice while this INSERT is in flight. It is a lock and not a
 * read — nothing consumes its result — so the assertions below keep indexing
 * the real work. The lock itself is asserted on `rawCalls()`, by the test named
 * for it; hiding it here without testing it there would be how it gets deleted.
 */
const calls = () =>
  rawCalls().filter(
    ([sql]) =>
      !/^\s*SELECT id FROM billing_documents WHERE id = \? FOR UPDATE\s*$/i.test(
        String(sql)
      )
  );

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

  // The other half of the fix in `deleteBillingDocument`. That function counts
  // the payments on a document and then deletes it; counting under FOR UPDATE
  // would protect nothing, because TiDB takes no gap lock on a payment row that
  // does not exist yet. The two transactions can only be made to queue by both
  // locking a row that DOES exist — the invoice — so if this lock ever goes, a
  // receipt saved in the gap is orphaned against a deleted document with no
  // FOREIGN KEY to catch it.
  it('locks the invoice row BEFORE writing the payment, so a concurrent delete cannot orphan it', async () => {
    conn.query
      .mockResolvedValueOnce([[]]) // no existing payment
      .mockResolvedValueOnce([[]]) // the lock
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // upsert
      .mockResolvedValueOnce([[{ paid: '107000.00' }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    await syncReceiptPayment(conn as never, receipt);

    const sqls = rawCalls().map(sqlOf);
    const lockAt = sqls.findIndex((sql) =>
      /SELECT id FROM billing_documents WHERE id = \? FOR UPDATE/i.test(sql)
    );
    const insertAt = sqls.findIndex((sql) =>
      /INSERT INTO billing_payments/i.test(sql)
    );

    expect(lockAt).toBeGreaterThanOrEqual(0);
    expect(insertAt).toBeGreaterThanOrEqual(0);
    // Ordering is the whole point: a lock taken after the write locks nothing.
    expect(lockAt).toBeLessThan(insertAt);
    // And it locks the INVOICE the money lands on, not the receipt.
    expect(rawCalls()[lockAt][1]).toEqual(['inv-1']);
  });

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

// ── WHO MAY CLEAR `voidedAt` ────────────────────────────────────────────────
// A void performed BY A HUMAN is a decision, and a re-save is not: /billing
// re-POSTs a document on every ดาวน์โหลด PDF, by anyone merely looking at it.
// The upsert therefore cannot un-void anything, and the ONE legitimate un-void
// is written out on its own, matched to the reason it is the inverse of.
describe('syncReceiptPayment — a re-save may correct the money, never the void', () => {
  const receipt = {
    id: 'rc-1',
    settlesDocId: 'inv-1',
    amount: 107000,
    paidDate: '2026-09-06',
    method: 'โอนเงิน',
    ref: 'TRF-1',
    createdAt: '2026-09-06T03:00:00.000Z',
  };

  const existing = (voidedAt: string | null, voidReason: string | null) =>
    conn.query
      .mockResolvedValueOnce([[{ billingDocumentId: 'inv-1', voidedAt, voidReason }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // upsert
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // (any un-void)
      .mockResolvedValue([[{ paid: '107000.00' }]]);

  const unvoided = () =>
    calls().filter(([sql]) => /SET voidedAt = NULL/.test(String(sql)));

  /** Nothing this save issued can bring the row back: neither a separate
   *  un-void, NOR the upsert's own ON DUPLICATE KEY UPDATE list — which is
   *  where the resurrection used to hide. */
  const expectVoidSurvives = () => {
    expect(unvoided()).toHaveLength(0);
    const upsert = calls().find(([sql]) => /INSERT INTO billing_payments/.test(String(sql)));
    expect(upsert).toBeTruthy();
    expect(sqlOf(upsert!)).not.toMatch(/ON DUPLICATE KEY UPDATE[\s\S]*voidedAt/);
  };

  it('the ON DUPLICATE KEY UPDATE list does not mention voidedAt at all', async () => {
    conn.query
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValue([[{ paid: '107000.00' }]]);

    await syncReceiptPayment(conn as never, receipt);

    const upsert = sqlOf(calls()[1]);
    // `voidedAt = NULL` in this clause is the whole of the defect: it made the
    // statement itself capable of re-crediting an invoice.
    expect(upsert).not.toMatch(/ON DUPLICATE KEY UPDATE[\s\S]*voidedAt/);
    expect(upsert).not.toMatch(/ON DUPLICATE KEY UPDATE[\s\S]*voidReason/);
  });

  it('leaves a payment a HUMAN voided voided, and re-sums WITHOUT it', async () => {
    existing('2026-09-06T09:00:00.000Z', 'พิมพ์ยอดผิด');
    await syncReceiptPayment(conn as never, receipt);
    expectVoidSurvives();
  });

  it('leaves a void the CANCEL wrote alone — only un-cancelling may take that back', async () => {
    existing('2026-09-07T00:00:00.000Z', RECEIPT_CANCELLED_VOID_REASON);
    await syncReceiptPayment(conn as never, receipt);
    expectVoidSurvives();
  });

  it('leaves a void the SUPERSEDE wrote alone — the newer version carries the money now', async () => {
    existing('2026-09-07T00:00:00.000Z', RECEIPT_SUPERSEDED_VOID_REASON);
    await syncReceiptPayment(conn as never, receipt);
    expectVoidSurvives();
  });

  it('DOES un-void when the receipt is pointed back at an invoice — the inverse of the unlink', async () => {
    existing('2026-09-06T09:00:00.000Z', RECEIPT_UNLINKED_VOID_REASON);
    await syncReceiptPayment(conn as never, receipt);
    const undo = unvoided();
    expect(undo).toHaveLength(1);
    expect(undo[0][1]).toEqual(['rc-1']);
  });

  it('voids under ถูกแทนที่ when a live newer version has replaced the receipt, and writes no payment', async () => {
    conn.query
      .mockResolvedValueOnce([[{ billingDocumentId: 'inv-1', voidedAt: null, voidReason: null }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValue([[{ paid: '0.00' }]]);

    await syncReceiptPayment(conn as never, { ...receipt, superseded: true });

    expect(calls().some(([sql]) => /INSERT INTO billing_payments/.test(String(sql)))).toBe(false);
    expect(calls()[1][1]).toEqual([
      receipt.createdAt,
      RECEIPT_SUPERSEDED_VOID_REASON,
      'rc-1',
    ]);
  });

  it('ถูกแทนที่ beats ยกเลิก, because only the cancel has an undo that could take the void back', async () => {
    conn.query
      .mockResolvedValueOnce([[{ billingDocumentId: 'inv-1', voidedAt: null, voidReason: null }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValue([[{ paid: '0.00' }]]);

    await syncReceiptPayment(conn as never, {
      ...receipt,
      superseded: true,
      cancelled: true,
    });

    expect((calls()[1][1] as unknown[])[1]).toBe(RECEIPT_SUPERSEDED_VOID_REASON);
  });
});

describe('voidSupersededReceiptPayment — แก้ไข (New Ver.) takes the old credit out', () => {
  it('voids the superseded receipt\'s payment and re-sums the invoice it credited', async () => {
    conn.query
      .mockResolvedValueOnce([[{ billingDocumentId: 'inv-1', voidedAt: null }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([[{ paid: '0.00' }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    await voidSupersededReceiptPayment(conn as never, 'rc-1', '2026-09-07T02:00:00.000Z');

    expect(sqlOf(calls()[1])).toBe(
      'UPDATE billing_payments SET voidedAt = ?, voidReason = ? WHERE id = ?'
    );
    expect(calls()[1][1]).toEqual([
      '2026-09-07T02:00:00.000Z',
      RECEIPT_SUPERSEDED_VOID_REASON,
      'rc-1',
    ]);
    expect(calls()[3][1]).toEqual([0, 'inv-1']);
    expect(calls().some(([sql]) => /DELETE/i.test(String(sql)))).toBe(false);
  });

  it('is a no-op for a document that minted no payment — an invoice never loses its deposit here', async () => {
    conn.query.mockResolvedValueOnce([[]]);
    await voidSupersededReceiptPayment(conn as never, 'inv-old', 'now');
    expect(conn.query).toHaveBeenCalledTimes(1);
  });

  it('leaves an already-voided payment exactly as it is — first void wins, reason and all', async () => {
    conn.query.mockResolvedValueOnce([
      [{ billingDocumentId: 'inv-1', voidedAt: '2026-09-06T09:00:00.000Z' }],
    ]);
    await voidSupersededReceiptPayment(conn as never, 'rc-1', 'now');
    expect(conn.query).toHaveBeenCalledTimes(1);
  });
});

// The route that exists today validates before calling in, so these exercise the
// guard the store now carries for the caller that does not yet exist. A bad
// amount here does not throw on its own — it sums into the document's
// paidAmount and quietly makes an invoice look part-paid, unpaid, or settled
// twice, from a row that reads like any other in the history.
describe('addBillingPayment — amount guard', () => {
  it.each([0, -1, -0.01, NaN, Infinity, -Infinity])(
    'refuses %p and writes nothing',
    async (amount) => {
      await expect(
        addBillingPayment({ ...payment, amount: amount as number })
      ).rejects.toBeInstanceOf(InvalidPaymentAmountError);
      // The point: it fails BEFORE opening a transaction, so there is no partial
      // write and no recomputed total to undo.
      expect(withTransaction).not.toHaveBeenCalled();
      expect(conn.query).not.toHaveBeenCalled();
    }
  );

  it('still accepts a payment larger than the invoice', async () => {
    // Overpayment is deliberately allowed — a customer who transfers too much
    // has to be recordable, or the admin is forced to enter a false figure.
    conn.query
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([[{ paid: '999999.00' }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    await expect(
      addBillingPayment({ ...payment, amount: 999999 })
    ).resolves.toEqual({ paidAmount: 999999 });
  });
});

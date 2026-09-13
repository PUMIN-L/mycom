// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const conn = { query: vi.fn() };
const topQuery = vi.fn();
vi.mock('@/app/lib/db', () => ({
  query: (...args: unknown[]) => topQuery(...args),
  withTransaction: vi.fn(async (fn: (c: typeof conn) => Promise<unknown>) => fn(conn)),
}));

import {
  deleteBillingDocument,
  cancelBillingDocument,
  listReceivableRows,
  listOpenInvoices,
  setReceivableOverride,
  setBillingDueDate,
  setDueDatesForUndatedReceivables,
  backfillBillingDerivedColumns,
  deriveBillingColumns,
  BillingDocumentHasPaymentsError,
} from '@/app/lib/billingStore';
import { withTransaction } from '@/app/lib/db';

beforeEach(() => {
  vi.clearAllMocks();
  conn.query.mockReset();
  topQuery.mockReset();
});

const sql = (call: unknown[]) => String(call[0]).replace(/\s+/g, ' ').trim();

// ── THE DELETE BAN ──────────────────────────────────────────────────────────
// billing_payments deliberately has NO FOREIGN KEY (the app hard-deletes
// documents), so nothing at the database level stops a DELETE from orphaning
// financial records. This ban is that stop.
describe('deleteBillingDocument', () => {
  // The check and the DELETE are ONE transaction, opened by locking the
  // document row. Two pool queries let a receipt saved in the gap between them
  // be orphaned: the count sees zero, the INSERT lands, the DELETE removes the
  // document, and `billing_payments` has no FOREIGN KEY to refuse the survivor.
  // Counting under FOR UPDATE could not have fixed it — TiDB takes no gap lock
  // on a payment row that does not exist yet — so the lock is on the invoice,
  // and `syncReceiptPayment` takes the same one.
  const lockThen = (...results: unknown[]) => {
    conn.query.mockResolvedValueOnce([[{ id: 'inv-1' }]]);
    for (const r of results) conn.query.mockResolvedValueOnce(r as never);
  };

  it('REFUSES and issues no DELETE when a live payment exists', async () => {
    lockThen([[{ cnt: 1 }]]);

    await expect(deleteBillingDocument('inv-1')).rejects.toBeInstanceOf(
      BillingDocumentHasPaymentsError
    );
    expect(withTransaction).toHaveBeenCalledTimes(1);
    expect(
      conn.query.mock.calls.some(([s]) => /DELETE FROM billing_documents/.test(String(s)))
    ).toBe(false);
  });

  it('locks the document row BEFORE counting its payments', async () => {
    lockThen([[{ cnt: 0 }]], [{ affectedRows: 1 }]);

    expect(await deleteBillingDocument('inv-1')).toBe(true);
    expect(sql(conn.query.mock.calls[0])).toBe(
      'SELECT id FROM billing_documents WHERE id = ? FOR UPDATE'
    );
    expect(conn.query.mock.calls[0][1]).toEqual(['inv-1']);
    // Ordering is the point: a count taken before the lock is a stale count.
    expect(sql(conn.query.mock.calls[1])).toContain('FROM billing_payments');
  });

  it('returns false without counting anything when the document is already gone', async () => {
    conn.query.mockResolvedValueOnce([[]]);

    expect(await deleteBillingDocument('inv-1')).toBe(false);
    expect(conn.query).toHaveBeenCalledTimes(1);
    expect(
      conn.query.mock.calls.some(([s]) => /DELETE FROM billing_documents/.test(String(s)))
    ).toBe(false);
  });

  it('counts only LIVE payments — a document whose only payment was voided is deletable again', async () => {
    lockThen([[{ cnt: 0 }]], [{ affectedRows: 1 }]);

    expect(await deleteBillingDocument('inv-1')).toBe(true);
    expect(sql(conn.query.mock.calls[1])).toContain('voidedAt IS NULL');
    expect(sql(conn.query.mock.calls[2])).toBe('DELETE FROM billing_documents WHERE id = ?');
  });

  // A receipt's implied payment carries the RECEIPT's id and points at the
  // INVOICE, so `billingDocumentId = id` alone never matches it. Checking only
  // that clause let a receipt be deleted while its credit lived on, and the
  // invoice it had settled stayed "paid" with no document behind it.
  it('also refuses for the RECEIPT that MINTED a payment, not just the doc it was paid against', async () => {
    conn.query
      .mockResolvedValueOnce([[{ id: 'rc-1' }]]) // lock
      .mockResolvedValueOnce([[{ cnt: 0 }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);
    await deleteBillingDocument('rc-1');
    const text = sql(conn.query.mock.calls[1]);
    expect(text).toContain('billingDocumentId = ? OR id = ?');
    expect(conn.query.mock.calls[1][1]).toEqual(['rc-1', 'rc-1']);
  });
});

describe('cancelBillingDocument — the non-destructive alternative', () => {
  it('stamps cancelledAt without touching the document, its payments or its docNo', async () => {
    conn.query
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([[]]); // no implied receipt payment (an invoice)
    await cancelBillingDocument('inv-1', '2026-09-06T00:00:00.000Z');
    expect(sql(conn.query.mock.calls[0])).toBe(
      'UPDATE billing_documents SET cancelledAt = ? WHERE id = ?'
    );
    expect(conn.query.mock.calls[0][1]).toEqual(['2026-09-06T00:00:00.000Z', 'inv-1']);
    // Nothing else was written: the payment lookup found no row to correct.
    expect(
      conn.query.mock.calls.some(([s]) => /UPDATE billing_payments/.test(String(s)))
    ).toBe(false);
  });

  it('un-cancels with NULL, because an admin can cancel the wrong invoice', async () => {
    conn.query.mockResolvedValueOnce([{ affectedRows: 1 }]).mockResolvedValueOnce([[]]);
    await cancelBillingDocument('inv-1', null);
    expect(conn.query.mock.calls[0][1]).toEqual([null, 'inv-1']);
  });

  it('does nothing at all when the document does not exist', async () => {
    conn.query.mockResolvedValueOnce([{ affectedRows: 0 }]);
    expect(await cancelBillingDocument('nope', '2026-09-06T00:00:00.000Z')).toBe(false);
    expect(conn.query).toHaveBeenCalledTimes(1);
  });

  // THE DEFECT THIS CLOSES: cancelling a receipt used to withdraw the document
  // and leave the credit it had minted on the invoice, so an unpaid invoice
  // reported ฿0 owed.
  it('VOIDS the payment a cancelled RECEIPT minted and re-sums the invoice', async () => {
    conn.query
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // the cancel
      .mockResolvedValueOnce([[{ billingDocumentId: 'inv-1', voidedAt: null, voidReason: null }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // the void
      .mockResolvedValueOnce([[{ paid: '0.00' }]]) // re-sum
      .mockResolvedValueOnce([{ affectedRows: 1 }]); // write paidAmount

    await cancelBillingDocument('rc-1', '2026-09-06T00:00:00.000Z');

    const voided = conn.query.mock.calls.find(([s]) =>
      /UPDATE billing_payments SET voidedAt = \?/.test(String(s))
    )!;
    expect(voided[1]).toEqual(['2026-09-06T00:00:00.000Z', 'ยกเลิกใบเสร็จรับเงิน', 'rc-1']);
    // NEVER deleted — the row stays, struck through, out of the SUM.
    expect(conn.query.mock.calls.some(([s]) => /DELETE FROM billing_payments/.test(String(s)))).toBe(
      false
    );
    const resum = conn.query.mock.calls.find(([s]) => /SET paidAmount = \?/.test(String(s)))!;
    expect(resum[1]).toEqual([0, 'inv-1']);
  });

  it('un-cancelling a receipt restores the credit the cancel took out', async () => {
    conn.query
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([
        [{ billingDocumentId: 'inv-1', voidedAt: 'x', voidReason: 'ยกเลิกใบเสร็จรับเงิน' }],
      ])
      .mockResolvedValueOnce([[]]) // no LIVE newer version has taken its place
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([[{ paid: '107000.00' }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    await cancelBillingDocument('rc-1', null);

    expect(
      conn.query.mock.calls.some(([s]) =>
        /SET voidedAt = NULL, voidReason = NULL/.test(String(s))
      )
    ).toBe(true);
    const resum = conn.query.mock.calls.find(([s]) => /SET paidAmount = \?/.test(String(s)))!;
    expect(resum[1]).toEqual([107000, 'inv-1']);
  });

  // An un-cancel is not a statement about a correction a human made.
  it('un-cancelling never resurrects a payment a human voided from the history', async () => {
    conn.query
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([
        [{ billingDocumentId: 'inv-1', voidedAt: 'x', voidReason: 'พิมพ์ยอดผิด' }],
      ]);

    await cancelBillingDocument('rc-1', null);
    expect(
      conn.query.mock.calls.some(([s]) => /UPDATE billing_payments/.test(String(s)))
    ).toBe(false);
    expect(conn.query.mock.calls.some(([s]) => /SET paidAmount = \?/.test(String(s)))).toBe(false);
  });

  it('cancelling twice is harmless — an already-voided payment is left alone', async () => {
    conn.query
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([
        [{ billingDocumentId: 'inv-1', voidedAt: 'y', voidReason: 'ยกเลิกใบเสร็จรับเงิน' }],
      ]);

    await cancelBillingDocument('rc-1', '2026-09-07T00:00:00.000Z');
    expect(
      conn.query.mock.calls.some(([s]) => /UPDATE billing_payments/.test(String(s)))
    ).toBe(false);
  });
});

// ── THE LEDGER READ ─────────────────────────────────────────────────────────
describe('listReceivableRows', () => {
  it('never selects the JSON blob — the ledger runs on denormalised columns alone', async () => {
    topQuery.mockResolvedValueOnce([[]]);
    await listReceivableRows();
    const text = sql(topQuery.mock.calls[0]);
    expect(text).toContain('FROM billing_documents');
    expect(text).not.toMatch(/\bdata\b/);
  });

  it('stays inside the same LIMIT 2000 the saved list already lives under', async () => {
    topQuery.mockResolvedValueOnce([[]]);
    await listReceivableRows();
    expect(sql(topQuery.mock.calls[0])).toContain('LIMIT 2000');
  });

  it('returns rows of EVERY docType — the nudge list and the version fallback need them', async () => {
    topQuery.mockResolvedValueOnce([[]]);
    await listReceivableRows();
    expect(sql(topQuery.mock.calls[0])).not.toContain("docType = 'invoice'");
  });

  it('coerces the DECIMAL columns from strings, so no caller adds money as text', async () => {
    topQuery.mockResolvedValueOnce([
      [
        {
          id: 'a',
          docNo: 'INV1',
          docType: 'invoice',
          docDate: '2026-08-01',
          dueDate: '2026-08-31',
          customerName: 'ก',
          customerPhone: '',
          linkedQuotationId: null,
          totalAmount: '107000.00',
          paidAmount: '30000.00',
          receivableOverride: null,
          cancelledAt: null,
          supersededById: null,
          settlesDocId: null,
          createdAt: 'x',
        },
      ],
    ]);
    const rows = await listReceivableRows();
    expect(rows[0].totalAmount).toBe(107000);
    expect(rows[0].paidAmount).toBe(30000);
  });
});

describe('listOpenInvoices', () => {
  it('applies the debtCarrier rule in SQL and compares with a satang tolerance', async () => {
    topQuery.mockResolvedValueOnce([[]]);
    await listOpenInvoices();
    const text = sql(topQuery.mock.calls[0]);
    expect(text).toContain('cancelledAt IS NULL');
    // "ถูกแทนที่" has to mean replaced by a row that is STILL ALIVE: a plain
    // `supersededById IS NULL` made an invoice whose newer version was later
    // cancelled impossible to pick, while the debt was still real.
    expect(text).toContain('NOT EXISTS');
    expect(text).toContain('newer.id = billing_documents.supersededById');
    expect(text).toContain('newer.cancelledAt IS NULL');
    expect(text).not.toContain('AND supersededById IS NULL');
    expect(text).toContain(
      "(receivableOverride = 1 OR (receivableOverride IS NULL AND docType = 'invoice'))"
    );
    // Never `paidAmount = totalAmount` on floats.
    expect(text).toContain('totalAmount - paidAmount > 0.005');
  });
});

describe('the explicit admin decisions', () => {
  it('setReceivableOverride writes the tri-state verbatim, including NULL', async () => {
    topQuery.mockResolvedValue([{ affectedRows: 1 }]);
    await setReceivableOverride('bn-1', 1);
    expect(topQuery.mock.calls[0][1]).toEqual([1, 'bn-1']);
    await setReceivableOverride('bn-1', 0);
    expect(topQuery.mock.calls[1][1]).toEqual([0, 'bn-1']);
    await setReceivableOverride('bn-1', null);
    expect(topQuery.mock.calls[2][1]).toEqual([null, 'bn-1']);
  });

  it('setBillingDueDate can clear a due date back to NULL', async () => {
    topQuery.mockResolvedValueOnce([{ affectedRows: 1 }]);
    await setBillingDueDate('inv-1', null);
    expect(topQuery.mock.calls[0][1]).toEqual([null, 'inv-1']);
  });
});

// ── THE BULK "ตั้งให้ทุกใบที่ยังไม่กำหนด" ─────────────────────────────────────
describe('setDueDatesForUndatedReceivables', () => {
  it('counts from docDate, in JS, and only touches rows whose dueDate is still NULL', async () => {
    topQuery.mockResolvedValueOnce([
      [
        { id: 'a', docNo: 'INV1', customerName: 'ก', docDate: '2026-08-01' },
        { id: 'b', docNo: 'INV2', customerName: 'ข', docDate: '2026-08-15' },
      ],
    ]);
    conn.query.mockResolvedValue([{ affectedRows: 1 }]);

    expect(await setDueDatesForUndatedReceivables(30)).toBe(2);

    expect(conn.query.mock.calls[0][1]).toEqual(['2026-08-31', 'a']);
    expect(conn.query.mock.calls[1][1]).toEqual(['2026-09-14', 'b']);
    // The guard matters: a due date set by hand between the read and the write
    // must survive.
    expect(sql(conn.query.mock.calls[0])).toContain('AND dueDate IS NULL');
  });

  // THE DEFECT THIS CLOSES: the count was incremented per ATTEMPT, so two
  // admins pressing the button at the same moment both saw "อัปเดต 40 ใบ" while
  // the second one's UPDATE matched zero rows and changed nothing.
  it('reports only the rows it ACTUALLY wrote, not the ones it tried', async () => {
    topQuery.mockResolvedValueOnce([
      [
        { id: 'a', docNo: 'INV1', customerName: 'ก', docDate: '2026-08-01' },
        { id: 'b', docNo: 'INV2', customerName: 'ข', docDate: '2026-08-15' },
      ],
    ]);
    // Someone else stamped both of these between the read and the write, so the
    // `AND dueDate IS NULL` guard matches nothing.
    conn.query.mockResolvedValue([{ affectedRows: 0 }]);

    expect(await setDueDatesForUndatedReceivables(30)).toBe(0);
    expect(conn.query).toHaveBeenCalledTimes(2);
  });

  it('counts the rows that were written when only some of them were still undated', async () => {
    topQuery.mockResolvedValueOnce([
      [
        { id: 'a', docNo: 'INV1', customerName: 'ก', docDate: '2026-08-01' },
        { id: 'b', docNo: 'INV2', customerName: 'ข', docDate: '2026-08-15' },
        { id: 'c', docNo: 'INV3', customerName: 'ค', docDate: '2026-08-20' },
      ],
    ]);
    conn.query
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{ affectedRows: 0 }])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    expect(await setDueDatesForUndatedReceivables(30)).toBe(2);
  });

  // withTransaction retries its callback after a transient connection loss, so
  // a counter that lives OUTSIDE the callback keeps the abandoned attempt's
  // tally and reports double.
  it('does not double its count when the transaction is replayed', async () => {
    topQuery.mockResolvedValueOnce([
      [{ id: 'a', docNo: 'INV1', customerName: 'ก', docDate: '2026-08-01' }],
    ]);
    conn.query.mockResolvedValue([{ affectedRows: 1 }]);
    vi.mocked(withTransaction).mockImplementationOnce((async (
      fn: (c: typeof conn) => Promise<number>
    ) => {
      await fn(conn);
      return fn(conn);
    }) as never);

    expect(await setDueDatesForUndatedReceivables(30)).toBe(1);
  });

  it('only targets rows that actually carry debt, and skips ones with no docDate', async () => {
    topQuery.mockResolvedValueOnce([[]]);
    expect(await setDueDatesForUndatedReceivables(30)).toBe(0);

    const text = sql(topQuery.mock.calls[0]);
    expect(text).toContain('dueDate IS NULL');
    expect(text).toContain('docDate IS NOT NULL');
    expect(text).toContain('cancelledAt IS NULL');
    expect(text).toContain('totalAmount > 0');
    // Nothing is written when there is nothing to write.
    expect(conn.query).not.toHaveBeenCalled();
  });
});

// ── THE BACKFILL ────────────────────────────────────────────────────────────
describe('backfillBillingDerivedColumns', () => {
  it('computes totals in TypeScript, from the blob — SQL cannot reproduce computeQuoteTotals', async () => {
    const blob = {
      docDate: '2026-08-10',
      customerCompany: 'บริษัท ก',
      customerPhone: '02-1',
      items: [{ qty: 2, unitPrice: 1000 }],
      vatEnabled: true,
    };
    topQuery.mockResolvedValueOnce([[{ id: 'a', data: JSON.stringify(blob), createdAt: '2026-08-11T00:00:00.000Z' }]]);
    conn.query.mockResolvedValue([{ affectedRows: 1 }]);

    const result = await backfillBillingDerivedColumns(200);

    expect(conn.query.mock.calls[0][1]).toEqual(['2026-08-10', 2140, 'บริษัท ก', '02-1', 'a']);
    expect(result).toEqual({ scanned: 1, updated: 1, done: true });
  });

  // ── The counter belongs INSIDE the transaction ────────────────────────────
  // `withTransaction` replays its callback on a transient connection loss. A
  // counter captured outside keeps the tally of the attempt that was rolled
  // back: a batch that wrote 2 rows, died, and then succeeded reported 4 rows
  // written. That number is shown to the owner AND feeds `updated === 0`,
  // which decides whether the queue is drained.
  //
  // This bites: move `let updated = 0` back outside `withTransaction` and the
  // count comes back 4.
  it('counts only the attempt that COMMITTED, even when the transaction is replayed', async () => {
    const rows = [
      { id: 'a', data: '{"docDate":"2026-08-10","items":[]}', createdAt: '2026-08-11T00:00:00.000Z' },
      { id: 'b', data: '{"docDate":"2026-08-11","items":[]}', createdAt: '2026-08-12T00:00:00.000Z' },
    ];
    topQuery.mockResolvedValueOnce([rows]);
    conn.query.mockResolvedValue([{ affectedRows: 1 }]);

    // One rolled-back attempt, then a clean one — exactly what the real
    // withTransaction does on PROTOCOL_CONNECTION_LOST. The first attempt's
    // return value is DISCARDED, as a rollback discards its writes.
    let attempts = 0;
    vi.mocked(withTransaction).mockImplementation((async (
      fn: (c: typeof conn) => Promise<unknown>
    ) => {
      attempts += 1;
      await fn(conn); // attempt 1: runs, then is rolled back
      return fn(conn); // attempt 2: the one that commits
    }) as never);

    const result = await backfillBillingDerivedColumns(200);

    expect(attempts).toBe(1);
    // TWO rows exist, so TWO is the only honest answer — never 4.
    expect(result.updated).toBe(2);
    expect(result.scanned).toBe(2);
  });

  it('does NOT invent a dueDate and does NOT touch paidAmount', async () => {
    topQuery.mockResolvedValueOnce([
      [{ id: 'a', data: '{"docDate":"2026-08-10","items":[]}', createdAt: '2026-08-11T00:00:00.000Z' }],
    ]);
    conn.query.mockResolvedValue([{ affectedRows: 1 }]);

    await backfillBillingDerivedColumns(200);

    const text = sql(conn.query.mock.calls[0]);
    expect(text).not.toContain('dueDate');
    expect(text).not.toContain('paidAmount');
  });

  it('selects ONLY rows still missing docDate, so re-running it is idempotent', async () => {
    topQuery.mockResolvedValueOnce([[]]);
    await backfillBillingDerivedColumns(200);
    expect(sql(topQuery.mock.calls[0])).toContain('WHERE docDate IS NULL');
  });

  it('falls back to createdAt only when the BLOB genuinely has no docDate', async () => {
    topQuery.mockResolvedValueOnce([
      [{ id: 'a', data: '{"items":[]}', createdAt: '2026-08-11T09:00:00.000Z' }],
    ]);
    conn.query.mockResolvedValue([{ affectedRows: 1 }]);

    await backfillBillingDerivedColumns(200);
    expect((conn.query.mock.calls[0][1] as unknown[])[0]).toBe('2026-08-11');
  });

  it('reports done when nothing is left, and cannot spin on blobs it can never write', async () => {
    topQuery.mockResolvedValueOnce([[]]);
    expect(await backfillBillingDerivedColumns(200)).toEqual({ scanned: 0, updated: 0, done: true });

    topQuery.mockResolvedValueOnce([
      [{ id: 'a', data: '{"items":[]}', createdAt: 'not-a-date' }],
    ]);
    const stuck = await backfillBillingDerivedColumns(1);
    expect(stuck.updated).toBe(0);
    expect(stuck.done).toBe(true);
  });
});

describe('deriveBillingColumns', () => {
  it('parses a blob that mysql2 handed back as a STRING as well as one already parsed', async () => {
    const parsed = deriveBillingColumns({ docDate: '2026-08-10', items: [{ qty: 1, unitPrice: 100 }] });
    const asString = deriveBillingColumns('{"docDate":"2026-08-10","items":[{"qty":1,"unitPrice":100}]}');
    expect(parsed).toEqual(asString);
    expect(parsed.totalAmount).toBe(100);
  });

  it('survives an unparseable blob instead of throwing on the save path', () => {
    expect(deriveBillingColumns('not json')).toEqual({
      docDate: null,
      totalAmount: 0,
      customerName: '-',
      customerPhone: '',
    });
  });
});

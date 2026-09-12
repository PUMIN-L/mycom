// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const conn = { query: vi.fn() };
vi.mock('@/app/lib/db', () => ({
  query: vi.fn(),
  withTransaction: vi.fn(async (fn: (c: typeof conn) => Promise<unknown>) => fn(conn)),
}));

import { saveBillingDocumentAtomic, BillingDocNoConflictError } from '@/app/lib/billingStore';
import { computeQuoteTotals, round2 } from '@/app/lib/quotationTotals';

beforeEach(() => {
  vi.clearAllMocks();
  conn.query.mockReset();
});

const rec = {
  id: 'b1',
  docType: 'invoice' as const,
  docNo: 'INV20260101-01',
  linkedQuotationId: null,
  data: { a: 1 },
  paymentMethod: null,
  paymentDate: null,
  paymentRef: null,
  createdAt: '2026-01-01T00:00:00.000Z',
};

const dupEntryError = () => Object.assign(new Error('ER_DUP_ENTRY'), { code: 'ER_DUP_ENTRY' });

describe('saveBillingDocumentAtomic', () => {
  // Same reasoning as saveQuotationAtomic: claiming the shared used_docnos
  // ledger via INSERT (a real PRIMARY KEY constraint) instead of a
  // SELECT...FOR UPDATE pre-check, since TiDB doesn't gap-lock a row that
  // doesn't exist yet.
  it('reserves a FREE docNo via an atomic ledger INSERT, then upserts the document', async () => {
    conn.query
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // INSERT used_docnos succeeds
      .mockResolvedValueOnce([{ affectedRows: 1 }]); // INSERT billing_documents

    await saveBillingDocumentAtomic(rec as any);

    expect(conn.query).toHaveBeenCalledTimes(2);
    expect(conn.query.mock.calls[0][0]).toContain('INSERT INTO used_docnos');
    expect(conn.query.mock.calls[0][1]).toEqual([rec.docNo, rec.id, rec.createdAt]);
    expect(conn.query.mock.calls[1][0]).toContain('INSERT INTO billing_documents');
  });

  it('allows re-saving the SAME document that already owns the docNo', async () => {
    conn.query
      .mockResolvedValueOnce(Promise.reject(dupEntryError()))
      .mockResolvedValueOnce([[{ quotationId: 'b1' }]]) // fallback lock+check: same owner
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // refresh ledger createdAt
      .mockResolvedValueOnce([{ affectedRows: 1 }]); // INSERT billing_documents (upsert)

    await expect(saveBillingDocumentAtomic(rec as any)).resolves.toBeUndefined();
    expect(conn.query).toHaveBeenCalledTimes(4);
    expect(conn.query.mock.calls[1][0]).toContain('FOR UPDATE');
    expect(conn.query.mock.calls[3][0]).toContain('INSERT INTO billing_documents');
  });

  it('throws BillingDocNoConflictError and writes NOTHING to billing_documents when a DIFFERENT document owns the docNo', async () => {
    conn.query
      .mockResolvedValueOnce(Promise.reject(dupEntryError()))
      .mockResolvedValueOnce([[{ quotationId: 'other-doc' }]]);

    await expect(saveBillingDocumentAtomic(rec as any)).rejects.toBeInstanceOf(BillingDocNoConflictError);
    expect(conn.query).toHaveBeenCalledTimes(2);
    expect(conn.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO billing_documents'))).toBe(false);
  });

  it('propagates a non-duplicate-key error from the ledger insert instead of treating it as a conflict', async () => {
    conn.query.mockResolvedValueOnce(Promise.reject(new Error('connection reset')));
    await expect(saveBillingDocumentAtomic(rec as any)).rejects.toThrow('connection reset');
    expect(conn.query).toHaveBeenCalledTimes(1);
  });

  it('skips the ledger entirely when the document has no docNo', async () => {
    conn.query.mockResolvedValueOnce([{ affectedRows: 1 }]);
    await saveBillingDocumentAtomic({ ...rec, docNo: '' } as any);
    expect(conn.query).toHaveBeenCalledTimes(1);
    expect(conn.query.mock.calls[0][0]).toContain('INSERT INTO billing_documents');
  });
});

// ── The denormalised receivables columns (v37) ───────────────────────────────
//
// This function is the table's ONLY writer, and every write is a full upsert of
// `data`. The derived columns are therefore computed HERE, in the same statement
// that stores the blob, from the same computeQuoteTotals call — they cannot be
// written apart, so they cannot drift apart.

// A blob whose 7% VAT leaves float dust: 12,345.67 * 1.07 = 13209.8669 with a
// tail that grandTotal does NOT round away (only per-line discounts do).
const dustyData = {
  docDate: '2026-08-10',
  customerCompany: 'บริษัท ตัวอย่าง จำกัด',
  customerContact: 'คุณสมชาย',
  customerPhone: '02-123-4567',
  items: [{ qty: 1, unitPrice: 12345.67 }],
  vatEnabled: true,
};

const upsertCall = () =>
  conn.query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO billing_documents'))!;
const upsertParams = () => upsertCall()[1] as unknown[];
const upsertSql = () => String(upsertCall()[0]).replace(/\s+/g, ' ');

describe('saveBillingDocumentAtomic — derived receivables columns', () => {
  beforeEach(() => {
    conn.query.mockResolvedValue([{ affectedRows: 1 }]);
  });

  it('writes EXACTLY round2(computeQuoteTotals(data).grandTotal) — the printed number, to the satang', async () => {
    await saveBillingDocumentAtomic({ ...rec, data: dustyData, docNo: '' } as any);

    const expected = round2(computeQuoteTotals(dustyData).grandTotal);
    // The raw total really does carry float dust; the column must not.
    expect(computeQuoteTotals(dustyData).grandTotal).not.toBe(expected);
    expect(upsertParams()).toContain(expected);
  });

  it('denormalises docDate from the BLOB, never from createdAt', async () => {
    // createdAt is rewritten on EVERY save (the upsert does
    // createdAt = VALUES(createdAt)) and /billing POSTs before generating a PDF,
    // so ageing on it would un-age every invoice the owner merely looks at.
    await saveBillingDocumentAtomic({ ...rec, data: dustyData, docNo: '' } as any);
    expect(upsertParams()).toContain('2026-08-10');
    expect(upsertParams()).not.toContain(rec.createdAt.slice(0, 10));
  });

  it('refuses a malformed docDate rather than poisoning a lexically-compared column', async () => {
    await saveBillingDocumentAtomic({
      ...rec,
      docNo: '',
      data: { ...dustyData, docDate: '10/08/2026' },
    } as any);
    const params = upsertParams();
    expect(params).not.toContain('10/08/2026');
    // docDate is the 10th bound param (see the INSERT column list).
    expect(params[9]).toBeNull();
  });

  it('denormalises the customer with the SAME expression the saved list uses', async () => {
    await saveBillingDocumentAtomic({ ...rec, data: dustyData, docNo: '' } as any);
    expect(upsertParams()).toContain('บริษัท ตัวอย่าง จำกัด');
    expect(upsertParams()).toContain('02-123-4567');
  });

  it('falls back company -> contact -> "-" so a row is never anonymous', async () => {
    await saveBillingDocumentAtomic({
      ...rec,
      docNo: '',
      data: { items: [], customerContact: 'คุณสมชาย' },
    } as any);
    expect(upsertParams()).toContain('คุณสมชาย');

    conn.query.mockClear();
    await saveBillingDocumentAtomic({ ...rec, docNo: '', data: { items: [] } } as any);
    expect(upsertParams()).toContain('-');
  });

  it('stores a valid dueDate and NULLs a malformed one (NULL is never overdue)', async () => {
    await saveBillingDocumentAtomic({
      ...rec,
      docNo: '',
      data: dustyData,
      dueDate: '2026-09-09',
    } as any);
    expect(upsertParams()).toContain('2026-09-09');

    conn.query.mockClear();
    await saveBillingDocumentAtomic({
      ...rec,
      docNo: '',
      data: dustyData,
      dueDate: 'next friday',
    } as any);
    expect(upsertParams()).not.toContain('next friday');
  });

  it('NEVER writes paidAmount, receivableOverride, cancelledAt or supersededById', async () => {
    // Re-saving a document — which /billing does on every PDF download — must
    // not be able to wipe a payment total or un-cancel a cancelled invoice.
    await saveBillingDocumentAtomic({ ...rec, data: dustyData, docNo: '' } as any);
    const sql = upsertSql();
    expect(sql).not.toContain('paidAmount');
    expect(sql).not.toContain('receivableOverride');
    expect(sql).not.toContain('cancelledAt');
    expect(sql).not.toContain('supersededById = VALUES');
  });

  it('stamps supersededById on the row a new version REPLACES — or a corrected invoice is billed twice', async () => {
    // The supersede now also has to reach into billing_payments (a receipt's
    // clone would otherwise credit its invoice twice), so the lookup that does
    // it is scripted here: this document has no payment row of its own.
    conn.query.mockImplementation((sql: string) =>
      String(sql).includes('SELECT billingDocumentId')
        ? Promise.resolve([[]])
        : Promise.resolve([{ affectedRows: 1 }])
    );
    await saveBillingDocumentAtomic({
      ...rec,
      id: 'v2',
      docNo: '',
      data: dustyData,
      supersedesId: 'v1',
    } as any);

    const stamp = conn.query.mock.calls.find(([sql]) =>
      String(sql).includes('SET supersededById = ?')
    )!;
    expect(stamp[1]).toEqual(['v2', 'v1']);
  });

  it('refuses to let a document supersede ITSELF (a mis-sent id would erase it from the ledger)', async () => {
    await saveBillingDocumentAtomic({
      ...rec,
      id: 'same',
      docNo: '',
      data: dustyData,
      supersedesId: 'same',
    } as any);
    expect(
      conn.query.mock.calls.some(([sql]) => String(sql).includes('SET supersededById = ?'))
    ).toBe(false);
  });

  it('creates NO payment row for an invoice, however its payment columns are filled', async () => {
    // Those three columns are written on EVERY save of EVERY doc type, for a
    // payment that never happened. They are display data, never evidence.
    await saveBillingDocumentAtomic({
      ...rec,
      docType: 'invoice',
      docNo: '',
      data: dustyData,
      paymentMethod: 'โอนเงิน',
      paymentDate: '2026-09-06',
    } as any);
    expect(
      conn.query.mock.calls.some(([sql]) => String(sql).includes('billing_payments'))
    ).toBe(false);
  });

  it('records the payment in the SAME transaction when a RECEIPT names the invoice it settles', async () => {
    conn.query.mockImplementation((sql: string) =>
      String(sql).includes('SELECT billingDocumentId')
        ? Promise.resolve([[]])
        : String(sql).includes('COALESCE(SUM(amount)')
          ? Promise.resolve([[{ paid: '13209.87' }]])
          : Promise.resolve([{ affectedRows: 1 }])
    );

    await saveBillingDocumentAtomic({
      ...rec,
      id: 'rc-1',
      docType: 'receipt',
      docNo: '',
      data: dustyData,
      settlesDocId: 'inv-1',
      paymentMethod: 'โอนเงิน',
      paymentDate: '2026-09-06',
      paymentRef: 'TRF-9',
    } as any);

    const insert = conn.query.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO billing_payments')
    )!;
    const params = insert[1] as unknown[];
    expect(params[0]).toBe('rc-1'); // payment id == receipt id => idempotent
    expect(params[1]).toBe('inv-1');
    expect(params[2]).toBe(round2(computeQuoteTotals(dustyData).grandTotal));
    expect(params[3]).toBe('2026-09-06');
    // And the cache is refreshed in the same transaction.
    expect(
      conn.query.mock.calls.some(([sql]) => String(sql).includes('SET paidAmount = ?'))
    ).toBe(true);
  });

  // /billing re-saves a document on EVERY PDF download, and the save never
  // writes cancelledAt — so a cancelled receipt comes back through this path
  // unchanged. Without reading the flag back, the upsert's `voidedAt = NULL`
  // silently re-credited the invoice from a receipt the admin had withdrawn.
  it('a CANCELLED receipt re-saved does not re-credit the invoice — it voids instead', async () => {
    conn.query.mockImplementation((sql: string) => {
      const s = String(sql);
      if (s.includes('SELECT cancelledAt')) {
        return Promise.resolve([[{ cancelledAt: '2026-09-06T00:00:00.000Z' }]]);
      }
      if (s.includes('SELECT billingDocumentId')) {
        return Promise.resolve([[{ billingDocumentId: 'inv-1', voidedAt: null }]]);
      }
      if (s.includes('COALESCE(SUM(amount)')) return Promise.resolve([[{ paid: '0.00' }]]);
      return Promise.resolve([{ affectedRows: 1 }]);
    });

    await saveBillingDocumentAtomic({
      ...rec,
      id: 'rc-1',
      docType: 'receipt',
      docNo: '',
      data: dustyData,
      settlesDocId: 'inv-1',
    } as any);

    expect(
      conn.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO billing_payments'))
    ).toBe(false);
    const voided = conn.query.mock.calls.find(([sql]) =>
      /UPDATE billing_payments SET voidedAt = \?/.test(String(sql))
    )!;
    expect((voided[1] as unknown[])[1]).toBe('ยกเลิกใบเสร็จรับเงิน');
    const resum = conn.query.mock.calls.find(([sql]) => /SET paidAmount = \?/.test(String(sql)))!;
    expect(resum[1]).toEqual([0, 'inv-1']);
  });

  it('a receipt that names ITSELF settles nothing — no payment against a document with no debt', async () => {
    conn.query.mockImplementation((sql: string) =>
      String(sql).includes('SELECT billingDocumentId')
        ? Promise.resolve([[]])
        : Promise.resolve([{ affectedRows: 1 }])
    );
    await saveBillingDocumentAtomic({
      ...rec,
      id: 'rc-self',
      docType: 'receipt',
      docNo: '',
      data: dustyData,
      settlesDocId: 'rc-self',
    } as any);
    expect(
      conn.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO billing_payments'))
    ).toBe(false);
    // The settlesDocId column (last in the INSERT list) is stored NULL.
    const params = upsertParams() as unknown[];
    expect(params[params.length - 1]).toBe(null);
  });

  it('does not carry settlesDocId onto a non-receipt, even if one is sent', async () => {
    await saveBillingDocumentAtomic({
      ...rec,
      docType: 'invoice',
      docNo: '',
      data: dustyData,
      settlesDocId: 'inv-other',
    } as any);
    expect(upsertParams()).not.toContain('inv-other');
  });
});

// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const conn = { query: vi.fn() };
vi.mock('@/app/lib/db', () => ({
  query: vi.fn(),
  withTransaction: vi.fn(async (fn: (c: typeof conn) => Promise<unknown>) => fn(conn)),
}));

import { saveBillingDocumentAtomic, BillingDocNoConflictError } from '@/app/lib/billingStore';

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

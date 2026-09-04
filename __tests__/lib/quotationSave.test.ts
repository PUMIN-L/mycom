// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

// A single transaction connection whose queries we script per test. withTransaction
// is mocked to invoke the callback with it (and propagate a thrown error like the
// real one, so a conflict rolls back).
const conn = { query: vi.fn() };
vi.mock('@/app/lib/db', () => ({
  query: vi.fn(),
  withTransaction: vi.fn(async (fn: (c: typeof conn) => Promise<unknown>) => fn(conn)),
}));
vi.mock('@/app/lib/cloudinaryHelper', () => ({ deleteCloudinaryImages: vi.fn() }));

import { saveQuotationAtomic, DocNoConflictError } from '@/app/lib/quotationStore';

beforeEach(() => {
  vi.clearAllMocks();
  conn.query.mockReset();
});

const rec = {
  id: 'q1',
  docNo: 'QT20260101-22',
  data: { a: 1 },
  uploadedImages: ['u1'],
  createdAt: '2026-01-01T00:00:00.000Z',
};

const dupEntryError = () => Object.assign(new Error('ER_DUP_ENTRY'), { code: 'ER_DUP_ENTRY' });

describe('saveQuotationAtomic', () => {
  // The ledger's docNo column is a real UNIQUE/PRIMARY KEY, so an INSERT is
  // the only thing the DB genuinely serializes — TiDB doesn't take a gap
  // lock via SELECT ... FOR UPDATE on a row that doesn't exist yet, so a
  // check-then-insert design lets two concurrent saves of the same brand-new
  // docNo both see "free" and both win. Claiming via INSERT first (and only
  // falling back to a lock+check on a duplicate-key error) closes that gap.
  it('reserves a FREE docNo via an atomic ledger INSERT, then upserts the quote', async () => {
    conn.query
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // INSERT used_docnos succeeds — docNo was free
      .mockResolvedValueOnce([{ affectedRows: 1 }]); // INSERT quotations

    await saveQuotationAtomic(rec as any);

    expect(conn.query).toHaveBeenCalledTimes(2);
    expect(conn.query.mock.calls[0][0]).toContain('INSERT INTO used_docnos');
    expect(conn.query.mock.calls[0][1]).toEqual([rec.docNo, rec.id, rec.createdAt]);
    expect(conn.query.mock.calls[1][0]).toContain('INSERT INTO quotations');
  });

  it('allows re-saving the SAME quotation that already owns the docNo (update, not a real conflict)', async () => {
    conn.query
      .mockResolvedValueOnce(Promise.reject(dupEntryError())) // ledger row already exists
      .mockResolvedValueOnce([[{ quotationId: 'q1' }]]) // fallback lock+check: same owner
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // refresh the ledger's createdAt
      .mockResolvedValueOnce([{ affectedRows: 1 }]); // INSERT quotations (upsert)

    await expect(saveQuotationAtomic(rec as any)).resolves.toBeUndefined();
    expect(conn.query).toHaveBeenCalledTimes(4);
    expect(conn.query.mock.calls[1][0]).toContain('FOR UPDATE');
    expect(conn.query.mock.calls[3][0]).toContain('INSERT INTO quotations');
  });

  it('throws DocNoConflictError and writes NOTHING to quotations when a DIFFERENT quote owns the docNo', async () => {
    conn.query
      .mockResolvedValueOnce(Promise.reject(dupEntryError()))
      .mockResolvedValueOnce([[{ quotationId: 'other-quote' }]]);

    await expect(saveQuotationAtomic(rec as any)).rejects.toBeInstanceOf(DocNoConflictError);
    // The ledger insert attempt + the fallback lock ran — the quote upsert never did.
    expect(conn.query).toHaveBeenCalledTimes(2);
    expect(conn.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO quotations'))).toBe(false);
  });

  it('propagates a non-duplicate-key error from the ledger insert instead of treating it as a conflict', async () => {
    conn.query.mockResolvedValueOnce(Promise.reject(new Error('connection reset')));
    await expect(saveQuotationAtomic(rec as any)).rejects.toThrow('connection reset');
    expect(conn.query).toHaveBeenCalledTimes(1);
  });

  it('skips the ledger entirely when the quote has no docNo', async () => {
    conn.query.mockResolvedValueOnce([{ affectedRows: 1 }]); // INSERT quotations only
    await saveQuotationAtomic({ ...rec, docNo: '' } as any);
    expect(conn.query).toHaveBeenCalledTimes(1);
    expect(conn.query.mock.calls[0][0]).toContain('INSERT INTO quotations');
  });
});

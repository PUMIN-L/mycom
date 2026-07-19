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

describe('saveQuotationAtomic', () => {
  it('reserves a FREE docNo: locks the ledger, upserts the quote, then the reservation', async () => {
    conn.query
      .mockResolvedValueOnce([[]]) // SELECT ... FOR UPDATE → free
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // INSERT quotations
      .mockResolvedValueOnce([{ affectedRows: 1 }]); // INSERT used_docnos

    await saveQuotationAtomic(rec as any);

    expect(conn.query).toHaveBeenCalledTimes(3);
    expect(conn.query.mock.calls[0][0]).toContain('FOR UPDATE');
    expect(conn.query.mock.calls[1][0]).toContain('INSERT INTO quotations');
    expect(conn.query.mock.calls[2][0]).toContain('INSERT INTO used_docnos');
    // The reservation is attributed to THIS quote.
    expect(conn.query.mock.calls[2][1]).toEqual([rec.docNo, rec.id, rec.createdAt]);
  });

  it('allows re-saving the SAME quotation that already owns the docNo (update, not dup)', async () => {
    conn.query
      .mockResolvedValueOnce([[{ quotationId: 'q1' }]]) // owned by the same id
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);
    await expect(saveQuotationAtomic(rec as any)).resolves.toBeUndefined();
    expect(conn.query).toHaveBeenCalledTimes(3);
  });

  it('throws DocNoConflictError and writes NOTHING when a DIFFERENT quote owns the docNo', async () => {
    conn.query.mockResolvedValueOnce([[{ quotationId: 'other-quote' }]]);
    await expect(saveQuotationAtomic(rec as any)).rejects.toBeInstanceOf(DocNoConflictError);
    // Only the lock SELECT ran — the quote + reservation upserts never happened.
    expect(conn.query).toHaveBeenCalledTimes(1);
  });

  it('skips the ledger entirely when the quote has no docNo', async () => {
    conn.query.mockResolvedValueOnce([{ affectedRows: 1 }]); // INSERT quotations only
    await saveQuotationAtomic({ ...rec, docNo: '' } as any);
    expect(conn.query).toHaveBeenCalledTimes(1);
    expect(conn.query.mock.calls[0][0]).toContain('INSERT INTO quotations');
  });
});

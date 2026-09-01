// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET as docnosGET } from '@/app/api/billing/docnos/route';

// The billing docNo ledger reuses quotationStore.listRecentDocNos (shared
// used_docnos table — see app/api/billing/docnos/route.ts).
vi.mock('@/app/lib/quotationStore', () => ({ listRecentDocNos: vi.fn() }));
import { listRecentDocNos } from '@/app/lib/quotationStore';

vi.mock('@/app/lib/session', () => ({ getSession: vi.fn() }));
import { getSession } from '@/app/lib/session';

const adminSession = { userId: '1', username: 'admin', expiresAt: new Date() } as any;

beforeEach(() => vi.clearAllMocks());

describe('GET /api/billing/docnos (reserved-number ledger)', () => {
  it('rejects anonymous callers with 401', async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    const res = await docnosGET();
    expect(res.status).toBe(401);
    expect(listRecentDocNos).not.toHaveBeenCalled();
  });

  it('returns the ledger to a logged-in admin — including numbers whose document was deleted', async () => {
    vi.mocked(getSession).mockResolvedValue(adminSession);
    // The whole point of this endpoint: a billing document can be deleted while
    // its docNo stays reserved in the ledger, so the suggester never re-offers it.
    const ledger = [{ docNo: 'INV260101-01', quotationId: 'deleted-doc-id' }];
    vi.mocked(listRecentDocNos).mockResolvedValue(ledger as any);
    const res = await docnosGET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(ledger);
  });
});

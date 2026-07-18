// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, DELETE } from '@/app/api/quotations/[id]/route';

// Store layer mocked — no DB / Cloudinary.
vi.mock('@/app/lib/quotationStore', () => ({
  getQuotation: vi.fn(),
  deleteQuotation: vi.fn(),
}));
import { getQuotation, deleteQuotation } from '@/app/lib/quotationStore';

// Drive real requireAuth via getSession (null = anon).
vi.mock('@/app/lib/session', () => ({ getSession: vi.fn() }));
import { getSession } from '@/app/lib/session';

const adminSession = { userId: '1', username: 'admin', expiresAt: new Date() } as any;

// Next 16 dynamic-route params arrive as a Promise; pass them as the 2nd arg.
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

const getReq = () =>
  new NextRequest('http://localhost/api/quotations/q1', { method: 'GET' });

// DELETE is mutating → real withRoute same-origin guard needs matching origin+host.
const deleteReq = () =>
  new NextRequest('http://localhost/api/quotations/q1', {
    method: 'DELETE',
    headers: { origin: 'http://localhost', host: 'localhost' },
  });

describe('Quotation [id] API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSession).mockResolvedValue(null); // default: anonymous
  });

  describe('GET /api/quotations/[id]', () => {
    it('rejects anonymous callers with 401', async () => {
      const res = await GET(getReq(), ctx('q1'));
      expect(res.status).toBe(401);
      expect(getQuotation).not.toHaveBeenCalled();
    });

    it('returns the quotation when found', async () => {
      vi.mocked(getSession).mockResolvedValue(adminSession);
      const rec = {
        id: 'q1',
        docNo: 'D-1',
        data: { foo: 'bar' },
        uploadedImages: [],
        createdAt: '2026-01-01',
      };
      vi.mocked(getQuotation).mockResolvedValue(rec as any);
      const res = await GET(getReq(), ctx('q1'));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(rec);
      expect(getQuotation).toHaveBeenCalledWith('q1');
    });

    it('returns 404 when the quotation is not found', async () => {
      vi.mocked(getSession).mockResolvedValue(adminSession);
      vi.mocked(getQuotation).mockResolvedValue(null);
      const res = await GET(getReq(), ctx('missing'));
      expect(res.status).toBe(404);
      expect((await res.json()).error).toBe('ไม่พบใบเสนอราคา');
    });
  });

  describe('DELETE /api/quotations/[id]', () => {
    it('rejects anonymous callers with 401, without deleting', async () => {
      const res = await DELETE(deleteReq(), ctx('q1'));
      expect(res.status).toBe(401);
      expect(deleteQuotation).not.toHaveBeenCalled();
    });

    it('returns 200 { success: true } when the quotation is deleted', async () => {
      vi.mocked(getSession).mockResolvedValue(adminSession);
      vi.mocked(deleteQuotation).mockResolvedValue(true);
      const res = await DELETE(deleteReq(), ctx('q1'));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ success: true });
      expect(deleteQuotation).toHaveBeenCalledWith('q1');
    });

    // NOTE: the route does NOT 404 on a missing id — deleteQuotation returns
    // false and the handler still responds 200 { success: false }. Documenting
    // ACTUAL behavior (see gap report; assignment expected 404).
    it('returns 200 { success: false } when the quotation did not exist', async () => {
      vi.mocked(getSession).mockResolvedValue(adminSession);
      vi.mocked(deleteQuotation).mockResolvedValue(false);
      const res = await DELETE(deleteReq(), ctx('missing'));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ success: false });
    });
  });
});

// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET as listGET, POST as savePOST } from '@/app/api/quotations/route';
import { GET as docnosGET } from '@/app/api/quotations/docnos/route';
import { GET as cleanupGET } from '@/app/api/quotations/cleanup/route';

// Quotation persistence layer — fully mocked so no DB/Cloudinary is touched.
// DocNoConflictError is a real class in the mock so the route's `instanceof`
// check (→ 409) works against the same reference.
vi.mock('@/app/lib/quotationStore', () => ({
  listQuotations: vi.fn(),
  saveQuotationAtomic: vi.fn(),
  DocNoConflictError: class DocNoConflictError extends Error {
    constructor(public docNo: string) {
      super(`docNo ${docNo} conflict`);
      this.name = 'DocNoConflictError';
    }
  },
  listRecentDocNos: vi.fn(),
  purgeExpiredQuotations: vi.fn(),
  purgeOldDocNos: vi.fn(),
}));
import {
  listQuotations,
  saveQuotationAtomic,
  DocNoConflictError,
  listRecentDocNos,
  purgeExpiredQuotations,
  purgeOldDocNos,
} from '@/app/lib/quotationStore';

// Drive the REAL requireAuth/withRoute by controlling getSession (null = anon).
vi.mock('@/app/lib/session', () => ({ getSession: vi.fn() }));
import { getSession } from '@/app/lib/session';

const adminSession = { userId: '1', username: 'admin', expiresAt: new Date() } as any;

// POST goes through the REAL withRoute same-origin guard → origin+host must match.
const postReq = (body: any) =>
  new NextRequest('http://localhost/api/quotations', {
    method: 'POST',
    headers: { origin: 'http://localhost', host: 'localhost' },
    body: JSON.stringify(body),
  });

describe('Quotations API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSession).mockResolvedValue(null); // default: anonymous
  });

  describe('GET /api/quotations (list)', () => {
    it('rejects anonymous callers with 401', async () => {
      const res = await listGET();
      expect(res.status).toBe(401);
      expect((await res.json()).error).toBe('Unauthorized');
      expect(listQuotations).not.toHaveBeenCalled();
    });

    it('returns the summary list to a logged-in admin', async () => {
      vi.mocked(getSession).mockResolvedValue(adminSession);
      const rows = [
        { id: 'q1', docNo: 'D-1', createdAt: '2026-01-01', customer: 'ACME', total: 100 },
      ];
      vi.mocked(listQuotations).mockResolvedValue(rows as any);
      const res = await listGET();
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(rows);
    });
  });

  describe('POST /api/quotations (save)', () => {
    it('rejects anonymous callers with 401, without saving', async () => {
      const res = await savePOST(postReq({ id: 'q1' }));
      expect(res.status).toBe(401);
      expect(saveQuotationAtomic).not.toHaveBeenCalled();
    });

    it('returns 400 when id is missing', async () => {
      vi.mocked(getSession).mockResolvedValue(adminSession);
      const res = await savePOST(postReq({ docNo: 'D-1' }));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe('id is required');
      expect(saveQuotationAtomic).not.toHaveBeenCalled();
    });

    it('returns 409 when the atomic save reports a docNo conflict', async () => {
      vi.mocked(getSession).mockResolvedValue(adminSession);
      vi.mocked(saveQuotationAtomic).mockRejectedValue(
        new (DocNoConflictError as any)('D-1')
      );
      const res = await savePOST(postReq({ id: 'q1', docNo: 'D-1' }));
      expect(res.status).toBe(409);
      expect((await res.json()).error).toBe(
        'เลขที่ใบเสนอราคานี้ถูกใช้ไปแล้ว กรุณาเปลี่ยนเลขที่'
      );
    });

    it('saves + reserves the docNo atomically on success', async () => {
      vi.mocked(getSession).mockResolvedValue(adminSession);
      vi.mocked(saveQuotationAtomic).mockResolvedValue(undefined);
      const res = await savePOST(postReq({ id: 'q1', docNo: 'D-1', data: { foo: 'bar' } }));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ id: 'q1' });

      expect(saveQuotationAtomic).toHaveBeenCalledTimes(1);
      const saved = vi.mocked(saveQuotationAtomic).mock.calls[0][0];
      expect(saved.id).toBe('q1');
      expect(saved.docNo).toBe('D-1');
      expect(saved.data).toEqual({ foo: 'bar' });
      expect(saved.uploadedImages).toEqual([]); // no valid Cloudinary URLs supplied
      expect(typeof saved.createdAt).toBe('string');
    });
  });

  describe('GET /api/quotations/docnos (reserved-number ledger)', () => {
    it('rejects anonymous callers with 401', async () => {
      const res = await docnosGET();
      expect(res.status).toBe(401);
      expect(listRecentDocNos).not.toHaveBeenCalled();
    });

    it('returns the ledger to a logged-in admin', async () => {
      vi.mocked(getSession).mockResolvedValue(adminSession);
      const ledger = [{ docNo: 'D-1', quotationId: 'q1' }];
      vi.mocked(listRecentDocNos).mockResolvedValue(ledger as any);
      const res = await docnosGET();
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(ledger);
    });
  });

  describe('GET /api/quotations/cleanup (cron)', () => {
    const cleanupReq = (authHeader?: string) =>
      new NextRequest('http://localhost/api/quotations/cleanup', {
        method: 'GET',
        headers: authHeader ? { authorization: authHeader } : {},
      });

    const ORIGINAL = process.env.CRON_SECRET;
    beforeEach(() => {
      process.env.CRON_SECRET = 'cron-test-secret';
    });
    afterEach(() => {
      if (ORIGINAL === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = ORIGINAL;
    });

    it('returns 401 when the Authorization header is missing', async () => {
      const res = await cleanupGET(cleanupReq());
      expect(res.status).toBe(401);
      expect(purgeExpiredQuotations).not.toHaveBeenCalled();
    });

    it('returns 401 when the Bearer secret is wrong', async () => {
      const res = await cleanupGET(cleanupReq('Bearer wrong-secret'));
      expect(res.status).toBe(401);
      expect(purgeExpiredQuotations).not.toHaveBeenCalled();
    });

    it('returns 401 when CRON_SECRET is not configured (fails closed)', async () => {
      delete process.env.CRON_SECRET;
      const res = await cleanupGET(cleanupReq('Bearer anything'));
      expect(res.status).toBe(401);
      expect(purgeExpiredQuotations).not.toHaveBeenCalled();
    });

    it('purges and returns counts when the Bearer secret matches', async () => {
      vi.mocked(purgeExpiredQuotations).mockResolvedValue(3);
      vi.mocked(purgeOldDocNos).mockResolvedValue(5);
      const res = await cleanupGET(cleanupReq('Bearer cron-test-secret'));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true, deleted: 3, docNosPurged: 5 });
      expect(purgeExpiredQuotations).toHaveBeenCalledWith(30);
      expect(purgeOldDocNos).toHaveBeenCalledWith(2);
    });
  });
});

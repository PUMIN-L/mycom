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
  listDocNosByBase: vi.fn(),
  purgeExpiredQuotations: vi.fn(),
  purgeOldDocNos: vi.fn(),
}));
import {
  listQuotations,
  saveQuotationAtomic,
  DocNoConflictError,
  listRecentDocNos,
  listDocNosByBase,
  purgeExpiredQuotations,
  purgeOldDocNos,
} from '@/app/lib/quotationStore';

// The nightly cron also purges expired alert snoozes. Mocked so no DB is
// touched; what it deletes is asserted in __tests__/lib/crmStore.test.ts.
vi.mock('@/app/lib/crmStore', () => ({ purgeExpiredAlertSnoozes: vi.fn() }));
import { purgeExpiredAlertSnoozes } from '@/app/lib/crmStore';

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

    it('passes ?search / ?limit through to the store (2-year retention needs SQL-side filtering)', async () => {
      vi.mocked(getSession).mockResolvedValue(adminSession);
      vi.mocked(listQuotations).mockResolvedValue([] as any);
      const res = await listGET(
        new NextRequest('http://localhost/api/quotations?search=ACME&limit=25')
      );
      expect(res.status).toBe(200);
      expect(listQuotations).toHaveBeenCalledWith({ search: 'ACME', limit: 25 });
    });

    it('sends no filter when neither param is given, keeping the previous full list', async () => {
      vi.mocked(getSession).mockResolvedValue(adminSession);
      vi.mocked(listQuotations).mockResolvedValue([] as any);
      await listGET(new NextRequest('http://localhost/api/quotations'));
      expect(listQuotations).toHaveBeenCalledWith({ search: undefined, limit: undefined });
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

    it('returns 400 and never saves when the line items compute a negative grand total', async () => {
      vi.mocked(getSession).mockResolvedValue(adminSession);
      const res = await savePOST(
        postReq({
          id: 'q1',
          docNo: 'D-1',
          data: { items: [{ qty: -5, unitPrice: 1000 }] },
        })
      );
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe(
        'ยอดรวมสุทธิต้องไม่ติดลบ กรุณาตรวจสอบรายการสินค้า'
      );
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

    // ?base= — what the version picker uses. The recent window is useless to
    // it: quotations are kept two years, so the document being cloned is
    // usually far older than 7 days and its v1 would be invisible.
    it('returns every number under ?base= instead of the recent window', async () => {
      vi.mocked(getSession).mockResolvedValue(adminSession);
      const versions = [
        { docNo: 'QT260719-23', quotationId: 'q1' },
        { docNo: 'QT260719-23v1', quotationId: 'q2' },
      ];
      vi.mocked(listDocNosByBase).mockResolvedValue(versions as any);
      const res = await docnosGET(
        new NextRequest('http://localhost/api/quotations/docnos?base=QT260719-23')
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(versions);
      expect(listDocNosByBase).toHaveBeenCalledWith('QT260719-23');
      expect(listRecentDocNos).not.toHaveBeenCalled();
    });

    it('falls back to the recent window for a blank ?base=', async () => {
      vi.mocked(getSession).mockResolvedValue(adminSession);
      vi.mocked(listRecentDocNos).mockResolvedValue([] as any);
      const res = await docnosGET(
        new NextRequest('http://localhost/api/quotations/docnos?base=%20%20')
      );
      expect(res.status).toBe(200);
      expect(listRecentDocNos).toHaveBeenCalled();
      expect(listDocNosByBase).not.toHaveBeenCalled();
    });

    // A day has TWO legitimate prefixes — the current DDMMYY shape and the
    // legacy YYMMDD one — and the MINT has to see both in one answer. Reading
    // only the first would leave the numbers issued under the other shape
    // invisible, which is the whole reason the mint stopped using the 7-day
    // window in the first place.
    it('merges every repeated ?base= into one de-duplicated answer', async () => {
      vi.mocked(getSession).mockResolvedValue(adminSession);
      vi.mocked(listDocNosByBase).mockImplementation(async (base) =>
        base === 'QT251026-'
          ? [{ docNo: 'QT251026-22', quotationId: 'q-2025' }]
          : [{ docNo: 'QT261025-40', quotationId: 'q-legacy' }]
      );
      const res = await docnosGET(
        new NextRequest(
          'http://localhost/api/quotations/docnos?base=QT251026-&base=QT261025-'
        )
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual([
        { docNo: 'QT251026-22', quotationId: 'q-2025' },
        { docNo: 'QT261025-40', quotationId: 'q-legacy' },
      ]);
      expect(listDocNosByBase).toHaveBeenCalledTimes(2);
      expect(listDocNosByBase).toHaveBeenCalledWith('QT251026-');
      expect(listDocNosByBase).toHaveBeenCalledWith('QT261025-');
      expect(listRecentDocNos).not.toHaveBeenCalled();
    });

    // On the dates where DDMMYY == YYMMDD (26 Sep 2026 → "260926" both ways)
    // the caller sends the same base twice.
    it('asks once, and returns one row, for a base repeated verbatim', async () => {
      vi.mocked(getSession).mockResolvedValue(adminSession);
      vi.mocked(listDocNosByBase).mockResolvedValue([
        { docNo: 'QT260926-22', quotationId: 'q1' },
      ]);
      const res = await docnosGET(
        new NextRequest(
          'http://localhost/api/quotations/docnos?base=QT260926-&base=QT260926-'
        )
      );
      expect(await res.json()).toEqual([{ docNo: 'QT260926-22', quotationId: 'q1' }]);
      expect(listDocNosByBase).toHaveBeenCalledTimes(1);
    });

    it('drops blank repeats instead of falling back to the recent window', async () => {
      vi.mocked(getSession).mockResolvedValue(adminSession);
      vi.mocked(listDocNosByBase).mockResolvedValue([]);
      const res = await docnosGET(
        new NextRequest('http://localhost/api/quotations/docnos?base=%20%20&base=QT251026-')
      );
      expect(res.status).toBe(200);
      expect(listDocNosByBase).toHaveBeenCalledTimes(1);
      expect(listDocNosByBase).toHaveBeenCalledWith('QT251026-');
      expect(listRecentDocNos).not.toHaveBeenCalled();
    });

    // ── The fan-out bound ────────────────────────────────────────────────
    // Every distinct base is its own LIKE scan and they all run at once, so an
    // unbounded `base` list turns one authenticated request into as many
    // concurrent non-indexable scans against the shared TiDB instance as the
    // caller cares to name. Two is all any real caller needs.
    it('refuses a base list longer than the bound instead of scanning for all of it', async () => {
      vi.mocked(getSession).mockResolvedValue(adminSession);
      const many = Array.from({ length: 200 }, (_, i) => `base=QT2510${i}-`).join('&');
      const res = await docnosGET(
        new NextRequest(`http://localhost/api/quotations/docnos?${many}`)
      );
      expect(res.status).toBe(400);
      // Thai, like every other message this admin UI shows.
      expect((await res.json()).error).toMatch(/ขอเลขที่ได้สูงสุด 4 ชุดต่อหนึ่งคำขอ/);
      // Not one scan issued — refused before the fan-out, not trimmed to four.
      expect(listDocNosByBase).not.toHaveBeenCalled();
      // And NOT quietly answered from the 7-day window either: an answer about
      // a different question is exactly what the mint must never receive.
      expect(listRecentDocNos).not.toHaveBeenCalled();
    });

    // Five is a refusal even when they would de-duplicate down to one: the
    // bound is on what the request asked for, and no caller of this app asks
    // about five bases.
    it('refuses five bases, and answers four', async () => {
      vi.mocked(getSession).mockResolvedValue(adminSession);
      vi.mocked(listDocNosByBase).mockResolvedValue([]);
      const url = (n: number) =>
        `http://localhost/api/quotations/docnos?${Array.from(
          { length: n },
          (_, i) => `base=QT26010${i}-`
        ).join('&')}`;

      const five = await docnosGET(new NextRequest(url(5)));
      expect(five.status).toBe(400);
      expect(listDocNosByBase).not.toHaveBeenCalled();

      const four = await docnosGET(new NextRequest(url(4)));
      expect(four.status).toBe(200);
      expect(listDocNosByBase).toHaveBeenCalledTimes(4);
    });

    it('still rejects anonymous callers when a base is supplied', async () => {
      const res = await docnosGET(
        new NextRequest('http://localhost/api/quotations/docnos?base=QT260719-23')
      );
      expect(res.status).toBe(401);
      expect(listDocNosByBase).not.toHaveBeenCalled();
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

    it('logs a distinct, greppable line when CRON_SECRET is unset (disabled cron)', async () => {
      delete process.env.CRON_SECRET;
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        await cleanupGET(cleanupReq('Bearer anything'));
        const line = spy.mock.calls.map((c) => String(c[0])).join('\n');
        expect(line).toContain('[cron:quotations-cleanup]');
        expect(line).toContain('DISABLED');
        expect(line).toContain('CRON_SECRET');
      } finally {
        spy.mockRestore();
      }
    });

    it('does not log the disabled line when the secret IS set but the caller is wrong', async () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        await cleanupGET(cleanupReq('Bearer wrong-secret'));
        expect(spy).not.toHaveBeenCalled();
      } finally {
        spy.mockRestore();
      }
    });

    it('gives an unauthorised caller the SAME body whether or not the secret is configured', async () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        const configured = await cleanupGET(cleanupReq('Bearer wrong-secret'));
        delete process.env.CRON_SECRET;
        const unconfigured = await cleanupGET(cleanupReq('Bearer wrong-secret'));
        // The "cron is switched off" signal belongs in the log only — a prober
        // must not be able to tell the two states apart from the response.
        expect(configured.status).toBe(401);
        expect(configured.status).toBe(unconfigured.status);
        expect(await configured.clone().json()).toEqual(
          await unconfigured.clone().json()
        );
        // Headers too, not just the body: a differing content-type or length
        // would be just as good an oracle as a differing message.
        const headersOf = (r: Response) =>
          [...r.headers.entries()].sort(([a], [b]) => a.localeCompare(b));
        expect(headersOf(configured)).toEqual(headersOf(unconfigured));
        // And byte-for-byte, so a whitespace or key-order difference cannot
        // sneak past the structural JSON comparison above.
        expect(await configured.text()).toBe(await unconfigured.text());
      } finally {
        spy.mockRestore();
      }
    });

    it('purges quotations but NEVER touches billing documents (invoices/receipts are permanent records)', async () => {
      vi.mocked(purgeExpiredQuotations).mockResolvedValue(3);
      vi.mocked(purgeExpiredAlertSnoozes).mockResolvedValue(2);
      const res = await cleanupGET(cleanupReq('Bearer cron-test-secret'));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        ok: true, deleted: 3, billingDeleted: 0, docNosPurged: 0, snoozesPurged: 2,
      });
      // Retention widened 30 -> 730 days (2 years): this business's sales cycle
      // runs for months, so the old window purged quotations right when the
      // customer decided to buy.
      expect(purgeExpiredQuotations).toHaveBeenCalledWith(730);
    });

    // ── Expired alert snoozes ──────────────────────────────────────────────
    it('purges expired alert snoozes in the same nightly run', async () => {
      vi.mocked(purgeExpiredQuotations).mockResolvedValue(0);
      vi.mocked(purgeExpiredAlertSnoozes).mockResolvedValue(7);
      const res = await cleanupGET(cleanupReq('Bearer cron-test-secret'));
      expect(res.status).toBe(200);
      expect((await res.json()).snoozesPurged).toBe(7);
      // No argument: the store defaults to today in Bangkok, and the boundary
      // rule lives with the SQL rather than being restated by every caller.
      expect(purgeExpiredAlertSnoozes).toHaveBeenCalledWith();
    });

    it('does not purge snoozes for an unauthorised caller', async () => {
      const res = await cleanupGET(cleanupReq('Bearer wrong-secret'));
      expect(res.status).toBe(401);
      expect(purgeExpiredAlertSnoozes).not.toHaveBeenCalled();
    });

    it('reports the snooze count on the greppable success line, in English like the rest', async () => {
      vi.mocked(purgeExpiredQuotations).mockResolvedValue(1);
      vi.mocked(purgeExpiredAlertSnoozes).mockResolvedValue(5);
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      try {
        await cleanupGET(cleanupReq('Bearer cron-test-secret'));
        const line = String(spy.mock.calls.at(-1)![0]);
        expect(line).toContain('[cron:quotations-cleanup] ok');
        expect(line).toContain('snoozesPurged=5');
      } finally {
        spy.mockRestore();
      }
    });

    it('fails the whole run when the snooze purge throws, instead of losing it silently', async () => {
      vi.mocked(purgeExpiredQuotations).mockResolvedValue(0);
      vi.mocked(purgeExpiredAlertSnoozes).mockRejectedValue(new Error('db down'));
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        const res = await cleanupGET(cleanupReq('Bearer cron-test-secret'));
        // 500 → Vercel marks the cron run FAILED.
        expect(res.status).toBe(500);
        expect(spy.mock.calls.some((c) => String(c[0]).includes('[cron:quotations-cleanup] FAILED'))).toBe(true);
      } finally {
        spy.mockRestore();
      }
    });
  });
});

// @vitest-environment node
//
// The two advisory lookups that connect a quotation to the sales it produced
// (`GET /api/quotations/[id]/sold`, `GET /api/admin/equipments/serial-check`),
// plus the quotation retention window the sale form depends on.
//
// The lookup routes run against the REAL stores over a mocked `query`, because
// what matters here is end-to-end behaviour — folding rows from several sales
// records into one per-line total, and normalizing serials the same way the
// equipment writer does — not that a route forwards a stubbed array.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/app/lib/db', () => ({ query: vi.fn(), withTransaction: vi.fn() }));
import { query } from '@/app/lib/db';

// Quotation persistence stays fully mocked: the retention test drives the real
// route against a fake store so nothing touches the DB or Cloudinary.
vi.mock('@/app/lib/quotationStore', () => ({
  purgeExpiredQuotations: vi.fn(),
  purgeOldDocNos: vi.fn(),
}));
import { purgeExpiredQuotations, purgeOldDocNos } from '@/app/lib/quotationStore';

vi.mock('@/app/lib/session', () => ({ getSession: vi.fn() }));
import { getSession } from '@/app/lib/session';

import { GET as soldGET } from '@/app/api/quotations/[id]/sold/route';
import { GET as serialCheckGET } from '@/app/api/admin/equipments/serial-check/route';
import { GET as cleanupGET } from '@/app/api/quotations/cleanup/route';

const admin = { userId: '1', username: 'admin', expiresAt: new Date() } as any;

const soldReq = (id: string) =>
  soldGET(new NextRequest(`http://localhost:3000/api/quotations/${id}/sold`), {
    params: Promise.resolve({ id }),
  });

const serialCheckReq = (queryString: string) =>
  serialCheckGET(
    new NextRequest(`http://localhost:3000/api/admin/equipments/serial-check${queryString}`)
  );

/** Rows shaped like the grouped SELECT in `getSoldQuotationItems`. */
const soldRows = (...rows: Array<[string, string, number]>) =>
  rows.map(([quotationItemId, salesRecordId, soldQty]) => ({
    quotationItemId,
    salesRecordId,
    soldQty,
  }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSession).mockResolvedValue(admin);
  vi.mocked(query).mockResolvedValue([[]] as any);
});

describe('GET /api/quotations/[id]/sold', () => {
  it('rejects anonymous callers with 401', async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    const res = await soldReq('quo-1');
    expect(res.status).toBe(401);
    expect(query).not.toHaveBeenCalled();
  });

  // A customer who takes the remaining machines a month later produces a
  // SECOND sale against the same quotation; the banner must show the combined
  // quantity per line, not the latest sale's.
  it('sums a quotation line across every sales record that referenced it', async () => {
    vi.mocked(query).mockResolvedValue([
      soldRows(['qi-1', 'sale-1', 2], ['qi-1', 'sale-2', 3], ['qi-2', 'sale-2', 1]),
    ] as any);

    const res = await soldReq('quo-1');
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.quotationId).toBe('quo-1');
    // X of "ขายไปแล้ว X/Y รายการ": distinct quotation LINES sold, not machines.
    expect(body.soldCount).toBe(2);
    expect(body.items).toEqual([
      { quotationItemId: 'qi-1', soldQty: 5, salesRecordIds: ['sale-1', 'sale-2'] },
      { quotationItemId: 'qi-2', soldQty: 1, salesRecordIds: ['sale-2'] },
    ]);
    expect(vi.mocked(query).mock.calls[0][1]).toEqual(['quo-1']);
  });

  it('does not repeat a sales record id when one sale covers a line twice', async () => {
    vi.mocked(query).mockResolvedValue([soldRows(['qi-1', 'sale-1', 1], ['qi-1', 'sale-1', 2])] as any);

    const body = await (await soldReq('quo-1')).json();
    expect(body.items).toEqual([
      { quotationItemId: 'qi-1', soldQty: 3, salesRecordIds: ['sale-1'] },
    ]);
  });

  // A quotation nobody has converted yet is the NORMAL case when the sale form
  // opens — an empty summary, never a 404 the form would have to special-case.
  it('returns 200 with an empty summary for a quotation that was never sold', async () => {
    const res = await soldReq('quo-never-sold');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      quotationId: 'quo-never-sold',
      soldCount: 0,
      items: [],
    });
  });

  // Advisory only (task 5.4 / D12): a broken lookup must degrade to "nothing
  // sold yet" rather than becoming an error that stalls the sale form.
  it('returns 200 with an empty summary when the lookup itself fails', async () => {
    vi.mocked(query).mockRejectedValue(new Error('table sales_record_items missing'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const res = await soldReq('quo-1');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ soldCount: 0, items: [] });

    warn.mockRestore();
  });
});

describe('GET /api/admin/equipments/serial-check', () => {
  const existing = {
    id: 'eq-1',
    serialNumber: 'SN-001',
    salesRecordId: 'sale-1',
    productName: 'Scale A',
    customerName: 'บริษัท ก จำกัด',
  };

  it('rejects anonymous callers with 401', async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    const res = await serialCheckReq('?serials=SN-001');
    expect(res.status).toBe(401);
    expect(query).not.toHaveBeenCalled();
  });

  // Matching must be identical to the equipment writer's own serial identity
  // (trim + case-insensitive), or the form would warn about a duplicate the
  // writer then fails to recognise — or, worse, stay silent about a real one.
  it('matches a serial regardless of surrounding spaces and letter case', async () => {
    vi.mocked(query).mockResolvedValue([[existing]] as any);

    const res = await serialCheckReq('?serials=%20%20sn-001%20%20');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ matches: [existing] });

    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(sql).toContain('LOWER(TRIM(e.serialNumber)) IN');
    expect(params).toEqual(['sn-001']);
  });

  it('accepts a comma list and repeated params, normalized and de-duplicated', async () => {
    vi.mocked(query).mockResolvedValue([[existing]] as any);

    const res = await serialCheckReq('?serials=%20SN-001%20,%20sn-001&serials=Sn-002');
    expect(res.status).toBe(200);

    const params = vi.mocked(query).mock.calls[0][1] as string[];
    // ' SN-001 ' and ' sn-001' are the SAME machine → one placeholder, not two.
    expect(params).toEqual(['sn-001', 'sn-002']);
    expect((vi.mocked(query).mock.calls[0][0] as string)).toContain('IN (?, ?)');
    expect((await res.json()).matches).toEqual([existing]);
  });

  it('returns an empty match list without querying when no serial is given', async () => {
    for (const qs of ['', '?serials=', '?serials=%20%20,%20']) {
      const res = await serialCheckReq(qs);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ matches: [] });
    }
    expect(query).not.toHaveBeenCalled();
  });

  // D13: duplicates are legal, so this endpoint only ever reports. A failed
  // lookup means "no duplicates found", never an error that blocks a save.
  it('returns 200 with no matches when the lookup fails', async () => {
    vi.mocked(query).mockRejectedValue(new Error('connection lost'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await serialCheckReq('?serials=SN-001');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ matches: [] });

    error.mockRestore();
  });
});

describe('GET /api/quotations/cleanup — 2-year retention (task 8.1)', () => {
  const DAY = 24 * 60 * 60 * 1000;
  const ageInDays = (days: number) => new Date(Date.now() - days * DAY).toISOString();

  let stored: Array<{ id: string; createdAt: string }>;

  beforeEach(() => {
    vi.stubEnv('CRON_SECRET', 'cron-secret');
    stored = [
      { id: 'quo-1y', createdAt: ageInDays(365) },
      { id: 'quo-2y-1d', createdAt: ageInDays(731) },
    ];
    // Stand-in for the real store: same cutoff arithmetic, in memory.
    vi.mocked(purgeExpiredQuotations).mockImplementation(async (days: number) => {
      const cutoff = Date.now() - days * DAY;
      const survivors = stored.filter((q) => new Date(q.createdAt).getTime() >= cutoff);
      const deleted = stored.length - survivors.length;
      stored = survivors;
      return deleted;
    });
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  const run = (authorization?: string) =>
    cleanupGET(
      new NextRequest('http://localhost:3000/api/quotations/cleanup', {
        headers: authorization ? { authorization } : {},
      })
    );

  it('keeps a 1-year-old quotation and purges one past 2 years', async () => {
    const res = await run('Bearer cron-secret');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, deleted: 1 });

    expect(purgeExpiredQuotations).toHaveBeenCalledWith(730);
    // The sale form's quotation picker still finds the 1-year-old quote — the
    // whole reason the window moved from 30 days to 2 years.
    expect(stored.map((q) => q.id)).toEqual(['quo-1y']);
  });

  it('leaves the docNo ledger retention untouched (task 8.2)', async () => {
    await run('Bearer cron-secret');
    // The ~2-day docNo window is deliberately unrelated to RETENTION_DAYS and
    // must never be swept along with it.
    expect(purgeOldDocNos).not.toHaveBeenCalledWith(730);
  });

  it('fails closed for a caller without the cron secret', async () => {
    expect((await run()).status).toBe(401);
    expect((await run('Bearer wrong')).status).toBe(401);
    expect(purgeExpiredQuotations).not.toHaveBeenCalled();
  });
});

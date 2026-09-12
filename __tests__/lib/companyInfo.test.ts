// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/app/lib/settingsStore', () => ({
  getCompanyProfile: vi.fn(),
  getContactEmail: vi.fn(),
  companyAddressQuery: (p: any) =>
    `${p.addressStreet}, ${p.addressLocality}, ${p.addressRegion} ${p.addressPostalCode}, ${p.addressCountry}`,
}));
import { getCompanyProfile, getContactEmail } from '@/app/lib/settingsStore';

// `unstable_cache` is stood in for by a REAL memoizer, not a pass-through. It
// has to be: the point of the fallback tests below is that a DB failure is
// never stored, and a pass-through stub cannot tell "outside the cache" from
// "inside" it. Only resolved values are memoized, exactly like the real thing.
const cacheStore = new Map<unknown, unknown>();
vi.mock('next/cache', () => ({
  unstable_cache: (fn: any) => async (...args: unknown[]) => {
    if (cacheStore.has(fn)) return cacheStore.get(fn);
    const value = await fn(...args);
    cacheStore.set(fn, value);
    return value;
  },
}));
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return { ...actual, cache: (fn: any) => fn };
});

import { getCompanyInfo } from '@/app/lib/companyInfo';
import { CONTACT_EMAIL } from '@/app/lib/contact';

const sampleProfile = {
  phone: '062-012-9895',
  addressDisplay: '93 ซอยงามวงศ์วาน 6 แยก 19',
  addressStreet: '93 Soi Ngamwongwan 6 Yaek 19',
  addressLocality: 'Mueang Nonthaburi',
  addressRegion: 'Nonthaburi',
  addressPostalCode: '11000',
  addressCountry: 'TH',
};

describe('getCompanyInfo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cacheStore.clear();
  });

  it('flattens the profile + contact email into the display shape', async () => {
    vi.mocked(getCompanyProfile).mockResolvedValue(sampleProfile as any);
    vi.mocked(getContactEmail).mockResolvedValue('sales@profinlab.co.th');

    const info = await getCompanyInfo();

    expect(info.email).toBe('sales@profinlab.co.th');
    expect(info.phone).toBe('062-012-9895');
    expect(info.address).toBe(sampleProfile.addressDisplay);
    expect(info.addressMapsQuery).toBe(
      '93 Soi Ngamwongwan 6 Yaek 19, Mueang Nonthaburi, Nonthaburi 11000, TH'
    );
    expect(info.profile).toEqual(sampleProfile);
  });
});

// ── The public site must not 500 because TiDB is asleep ────────────────────
// /about and /contact declare no dynamic/revalidate and previously rendered
// only client components, so an unreachable database turned a page that needs
// no data into a hard 500 — and failed `next build` while prerendering them.
// getProductsData.ts already degrades instead of throwing; this must too.

describe('getCompanyInfo when the database is unreachable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cacheStore.clear();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('returns a renderable shape instead of throwing', async () => {
    vi.mocked(getCompanyProfile).mockRejectedValue(new Error('ECONNREFUSED 10.0.0.1:4000'));
    vi.mocked(getContactEmail).mockRejectedValue(new Error('ECONNREFUSED 10.0.0.1:4000'));

    // The assertion that bites: the old version rejected here, and every
    // caller (/, /about, /contact, /catalog/*) awaited it unguarded.
    const info = await getCompanyInfo();

    expect(info.profile).toEqual({
      phone: '',
      addressDisplay: '',
      addressStreet: '',
      addressLocality: '',
      addressRegion: '',
      addressPostalCode: '',
      addressCountry: '',
    });
    expect(info.phone).toBe('');
    expect(info.address).toBe('');
  });

  it('never emits a half-built Maps query from the blank address', async () => {
    // companyAddressQuery() over empty fields would produce ", ,   , " and
    // point a Maps embed at nowhere. Blank is the honest answer.
    vi.mocked(getCompanyProfile).mockRejectedValue(new Error('db down'));
    vi.mocked(getContactEmail).mockRejectedValue(new Error('db down'));

    expect((await getCompanyInfo()).addressMapsQuery).toBe('');
  });

  it('still answers with the app-wide contact email, not an empty one', async () => {
    // CONTACT_EMAIL is the SAME value getContactEmail() falls back to when the
    // setting row does not exist — not a second hardcoded copy — so the public
    // contact details do not disappear entirely.
    vi.mocked(getCompanyProfile).mockRejectedValue(new Error('db down'));
    vi.mocked(getContactEmail).mockRejectedValue(new Error('db down'));

    expect((await getCompanyInfo()).email).toBe(CONTACT_EMAIL);
  });

  it('logs the failure rather than swallowing it silently', async () => {
    vi.mocked(getCompanyProfile).mockRejectedValue(new Error('db down'));
    vi.mocked(getContactEmail).mockRejectedValue(new Error('db down'));

    await getCompanyInfo();

    expect(console.error).toHaveBeenCalledWith(
      'Error fetching company info:',
      expect.any(Error)
    );
  });

  it('does not cache the fallback — the next request retries the database', async () => {
    // The try/catch sits OUTSIDE unstable_cache for this reason: one transient
    // blip must not pin an empty address on the public site until someone
    // happens to re-save the settings form.
    vi.mocked(getCompanyProfile).mockRejectedValueOnce(new Error('db down'));
    vi.mocked(getContactEmail).mockRejectedValueOnce(new Error('db down'));
    expect((await getCompanyInfo()).phone).toBe('');

    vi.mocked(getCompanyProfile).mockResolvedValue(sampleProfile as any);
    vi.mocked(getContactEmail).mockResolvedValue('sales@profinlab.co.th');
    expect((await getCompanyInfo()).phone).toBe('062-012-9895');
  });
});

// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/app/lib/settingsStore', () => ({
  getCompanyProfile: vi.fn(),
  getContactEmail: vi.fn(),
  companyAddressQuery: (p: any) =>
    `${p.addressStreet}, ${p.addressLocality}, ${p.addressRegion} ${p.addressPostalCode}, ${p.addressCountry}`,
}));
import { getCompanyProfile, getContactEmail } from '@/app/lib/settingsStore';

// Pass-through the caching wrappers, same pattern as getProductsData.test.ts —
// this test is about the composition logic, not Next's caching machinery.
vi.mock('next/cache', () => ({ unstable_cache: (fn: any) => fn }));
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return { ...actual, cache: (fn: any) => fn };
});

import { getCompanyInfo } from '@/app/lib/companyInfo';

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
  beforeEach(() => vi.clearAllMocks());

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

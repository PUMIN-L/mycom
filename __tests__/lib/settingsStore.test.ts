// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the DB layer. `query()` resolves to a tuple `[rows|result, fields]`.
vi.mock('@/app/lib/db', () => ({
  query: vi.fn(),
  withTransaction: vi.fn(),
  getDbConnection: vi.fn(),
}));
import { query } from '@/app/lib/db';

import {
  getSetting,
  setSetting,
  getContactEmail,
  getCompanyProfile,
  updateCompanyProfile,
  companyAddressQuery,
  toThaiE164,
  CONTACT_EMAIL_SETTING,
  getCreditTermDays,
  setCreditTermDays,
  BILLING_CREDIT_TERM_SETTING,
  MAX_CREDIT_TERM_DAYS,
  type CompanyProfile,
} from '@/app/lib/settingsStore';
import { DEFAULT_CREDIT_TERM_DAYS } from '@/app/lib/alertThresholds';
import { CONTACT_EMAIL } from '@/app/lib/contact';

describe('settingsStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('CONTACT_EMAIL_SETTING', () => {
    it('is the "contact_email" key', () => {
      expect(CONTACT_EMAIL_SETTING).toBe('contact_email');
    });
  });

  describe('getSetting', () => {
    it('returns the stored value when the row exists', async () => {
      vi.mocked(query).mockResolvedValue([[{ value: 'hello@x.com' }]] as any);

      const value = await getSetting('some_key');

      expect(value).toBe('hello@x.com');
      expect(vi.mocked(query).mock.calls[0][0]).toContain('SELECT value FROM settings');
      expect(vi.mocked(query).mock.calls[0][1]).toEqual(['some_key']);
    });

    it('coerces a non-string stored value to a string', async () => {
      vi.mocked(query).mockResolvedValue([[{ value: 123 }]] as any);
      expect(await getSetting('num')).toBe('123');
    });

    it('returns null when the setting is absent', async () => {
      vi.mocked(query).mockResolvedValue([[]] as any);
      expect(await getSetting('missing')).toBeNull();
    });
  });

  describe('setSetting', () => {
    it('upserts the name/value pair and resolves void', async () => {
      vi.mocked(query).mockResolvedValue([{ affectedRows: 1 }] as any);

      const result = await setSetting('contact_email', 'new@x.com');

      expect(result).toBeUndefined();
      expect(vi.mocked(query).mock.calls[0][0]).toContain(
        'ON DUPLICATE KEY UPDATE value = VALUES(value)'
      );
      expect(vi.mocked(query).mock.calls[0][1]).toEqual(['contact_email', 'new@x.com']);
    });
  });

  describe('getContactEmail', () => {
    it('returns the stored contact email when set', async () => {
      vi.mocked(query).mockResolvedValue([[{ value: 'custom@company.com' }]] as any);

      expect(await getContactEmail()).toBe('custom@company.com');
      // Reads the contact_email setting key.
      expect(vi.mocked(query).mock.calls[0][1]).toEqual([CONTACT_EMAIL_SETTING]);
    });

    it('falls back to the default constant when the setting is unset', async () => {
      vi.mocked(query).mockResolvedValue([[]] as any);
      expect(await getContactEmail()).toBe(CONTACT_EMAIL);
      expect(CONTACT_EMAIL).toBe('ampumin@gmail.com');
    });

    it('falls back to the default constant when the stored value is empty', async () => {
      vi.mocked(query).mockResolvedValue([[{ value: '' }]] as any);
      expect(await getContactEmail()).toBe(CONTACT_EMAIL);
    });
  });

  describe('getCompanyProfile', () => {
    it('falls back to the built-in defaults when no settings rows exist', async () => {
      vi.mocked(query).mockResolvedValue([[]] as any);
      const profile = await getCompanyProfile();
      expect(profile).toEqual({
        phone: '062-012-9895',
        addressDisplay:
          '93 ซอยงามวงศ์วาน 6 แยก 19 ถนนงามวงศ์วาน ตำบลบางเขน อำเภอเมืองนนทบุรี จ.นนทบุรี 11000',
        addressStreet: '93 Soi Ngamwongwan 6 Yaek 19, Ngamwongwan Rd., Bang Khen',
        addressLocality: 'Mueang Nonthaburi',
        addressRegion: 'Nonthaburi',
        addressPostalCode: '11000',
        addressCountry: 'TH',
      });
    });

    it('uses the stored value per-field when present, default otherwise', async () => {
      vi.mocked(query).mockImplementation(async (_sql: unknown, params?: unknown) => {
        const key = (params as string[])[0];
        if (key === 'company_phone') return [[{ value: '02-000-1111' }]] as any;
        return [[]] as any; // everything else: unset -> default
      });
      const profile = await getCompanyProfile();
      expect(profile.phone).toBe('02-000-1111');
      expect(profile.addressLocality).toBe('Mueang Nonthaburi'); // default
    });
  });

  describe('updateCompanyProfile', () => {
    it('writes only the provided fields, under their settings keys', async () => {
      vi.mocked(query).mockResolvedValue([{ affectedRows: 1 }] as any);
      await updateCompanyProfile({ phone: '099-999-9999', addressRegion: 'Bangkok' });

      const calls = vi.mocked(query).mock.calls;
      expect(calls).toHaveLength(2);
      const writtenKeys = calls.map((c) => (c[1] as string[])[0]);
      expect(writtenKeys.sort()).toEqual(['company_address_region', 'company_phone'].sort());
    });

    it('writes nothing when given an empty object', async () => {
      await updateCompanyProfile({});
      expect(query).not.toHaveBeenCalled();
    });
  });

  describe('companyAddressQuery', () => {
    it('composes a single-line address string from every structured field', () => {
      const profile: CompanyProfile = {
        phone: '062-012-9895',
        addressDisplay: 'ignored for the maps query',
        addressStreet: '93 Soi Ngamwongwan 6 Yaek 19, Ngamwongwan Rd., Bang Khen',
        addressLocality: 'Mueang Nonthaburi',
        addressRegion: 'Nonthaburi',
        addressPostalCode: '11000',
        addressCountry: 'TH',
      };
      expect(companyAddressQuery(profile)).toBe(
        '93 Soi Ngamwongwan 6 Yaek 19, Ngamwongwan Rd., Bang Khen, Mueang Nonthaburi, Nonthaburi 11000, TH'
      );
    });
  });

  describe('toThaiE164', () => {
    it('converts a Thai domestic display number to E.164', () => {
      expect(toThaiE164('062-012-9895')).toBe('+66620129895');
    });

    it('handles a number with no leading zero the same way', () => {
      expect(toThaiE164('620129895')).toBe('+66620129895');
    });

    it('strips spaces and parentheses too, not just dashes', () => {
      expect(toThaiE164('(02) 000 1111')).toBe('+6620001111');
    });

    it('passes through a number already in +66 international format unchanged', () => {
      expect(toThaiE164('+66-62-012-9895')).toBe('+66620129895');
    });

    it('does not double up the country code when 66 is typed without a plus', () => {
      expect(toThaiE164('66-62-012-9895')).toBe('+66620129895');
    });
  });
});

// ── เครดิตเทอมเริ่มต้น ──────────────────────────────────────────────────────
// A plain `settings` row, the repo's only global-setting mechanism — the same
// one contact_email, the company profile and schema_version itself all use.
describe('credit term setting', () => {
  const mockQuery = vi.mocked(query);
  beforeEach(() => vi.clearAllMocks());

  it('reads the stored value from the settings row', async () => {
    mockQuery.mockResolvedValueOnce([[{ value: '45' }], []] as never);
    expect(await getCreditTermDays()).toBe(45);
    expect(mockQuery.mock.calls[0][1]).toEqual([BILLING_CREDIT_TERM_SETTING]);
  });

  it('falls back to the shared constant when the row does not exist yet', async () => {
    // 100% of installs are in this state until someone visits /settings, so the
    // feature has to work without it.
    mockQuery.mockResolvedValueOnce([[], []] as never);
    expect(await getCreditTermDays()).toBe(DEFAULT_CREDIT_TERM_DAYS);
  });

  it('falls back rather than returning NaN for an unparseable stored value', async () => {
    mockQuery.mockResolvedValueOnce([[{ value: 'สามสิบ' }], []] as never);
    expect(await getCreditTermDays()).toBe(DEFAULT_CREDIT_TERM_DAYS);
  });

  it('clamps a stored value that is out of range in either direction', async () => {
    mockQuery.mockResolvedValueOnce([[{ value: '-10' }], []] as never);
    expect(await getCreditTermDays()).toBe(0);
    mockQuery.mockResolvedValueOnce([[{ value: '99999' }], []] as never);
    expect(await getCreditTermDays()).toBe(MAX_CREDIT_TERM_DAYS);
  });

  it('accepts 0 days (cash on delivery) rather than treating it as "unset"', async () => {
    mockQuery.mockResolvedValueOnce([[{ value: '0' }], []] as never);
    expect(await getCreditTermDays()).toBe(0);
  });

  it('writes the clamped value, so what is read back is exactly what was written', async () => {
    mockQuery.mockResolvedValue([{ affectedRows: 1 }, []] as never);
    expect(await setCreditTermDays(45)).toBe(45);
    expect(mockQuery.mock.calls[0][1]).toEqual([BILLING_CREDIT_TERM_SETTING, '45']);
    expect(await setCreditTermDays(9999)).toBe(MAX_CREDIT_TERM_DAYS);
    expect(await setCreditTermDays(-5)).toBe(0);
  });
});

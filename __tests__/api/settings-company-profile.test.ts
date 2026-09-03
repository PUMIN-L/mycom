// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, PUT } from '@/app/api/settings/company-profile/route';

const sampleProfile = {
  phone: '062-012-9895',
  addressDisplay: '93 ซอยงามวงศ์วาน 6 แยก 19',
  addressStreet: '93 Soi Ngamwongwan 6 Yaek 19',
  addressLocality: 'Mueang Nonthaburi',
  addressRegion: 'Nonthaburi',
  addressPostalCode: '11000',
  addressCountry: 'TH',
};

// Not mocking otpAttempts.ts — it's real code backed by the mocked
// settingsStore getSetting/setSetting below (same pattern as
// settings-contact-email.test.ts).
vi.mock('@/app/lib/settingsStore', () => ({
  getCompanyProfile: vi.fn(),
  updateCompanyProfile: vi.fn(),
  getSetting: vi.fn(),
  setSetting: vi.fn(),
}));
import { getCompanyProfile, updateCompanyProfile, getSetting, setSetting } from '@/app/lib/settingsStore';

vi.mock('@/app/lib/session', () => ({ getSession: vi.fn() }));
import { getSession } from '@/app/lib/session';

vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }));
import { revalidateTag } from 'next/cache';

const adminSession = { userId: '1', username: 'admin', expiresAt: new Date() } as any;

const putRequest = (body: any) =>
  new NextRequest('http://localhost/api/settings/company-profile', {
    method: 'PUT',
    headers: { origin: 'http://localhost', host: 'localhost' },
    body: JSON.stringify(body),
  });

// Wires getSetting/setSetting to a shared Map so recordOtpFailure/
// clearOtpAttempts (real code) observe writes made during the same test.
function mockSettingsState(initial: Record<string, string> = {}) {
  const state = new Map<string, string>(Object.entries(initial));
  vi.mocked(getSetting).mockImplementation(async (key: string) => state.get(key) ?? null);
  vi.mocked(setSetting).mockImplementation(async (key: string, value: string) => {
    state.set(key, value);
  });
  return state;
}

// otp/expiresAt/pending live in ONE settings row — seed it as the route
// itself would write it (see app/api/settings/company-profile/otp/route.ts).
function seedOtpState(
  state: Map<string, string>,
  { otp, expiresAt, pending }: { otp: string; expiresAt: number; pending: Record<string, string> }
) {
  state.set('company_profile_otp_state', JSON.stringify({ otp, expiresAt, pending }));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSession).mockResolvedValue(null); // default: anonymous
  vi.mocked(getCompanyProfile).mockResolvedValue(sampleProfile as any);
});

describe('GET /api/settings/company-profile', () => {
  it('rejects anonymous callers with 401', async () => {
    const res = await GET();
    expect(res.status).toBe(401);
    expect(getCompanyProfile).not.toHaveBeenCalled();
  });

  it('returns the full profile for a logged-in admin', async () => {
    vi.mocked(getSession).mockResolvedValue(adminSession);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(sampleProfile);
  });
});

describe('PUT /api/settings/company-profile', () => {
  it('rejects anonymous callers with 401 and does not persist', async () => {
    const res = await PUT(putRequest({ otp: '123456' }));
    expect(res.status).toBe(401);
    expect(updateCompanyProfile).not.toHaveBeenCalled();
  });

  it('rejects a malformed OTP with 400', async () => {
    vi.mocked(getSession).mockResolvedValue(adminSession);
    const res = await PUT(putRequest({ otp: '123' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('รหัส OTP ไม่ถูกต้อง');
    expect(updateCompanyProfile).not.toHaveBeenCalled();
  });

  it('rejects when there is no pending request (no OTP was ever sent)', async () => {
    vi.mocked(getSession).mockResolvedValue(adminSession);
    mockSettingsState({});
    const res = await PUT(putRequest({ otp: '123456' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('ไม่มีคำขอ');
    expect(updateCompanyProfile).not.toHaveBeenCalled();
  });

  it('rejects an expired OTP', async () => {
    vi.mocked(getSession).mockResolvedValue(adminSession);
    const state = mockSettingsState();
    seedOtpState(state, { otp: '123456', expiresAt: Date.now() - 1000, pending: { phone: '099-999-9999' } });
    const res = await PUT(putRequest({ otp: '123456' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('หมดอายุ');
    expect(updateCompanyProfile).not.toHaveBeenCalled();
  });

  it('rejects a corrupted (non-JSON) pending state instead of throwing', async () => {
    vi.mocked(getSession).mockResolvedValue(adminSession);
    const state = mockSettingsState();
    state.set('company_profile_otp_state', 'not-json');
    const res = await PUT(putRequest({ otp: '123456' }));
    expect(res.status).toBe(400);
    expect(updateCompanyProfile).not.toHaveBeenCalled();
  });

  it('locks out the OTP after 5 wrong attempts, even for the right code afterward', async () => {
    vi.mocked(getSession).mockResolvedValue(adminSession);
    const state = mockSettingsState();
    seedOtpState(state, { otp: '123456', expiresAt: Date.now() + 100000, pending: { phone: '099-999-9999' } });

    let lastRes;
    for (let i = 0; i < 5; i++) {
      lastRes = await PUT(putRequest({ otp: '000000' }));
    }
    expect(lastRes!.status).toBe(400);
    expect((await lastRes!.json()).error).toContain('เกินจำนวนที่กำหนด');

    const afterLockout = await PUT(putRequest({ otp: '123456' }));
    expect(afterLockout.status).toBe(400);
    expect(updateCompanyProfile).not.toHaveBeenCalled();
    // Lockout must wipe the real combined state, not just a throwaway key.
    expect(state.get('company_profile_otp_state')).toBe('');
  });

  it('applies the pending changes on a correct OTP, clears OTP state, and revalidates', async () => {
    vi.mocked(getSession).mockResolvedValue(adminSession);
    vi.mocked(updateCompanyProfile).mockResolvedValue(undefined);
    const state = mockSettingsState();
    seedOtpState(state, { otp: '123456', expiresAt: Date.now() + 100000, pending: { phone: '099-999-9999' } });

    const res = await PUT(putRequest({ otp: '123456' }));
    expect(res.status).toBe(200);
    expect(updateCompanyProfile).toHaveBeenCalledWith({ phone: '099-999-9999' });
    expect(await res.json()).toEqual(sampleProfile);

    expect(state.get('company_profile_otp_state')).toBe('');
    // Public pages read company info through a cache tagged "company-info" —
    // a change must actually bust it, or the public site shows stale data.
    expect(revalidateTag).toHaveBeenCalledWith('company-info', { expire: 0 });
  });

  it('ignores unrecognized keys in the stored pending JSON', async () => {
    vi.mocked(getSession).mockResolvedValue(adminSession);
    vi.mocked(updateCompanyProfile).mockResolvedValue(undefined);
    const state = mockSettingsState();
    seedOtpState(state, {
      otp: '123456',
      expiresAt: Date.now() + 100000,
      pending: { phone: '099-999-9999', evil: 'x' } as any,
    });

    await PUT(putRequest({ otp: '123456' }));
    expect(updateCompanyProfile).toHaveBeenCalledWith({ phone: '099-999-9999' });
  });

  it('a second OTP request fully supersedes the first (no torn read across old/new state)', async () => {
    vi.mocked(getSession).mockResolvedValue(adminSession);
    vi.mocked(updateCompanyProfile).mockResolvedValue(undefined);
    const state = mockSettingsState();
    seedOtpState(state, { otp: '111111', expiresAt: Date.now() + 100000, pending: { phone: '099-999-9999' } });
    // A second request (e.g. the admin edited the form again) supersedes it.
    seedOtpState(state, { otp: '222222', expiresAt: Date.now() + 100000, pending: { phone: '088-888-8888' } });

    // The old OTP must no longer work.
    const oldRes = await PUT(putRequest({ otp: '111111' }));
    expect(oldRes.status).toBe(400);
    expect(updateCompanyProfile).not.toHaveBeenCalled();

    // The new OTP applies the new pending data.
    const newRes = await PUT(putRequest({ otp: '222222' }));
    expect(newRes.status).toBe(200);
    expect(updateCompanyProfile).toHaveBeenCalledWith({ phone: '088-888-8888' });
  });
});

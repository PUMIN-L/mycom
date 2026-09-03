// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/settings/company-profile/otp/route';

const sampleProfile = {
  phone: '062-012-9895',
  addressDisplay: '93 ซอยงามวงศ์วาน 6 แยก 19',
  addressStreet: '93 Soi Ngamwongwan 6 Yaek 19',
  addressLocality: 'Mueang Nonthaburi',
  addressRegion: 'Nonthaburi',
  addressPostalCode: '11000',
  addressCountry: 'TH',
};

vi.mock('@/app/lib/settingsStore', () => ({
  getCompanyProfile: vi.fn(),
  getContactEmail: vi.fn(),
  setSetting: vi.fn(),
}));
import { getCompanyProfile, getContactEmail, setSetting } from '@/app/lib/settingsStore';

vi.mock('@/app/lib/mailer', () => ({
  isMailConfigured: vi.fn(),
  sendCompanyProfileOtpEmail: vi.fn(),
}));
import { isMailConfigured, sendCompanyProfileOtpEmail } from '@/app/lib/mailer';

vi.mock('@/app/lib/session', () => ({ getSession: vi.fn() }));
import { getSession } from '@/app/lib/session';

const adminSession = { userId: '1', username: 'admin', expiresAt: new Date() } as any;

const postRequest = (body: any) =>
  new NextRequest('http://localhost/api/settings/company-profile/otp', {
    method: 'POST',
    headers: { origin: 'http://localhost', host: 'localhost' },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSession).mockResolvedValue(null); // default: anonymous
  vi.mocked(isMailConfigured).mockReturnValue(true);
  vi.mocked(getCompanyProfile).mockResolvedValue(sampleProfile as any);
  vi.mocked(getContactEmail).mockResolvedValue('current@example.com');
});

describe('POST /api/settings/company-profile/otp', () => {
  it('rejects anonymous callers with 401 and sends nothing', async () => {
    const res = await POST(postRequest({ phone: '099-999-9999' }));
    expect(res.status).toBe(401);
    expect(sendCompanyProfileOtpEmail).not.toHaveBeenCalled();
  });

  it('returns 503 when SMTP is not configured', async () => {
    vi.mocked(getSession).mockResolvedValue(adminSession);
    vi.mocked(isMailConfigured).mockReturnValue(false);
    const res = await POST(postRequest({ phone: '099-999-9999' }));
    expect(res.status).toBe(503);
    expect(sendCompanyProfileOtpEmail).not.toHaveBeenCalled();
  });

  it('rejects a blank field with 400 and sends nothing', async () => {
    vi.mocked(getSession).mockResolvedValue(adminSession);
    const res = await POST(postRequest({ phone: '   ' }));
    expect(res.status).toBe(400);
    expect(sendCompanyProfileOtpEmail).not.toHaveBeenCalled();
    expect(setSetting).not.toHaveBeenCalledWith('company_profile_otp_state', expect.anything());
  });

  it('rejects a body with no recognized fields', async () => {
    vi.mocked(getSession).mockResolvedValue(adminSession);
    const res = await POST(postRequest({ unknownField: 'x' }));
    expect(res.status).toBe(400);
    expect(sendCompanyProfileOtpEmail).not.toHaveBeenCalled();
  });

  it('stores the OTP + expiry + pending change as one settings row and emails the current contact address', async () => {
    vi.mocked(getSession).mockResolvedValue(adminSession);
    const res = await POST(postRequest({ phone: '  099-999-9999  ' }));
    expect(res.status).toBe(200);

    const call = vi.mocked(setSetting).mock.calls.find(([key]) => key === 'company_profile_otp_state');
    expect(call).toBeDefined();
    const stored = JSON.parse(call![1]);
    expect(stored.otp).toMatch(/^\d{6}$/);
    expect(typeof stored.expiresAt).toBe('number');
    expect(stored.pending).toEqual({ phone: '099-999-9999' });

    expect(sendCompanyProfileOtpEmail).toHaveBeenCalledWith(
      'current@example.com',
      expect.stringMatching(/^\d{6}$/),
      expect.stringContaining('เบอร์โทรศัพท์')
    );
  });
});

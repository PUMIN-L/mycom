// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/settings/contact-email/otp/route';

vi.mock('@/app/lib/settingsStore', () => ({
  getContactEmail: vi.fn(),
  setSetting: vi.fn(),
}));
import { getContactEmail, setSetting } from '@/app/lib/settingsStore';

vi.mock('@/app/lib/mailer', () => ({
  isMailConfigured: vi.fn(),
  sendOtpEmail: vi.fn(),
}));
import { isMailConfigured, sendOtpEmail } from '@/app/lib/mailer';

vi.mock('@/app/lib/session', () => ({ getSession: vi.fn() }));
import { getSession } from '@/app/lib/session';

const adminSession = { userId: '1', username: 'admin', expiresAt: new Date() } as any;

const postRequest = (body: any) =>
  new NextRequest('http://localhost/api/settings/contact-email/otp', {
    method: 'POST',
    headers: { origin: 'http://localhost', host: 'localhost' },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSession).mockResolvedValue(null); // default: anonymous
  vi.mocked(isMailConfigured).mockReturnValue(true);
  vi.mocked(getContactEmail).mockResolvedValue('current@example.com');
});

describe('POST /api/settings/contact-email/otp', () => {
  it('rejects anonymous callers with 401 and sends nothing', async () => {
    const res = await POST(postRequest({ newEmail: 'new@example.com' }));
    expect(res.status).toBe(401);
    expect(sendOtpEmail).not.toHaveBeenCalled();
  });

  it('returns 503 when SMTP is not configured', async () => {
    vi.mocked(getSession).mockResolvedValue(adminSession);
    vi.mocked(isMailConfigured).mockReturnValue(false);
    const res = await POST(postRequest({ newEmail: 'new@example.com' }));
    expect(res.status).toBe(503);
    expect(sendOtpEmail).not.toHaveBeenCalled();
  });

  it('rejects a malformed email with 400 and sends nothing', async () => {
    vi.mocked(getSession).mockResolvedValue(adminSession);
    const res = await POST(postRequest({ newEmail: 'not-an-email' }));
    expect(res.status).toBe(400);
    expect(sendOtpEmail).not.toHaveBeenCalled();
    expect(setSetting).not.toHaveBeenCalled();
  });

  it('rejects a new email equal to the current one', async () => {
    vi.mocked(getSession).mockResolvedValue(adminSession);
    const res = await POST(postRequest({ newEmail: 'current@example.com' }));
    expect(res.status).toBe(400);
    expect(sendOtpEmail).not.toHaveBeenCalled();
  });

  it('stores the OTP + expiry + pending email as ONE settings row and emails the current address', async () => {
    vi.mocked(getSession).mockResolvedValue(adminSession);
    const res = await POST(postRequest({ newEmail: 'new@example.com' }));
    expect(res.status).toBe(200);

    const call = vi.mocked(setSetting).mock.calls.find(([key]) => key === 'contact_email_otp_state');
    expect(call).toBeDefined();
    const stored = JSON.parse(call![1]);
    expect(stored.otp).toMatch(/^\d{6}$/);
    expect(typeof stored.expiresAt).toBe('number');
    expect(stored.pendingEmail).toBe('new@example.com');

    // Only the combined row is written — never the old separate keys.
    expect(setSetting).not.toHaveBeenCalledWith('contact_email_otp', expect.anything());
    expect(setSetting).not.toHaveBeenCalledWith('contact_email_otp_expires', expect.anything());
    expect(setSetting).not.toHaveBeenCalledWith('contact_email_pending', expect.anything());

    expect(sendOtpEmail).toHaveBeenCalledWith(
      'current@example.com',
      expect.stringMatching(/^\d{6}$/),
      'new@example.com'
    );
  });
});

// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, PUT } from '@/app/api/settings/contact-email/route';

// Settings store — the route reads/writes the contact-email setting through this.
vi.mock('@/app/lib/settingsStore', () => ({
  getContactEmail: vi.fn(),
  setSetting: vi.fn(),
  getSetting: vi.fn(),
  CONTACT_EMAIL_SETTING: 'contact_email',
}));
import { getContactEmail, setSetting, getSetting } from '@/app/lib/settingsStore';

// otpAttempts.ts's failure counter reads/writes through a locked db.ts
// transaction (see otpAttempts.ts) — shares state with the getSetting/
// setSetting mock above via the module-level `sharedState` used below.
let sharedState = new Map<string, string>();
const conn = {
  query: vi.fn(async (sql: string, params: unknown[] = []) => {
    if (sql.includes('SELECT value FROM settings')) {
      const [key] = params as [string];
      const v = sharedState.get(key);
      return [v !== undefined ? [{ value: v }] : []];
    }
    if (sql.includes('INSERT INTO settings')) {
      const [key, value] = params as [string, string];
      sharedState.set(key, value);
      return [{ affectedRows: 1 }];
    }
    throw new Error(`Unhandled SQL in test: ${sql}`);
  }),
};
vi.mock('@/app/lib/db', () => ({
  withTransaction: vi.fn(async (fn: (c: typeof conn) => Promise<unknown>) => fn(conn)),
}));

// Mailer — the change-notification side effect.
vi.mock('@/app/lib/mailer', () => ({
  isMailConfigured: vi.fn(),
  sendContactRecipientChangedEmail: vi.fn(),
}));
import { isMailConfigured, sendContactRecipientChangedEmail } from '@/app/lib/mailer';

// Drive the REAL requireAuth by controlling getSession (null = anon).
vi.mock('@/app/lib/session', () => ({ getSession: vi.fn() }));
import { getSession } from '@/app/lib/session';

vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }));
import { revalidateTag } from 'next/cache';

const adminSession = { userId: '1', username: 'admin', expiresAt: new Date() } as any;

// State-changing PUT flows through the real same-origin (CSRF) guard, so
// requests carry a matching origin+host.
const putRequest = (body: any) =>
  new NextRequest('http://localhost/api/settings/contact-email', {
    method: 'PUT',
    headers: { origin: 'http://localhost', host: 'localhost' },
    body: JSON.stringify(body),
  });

// Wires getSetting/setSetting to sharedState so recordOtpFailure/
// clearOtpAttempts (real code) observe writes made during the same test.
function mockSettingsState(initial: Record<string, string> = {}) {
  sharedState = new Map<string, string>(Object.entries(initial));
  vi.mocked(getSetting).mockImplementation(async (key: string) => sharedState.get(key) ?? null);
  vi.mocked(setSetting).mockImplementation(async (key: string, value: string) => {
    sharedState.set(key, value);
  });
  return sharedState;
}

// otp/expiresAt/pendingEmail live in ONE settings row — seed it as the route
// itself would write it (see app/api/settings/contact-email/otp/route.ts).
function seedOtpState(
  state: Map<string, string>,
  { otp, expiresAt, pendingEmail }: { otp: string; expiresAt: number; pendingEmail: string }
) {
  state.set('contact_email_otp_state', JSON.stringify({ otp, expiresAt, pendingEmail }));
}

describe('Settings contact-email API Route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSession).mockResolvedValue(null); // default: anonymous
    vi.mocked(isMailConfigured).mockReturnValue(true);
  });

  describe('GET /api/settings/contact-email', () => {
    it('rejects anonymous callers with 401 (real requireAuth path)', async () => {
      vi.mocked(getSession).mockResolvedValue(null);
      const res = await GET();
      expect(res.status).toBe(401);
      expect((await res.json()).error).toBe('Unauthorized');
      expect(getContactEmail).not.toHaveBeenCalled();
    });

    it('returns the current contact email to a logged-in admin', async () => {
      vi.mocked(getSession).mockResolvedValue(adminSession);
      vi.mocked(getContactEmail).mockResolvedValue('current@example.com');
      const res = await GET();
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ email: 'c***t@example.com' });
    });
  });

  describe('PUT /api/settings/contact-email', () => {
    it('rejects anonymous callers with 401 and does not persist', async () => {
      vi.mocked(getSession).mockResolvedValue(null);
      const res = await PUT(putRequest({ email: 'new@example.com' }));
      expect(res.status).toBe(401);
      expect((await res.json()).error).toBe('Unauthorized');
      expect(setSetting).not.toHaveBeenCalled();
    });

    it('rejects an invalid email with 400 and does not persist', async () => {
      vi.mocked(getSession).mockResolvedValue(adminSession);
      const res = await PUT(putRequest({ email: 'not-an-email', otp: '123456' }));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe('รูปแบบอีเมลไม่ถูกต้อง');
      expect(setSetting).not.toHaveBeenCalled();
      expect(sendContactRecipientChangedEmail).not.toHaveBeenCalled();
    });

    it('rejects when there is no pending request (no OTP was ever sent)', async () => {
      vi.mocked(getSession).mockResolvedValue(adminSession);
      mockSettingsState({});
      const res = await PUT(putRequest({ email: 'new@example.com', otp: '123456' }));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toContain('ไม่มีคำขอ');
      expect(setSetting).not.toHaveBeenCalledWith('contact_email', expect.anything());
    });

    it('rejects an expired OTP', async () => {
      vi.mocked(getSession).mockResolvedValue(adminSession);
      const state = mockSettingsState();
      seedOtpState(state, { otp: '123456', expiresAt: Date.now() - 1000, pendingEmail: 'new@example.com' });
      const res = await PUT(putRequest({ email: 'new@example.com', otp: '123456' }));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toContain('หมดอายุ');
    });

    it('rejects a corrupted (non-JSON) pending state instead of throwing', async () => {
      vi.mocked(getSession).mockResolvedValue(adminSession);
      const state = mockSettingsState();
      state.set('contact_email_otp_state', 'not-json');
      const res = await PUT(putRequest({ email: 'new@example.com', otp: '123456' }));
      expect(res.status).toBe(400);
    });

    it('a second OTP request fully supersedes the first (no torn read across old/new state)', async () => {
      vi.mocked(getSession).mockResolvedValue(adminSession);
      vi.mocked(getContactEmail).mockResolvedValue('old@example.com');
      const state = mockSettingsState();
      seedOtpState(state, { otp: '111111', expiresAt: Date.now() + 100000, pendingEmail: 'a@example.com' });
      // A second request (e.g. the admin edited the field again) supersedes it.
      seedOtpState(state, { otp: '222222', expiresAt: Date.now() + 100000, pendingEmail: 'b@example.com' });

      // The old OTP must no longer work, even paired with its own pending email.
      const oldRes = await PUT(putRequest({ email: 'a@example.com', otp: '111111' }));
      expect(oldRes.status).toBe(400);
      expect(setSetting).not.toHaveBeenCalledWith('contact_email', 'a@example.com');

      // The new OTP applies the new pending email.
      const newRes = await PUT(putRequest({ email: 'b@example.com', otp: '222222' }));
      expect(newRes.status).toBe(200);
      expect(setSetting).toHaveBeenCalledWith('contact_email', 'b@example.com');
    });

    it('locks out the OTP after 5 wrong attempts, even for the right code afterward', async () => {
      vi.mocked(getSession).mockResolvedValue(adminSession);
      vi.mocked(getContactEmail).mockResolvedValue('old@example.com');
      const state = mockSettingsState();
      seedOtpState(state, { otp: '123456', expiresAt: Date.now() + 100000, pendingEmail: 'new@example.com' });

      let lastRes;
      for (let i = 0; i < 5; i++) {
        lastRes = await PUT(putRequest({ email: 'new@example.com', otp: '000000' }));
      }
      expect(lastRes!.status).toBe(400);
      expect((await lastRes!.json()).error).toContain('เกินจำนวนที่กำหนด');

      const afterLockout = await PUT(putRequest({ email: 'new@example.com', otp: '123456' }));
      expect(afterLockout.status).toBe(400);
      expect(setSetting).not.toHaveBeenCalledWith('contact_email', 'new@example.com');
      // Lockout must wipe the real combined state, not just a throwaway key.
      expect(state.get('contact_email_otp_state')).toBe('');
    });

    it('persists a valid change and notifies both old and new addresses', async () => {
      vi.mocked(getSession).mockResolvedValue(adminSession);
      vi.mocked(getContactEmail).mockResolvedValue('old@example.com');
      const state = mockSettingsState();
      seedOtpState(state, { otp: '123456', expiresAt: Date.now() + 100000, pendingEmail: 'new@example.com' });

      const res = await PUT(putRequest({ email: 'new@example.com', otp: '123456' }));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        email: 'n***w@example.com',
        changed: true,
        notified: true,
      });

      expect(setSetting).toHaveBeenCalledWith('contact_email', 'new@example.com');
      expect(sendContactRecipientChangedEmail).toHaveBeenCalledWith(
        ['old@example.com', 'new@example.com'],
        'old@example.com',
        'new@example.com'
      );
      // Public pages read this email through a cache tagged "company-info" —
      // a real change must actually bust it, or the site shows it stale.
      expect(revalidateTag).toHaveBeenCalledWith('company-info', { expire: 0 });
    });

    it('still saves (200) even if the notification email fails to send', async () => {
      vi.mocked(getSession).mockResolvedValue(adminSession);
      vi.mocked(getContactEmail).mockResolvedValue('old@example.com');
      vi.mocked(sendContactRecipientChangedEmail).mockRejectedValue(new Error('SMTP down'));
      const state = mockSettingsState();
      seedOtpState(state, { otp: '123456', expiresAt: Date.now() + 100000, pendingEmail: 'new@example.com' });

      const res = await PUT(putRequest({ email: 'new@example.com', otp: '123456' }));
      expect(res.status).toBe(200);
      // Save happened; notification is best-effort so `notified` is false.
      expect(await res.json()).toEqual({
        email: 'n***w@example.com',
        changed: true,
        notified: false,
      });
      expect(setSetting).toHaveBeenCalledWith('contact_email', 'new@example.com');
    });

    it('does not notify when the value is unchanged', async () => {
      vi.mocked(getSession).mockResolvedValue(adminSession);
      vi.mocked(getContactEmail).mockResolvedValue('same@example.com');
      const state = mockSettingsState();
      seedOtpState(state, { otp: '123456', expiresAt: Date.now() + 100000, pendingEmail: 'same@example.com' });

      const res = await PUT(putRequest({ email: 'same@example.com', otp: '123456' }));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        email: 's***e@example.com',
        changed: false,
        notified: false,
      });
      // Setting is still written, but no notification for a no-op change.
      expect(setSetting).toHaveBeenCalledWith('contact_email', 'same@example.com');
      expect(sendContactRecipientChangedEmail).not.toHaveBeenCalled();
    });
  });
});

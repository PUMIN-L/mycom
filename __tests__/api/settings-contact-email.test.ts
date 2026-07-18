// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, PUT } from '@/app/api/settings/contact-email/route';

// Settings store — the route reads/writes the contact-email setting through this.
vi.mock('@/app/lib/settingsStore', () => ({
  getContactEmail: vi.fn(),
  setSetting: vi.fn(),
  CONTACT_EMAIL_SETTING: 'contact_email',
}));
import { getContactEmail, setSetting } from '@/app/lib/settingsStore';

// Mailer — the change-notification side effect.
vi.mock('@/app/lib/mailer', () => ({
  isMailConfigured: vi.fn(),
  sendContactRecipientChangedEmail: vi.fn(),
}));
import { isMailConfigured, sendContactRecipientChangedEmail } from '@/app/lib/mailer';

// Drive the REAL requireAuth by controlling getSession (null = anon).
vi.mock('@/app/lib/session', () => ({ getSession: vi.fn() }));
import { getSession } from '@/app/lib/session';

const adminSession = { userId: '1', username: 'admin', expiresAt: new Date() } as any;

// State-changing PUT flows through the real same-origin (CSRF) guard, so
// requests carry a matching origin+host.
const putRequest = (body: any) =>
  new NextRequest('http://localhost/api/settings/contact-email', {
    method: 'PUT',
    headers: { origin: 'http://localhost', host: 'localhost' },
    body: JSON.stringify(body),
  });

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
      expect(await res.json()).toEqual({ email: 'current@example.com' });
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
      const res = await PUT(putRequest({ email: 'not-an-email' }));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe('รูปแบบอีเมลไม่ถูกต้อง');
      expect(setSetting).not.toHaveBeenCalled();
      expect(sendContactRecipientChangedEmail).not.toHaveBeenCalled();
    });

    it('persists a valid change and notifies both old and new addresses', async () => {
      vi.mocked(getSession).mockResolvedValue(adminSession);
      vi.mocked(getContactEmail).mockResolvedValue('old@example.com');

      const res = await PUT(putRequest({ email: 'new@example.com' }));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        email: 'new@example.com',
        changed: true,
        notified: true,
      });

      expect(setSetting).toHaveBeenCalledWith('contact_email', 'new@example.com');
      expect(sendContactRecipientChangedEmail).toHaveBeenCalledWith(
        ['old@example.com', 'new@example.com'],
        'old@example.com',
        'new@example.com'
      );
    });

    it('still saves (200) even if the notification email fails to send', async () => {
      vi.mocked(getSession).mockResolvedValue(adminSession);
      vi.mocked(getContactEmail).mockResolvedValue('old@example.com');
      vi.mocked(sendContactRecipientChangedEmail).mockRejectedValue(new Error('SMTP down'));

      const res = await PUT(putRequest({ email: 'new@example.com' }));
      expect(res.status).toBe(200);
      // Save happened; notification is best-effort so `notified` is false.
      expect(await res.json()).toEqual({
        email: 'new@example.com',
        changed: true,
        notified: false,
      });
      expect(setSetting).toHaveBeenCalledWith('contact_email', 'new@example.com');
    });

    it('does not notify when the value is unchanged', async () => {
      vi.mocked(getSession).mockResolvedValue(adminSession);
      vi.mocked(getContactEmail).mockResolvedValue('same@example.com');

      const res = await PUT(putRequest({ email: 'same@example.com' }));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        email: 'same@example.com',
        changed: false,
        notified: false,
      });
      // Setting is still written, but no notification for a no-op change.
      expect(setSetting).toHaveBeenCalledWith('contact_email', 'same@example.com');
      expect(sendContactRecipientChangedEmail).not.toHaveBeenCalled();
    });
  });
});

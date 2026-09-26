// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/contact/route';

// Mailer: mock both the "is it configured?" gate and the actual send so no SMTP
// socket is ever opened. Drive real withRoute (same-origin enforcement) around it.
vi.mock('@/app/lib/mailer', () => ({
  sendContactEmail: vi.fn(),
  isMailConfigured: vi.fn(),
}));
import { sendContactEmail, isMailConfigured } from '@/app/lib/mailer';

// Recipient is resolved from CMS settings; mock so no DB is touched.
vi.mock('@/app/lib/settingsStore', () => ({ getContactEmail: vi.fn() }));
import { getContactEmail } from '@/app/lib/settingsStore';

// The lead is persisted before the email send; mock the store so no DB is hit.
vi.mock('@/app/lib/contactMessageStore', () => ({
  saveContactMessage: vi.fn(),
  markContactMessageEmailed: vi.fn(),
  listContactMessages: vi.fn(),
  countContactMessagesSince: vi.fn(),
}));
import {
  saveContactMessage,
  markContactMessageEmailed,
  countContactMessagesSince,
} from '@/app/lib/contactMessageStore';
import { CONTACT_EMAIL_CAP_PER_HOUR, CONTACT_HONEYPOT_FIELD } from '@/app/lib/contactSpamGuard';

const valid = {
  name: 'John Visitor',
  email: 'john@example.com',
  phone: '0812345678',
  subject: 'Question about pricing',
  message: 'Hello, I would like a quote please.',
};

// POST goes through the REAL withRoute → same-origin check, so origin+host must
// match. Each success-path test uses a UNIQUE ip: the rate-limit map is
// module-level and survives between tests, so distinct ips prevent leakage.
const makeReq = (body: any, ip = '203.0.113.1', origin = 'http://localhost') =>
  new NextRequest('http://localhost/api/contact', {
    method: 'POST',
    headers: { origin, host: 'localhost', 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  });

describe('POST /api/contact (public contact form)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isMailConfigured).mockReturnValue(true);
    vi.mocked(getContactEmail).mockResolvedValue('admin@shop.test');
    vi.mocked(countContactMessagesSince).mockResolvedValue(1); // just this lead
  });

  it('refuses a cross-origin request with 403 (real withRoute CSRF guard)', async () => {
    const res = await POST(makeReq(valid, '203.0.113.99', 'http://evil.example'));
    expect(res.status).toBe(403);
    expect(sendContactEmail).not.toHaveBeenCalled();
  });

  // It used to answer 503 before saving anything, so every enquiry sent while
  // SMTP was unset was simply lost.
  it('still stores the lead when mail is not configured — it just is not emailed', async () => {
    vi.mocked(isMailConfigured).mockReturnValue(false);
    const res = await POST(makeReq(valid, '203.0.113.2'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, emailed: false });
    expect(saveContactMessage).toHaveBeenCalledTimes(1);
    expect(vi.mocked(saveContactMessage).mock.calls[0][0]).toMatchObject({ ...valid, emailedOk: false });
    expect(sendContactEmail).not.toHaveBeenCalled();
    expect(markContactMessageEmailed).not.toHaveBeenCalled();
  });

  it('answers a bot that filled the honeypot as if it worked — and stores and sends nothing', async () => {
    const res = await POST(makeReq({ ...valid, [CONTACT_HONEYPOT_FIELD]: 'http://spam.example' }, '203.0.113.20'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, emailed: false });
    expect(saveContactMessage).not.toHaveBeenCalled();
    expect(sendContactEmail).not.toHaveBeenCalled();
  });

  it('treats the empty honeypot the real form always sends as a normal submission', async () => {
    const res = await POST(makeReq({ ...valid, [CONTACT_HONEYPOT_FIELD]: '' }, '203.0.113.21'));
    expect(await res.json()).toEqual({ success: true, emailed: true });
    expect(saveContactMessage).toHaveBeenCalledTimes(1);
  });

  describe('the hourly email cap (counted in the DB, so across every instance)', () => {
    it('emails the lead that reaches the cap exactly', async () => {
      vi.mocked(countContactMessagesSince).mockResolvedValue(CONTACT_EMAIL_CAP_PER_HOUR);
      const res = await POST(makeReq(valid, '203.0.113.22'));
      expect(await res.json()).toEqual({ success: true, emailed: true });
      expect(sendContactEmail).toHaveBeenCalledTimes(1);
    });

    it('stores but does not email a lead past the cap', async () => {
      vi.mocked(countContactMessagesSince).mockResolvedValue(CONTACT_EMAIL_CAP_PER_HOUR + 1);
      const res = await POST(makeReq(valid, '203.0.113.23'));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ success: true, emailed: false });
      expect(saveContactMessage).toHaveBeenCalledTimes(1);
      expect(sendContactEmail).not.toHaveBeenCalled();
    });

    it('counts the hour before this request, after this lead was stored', async () => {
      const before = Date.now();
      await POST(makeReq(valid, '203.0.113.24'));
      const since = Date.parse(vi.mocked(countContactMessagesSince).mock.calls[0][0]);
      expect(before - since).toBeGreaterThanOrEqual(60 * 60 * 1000 - 1000);
      expect(before - since).toBeLessThanOrEqual(60 * 60 * 1000 + 1000);
      expect(vi.mocked(saveContactMessage).mock.invocationCallOrder[0]).toBeLessThan(
        vi.mocked(countContactMessagesSince).mock.invocationCallOrder[0]
      );
    });

    it('still emails the lead when the count itself fails', async () => {
      vi.mocked(countContactMessagesSince).mockRejectedValueOnce(new Error('DB blip'));
      const res = await POST(makeReq(valid, '203.0.113.25'));
      expect(await res.json()).toEqual({ success: true, emailed: true });
    });
  });

  // The lead is already stored by then: a 500 would tell the visitor it failed
  // and invite a second, duplicate submission.
  it('reports emailed:false, not a 500, when the recipient cannot be read', async () => {
    vi.mocked(getContactEmail).mockRejectedValueOnce(new Error('DB blip'));
    const res = await POST(makeReq(valid, '203.0.113.26'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, emailed: false });
    expect(saveContactMessage).toHaveBeenCalledTimes(1);
  });

  it('returns 400 when a required field is missing', async () => {
    const res = await POST(makeReq({ ...valid, message: '' }, '203.0.113.3'));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('กรุณากรอกข้อมูลให้ครบทุกช่อง');
    expect(sendContactEmail).not.toHaveBeenCalled();
  });

  it('returns 400 when a field exceeds its length cap', async () => {
    const res = await POST(
      makeReq({ ...valid, name: 'a'.repeat(201) }, '203.0.113.4')
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('ข้อความยาวเกินไป');
    expect(sendContactEmail).not.toHaveBeenCalled();
  });

  it('returns 400 when the email format is invalid', async () => {
    const res = await POST(makeReq({ ...valid, email: 'not-an-email' }, '203.0.113.5'));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('รูปแบบอีเมลไม่ถูกต้อง');
    expect(sendContactEmail).not.toHaveBeenCalled();
  });

  it('returns 400 when the phone format is invalid', async () => {
    const res = await POST(makeReq({ ...valid, phone: '081234abc' }, '203.0.113.55'));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_phone');
    expect(sendContactEmail).not.toHaveBeenCalled();
  });

  it('persists the lead, sends to the CMS-resolved recipient, and returns 200', async () => {
    const res = await POST(makeReq(valid, '203.0.113.6'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, emailed: true });
    // Lead is stored BEFORE the send, so a mail failure can't drop it.
    expect(saveContactMessage).toHaveBeenCalledTimes(1);
    const savedLead = vi.mocked(saveContactMessage).mock.calls[0][0];
    expect(savedLead).toMatchObject({ ...valid, emailedOk: false });
    expect(typeof savedLead.id).toBe('string');
    expect(getContactEmail).toHaveBeenCalledTimes(1);
    // Recipient is the resolved settings value, NOT anything from the request body.
    expect(sendContactEmail).toHaveBeenCalledWith('admin@shop.test', {
      name: valid.name,
      email: valid.email,
      phone: valid.phone,
      subject: valid.subject,
      message: valid.message,
    });
  });

  it('still returns 200 (lead captured) when the email send throws', async () => {
    vi.mocked(sendContactEmail).mockRejectedValueOnce(new Error('SMTP down'));
    const res = await POST(makeReq(valid, '203.0.113.7'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, emailed: false });
    // The lead was still saved despite the mail failure.
    expect(saveContactMessage).toHaveBeenCalledTimes(1);
    // The send failed, so the flag was never touched.
    expect(markContactMessageEmailed).not.toHaveBeenCalled();
  });

  it('still returns 200 emailed:true when the send succeeds but the flag UPDATE fails', async () => {
    // The email DID go out; a failed emailedOk update must not flip the response
    // or be misreported — the send-failure path is separate now.
    vi.mocked(markContactMessageEmailed).mockRejectedValueOnce(new Error('DB blip'));
    const res = await POST(makeReq(valid, '203.0.113.8'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, emailed: true });
    expect(sendContactEmail).toHaveBeenCalledTimes(1);
    expect(markContactMessageEmailed).toHaveBeenCalledWith(expect.any(String), true);
  });

  it('rate-limits an ip to 5 messages per window, then returns 429', async () => {
    const ip = '198.51.100.9';
    for (let i = 0; i < 5; i++) {
      const ok = await POST(makeReq(valid, ip));
      expect(ok.status).toBe(200);
    }
    const blocked = await POST(makeReq(valid, ip));
    expect(blocked.status).toBe(429);
    expect((await blocked.json()).error).toBe('ส่งข้อความบ่อยเกินไป กรุณารอสักครู่');
    // The 6th attempt is rejected before send: only 5 emails went out.
    expect(sendContactEmail).toHaveBeenCalledTimes(5);
  });
});

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

const valid = {
  name: 'John Visitor',
  email: 'john@example.com',
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
  });

  it('refuses a cross-origin request with 403 (real withRoute CSRF guard)', async () => {
    const res = await POST(makeReq(valid, '203.0.113.99', 'http://evil.example'));
    expect(res.status).toBe(403);
    expect(sendContactEmail).not.toHaveBeenCalled();
  });

  it('returns 503 when mail is not configured, without sending', async () => {
    vi.mocked(isMailConfigured).mockReturnValue(false);
    const res = await POST(makeReq(valid, '203.0.113.2'));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe(
      'ระบบส่งอีเมลยังไม่ถูกตั้งค่า กรุณาติดต่อผ่าน LINE'
    );
    expect(sendContactEmail).not.toHaveBeenCalled();
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

  it('sends to the CMS-resolved recipient and returns 200 on success', async () => {
    const res = await POST(makeReq(valid, '203.0.113.6'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(getContactEmail).toHaveBeenCalledTimes(1);
    // Recipient is the resolved settings value, NOT anything from the request body.
    expect(sendContactEmail).toHaveBeenCalledWith('admin@shop.test', {
      name: valid.name,
      email: valid.email,
      subject: valid.subject,
      message: valid.message,
    });
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

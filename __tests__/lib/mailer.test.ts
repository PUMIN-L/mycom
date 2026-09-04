// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the external `nodemailer` package (NOT the module under test).
// `vi.hoisted` lets the shared mocks be referenced from the hoisted factory so
// we can assert on the SAME sendMail/createTransport instances the SUT uses.
const { sendMailMock, createTransportMock } = vi.hoisted(() => {
  const sendMailMock = vi.fn();
  const createTransportMock = vi.fn(() => ({ sendMail: sendMailMock }));
  return { sendMailMock, createTransportMock };
});

vi.mock('nodemailer', () => ({
  default: { createTransport: createTransportMock },
}));

// mailer reads process.env at CALL time (isMailConfigured / createTransport both
// read inside the function body — verified in source), so a static import is
// safe; no vi.resetModules()/dynamic-import dance is needed.
import {
  isMailConfigured,
  sendContactEmail,
  sendContactRecipientChangedEmail,
  sendOtpEmail,
  sendCompanyProfileOtpEmail,
  sendOrphanDeleteOtpEmail,
  sendScheduleDeleteOtpEmail,
  type ContactMessage,
} from '@/app/lib/mailer';

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  sendMailMock.mockResolvedValue({ messageId: 'test-id' });
});

afterEach(() => {
  // Restore env after every test so per-test SMTP_* mutations don't leak.
  process.env = { ...ORIGINAL_ENV };
});

describe('mailer', () => {
  describe('isMailConfigured', () => {
    it('returns true when both SMTP_USER and SMTP_PASS are present', () => {
      process.env.SMTP_USER = 'me@example.com';
      process.env.SMTP_PASS = 'app-password';
      expect(isMailConfigured()).toBe(true);
    });

    it('returns false when SMTP_USER is missing', () => {
      delete process.env.SMTP_USER;
      process.env.SMTP_PASS = 'app-password';
      expect(isMailConfigured()).toBe(false);
    });

    it('returns false when SMTP_PASS is missing', () => {
      process.env.SMTP_USER = 'me@example.com';
      delete process.env.SMTP_PASS;
      expect(isMailConfigured()).toBe(false);
    });

    it('returns false when both are missing', () => {
      delete process.env.SMTP_USER;
      delete process.env.SMTP_PASS;
      expect(isMailConfigured()).toBe(false);
    });
  });

  describe('sendContactEmail', () => {
    const msg: ContactMessage = {
      name: 'สมชาย',
      phone: '0812345678',
      email: 'visitor@example.com',
      subject: 'สอบถามสินค้า',
      message: 'รายละเอียดข้อความจากผู้ใช้',
    };

    it('sends with a STRUCTURED from/replyTo (header-injection safe) and the message fields', async () => {
      process.env.SMTP_USER = 'system@example.com';

      await sendContactEmail('admin@site.com', msg);

      expect(createTransportMock).toHaveBeenCalledTimes(1);
      expect(sendMailMock).toHaveBeenCalledTimes(1);

      const mail = sendMailMock.mock.calls[0][0];

      // `from` must be a structured object, never a hand-built string — this is
      // the guard against a visitor-controlled display name injecting headers.
      expect(mail.from).toEqual({ name: 'สมชาย (เว็บไซต์)', address: 'system@example.com' });
      expect(typeof mail.from).toBe('object');

      // `replyTo` carries the visitor's address as a structured object too.
      expect(mail.replyTo).toEqual({ name: 'สมชาย', address: 'visitor@example.com' });

      expect(mail.to).toBe('admin@site.com');
      expect(mail.subject).toBe('[ติดต่อจากเว็บไซต์] สอบถามสินค้า');

      // Body contains every message field.
      expect(mail.text).toContain('สมชาย');
      expect(mail.text).toContain('visitor@example.com');
      expect(mail.text).toContain('สอบถามสินค้า');
      expect(mail.text).toContain('รายละเอียดข้อความจากผู้ใช้');
    });

    it('falls back to an empty from.address when SMTP_USER is unset', async () => {
      delete process.env.SMTP_USER;
      await sendContactEmail('admin@site.com', msg);
      expect(sendMailMock.mock.calls[0][0].from.address).toBe('');
    });

    it('propagates SMTP failures (throws)', async () => {
      process.env.SMTP_USER = 'system@example.com';
      sendMailMock.mockRejectedValueOnce(new Error('SMTP down'));
      await expect(sendContactEmail('admin@site.com', msg)).rejects.toThrow('SMTP down');
    });
  });

  describe('sendContactRecipientChangedEmail', () => {
    it('notifies BOTH the old and new recipients with a structured to[]', async () => {
      process.env.SMTP_USER = 'system@example.com';

      await sendContactRecipientChangedEmail(
        ['old@site.com', 'new@site.com'],
        'old@site.com',
        'new@site.com'
      );

      expect(sendMailMock).toHaveBeenCalledTimes(1);
      const mail = sendMailMock.mock.calls[0][0];

      expect(mail.from).toEqual({ name: 'ระบบเว็บไซต์ (Profin Lab Scale)', address: 'system@example.com' });
      expect(mail.to).toEqual([
        { name: '', address: 'old@site.com' },
        { name: '', address: 'new@site.com' },
      ]);
      expect(mail.subject).toContain('เปลี่ยนอีเมล');
      // Both addresses appear in the audit-trail body.
      expect(mail.text).toContain('old@site.com');
      expect(mail.text).toContain('new@site.com');
    });

    it('falls back to an empty from.address when SMTP_USER is unset', async () => {
      delete process.env.SMTP_USER;
      await sendContactRecipientChangedEmail(['old@site.com', 'new@site.com'], 'old@site.com', 'new@site.com');
      expect(sendMailMock.mock.calls[0][0].from.address).toBe('');
    });

    it('propagates SMTP failures (throws)', async () => {
      process.env.SMTP_USER = 'system@example.com';
      sendMailMock.mockRejectedValueOnce(new Error('SMTP down'));
      await expect(
        sendContactRecipientChangedEmail(['old@site.com', 'new@site.com'], 'old@site.com', 'new@site.com')
      ).rejects.toThrow('SMTP down');
    });
  });

  describe('sendOtpEmail', () => {
    it('sends a single-recipient OTP email with the new email in the body', async () => {
      process.env.SMTP_USER = 'system@example.com';
      await sendOtpEmail('current@site.com', '123456', 'new@site.com');

      expect(sendMailMock).toHaveBeenCalledTimes(1);
      const mail = sendMailMock.mock.calls[0][0];
      expect(mail.from).toEqual({ name: 'ระบบเว็บไซต์ (Profin Lab Scale)', address: 'system@example.com' });
      expect(mail.to).toEqual({ name: '', address: 'current@site.com' });
      expect(mail.subject).toContain('OTP');
      expect(mail.text).toContain('123456');
      expect(mail.text).toContain('new@site.com');
    });

    it('propagates SMTP failures (throws)', async () => {
      sendMailMock.mockRejectedValueOnce(new Error('SMTP down'));
      await expect(sendOtpEmail('a@site.com', '123456', 'b@site.com')).rejects.toThrow('SMTP down');
    });
  });

  describe('sendCompanyProfileOtpEmail', () => {
    it('sends a single-recipient OTP email with the changes summary in the body', async () => {
      process.env.SMTP_USER = 'system@example.com';
      await sendCompanyProfileOtpEmail('admin@site.com', '654321', 'เบอร์โทรศัพท์: "02-000-1111" -> "02-999-8888"');

      const mail = sendMailMock.mock.calls[0][0];
      expect(mail.from).toEqual({ name: 'ระบบเว็บไซต์ (Profin Lab Scale)', address: 'system@example.com' });
      expect(mail.to).toEqual({ name: '', address: 'admin@site.com' });
      expect(mail.subject).toContain('ข้อมูลบริษัท');
      expect(mail.text).toContain('654321');
      expect(mail.text).toContain('02-999-8888');
    });

    it('propagates SMTP failures (throws)', async () => {
      sendMailMock.mockRejectedValueOnce(new Error('SMTP down'));
      await expect(sendCompanyProfileOtpEmail('a@site.com', '654321', 'summary')).rejects.toThrow('SMTP down');
    });
  });

  describe('sendOrphanDeleteOtpEmail', () => {
    it('sends a single-recipient OTP email with the image count in the body', async () => {
      process.env.SMTP_USER = 'system@example.com';
      await sendOrphanDeleteOtpEmail('admin@site.com', '11111', 7);

      const mail = sendMailMock.mock.calls[0][0];
      expect(mail.from).toEqual({ name: 'ระบบเว็บไซต์ (Profin Lab Scale)', address: 'system@example.com' });
      expect(mail.to).toEqual({ name: '', address: 'admin@site.com' });
      expect(mail.subject).toContain('Cloudinary');
      expect(mail.text).toContain('11111');
      expect(mail.text).toContain('7 รูป');
    });

    it('propagates SMTP failures (throws)', async () => {
      sendMailMock.mockRejectedValueOnce(new Error('SMTP down'));
      await expect(sendOrphanDeleteOtpEmail('a@site.com', '11111', 3)).rejects.toThrow('SMTP down');
    });
  });

  describe('sendScheduleDeleteOtpEmail', () => {
    it('sends a single-recipient OTP email mentioning the schedule type/date/equipment', async () => {
      process.env.SMTP_USER = 'system@example.com';
      await sendScheduleDeleteOtpEmail('admin@site.com', '222222', {
        scheduleType: 'service',
        scheduledDate: '2026-09-10',
        equipmentName: 'เครื่องชั่ง A',
      });

      const mail = sendMailMock.mock.calls[0][0];
      expect(mail.from).toEqual({ name: 'ระบบเว็บไซต์ (Profin Lab Scale)', address: 'system@example.com' });
      expect(mail.to).toEqual({ name: '', address: 'admin@site.com' });
      expect(mail.text).toContain('222222');
      expect(mail.text).toContain('Service');
      expect(mail.text).toContain('2026-09-10');
      expect(mail.text).toContain('เครื่องชั่ง A');
    });

    it('omits the equipment clause when equipmentName is not given', async () => {
      process.env.SMTP_USER = 'system@example.com';
      await sendScheduleDeleteOtpEmail('admin@site.com', '222222', {
        scheduleType: 'follow_up',
        scheduledDate: '2026-09-10',
      });
      const mail = sendMailMock.mock.calls[0][0];
      expect(mail.text).toContain('โทรติดตามผล');
      expect(mail.text).not.toContain('สำหรับเครื่อง');
    });

    it('propagates SMTP failures (throws)', async () => {
      sendMailMock.mockRejectedValueOnce(new Error('SMTP down'));
      await expect(
        sendScheduleDeleteOtpEmail('a@site.com', '222222', { scheduleType: 'service', scheduledDate: '2026-01-01' })
      ).rejects.toThrow('SMTP down');
    });
  });
});

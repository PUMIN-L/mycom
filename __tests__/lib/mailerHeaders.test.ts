// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// mailer.test.ts mocks nodemailer, so it can only check WHAT mailer hands it.
// Whether a visitor-controlled name can smuggle in an extra address is decided
// by how nodemailer itself writes the headers — and a nodemailer upgrade can
// change that. So here the REAL nodemailer composes the real message; only the
// SMTP connection is swapped for its buffer-only stream transport.
const { sent } = vi.hoisted(() => ({ sent: [] as Buffer[] }));

vi.mock('nodemailer', async (importOriginal) => {
  const real = ((await importOriginal()) as { default: typeof import('nodemailer') }).default;
  return {
    default: {
      createTransport: () => {
        const transport = real.createTransport({ streamTransport: true, buffer: true });
        return {
          sendMail: async (mail: Parameters<typeof transport.sendMail>[0]) => {
            const info = await transport.sendMail(mail);
            sent.push(info.message as Buffer);
            return info;
          },
        };
      },
    },
  };
});

import { sendContactEmail } from '@/app/lib/mailer';
import addressparser from 'nodemailer/lib/addressparser';

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  sent.length = 0;
  process.env.SMTP_USER = 'site@example.com';
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

/** One header of the composed message, folded lines joined. */
function header(raw: Buffer, name: string): string {
  const head = raw.toString('utf8').split('\r\n\r\n')[0].replace(/\r\n[ \t]+/g, ' ');
  const line = head.split('\r\n').find((l) => l.toLowerCase().startsWith(`${name.toLowerCase()}:`));
  return line ? line.slice(name.length + 1).trim() : '';
}

const addresses = (value: string) =>
  (addressparser(value) as { address?: string }[]).map((a) => a.address);

describe('contact email headers (real nodemailer)', () => {
  const EVIL = 'x" <evil@x.com>, "y';

  it('a display name crafted to look like a second address stays ONE address', async () => {
    await sendContactEmail('owner@example.com', {
      name: EVIL,
      email: 'visitor@example.com',
      phone: '0812345678',
      subject: 'สอบถามราคา',
      message: 'ข้อความ',
    });
    expect(sent).toHaveLength(1);
    const raw = sent[0];
    expect(addresses(header(raw, 'Reply-To'))).toEqual(['visitor@example.com']);
    expect(addresses(header(raw, 'From'))).toEqual(['site@example.com']);
    expect(addresses(header(raw, 'To'))).toEqual(['owner@example.com']);
  });

  // The control: the same name in a hand-built `"name" <addr>` string is
  // exactly the injection the structured objects in mailer.ts prevent.
  it('the parser does split the hand-built form (so the check above can fail)', () => {
    expect(addresses(`"${EVIL}" <visitor@example.com>`)).toEqual(['evil@x.com', 'visitor@example.com']);
  });
});

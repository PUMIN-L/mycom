import "server-only";
import nodemailer from "nodemailer";

// Outbound email via SMTP (nodemailer). Defaults target Gmail — create an App
// Password (Google Account → Security → 2-Step Verification → App passwords)
// and set:
//   SMTP_USER=<gmail address>   SMTP_PASS=<16-char app password>
// Optional overrides for other providers: SMTP_HOST / SMTP_PORT.
// Pure JS over a TCP socket — safe on Vercel's serverless runtime (no jsdom-like
// native/loader issues; see the sanitizeHtml history before adding server deps).

export function isMailConfigured(): boolean {
  return Boolean(process.env.SMTP_USER && process.env.SMTP_PASS);
}

function createTransport() {
  const port = parseInt(process.env.SMTP_PORT || "465");
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port,
    secure: port === 465, // 465 = implicit TLS; 587 upgrades via STARTTLS
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

export interface ContactMessage {
  name: string;
  email: string;
  subject: string;
  message: string;
}

/**
 * Notify that the contact-form recipient email was changed. Sent to both the
 * old and new addresses (audit trail — if an attacker changed it, the previous
 * owner is alerted). Addresses are passed as structured objects and are already
 * EMAIL_RE-validated by the caller, so no header-injection surface. Throws on
 * SMTP failure.
 */
export async function sendContactRecipientChangedEmail(
  recipients: string[],
  oldEmail: string,
  newEmail: string
): Promise<void> {
  const transport = createTransport();
  await transport.sendMail({
    from: { name: "ระบบเว็บไซต์ (Profin Lab Scale)", address: process.env.SMTP_USER ?? "" },
    to: recipients.map((address) => ({ name: "", address })),
    subject: "แจ้งเตือน: เปลี่ยนอีเมลรับข้อความจากฟอร์มติดต่อ",
    text:
      `อีเมลสำหรับรับข้อความจากฟอร์ม "ติดต่อเรา" ถูกเปลี่ยนแล้ว\n\n` +
      `จาก: ${oldEmail}\n` +
      `เป็น: ${newEmail}\n\n` +
      `หากคุณไม่ได้เป็นผู้เปลี่ยนแปลงนี้ กรุณาตรวจสอบความปลอดภัยของบัญชีผู้ดูแลระบบทันที`,
  });
}

/** Send a contact-form submission to `to`. Throws on SMTP failure. */
export async function sendContactEmail(
  to: string,
  msg: ContactMessage
): Promise<void> {
  const transport = createTransport();
  await transport.sendMail({
    // SECURITY: pass structured {name, address} objects, never hand-built
    // `"name" <addr>` strings — nodemailer re-parses raw strings BEFORE
    // escaping, so a visitor-controlled name like `x" <evil@x.com>, "y`
    // would inject an extra From/Reply-To address (verified against v9).
    // Structured objects get the display name properly quoted/encoded.
    from: {
      name: `${msg.name} (เว็บไซต์)`,
      address: process.env.SMTP_USER ?? "",
    },
    to,
    replyTo: { name: msg.name, address: msg.email }, // admin can hit Reply to answer the visitor
    subject: `[ติดต่อจากเว็บไซต์] ${msg.subject}`,
    text: `ชื่อ: ${msg.name}\nอีเมล: ${msg.email}\nหัวข้อ: ${msg.subject}\n\n${msg.message}`,
  });
}

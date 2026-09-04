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
  phone: string;
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

function escapeHtml(unsafe: string | undefined | null): string {
  return String(unsafe ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/** Send a contact-form submission to `to`. Throws on SMTP failure. */
export async function sendContactEmail(
  to: string,
  msg: ContactMessage
): Promise<void> {
  const transport = createTransport();

  const safeName = escapeHtml(msg.name);
  const safeEmail = escapeHtml(msg.email);
  const safePhone = escapeHtml(msg.phone);
  const safeSubject = escapeHtml(msg.subject);
  const safeMessage = escapeHtml(msg.message);

  const html = `
<div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; color: #333; line-height: 1.6;">
  <div style="background-color: #0f172a; padding: 25px 20px; text-align: center; border-radius: 8px 8px 0 0;">
    <h2 style="color: #ffffff; margin: 0; font-size: 22px; font-weight: 600;">การติดต่อใหม่จากเว็บไซต์</h2>
  </div>
  <div style="padding: 30px; background-color: #ffffff; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 8px 8px;">
    <p style="font-size: 16px; margin-top: 0; margin-bottom: 25px; color: #475569;">
      คุณได้รับข้อความใหม่จากฟอร์ม <strong>"ติดต่อเรา"</strong> โดยมีรายละเอียดดังนี้:
    </p>
    
    <table style="width: 100%; border-collapse: collapse; margin-bottom: 30px; font-size: 15px;">
      <tr>
        <td style="padding: 12px 0; border-bottom: 1px solid #f1f5f9; width: 35%; font-weight: 600; color: #64748b;">ชื่อ-นามสกุล:</td>
        <td style="padding: 12px 0; border-bottom: 1px solid #f1f5f9; color: #0f172a; font-weight: 500;">${safeName}</td>
      </tr>
      <tr>
        <td style="padding: 12px 0; border-bottom: 1px solid #f1f5f9; font-weight: 600; color: #64748b;">อีเมล:</td>
        <td style="padding: 12px 0; border-bottom: 1px solid #f1f5f9;"><a href="mailto:${safeEmail}" style="color: #2563eb; text-decoration: none; font-weight: 500;">${safeEmail}</a></td>
      </tr>
      <tr>
        <td style="padding: 12px 0; border-bottom: 1px solid #f1f5f9; font-weight: 600; color: #64748b;">เบอร์โทร:</td>
        <td style="padding: 12px 0; border-bottom: 1px solid #f1f5f9; color: #0f172a; font-weight: 500;">${safePhone}</td>
      </tr>
      <tr>
        <td style="padding: 12px 0; border-bottom: 1px solid #f1f5f9; font-weight: 600; color: #64748b;">หัวข้อ:</td>
        <td style="padding: 12px 0; border-bottom: 1px solid #f1f5f9; color: #0f172a; font-weight: 500;">${safeSubject}</td>
      </tr>
    </table>
    
    <div style="background-color: #f8fafc; padding: 20px; border: 1px solid #e2e8f0; border-radius: 6px;">
      <h3 style="margin-top: 0; color: #64748b; font-size: 14px; text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 1px solid #e2e8f0; padding-bottom: 12px; margin-bottom: 15px;">ข้อความ</h3>
      <p style="white-space: pre-wrap; margin: 0; color: #334155; font-size: 15px;">${safeMessage}</p>
    </div>
  </div>
  
  <div style="text-align: center; margin-top: 25px; font-size: 13px; color: #94a3b8;">
    อีเมลฉบับนี้ถูกส่งอัตโนมัติจากระบบเว็บไซต์ <strong>Profin Lab Scale</strong><br/>
    <span style="font-size: 12px; margin-top: 5px; display: inline-block;">หากต้องการติดต่อลูกค้า สามารถกด Reply อีเมลฉบับนี้ได้เลย</span>
  </div>
</div>
  `.trim();

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
    text: `ชื่อ: ${msg.name}\nอีเมล: ${msg.email}\nเบอร์โทร: ${msg.phone}\nหัวข้อ: ${msg.subject}\n\n${msg.message}`,
    html,
  });
}

/**
 * Every OTP notification shares this exact shape (system sender, single
 * plain-text recipient) — only the subject/body differ per use case.
 */
async function sendOtpNotification(to: string, subject: string, text: string): Promise<void> {
  const transport = createTransport();
  await transport.sendMail({
    from: { name: "ระบบเว็บไซต์ (Profin Lab Scale)", address: process.env.SMTP_USER ?? "" },
    to: { name: "", address: to },
    subject,
    text,
  });
}

/** Send an OTP to `to` to authorize changing the contact email to `newEmail`. */
export async function sendOtpEmail(
  to: string,
  otp: string,
  newEmail: string
): Promise<void> {
  await sendOtpNotification(
    to,
    `[รหัส OTP] ยืนยันการเปลี่ยนอีเมลรับข้อความ`,
    `มีการขอเปลี่ยนอีเมลรับข้อความ (Contact Email) เป็นอีเมลใหม่: ${newEmail}\n\nหากคุณเป็นผู้ดำเนินการ กรุณานำรหัสผ่านชั่วคราวด้านล่างนี้ไปกรอกในหน้าต่างตั้งค่า:\n\nรหัสยืนยัน: ${otp}\n\n(รหัสนี้มีอายุ 15 นาที)\n\nหากคุณไม่ได้เป็นผู้ดำเนินการ กรุณาเพิกเฉยต่ออีเมลฉบับนี้ และตรวจสอบความปลอดภัยของรหัสผ่านผู้ดูแลระบบของคุณทันที`
  );
}

/** Send a 6-digit OTP to `to` to authorize a company-profile (address/phone) change. */
export async function sendCompanyProfileOtpEmail(
  to: string,
  otp: string,
  changesSummary: string
): Promise<void> {
  await sendOtpNotification(
    to,
    `[รหัส OTP] ยืนยันการเปลี่ยนข้อมูลบริษัท`,
    `มีการขอเปลี่ยนข้อมูลบริษัท (ที่แสดงบนหน้าเว็บสาธารณะ) ดังนี้:\n\n${changesSummary}\n\nหากคุณเป็นผู้ดำเนินการ กรุณานำรหัสยืนยันด้านล่างนี้ไปกรอกในหน้าตั้งค่า:\n\nรหัสยืนยัน: ${otp}\n\n(รหัสนี้มีอายุ 15 นาที)\n\nหากคุณไม่ได้เป็นผู้ดำเนินการ กรุณาเพิกเฉยต่ออีเมลฉบับนี้ และตรวจสอบความปลอดภัยของบัญชีผู้ดูแลระบบทันที`
  );
}

/** Send a 5-digit OTP to `to` to authorize deleting orphaned Cloudinary images. */
export async function sendOrphanDeleteOtpEmail(
  to: string,
  otp: string,
  imageCount: number
): Promise<void> {
  await sendOtpNotification(
    to,
    `[รหัสยืนยัน] ลบรูปภาพที่ไม่ได้ใช้งานจาก Cloudinary`,
    `มีการขอลบรูปภาพที่ไม่ได้ใช้งานจำนวน ${imageCount} รูป ออกจาก Cloudinary\n\nหากคุณเป็นผู้ดำเนินการ กรุณานำรหัสยืนยันด้านล่างนี้ไปกรอก:\n\nรหัสยืนยัน: ${otp}\n\n(รหัสนี้มีอายุ 10 นาที)\n\nหากคุณไม่ได้เป็นผู้ดำเนินการ กรุณาเพิกเฉยต่ออีเมลฉบับนี้ และตรวจสอบความปลอดภัยของบัญชีผู้ดูแลระบบทันที`
  );
}

/** Send a 6-digit OTP to `to` to authorize deleting a completed schedule. */
export async function sendScheduleDeleteOtpEmail(
  to: string,
  otp: string,
  scheduleInfo: { scheduleType: string; scheduledDate: string; equipmentName?: string }
): Promise<void> {
  const typeText = scheduleInfo.scheduleType === "service" ? "Service (บำรุงรักษา)" : "โทรติดตามผล";
  const equipText = scheduleInfo.equipmentName ? ` สำหรับเครื่อง: ${scheduleInfo.equipmentName}` : "";
  await sendOtpNotification(
    to,
    `[รหัสยืนยัน OTP] ขอลบประวัตินัดหมายที่เสร็จสิ้นแล้ว`,
    `มีการขอลบประวัตินัดหมาย ${typeText} วันที่ ${scheduleInfo.scheduledDate}${equipText} ที่ดำเนินการเสร็จสิ้นแล้ว\n\nเนื่องจากการลบประวัติงานที่เสร็จแล้วส่งผลต่อข้อมูลการรับประกันและการบริการ กรุณานำรหัสยืนยัน 6 หลักด้านล่างนี้ไปกรอกเพื่อยืนยันการลบ:\n\nรหัสยืนยัน: ${otp}\n\n(รหัสนี้มีอายุ 15 นาที)\n\nหากคุณไม่ได้เป็นผู้ดำเนินการ กรุณาเพิกเฉยต่ออีเมลฉบับนี้ และตรวจสอบความปลอดภัยของบัญชีผู้ดูแลระบบทันที`
  );
}


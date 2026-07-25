import { NextRequest, NextResponse } from "next/server";
import { withRoute, requireAuth } from "../../../lib/apiHelpers";
import {
  getContactEmail,
  setSetting,
  getSetting,
  CONTACT_EMAIL_SETTING,
} from "../../../lib/settingsStore";
import { isMailConfigured, sendContactRecipientChangedEmail } from "../../../lib/mailer";

// Rejects <>"',; too — this value ends up in an SMTP To: header (mailer.ts).
const EMAIL_RE = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/;

function maskEmail(email: string): string {
  const [username, domain] = email.split("@");
  if (!domain) return email; // Should not happen for valid emails
  if (username.length <= 2) {
    return `${username[0]}***@${domain}`;
  }
  return `${username[0]}***${username[username.length - 1]}@${domain}`;
}

export const GET = withRoute("โหลดการตั้งค่าไม่สำเร็จ", async () => {
  await requireAuth();
  const email = await getContactEmail();
  return NextResponse.json({ email: maskEmail(email) });
});

export const PUT = withRoute(
  "บันทึกการตั้งค่าไม่สำเร็จ",
  async (request: NextRequest) => {
    await requireAuth();
    const { email, otp } = await request.json();
    const value = String(email ?? "").trim();
    const providedOtp = String(otp ?? "").trim();
    
    if (!value || value.length > 320 || !EMAIL_RE.test(value)) {
      return NextResponse.json(
        { error: "รูปแบบอีเมลไม่ถูกต้อง" },
        { status: 400 }
      );
    }
    if (!providedOtp || providedOtp.length !== 6) {
      return NextResponse.json(
        { error: "รหัส OTP ไม่ถูกต้อง" },
        { status: 400 }
      );
    }

    // Verify OTP
    const storedOtp = await getSetting("contact_email_otp");
    const storedExpires = await getSetting("contact_email_otp_expires");
    const pendingEmail = await getSetting("contact_email_pending");

    if (!storedOtp || !storedExpires || !pendingEmail) {
      return NextResponse.json(
        { error: "ไม่มีคำขอเปลี่ยนอีเมล (OTP อาจจะหมดอายุแล้ว)" },
        { status: 400 }
      );
    }

    if (Date.now() > parseInt(storedExpires, 10)) {
      return NextResponse.json(
        { error: "รหัส OTP หมดอายุแล้ว กรุณาขอรหัสใหม่" },
        { status: 400 }
      );
    }

    if (storedOtp !== providedOtp) {
      return NextResponse.json(
        { error: "รหัส OTP ไม่ถูกต้อง" },
        { status: 400 }
      );
    }

    if (pendingEmail !== value) {
      return NextResponse.json(
        { error: "อีเมลไม่ตรงกับที่ขอรหัส OTP" },
        { status: 400 }
      );
    }

    const previous = await getContactEmail();
    await setSetting(CONTACT_EMAIL_SETTING, value);
    
    // Clear the OTP data
    await setSetting("contact_email_otp", "");
    await setSetting("contact_email_otp_expires", "0");
    await setSetting("contact_email_pending", "");

    // On a real change, alert BOTH the old and new addresses. Best-effort: a
    // notification failure (e.g. SMTP unconfigured) must not fail the save.
    let notified = false;
    if (value !== previous && isMailConfigured()) {
      const recipients = Array.from(new Set([previous, value]));
      try {
        await sendContactRecipientChangedEmail(recipients, previous, value);
        notified = true;
      } catch (err) {
        console.error("Failed to send recipient-change notice:", err);
      }
    }

    // Return the masked email so the UI updates
    return NextResponse.json({ email: maskEmail(value), changed: value !== previous, notified });
  }
);

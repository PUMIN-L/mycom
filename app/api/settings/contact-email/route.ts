import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { withRoute, requireAuth } from "../../../lib/apiHelpers";
import {
  getContactEmail,
  setSetting,
  getSetting,
  CONTACT_EMAIL_SETTING,
} from "../../../lib/settingsStore";
import { isMailConfigured, sendContactRecipientChangedEmail } from "../../../lib/mailer";
import { recordOtpFailure, clearOtpAttempts } from "../../../lib/otpAttempts";

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

    // otp/expiresAt/pendingEmail live in ONE settings row so this is a single
    // consistent read — three independent reads could otherwise interleave
    // with a second, superseding OTP request and let a stale OTP authorize a
    // pending change it was never issued for.
    const stateRaw = await getSetting("contact_email_otp_state");
    if (!stateRaw) {
      return NextResponse.json(
        { error: "ไม่มีคำขอเปลี่ยนอีเมล (OTP อาจจะหมดอายุแล้ว)" },
        { status: 400 }
      );
    }

    let state: { otp: string; expiresAt: number; pendingEmail: string };
    try {
      state = JSON.parse(stateRaw);
    } catch {
      return NextResponse.json({ error: "ข้อมูลที่รออนุมัติเสียหาย กรุณาขอรหัสใหม่" }, { status: 400 });
    }

    if (Date.now() > state.expiresAt) {
      return NextResponse.json(
        { error: "รหัส OTP หมดอายุแล้ว กรุณาขอรหัสใหม่" },
        { status: 400 }
      );
    }

    if (state.otp !== providedOtp) {
      // The 2nd arg only needs a key name recordOtpFailure can wipe on
      // lockout — the real combined state is cleared explicitly below instead,
      // since its "0" numeric-expiry wipe format doesn't fit the JSON blob here.
      const { locked } = await recordOtpFailure(
        "contact_email_otp",
        "contact_email_otp_legacy_expires_unused"
      );
      if (locked) await setSetting("contact_email_otp_state", "");
      return NextResponse.json(
        {
          error: locked
            ? "กรอกรหัส OTP ผิดเกินจำนวนที่กำหนด กรุณาขอรหัสใหม่"
            : "รหัส OTP ไม่ถูกต้อง",
        },
        { status: 400 }
      );
    }

    if (state.pendingEmail !== value) {
      return NextResponse.json(
        { error: "อีเมลไม่ตรงกับที่ขอรหัส OTP" },
        { status: 400 }
      );
    }

    const previous = await getContactEmail();
    await setSetting(CONTACT_EMAIL_SETTING, value);
    // Public pages (Footer/Contact/Organization JSON-LD) read a cached copy
    // (app/lib/companyInfo.ts) that bundles this email in — refresh it too.
    if (value !== previous) revalidateTag("company-info", { expire: 0 });

    // Clear the OTP data
    await setSetting("contact_email_otp_state", "");
    await clearOtpAttempts("contact_email_otp");

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

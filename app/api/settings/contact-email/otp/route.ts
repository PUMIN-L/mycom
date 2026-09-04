import { randomInt } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { withRoute, requireAuth } from "../../../../lib/apiHelpers";
import {
  getContactEmail,
  setSetting,
} from "../../../../lib/settingsStore";
import { isMailConfigured, sendOtpEmail } from "../../../../lib/mailer";
import { resetOtpAttempts } from "../../../../lib/otpAttempts";

// Rejects <>"',; too
const EMAIL_RE = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/;

// Generate a random 6-digit OTP
function generateOtp(): string {
  return randomInt(100000, 1000000).toString();
}

export const POST = withRoute(
  "ไม่สามารถส่งรหัส OTP ได้",
  async (request: NextRequest) => {
    await requireAuth();

    if (!isMailConfigured()) {
      return NextResponse.json(
        { error: "ระบบอีเมลยังไม่ได้ตั้งค่า (SMTP_USER/PASS) จึงไม่สามารถส่ง OTP ได้" },
        { status: 503 }
      );
    }

    const { newEmail } = await request.json();
    const value = String(newEmail ?? "").trim();
    
    if (!value || value.length > 320 || !EMAIL_RE.test(value)) {
      return NextResponse.json(
        { error: "รูปแบบอีเมลไม่ถูกต้อง" },
        { status: 400 }
      );
    }

    const currentEmail = await getContactEmail();
    
    if (value === currentEmail) {
      return NextResponse.json(
        { error: "อีเมลใหม่ซ้ำกับอีเมลปัจจุบัน" },
        { status: 400 }
      );
    }

    const otp = generateOtp();
    const expiresAt = Date.now() + 15 * 60 * 1000; // 15 minutes

    // otp/expiresAt/pendingEmail are kept in ONE settings row (not three) so a
    // verifying PUT reads a single consistent snapshot instead of three
    // independent reads that a second, superseding OTP request could
    // interleave with (an old OTP authorizing a newer pending change) — same
    // fix as company-profile's otp route.
    await setSetting(
      "contact_email_otp_state",
      JSON.stringify({ otp, expiresAt, pendingEmail: value })
    );
    await resetOtpAttempts("contact_email_otp");

    // Send the OTP to the CURRENT email
    await sendOtpEmail(currentEmail, otp, value);

    return NextResponse.json({ success: true, message: "ส่งรหัส OTP แล้ว" });
  }
);

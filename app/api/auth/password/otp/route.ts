import { NextResponse } from "next/server";
import { withRoute, requireAuth } from "../../../../lib/apiHelpers";
import { getTwoFactorUser } from "../../../../lib/twoFactor";
import { isMailConfigured, sendPasswordOtpEmail } from "../../../../lib/mailer";
import { otpIssueRefused } from "../../../../lib/otpAttempts";
import {
  issuePasswordOtp,
  maskEmail,
  PASSWORD_OTP_EMAIL,
  PASSWORD_OTP_TTL_MINUTES,
} from "../../../../lib/passwordReset";

// POST /api/auth/password/otp — step one of "เปลี่ยนรหัสผ่าน" in /settings:
// email a 6-digit code to the fixed address (lib/passwordReset.ts). The
// password itself changes in POST /api/auth/password.
export const POST = withRoute(
  "ส่งรหัส OTP ไม่สำเร็จ",
  // No parameter: nothing is read from the request. withRoute still receives
  // it at runtime, so the same-origin guard applies all the same.
  async () => {
    const session = await requireAuth();
    const user = await getTwoFactorUser(session.userId);
    if (!user) return NextResponse.json({ error: "ไม่พบบัญชีผู้ใช้" }, { status: 404 });
    if (!isMailConfigured()) {
      return NextResponse.json(
        { error: "ระบบอีเมลยังไม่ได้ตั้งค่า (SMTP_USER/PASS) จึงไม่สามารถส่ง OTP ได้" },
        { status: 503 }
      );
    }

    const issue = await issuePasswordOtp("change", user.id);
    if (!issue.allowed) return otpIssueRefused(issue.retryAfterSeconds);
    await sendPasswordOtpEmail(PASSWORD_OTP_EMAIL, issue.otp, "change", user.username, PASSWORD_OTP_TTL_MINUTES);

    return NextResponse.json({
      success: true,
      sentTo: maskEmail(PASSWORD_OTP_EMAIL),
      // The form asks for an authenticator code too when 2FA is on.
      twoFactorRequired: user.totpEnabled,
    });
  }
);

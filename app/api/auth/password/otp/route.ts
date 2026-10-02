import { NextRequest, NextResponse } from "next/server";
import { withRoute, requireAuth } from "../../../../lib/apiHelpers";
import { getTwoFactorUser } from "../../../../lib/twoFactor";
import { isMailConfigured, sendPasswordOtpEmail } from "../../../../lib/mailer";
import { otpIssueRefused } from "../../../../lib/otpAttempts";
import { requirePassword } from "../../../../lib/twoFactorReauth";
import {
  issuePasswordOtp,
  maskEmail,
  PASSWORD_OTP_EMAIL,
  PASSWORD_OTP_TTL_MINUTES,
} from "../../../../lib/passwordReset";

// POST /api/auth/password/otp — step one of "เปลี่ยนรหัสผ่าน" in /settings:
// email a 6-digit code to the fixed address (lib/passwordReset.ts). The
// password itself changes in POST /api/auth/password.
//
// Body: { currentPassword }. Checked HERE, before any code is issued or
// mailed, so a mistyped current password is said at once rather than after
// the admin has fetched a code from the inbox (and only then learned the code
// was never the problem). POST /api/auth/password checks it again — the field
// stays editable after this step. Counted in the same re-auth bucket.
export const POST = withRoute(
  "ส่งรหัส OTP ไม่สำเร็จ",
  async (request: NextRequest) => {
    const session = await requireAuth();
    const body = (await request.json()) as { currentPassword?: unknown };
    const user = await getTwoFactorUser(session.userId);
    if (!user) return NextResponse.json({ error: "ไม่พบบัญชีผู้ใช้" }, { status: 404 });

    const passwordRefusal = await requirePassword(user, body.currentPassword);
    if (passwordRefusal) return passwordRefusal;
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

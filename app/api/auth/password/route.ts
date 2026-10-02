import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { withRoute, requireAuth } from "../../../lib/apiHelpers";
import { createSession } from "../../../lib/session";
import { bumpSessionEpoch, SESSION_EPOCH_TAG } from "../../../lib/settingsStore";
import {
  LOGIN_DEVICE_COOKIE,
  LOGIN_DEVICE_COOKIE_OPTIONS,
  issueLoginDeviceToken,
} from "../../../lib/loginDevice";
import { getTwoFactorUser } from "../../../lib/twoFactor";
import { NO_STORE, requirePassword, requireSecondFactor } from "../../../lib/twoFactorReauth";
import { sendPasswordChangedEmail } from "../../../lib/mailer";
import {
  checkPasswordOtp,
  consumePasswordOtp,
  PASSWORD_OTP_ALREADY_USED,
  PASSWORD_OTP_EMAIL,
  setPassword,
} from "../../../lib/passwordReset";
import { newPasswordProblem } from "../../../lib/passwordRules";

// POST /api/auth/password — "เปลี่ยนรหัสผ่าน" in /settings, logged in.
//
// Body: { currentPassword, newPassword, otp, code? }. Needs ALL of: a session,
// the current password (counted in the settings' own lockout bucket, like the
// 2FA settings — lib/twoFactorReauth.ts), the code emailed by
// POST /api/auth/password/otp, and — while 2FA is on — a code from the app or
// a backup code. A session alone, or a session plus the inbox, is not enough.
//
// Cheapest checks first, and nothing is SPENT until everything has passed:
// the emailed code is consumed (atomically) only after the 2FA code is right,
// so a mistyped 2FA code does not cost the admin another email.
//
// Then every session and trusted-device token issued so far is voided (the
// session epoch) — whoever else was logged in is out — and this browser gets
// a fresh session and device token, so the admin who changed it stays in.
export const POST = withRoute(
  "เปลี่ยนรหัสผ่านไม่สำเร็จ",
  async (request: NextRequest) => {
    const session = await requireAuth();
    const body = (await request.json()) as {
      currentPassword?: unknown;
      newPassword?: unknown;
      otp?: unknown;
      code?: unknown;
    };

    const user = await getTwoFactorUser(session.userId);
    if (!user) return NextResponse.json({ error: "ไม่พบบัญชีผู้ใช้" }, { status: 404 });

    const problem = newPasswordProblem(body.newPassword, user.username);
    if (problem) return NextResponse.json({ error: problem }, { status: 400 });
    const newPassword = body.newPassword as string;

    const passwordRefusal = await requirePassword(user, body.currentPassword);
    if (passwordRefusal) return passwordRefusal;
    // The current password was just proven, so this is plain equality — no
    // second bcrypt, and no oracle for anyone who does not already know it.
    if (newPassword === body.currentPassword) {
      return NextResponse.json({ error: "รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านเดิม" }, { status: 400 });
    }

    const otp = await checkPasswordOtp("change", user.id, body.otp);
    if (!otp.ok) return NextResponse.json({ error: otp.error }, { status: 400 });

    if (user.totpEnabled) {
      const codeRefusal = await requireSecondFactor(user, body.code);
      if (codeRefusal) return codeRefusal;
    }

    if (!(await consumePasswordOtp("change", otp.stateRaw))) {
      return NextResponse.json({ error: PASSWORD_OTP_ALREADY_USED }, { status: 400 });
    }
    if (!(await setPassword(user.id, newPassword))) {
      return NextResponse.json({ error: "ไม่พบบัญชีผู้ใช้" }, { status: 404 });
    }

    const epoch = await bumpSessionEpoch();
    revalidateTag(SESSION_EPOCH_TAG, { expire: 0 });
    await createSession(user.id, user.username, epoch);

    try {
      await sendPasswordChangedEmail(PASSWORD_OTP_EMAIL, user.username, "change");
    } catch (error) {
      // The password HAS changed; a failed notice must not report otherwise.
      console.error("[password] changed, but the notice email failed:", error);
    }

    const response = NextResponse.json({ success: true }, { headers: NO_STORE });
    response.cookies.set(
      LOGIN_DEVICE_COOKIE,
      await issueLoginDeviceToken(user.username, epoch),
      LOGIN_DEVICE_COOKIE_OPTIONS
    );
    return response;
  }
);

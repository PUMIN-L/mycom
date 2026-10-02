import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { withRoute } from "../../../lib/apiHelpers";
import { clientKey } from "../../../lib/rateLimit";
import { bumpSessionEpoch, SESSION_EPOCH_TAG } from "../../../lib/settingsStore";
import { verifySecondFactor } from "../../../lib/twoFactor";
import {
  clearLoginFailures,
  loginLockKey,
  resetCodeLockKey,
  takeLoginAttempt,
} from "../../../lib/loginThrottle";
import { sendPasswordChangedEmail } from "../../../lib/mailer";
import {
  checkPasswordOtp,
  consumePasswordOtp,
  findUserByUsername,
  PASSWORD_OTP_ALREADY_USED,
  PASSWORD_OTP_EMAIL,
  PASSWORD_RESET_OTP_REFUSED,
  passwordResetIpLimiter,
  setPassword,
} from "../../../lib/passwordReset";
import { newPasswordProblem } from "../../../lib/passwordRules";

// POST /api/auth/forgot-password — step two of "ลืมรหัสผ่าน", PUBLIC.
//
// Body: { username, otp, newPassword, code? }. No current password — that is
// the point of the page — so what stands in for it is the code emailed to the
// fixed address (lib/passwordReset.ts) and, for an account with 2FA on, a
// code from the app or a backup code. Inbox access alone cannot take over a
// two-factor account.
//
// The order keeps a stranger from learning anything:
//   1. the new password's rules — judged against the username TYPED, before
//      any lookup, so "too short" never hints that the account exists;
//   2. the emailed code — EVERY refusal of it (an unknown username, no code
//      asked for, expired, wrong, five wrong, the daily budget spent) is the
//      one PASSWORD_RESET_OTP_REFUSED. A made-up username still has the code
//      row read, so it costs what a real one without a code does; a real one
//      WITH a live code also spends its guess (two short transactions more) —
//      the one difference left, in milliseconds;
//   3. only then the 2FA code, in its own lockout bucket (resetCodeLockKey):
//      "this account needs a 2FA code" is said only to whoever holds the
//      emailed code, and nobody can fill the LOGIN code step's bucket from
//      here. There is deliberately no "same as the old password?" check: on a
//      page without the old password it would be a free password oracle.
// Nothing is spent until all three pass; then the emailed code is consumed
// atomically, the password set, every session and trusted device voided (the
// session epoch), and the username's login lockout cleared so the admin can
// log in at once. No session is issued here — the login page does that.
export const POST = withRoute(
  "ตั้งรหัสผ่านใหม่ไม่สำเร็จ",
  async (request: NextRequest) => {
    const ipLimit = passwordResetIpLimiter.check(clientKey(request));
    if (!ipLimit.allowed) {
      return NextResponse.json(
        { error: "มีการขอจากเครือข่ายนี้บ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่" },
        { status: 429, headers: { "Retry-After": String(ipLimit.retryAfterSeconds) } }
      );
    }

    const body = (await request.json()) as {
      username?: unknown;
      otp?: unknown;
      newPassword?: unknown;
      code?: unknown;
    };
    const username = body.username;
    if (typeof username !== "string" || !username || username.length > 100) {
      return NextResponse.json({ error: "กรุณากรอกชื่อผู้ใช้ (username)" }, { status: 400 });
    }

    const problem = newPasswordProblem(body.newPassword, username);
    if (problem) return NextResponse.json({ error: problem }, { status: 400 });
    const newPassword = body.newPassword as string;

    const user = await findUserByUsername(username);
    // No user: an id no code can carry, so this reads the code row and stops.
    const otp = await checkPasswordOtp("reset", user?.id ?? "", body.otp);
    if (!user || !otp.ok) return NextResponse.json({ error: PASSWORD_RESET_OTP_REFUSED }, { status: 400 });

    if (user.totpEnabled) {
      const code = body.code;
      if (typeof code !== "string" || !code.trim() || code.length > 64) {
        return NextResponse.json(
          {
            error: "บัญชีนี้เปิดการยืนยันตัวตน 2 ขั้นไว้ กรุณากรอกรหัส 6 หลักจากแอป หรือรหัสสำรอง",
            twoFactorRequired: true,
          },
          { status: 400 }
        );
      }
      const lockKey = resetCodeLockKey(user.id);
      if (!(await takeLoginAttempt(lockKey))) {
        return NextResponse.json(
          { error: "ใส่รหัสผิดหลายครั้งเกินไป กรุณารอ 15 นาทีแล้วลองใหม่" },
          { status: 429 }
        );
      }
      const second = await verifySecondFactor(user.id, code);
      if (!second.ok) {
        return NextResponse.json(
          {
            error:
              second.reason === "replayed"
                ? "รหัสนี้ถูกใช้ไปแล้ว กรุณารอรหัสถัดไปในแอป (เปลี่ยนทุก 30 วินาที)"
                : "รหัสยืนยันตัวตน 2 ขั้นไม่ถูกต้อง",
            twoFactorRequired: true,
          },
          { status: 403 }
        );
      }
      await clearLoginFailures(lockKey);
    }

    if (!(await consumePasswordOtp("reset", otp.stateRaw))) {
      return NextResponse.json({ error: PASSWORD_OTP_ALREADY_USED }, { status: 400 });
    }
    if (!(await setPassword(user.id, newPassword))) {
      return NextResponse.json({ error: PASSWORD_RESET_OTP_REFUSED }, { status: 400 });
    }

    await clearLoginFailures(loginLockKey(user.username));
    await bumpSessionEpoch();
    revalidateTag(SESSION_EPOCH_TAG, { expire: 0 });

    try {
      await sendPasswordChangedEmail(PASSWORD_OTP_EMAIL, user.username, "reset");
    } catch (error) {
      console.error("[forgot-password] password set, but the notice email failed:", error);
    }

    return NextResponse.json({ success: true });
  }
);

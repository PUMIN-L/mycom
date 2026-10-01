import "server-only";
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import {
  clearLoginFailures,
  isLockedOut,
  loginLockKey,
  recordLoginFailure,
  twoFactorLockKey,
} from "./loginThrottle";
import { verifySecondFactor, type TwoFactorUser } from "./twoFactor";

// Re-authentication for the 2FA settings routes. A logged-in session alone is
// NOT enough to turn 2FA on or off or to mint new backup codes: someone who
// has walked up to an unlocked browser, or stolen a session cookie, could
// otherwise switch 2FA on with HIS phone and lock the real admin out, or
// switch it off. So these ask for the password again — and, once 2FA is on,
// a code — each counted in the same lockout buckets as the login screen
// (lib/loginThrottle.ts), so a stolen session cannot be used to guess either.
//
// Each check returns null when it passes, or the response to send.
// 403 rather than 401 for a wrong answer: the settings page reads 401 as
// "your session has expired".

export async function requirePassword(user: TwoFactorUser, password: unknown): Promise<NextResponse | null> {
  if (typeof password !== "string" || !password) {
    return NextResponse.json({ error: "กรุณากรอกรหัสผ่าน" }, { status: 400 });
  }
  const lockKey = loginLockKey(user.username);
  if (await isLockedOut(lockKey)) {
    return NextResponse.json(
      { error: "ใส่รหัสผ่านผิดหลายครั้งเกินไป กรุณารอ 15 นาทีแล้วลองใหม่" },
      { status: 429 }
    );
  }
  if (!(await bcrypt.compare(password, user.passwordHash))) {
    await recordLoginFailure(lockKey);
    return NextResponse.json({ error: "รหัสผ่านไม่ถูกต้อง" }, { status: 403 });
  }
  return null;
}

/** Only for a user with 2FA ON: a code from the app, or a backup code (which
 *  is spent by this). */
export async function requireSecondFactor(user: TwoFactorUser, code: unknown): Promise<NextResponse | null> {
  if (typeof code !== "string" || !code.trim() || code.length > 64) {
    return NextResponse.json({ error: "กรุณากรอกรหัส 6 หลักจากแอป หรือรหัสสำรอง" }, { status: 400 });
  }
  const lockKey = twoFactorLockKey(user.id);
  if (await isLockedOut(lockKey)) {
    return NextResponse.json(
      { error: "ใส่รหัสผิดหลายครั้งเกินไป กรุณารอ 15 นาทีแล้วลองใหม่" },
      { status: 429 }
    );
  }
  const result = await verifySecondFactor(user.id, code);
  if (!result.ok) {
    await recordLoginFailure(lockKey);
    return NextResponse.json(
      {
        error:
          result.reason === "replayed"
            ? "รหัสนี้ถูกใช้ไปแล้ว กรุณารอรหัสถัดไปในแอป (เปลี่ยนทุก 30 วินาที)"
            : "รหัสไม่ถูกต้อง",
      },
      { status: 403 }
    );
  }
  await clearLoginFailures(lockKey);
  return null;
}

/** Headers for a response that carries a secret or backup codes: never cached. */
export const NO_STORE = { "Cache-Control": "no-store" } as const;

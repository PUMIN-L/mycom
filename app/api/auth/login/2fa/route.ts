import { NextRequest, NextResponse } from "next/server";
import { createSession } from "../../../../lib/session";
import { withRoute } from "../../../../lib/apiHelpers";
import {
  LOGIN_DEVICE_COOKIE,
  LOGIN_DEVICE_COOKIE_OPTIONS,
  issueLoginDeviceToken,
  loginDeviceIdFor,
} from "../../../../lib/loginDevice";
import {
  clearLoginFailures,
  isLockedOut,
  loginIpLimiter,
  recordLoginFailure,
  twoFactorDeviceLockKey,
  twoFactorLockKey,
} from "../../../../lib/loginThrottle";
import {
  LOGIN_2FA_COOKIE,
  LOGIN_2FA_COOKIE_CLEAR,
  readTwoFactorPendingToken,
} from "../../../../lib/twoFactorPending";
import { countUnusedBackupCodes, verifySecondFactor } from "../../../../lib/twoFactor";
import { clientKey } from "../../../../lib/rateLimit";

// POST /api/auth/login/2fa — step two of logging in to a two-factor account.
//
// Body: { code } — six digits from the authenticator app, or a backup code.
// Needs the pending cookie POST /api/auth/login set when the password was
// right (5 minutes, this path only). Only here does the session cookie get
// issued, so nothing downstream (proxy.ts, requireAuth) knows 2FA exists.
const WRONG_MESSAGES = {
  wrong: "รหัสไม่ถูกต้อง",
  replayed: "รหัสนี้ถูกใช้ไปแล้ว กรุณารอรหัสถัดไปในแอป (เปลี่ยนทุก 30 วินาที)",
  unavailable: "ยืนยันรหัสไม่ได้ กรุณาติดต่อผู้ดูแลระบบ",
} as const;

export const POST = withRoute(
  "ยืนยันรหัสไม่สำเร็จ กรุณาลองใหม่",
  async (request: NextRequest) => {
    const body: unknown = await request.json();
    const code = (body as { code?: unknown } | null)?.code;
    if (typeof code !== "string" || !code.trim() || code.length > 64) {
      return NextResponse.json(
        { error: "กรุณากรอกรหัส 6 หลักจากแอป หรือรหัสสำรอง" },
        { status: 400 }
      );
    }

    const ipLimit = loginIpLimiter.check(clientKey(request));
    if (!ipLimit.allowed) {
      return NextResponse.json(
        { error: "มีการพยายามเข้าสู่ระบบจากเครือข่ายนี้บ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่" },
        { status: 429, headers: { "Retry-After": String(ipLimit.retryAfterSeconds) } }
      );
    }

    const pending = await readTwoFactorPendingToken(request.cookies.get(LOGIN_2FA_COOKIE)?.value);
    if (!pending) {
      // `restart` tells the login page to go back to the password form.
      return NextResponse.json(
        { error: "หมดเวลายืนยันรหัส กรุณาใส่ username และ password ใหม่อีกครั้ง", restart: true },
        { status: 401 }
      );
    }

    const now = Date.now();
    const deviceId = await loginDeviceIdFor(request.cookies.get(LOGIN_DEVICE_COOKIE)?.value, pending.username);
    const lockKey = deviceId ? twoFactorDeviceLockKey(deviceId) : twoFactorLockKey(pending.userId);

    if (await isLockedOut(lockKey, now)) {
      return NextResponse.json(
        { error: "ใส่รหัสผิดหลายครั้งเกินไป กรุณารอ 15 นาทีแล้วลองใหม่" },
        { status: 429 }
      );
    }

    const result = await verifySecondFactor(pending.userId, code, now);
    if (!result.ok) {
      await recordLoginFailure(lockKey, now);
      return NextResponse.json({ error: WRONG_MESSAGES[result.reason] }, { status: 401 });
    }

    await clearLoginFailures(lockKey);
    await createSession(pending.userId, pending.username);
    const response = NextResponse.json({
      success: true,
      username: pending.username,
      // A spent backup code is one fewer between the admin and a lockout —
      // the login page says how many are left.
      ...(result.method === "backup"
        ? { backupCodesRemaining: await countUnusedBackupCodes(pending.userId) }
        : {}),
    });
    response.cookies.set(LOGIN_2FA_COOKIE, "", LOGIN_2FA_COOKIE_CLEAR);
    response.cookies.set(
      LOGIN_DEVICE_COOKIE,
      await issueLoginDeviceToken(pending.username),
      LOGIN_DEVICE_COOKIE_OPTIONS
    );
    return response;
  }
);

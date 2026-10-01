import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { withRoute, requireAuth } from "../../../../lib/apiHelpers";
import { createSession } from "../../../../lib/session";
import { bumpSessionEpoch, SESSION_EPOCH_TAG } from "../../../../lib/settingsStore";
import {
  LOGIN_DEVICE_COOKIE,
  LOGIN_DEVICE_COOKIE_OPTIONS,
  issueLoginDeviceToken,
} from "../../../../lib/loginDevice";
import {
  clearLoginFailures,
  refundLoginAttempt,
  takeLoginAttempt,
  twoFactorLockKey,
} from "../../../../lib/loginThrottle";
import { confirmTotpSetup, getTwoFactorUser } from "../../../../lib/twoFactor";
import { NO_STORE, requirePassword } from "../../../../lib/twoFactorReauth";

// POST /api/auth/2fa/enable (login required) — finish turning 2FA on.
// Body: { password, code } — the current password, and a code the app shows
// for the secret /setup just issued (proof the phone really holds it).
//
// Returns the backup codes in plain text. This response is the only place
// they ever exist unhashed; the page shows them once.
//
// Every session issued before now was issued on the password alone, so the
// session epoch is bumped: every other browser is logged out and must come
// back through the code screen. This one is re-issued a session under the new
// epoch, the same way "ออกจากระบบอุปกรณ์อื่นทั้งหมด" does it.
export const POST = withRoute(
  "เปิดการยืนยันตัวตน 2 ขั้นไม่สำเร็จ",
  async (request: NextRequest) => {
    const session = await requireAuth();
    const body = (await request.json()) as { password?: unknown; code?: unknown } | null;

    const user = await getTwoFactorUser(session.userId);
    if (!user) return NextResponse.json({ error: "ไม่พบบัญชีผู้ใช้" }, { status: 404 });
    if (user.totpEnabled) {
      return NextResponse.json({ error: "เปิดการยืนยันตัวตน 2 ขั้นอยู่แล้ว" }, { status: 409 });
    }

    const passwordRefusal = await requirePassword(user, body?.password);
    if (passwordRefusal) return passwordRefusal;

    const code = body?.code;
    if (typeof code !== "string" || !code.trim() || code.length > 64) {
      return NextResponse.json({ error: "กรุณากรอกรหัส 6 หลักจากแอป" }, { status: 400 });
    }
    // Taken before the code is checked (takeLoginAttempt) so parallel guesses
    // cannot all get past the lockout.
    const lockKey = twoFactorLockKey(user.id);
    if (!(await takeLoginAttempt(lockKey))) {
      return NextResponse.json(
        { error: "ใส่รหัสผิดหลายครั้งเกินไป กรุณารอ 15 นาทีแล้วลองใหม่" },
        { status: 429 }
      );
    }

    const result = await confirmTotpSetup(user.id, code);
    if (!result.ok) {
      if (result.reason === "wrong_code") {
        return NextResponse.json(
          { error: "รหัสไม่ถูกต้อง — ตรวจว่าสแกน QR อันล่าสุด และเวลาในมือถือตั้งเป็นอัตโนมัติ" },
          { status: 403 }
        );
      }
      // Not a guess at a code: give the attempt back.
      await refundLoginAttempt(lockKey);
      if (result.reason === "already_enabled") {
        return NextResponse.json({ error: "เปิดการยืนยันตัวตน 2 ขั้นอยู่แล้ว" }, { status: 409 });
      }
      return NextResponse.json(
        { error: "ยังไม่ได้เริ่มตั้งค่า กรุณากด “เริ่มตั้งค่า” เพื่อรับ QR ใหม่" },
        { status: 400 }
      );
    }
    await clearLoginFailures(lockKey);

    const epoch = await bumpSessionEpoch();
    revalidateTag(SESSION_EPOCH_TAG, { expire: 0 });
    await createSession(session.userId, session.username, epoch);
    const response = NextResponse.json(
      { success: true, backupCodes: result.backupCodes },
      { headers: NO_STORE }
    );
    response.cookies.set(
      LOGIN_DEVICE_COOKIE,
      await issueLoginDeviceToken(session.username, epoch),
      LOGIN_DEVICE_COOKIE_OPTIONS
    );
    return response;
  }
);

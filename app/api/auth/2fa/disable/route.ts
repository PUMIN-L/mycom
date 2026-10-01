import { NextRequest, NextResponse } from "next/server";
import { withRoute, requireAuth } from "../../../../lib/apiHelpers";
import { disableTwoFactor, getTwoFactorUser } from "../../../../lib/twoFactor";
import { requirePassword, requireSecondFactor } from "../../../../lib/twoFactorReauth";

// POST /api/auth/2fa/disable (login required) — turn 2FA off.
// Body: { password, code } — the current password AND a code from the app (or
// a backup code). Both, because this removes the protection: a stolen session,
// or a known password, must not be enough on its own.
export const POST = withRoute(
  "ปิดการยืนยันตัวตน 2 ขั้นไม่สำเร็จ",
  async (request: NextRequest) => {
    const session = await requireAuth();
    const body = (await request.json()) as { password?: unknown; code?: unknown } | null;

    const user = await getTwoFactorUser(session.userId);
    if (!user) return NextResponse.json({ error: "ไม่พบบัญชีผู้ใช้" }, { status: 404 });
    if (!user.totpEnabled) {
      return NextResponse.json({ error: "ยังไม่ได้เปิดการยืนยันตัวตน 2 ขั้น" }, { status: 409 });
    }

    const passwordRefusal = await requirePassword(user, body?.password);
    if (passwordRefusal) return passwordRefusal;
    const codeRefusal = await requireSecondFactor(user, body?.code);
    if (codeRefusal) return codeRefusal;

    await disableTwoFactor(user.id);
    return NextResponse.json({ success: true });
  }
);

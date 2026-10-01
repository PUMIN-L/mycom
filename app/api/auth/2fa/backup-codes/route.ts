import { NextRequest, NextResponse } from "next/server";
import { withRoute, requireAuth } from "../../../../lib/apiHelpers";
import { getTwoFactorUser, regenerateBackupCodes } from "../../../../lib/twoFactor";
import { NO_STORE, requirePassword, requireSecondFactor } from "../../../../lib/twoFactorReauth";

// POST /api/auth/2fa/backup-codes (login required) — a fresh set of backup
// codes; every earlier one, used or not, stops working. Body: { password,
// code }. For when the old sheet is used up, lost, or may have been seen.
// The new codes are in this response and nowhere else in plain text.
export const POST = withRoute(
  "สร้างรหัสสำรองชุดใหม่ไม่สำเร็จ",
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

    const backupCodes = await regenerateBackupCodes(user.id);
    return NextResponse.json({ success: true, backupCodes }, { headers: NO_STORE });
  }
);

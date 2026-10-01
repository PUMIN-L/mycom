import { NextResponse } from "next/server";
import { withRoute, requireAuth } from "../../../lib/apiHelpers";
import { countUnusedBackupCodes, getTwoFactorUser } from "../../../lib/twoFactor";

// GET /api/auth/2fa (login required) — is two-factor login on for this
// account, and how many backup codes are left. Read by the settings page.
export const GET = withRoute(
  "โหลดสถานะการยืนยันตัวตน 2 ขั้นไม่สำเร็จ",
  async () => {
    const session = await requireAuth();
    const user = await getTwoFactorUser(session.userId);
    if (!user) {
      return NextResponse.json({ error: "ไม่พบบัญชีผู้ใช้" }, { status: 404 });
    }
    return NextResponse.json({
      enabled: user.totpEnabled,
      backupCodesRemaining: user.totpEnabled ? await countUnusedBackupCodes(user.id) : 0,
    });
  }
);

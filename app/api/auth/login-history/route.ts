import { NextResponse } from "next/server";
import { requireAuth, withRoute } from "../../../lib/apiHelpers";
import { LOGIN_HISTORY_RETENTION_DAYS, listLoginHistory } from "../../../lib/loginEvents";
import { PASSWORD_OTP_EMAIL, maskEmail } from "../../../lib/passwordReset";

// GET /api/auth/login-history — the newest logins of every account, for
// /settings → "ประวัติการเข้าสู่ระบบ" (lib/loginEvents.ts). `alertEmail` is
// where the new-device emails go, masked like the password-code screens.
export const GET = withRoute("โหลดประวัติการเข้าสู่ระบบไม่สำเร็จ", async () => {
  await requireAuth();
  return NextResponse.json({
    entries: await listLoginHistory(),
    alertEmail: maskEmail(PASSWORD_OTP_EMAIL),
    retentionDays: LOGIN_HISTORY_RETENTION_DAYS,
  });
});

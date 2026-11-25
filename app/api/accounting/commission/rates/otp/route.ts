import { NextRequest } from "next/server";
import { withRoute, ApiError } from "../../../../../lib/apiHelpers";
import { noStoreJson, requireAccountingUser } from "../../../../../lib/accounting/guard";
import { otpIssueRefused } from "../../../../../lib/otpAttempts";
import { maskEmail } from "../../../../../lib/passwordReset";
import { cleanRateChange } from "../../../../../lib/accounting/commissionRateChange";
import { COMMISSION_EMAIL } from "../../../../../lib/accounting/commissionEmails";
import { RATES_OTP_TTL_MINUTES, requestRatesCode } from "../../../../../lib/accounting/commissionRates";

// POST /api/accounting/commission/rates/otp — { change }: email the owner a
// 6-digit code for this change to the commission rate table (a save of one
// month's set, or the removal of a later one). The code approves exactly this
// change. Answers where it went (masked) and how long it lasts; 429 when codes
// are asked for too often.
export const POST = withRoute("ส่งรหัสยืนยันไม่สำเร็จ", async (request: NextRequest) => {
  const { actor } = await requireAccountingUser();
  const body = (await request.json()) as Record<string, unknown> | null;
  const change = cleanRateChange(body?.change);
  if (!change) throw new ApiError(400, "ข้อมูลตารางอัตราไม่ถูกต้อง");
  const result = await requestRatesCode(change, actor);
  if (!result.allowed) {
    const refused = otpIssueRefused(result.retryAfterSeconds);
    refused.headers.set("Cache-Control", "no-store");
    return refused;
  }
  return noStoreJson({ sent: true, email: maskEmail(COMMISSION_EMAIL), minutes: RATES_OTP_TTL_MINUTES });
});

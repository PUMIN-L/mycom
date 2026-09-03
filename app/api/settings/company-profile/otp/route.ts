import { randomInt } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { withRoute, requireAuth } from "../../../../lib/apiHelpers";
import { getCompanyProfile, getContactEmail, setSetting } from "../../../../lib/settingsStore";
import { isMailConfigured, sendCompanyProfileOtpEmail } from "../../../../lib/mailer";
import { resetOtpAttempts } from "../../../../lib/otpAttempts";
import { parseCompanyProfilePartial, summarizeCompanyProfileChanges } from "../../../../lib/companyProfileValidation";

function generateOtp(): string {
  return randomInt(100000, 1000000).toString();
}

export const POST = withRoute(
  "ไม่สามารถส่งรหัส OTP ได้",
  async (request: NextRequest) => {
    await requireAuth();

    if (!isMailConfigured()) {
      return NextResponse.json(
        { error: "ระบบอีเมลยังไม่ได้ตั้งค่า (SMTP_USER/PASS) จึงไม่สามารถส่ง OTP ได้" },
        { status: 503 }
      );
    }

    const body = await request.json();
    const result = parseCompanyProfilePartial(body);
    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    const [current, currentEmail] = await Promise.all([getCompanyProfile(), getContactEmail()]);
    const changesSummary = summarizeCompanyProfileChanges(current, result.partial);

    const otp = generateOtp();
    const expiresAt = Date.now() + 15 * 60 * 1000; // 15 minutes

    // otp/expiresAt/pending are kept in ONE settings row (not three) so a
    // verifying PUT reads a single consistent snapshot instead of three
    // independent reads that a second, superseding OTP request could
    // interleave with (an old OTP authorizing a newer pending change).
    await setSetting(
      "company_profile_otp_state",
      JSON.stringify({ otp, expiresAt, pending: result.partial })
    );
    await resetOtpAttempts("company_profile_otp");

    await sendCompanyProfileOtpEmail(currentEmail, otp, changesSummary);

    return NextResponse.json({ success: true, message: "ส่งรหัส OTP แล้ว" });
  }
);

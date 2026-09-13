import { randomInt } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { withRoute, requireAuth } from "../../../../lib/apiHelpers";
import { getContactEmail, setSetting, isMaintenanceMode } from "../../../../lib/settingsStore";
import { isMailConfigured, sendMaintenanceOtpEmail } from "../../../../lib/mailer";
import { resetOtpAttempts } from "../../../../lib/otpAttempts";

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

    const { enable } = await request.json();
    const wantEnable = Boolean(enable);

    // Prevent toggling to the state that is already active.
    const currentlyEnabled = await isMaintenanceMode();
    if (wantEnable === currentlyEnabled) {
      return NextResponse.json(
        { error: wantEnable ? "โหมดปรับปรุงเปิดอยู่แล้ว" : "โหมดปรับปรุงปิดอยู่แล้ว" },
        { status: 400 }
      );
    }

    const otp = generateOtp();
    const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes

    // otp/expiresAt/enable are kept in ONE settings row so the verifying PUT
    // reads a single consistent snapshot — same pattern as company-profile OTP.
    await setSetting(
      "maintenance_otp_state",
      JSON.stringify({ otp, expiresAt, enable: wantEnable })
    );
    await resetOtpAttempts("maintenance_otp");

    const currentEmail = await getContactEmail();
    await sendMaintenanceOtpEmail(currentEmail, otp, wantEnable);

    return NextResponse.json({ success: true, message: "ส่งรหัส OTP แล้ว" });
  }
);

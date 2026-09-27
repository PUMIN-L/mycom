import { randomInt } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireAuth, withRoute } from "../../../../lib/apiHelpers";
import { getContactEmail, setSetting } from "../../../../lib/settingsStore";
import { isMailConfigured, sendOrphanDeleteOtpEmail } from "../../../../lib/mailer";
import { claimOtpIssue, otpIssueRefused, resetOtpAttempts } from "../../../../lib/otpAttempts";

// Generate a random 6-digit OTP — the same strength as every other OTP here.
// (It was 5 digits: ten times easier to guess, for a delete that cannot be
// undone.)
function generateOtp(): string {
  return randomInt(100000, 1000000).toString();
}

/**
 * POST /api/cloudinary/orphans/otp  (admin only)
 *
 * Sends a 6-digit OTP to the configured contact email to authorize
 * deletion of orphaned Cloudinary images.
 * Body: { imageCount: number }
 */
export const POST = withRoute(
  "ไม่สามารถส่งรหัสยืนยันได้",
  async (request: NextRequest) => {
    await requireAuth();

    if (!isMailConfigured()) {
      return NextResponse.json(
        { error: "ระบบอีเมลยังไม่ได้ตั้งค่า (SMTP_USER/PASS) จึงไม่สามารถส่งรหัสยืนยันได้" },
        { status: 503 }
      );
    }

    const { imageCount } = await request.json();
    if (!imageCount || typeof imageCount !== "number" || imageCount < 1) {
      return NextResponse.json(
        { error: "ต้องระบุจำนวนรูป (imageCount)" },
        { status: 400 }
      );
    }

    const issue = await claimOtpIssue("orphan_delete_otp");
    if (!issue.allowed) return otpIssueRefused(issue.retryAfterSeconds);

    const otp = generateOtp();
    const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes

    // Save OTP to settings store
    await setSetting("orphan_delete_otp", otp);
    await setSetting("orphan_delete_otp_expires", expiresAt.toString());
    await resetOtpAttempts("orphan_delete_otp");

    // Send OTP to the configured contact email
    const contactEmail = await getContactEmail();
    await sendOrphanDeleteOtpEmail(contactEmail, otp, imageCount);

    return NextResponse.json({ success: true, message: "ส่งรหัสยืนยันแล้ว" });
  }
);

import { NextRequest, NextResponse } from "next/server";
import { requireAuth, withRoute } from "../../../../lib/apiHelpers";
import { getContactEmail } from "../../../../lib/settingsStore";
import { setSetting, getSetting } from "../../../../lib/settingsStore";
import { isMailConfigured, sendOrphanDeleteOtpEmail } from "../../../../lib/mailer";

// Generate a random 5-digit OTP
function generateOtp(): string {
  return Math.floor(10000 + Math.random() * 90000).toString();
}

/**
 * POST /api/cloudinary/orphans/otp  (admin only)
 *
 * Sends a 5-digit OTP to the configured contact email to authorize
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
        { error: "imageCount is required" },
        { status: 400 }
      );
    }

    const otp = generateOtp();
    const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes

    // Save OTP to settings store
    await setSetting("orphan_delete_otp", otp);
    await setSetting("orphan_delete_otp_expires", expiresAt.toString());

    // Send OTP to the configured contact email
    const contactEmail = await getContactEmail();
    await sendOrphanDeleteOtpEmail(contactEmail, otp, imageCount);

    return NextResponse.json({ success: true, message: "ส่งรหัสยืนยันแล้ว" });
  }
);

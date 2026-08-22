import { NextRequest, NextResponse } from "next/server";
import { withRoute, requireAuth, jsonError } from "../../../../../lib/apiHelpers";
import { getSchedule, getEquipment } from "../../../../../lib/crmStore";
import { getContactEmail, setSetting } from "../../../../../lib/settingsStore";
import { isMailConfigured, sendScheduleDeleteOtpEmail } from "../../../../../lib/mailer";

// Generate a random 6-digit OTP
function generateOtp(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/**
 * POST /api/admin/schedules/[id]/delete-otp
 * Sends a 6-digit OTP to the contact email to authorize deleting a completed schedule.
 */
export const POST = withRoute(
  "ไม่สามารถส่งรหัส OTP ได้",
  async (
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
  ) => {
    await requireAuth();
    const { id } = await params;

    const schedule = await getSchedule(id);
    if (!schedule) return jsonError("ไม่พบนัดหมาย", 404);

    if (schedule.status !== "completed") {
      return NextResponse.json({
        needOtp: false,
        message: "นัดหมายนี้ยังไม่เสร็จสิ้น สามารถลบได้เลยโดยไม่ต้องใช้ OTP",
      });
    }

    if (!isMailConfigured()) {
      return NextResponse.json(
        { error: "ระบบอีเมลยังไม่ได้ตั้งค่า (SMTP_USER/PASS) จึงไม่สามารถส่ง OTP ได้" },
        { status: 503 }
      );
    }

    const contactEmail = await getContactEmail();
    if (!contactEmail) {
      return NextResponse.json(
        { error: "ไม่พบอีเมลผู้ดูแลระบบในระบบตั้งค่า" },
        { status: 400 }
      );
    }

    const otp = generateOtp();
    const expiresAt = Date.now() + 15 * 60 * 1000; // 15 minutes

    await setSetting(`schedule_delete_otp_${id}`, otp);
    await setSetting(`schedule_delete_otp_expires_${id}`, expiresAt.toString());

    let equipmentName: string | undefined;
    if (schedule.equipmentId) {
      try {
        const eq = await getEquipment(schedule.equipmentId);
        if (eq) equipmentName = `${eq.name || ""} (S/N: ${eq.serialNumber || "-"})`;
      } catch { /* ignore */ }
    }

    await sendScheduleDeleteOtpEmail(contactEmail, otp, {
      scheduleType: schedule.scheduleType,
      scheduledDate: schedule.scheduledDate,
      equipmentName,
    });

    return NextResponse.json({
      success: true,
      email: contactEmail,
      message: `ส่งรหัส OTP 6 หลักไปยัง ${contactEmail} เรียบร้อยแล้ว (รหัสมีอายุ 15 นาที)`,
    });
  }
);

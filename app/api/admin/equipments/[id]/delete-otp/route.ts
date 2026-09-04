import { randomInt } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { withRoute, requireAuth, jsonError } from "../../../../../lib/apiHelpers";
import { getEquipment, listSchedules } from "../../../../../lib/crmStore";
import { getContactEmail, setSetting } from "../../../../../lib/settingsStore";
import { isMailConfigured, sendEquipmentDeleteOtpEmail } from "../../../../../lib/mailer";
import { resetOtpAttempts } from "../../../../../lib/otpAttempts";

function generateOtp(): string {
  return randomInt(100000, 1000000).toString();
}

/**
 * POST /api/admin/equipments/[id]/delete-otp
 * Sends a 6-digit OTP to the contact email to authorize deleting equipment
 * that has one or more completed service schedules attached — deleting the
 * equipment cascades to those schedules and their logs, so this closes the
 * same gap the schedule-delete OTP flow protects against, reached via a
 * different route.
 */
export const POST = withRoute(
  "ไม่สามารถส่งรหัส OTP ได้",
  async (
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
  ) => {
    await requireAuth();
    const { id } = await params;

    const equipment = await getEquipment(id);
    if (!equipment) return jsonError("ไม่พบอุปกรณ์", 404);

    const schedules = await listSchedules(id);
    const completedCount = schedules.filter((s) => s.status === "completed").length;

    if (completedCount === 0) {
      return NextResponse.json({
        needOtp: false,
        message: "อุปกรณ์นี้ไม่มีประวัตินัดหมายที่เสร็จสิ้นแล้ว สามารถลบได้เลยโดยไม่ต้องใช้ OTP",
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

    await setSetting(`equipment_delete_otp_${id}`, otp);
    await setSetting(`equipment_delete_otp_expires_${id}`, expiresAt.toString());
    await resetOtpAttempts(`equipment_delete_otp_${id}`);

    await sendEquipmentDeleteOtpEmail(contactEmail, otp, {
      productName: equipment.productName || "อุปกรณ์",
      serialNumber: equipment.serialNumber || undefined,
      completedScheduleCount: completedCount,
    });

    return NextResponse.json({
      success: true,
      email: contactEmail,
      message: `ส่งรหัส OTP 6 หลักไปยัง ${contactEmail} เรียบร้อยแล้ว (รหัสมีอายุ 15 นาที)`,
    });
  }
);

import { randomInt } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { withRoute, requireAuth, jsonError } from "../../../../../lib/apiHelpers";
import { getEquipment, countProtectedServiceHistory } from "../../../../../lib/crmStore";
import { getContactEmail, setSetting } from "../../../../../lib/settingsStore";
import { isMailConfigured, sendEquipmentDeleteOtpEmail } from "../../../../../lib/mailer";
import { resetOtpAttempts } from "../../../../../lib/otpAttempts";

function generateOtp(): string {
  return randomInt(100000, 1000000).toString();
}

/**
 * POST /api/admin/equipments/[id]/delete-otp
 * Sends a 6-digit OTP to the contact email to authorize deleting equipment that
 * carries real service history — deleting the equipment cascades to that
 * history, so this closes the same gap the schedule-delete OTP flow protects
 * against, reached via a different route.
 *
 * The "does it need a code?" question is `countProtectedServiceHistory`, the
 * SAME call the DELETE makes. They must never be two tests: one asking about
 * completed schedules while the other asks about all history means either a
 * refusal to send the code the delete insists on, or a code for a delete that
 * would have gone through anyway.
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

    const history = await countProtectedServiceHistory(id);

    if (history.total === 0) {
      return NextResponse.json({
        needOtp: false,
        message:
          "อุปกรณ์นี้ยังไม่มีประวัติการให้บริการ (ทั้งนัดหมายที่เสร็จสิ้นและใบ Job ที่ปิดงานแล้ว) สามารถลบได้เลยโดยไม่ต้องใช้ OTP",
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
      // What the owner is about to destroy, counted the way he would count it.
      // Two doors write this history and the email names both, so a machine
      // visited only on ใบ Job does not read as "0 นัดหมาย" next to a warning
      // that its history is about to go.
      completedScheduleCount: history.completedSchedules,
      jobLogCount: history.jobLogs,
    });

    return NextResponse.json({
      success: true,
      email: contactEmail,
      message: `ส่งรหัส OTP 6 หลักไปยัง ${contactEmail} เรียบร้อยแล้ว (รหัสมีอายุ 15 นาที)`,
    });
  }
);

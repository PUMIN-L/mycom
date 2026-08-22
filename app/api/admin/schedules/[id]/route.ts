import { NextRequest, NextResponse } from "next/server";
import { withRoute, requireAuth, jsonError } from "../../../../lib/apiHelpers";
import {
  getSchedule,
  updateSchedule,
  deleteSchedule,
  SCHEDULE_TYPES,
  SCHEDULE_STATUSES,
} from "../../../../lib/crmStore";
import { getSetting, setSetting } from "../../../../lib/settingsStore";

// GET /api/admin/schedules/[id] — single schedule.
export const GET = withRoute(
  "โหลดข้อมูลนัดหมายไม่สำเร็จ",
  async (
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
  ) => {
    await requireAuth();
    const { id } = await params;
    const schedule = await getSchedule(id);
    if (!schedule) return jsonError("ไม่พบนัดหมาย", 404);
    return NextResponse.json(schedule);
  }
);

// PUT /api/admin/schedules/[id] — update schedule (type, date, status, notes).
// Completed schedules cannot be edited.
export const PUT = withRoute(
  "อัปเดตนัดหมายไม่สำเร็จ",
  async (
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
  ) => {
    await requireAuth();
    const { id } = await params;
    const data = await request.json();

    const existing = await getSchedule(id);
    if (!existing) return jsonError("ไม่พบนัดหมาย", 404);

    if (existing.status === "completed") {
      return jsonError("นัดหมายที่เสร็จสิ้นแล้วไม่สามารถแก้ไขได้", 400);
    }

    // Validate enum fields if provided
    if (
      data.scheduleType &&
      !(SCHEDULE_TYPES as readonly string[]).includes(data.scheduleType)
    ) {
      return jsonError(
        `scheduleType must be one of: ${SCHEDULE_TYPES.join(", ")}`,
        400
      );
    }
    if (
      data.status &&
      !(SCHEDULE_STATUSES as readonly string[]).includes(data.status)
    ) {
      return jsonError(
        `status must be one of: ${SCHEDULE_STATUSES.join(", ")}`,
        400
      );
    }

    const updated = await updateSchedule(id, data);
    if (!updated) return jsonError("ไม่พบนัดหมาย", 404);
    return NextResponse.json(updated);
  }
);

// DELETE /api/admin/schedules/[id] — remove a schedule.
// Completed schedules require a valid 6-digit OTP sent to admin contact email.
export const DELETE = withRoute(
  "ลบนัดหมายไม่สำเร็จ",
  async (
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
  ) => {
    await requireAuth();
    const { id } = await params;

    const schedule = await getSchedule(id);
    if (!schedule) return jsonError("ไม่พบนัดหมาย", 404);

    if (schedule.status === "completed") {
      let otp = "";
      try {
        const body = await request.json();
        otp = String(body.otp ?? "").trim();
      } catch {
        otp = request.nextUrl.searchParams.get("otp") || "";
      }

      if (!otp || otp.length !== 6) {
        return jsonError("กรุณาระบุรหัส OTP 6 หลักที่ถูกต้องจากอีเมล", 400);
      }

      const savedOtp = await getSetting(`schedule_delete_otp_${id}`);
      const expiresAtStr = await getSetting(`schedule_delete_otp_expires_${id}`);

      if (!savedOtp || otp !== savedOtp) {
        return jsonError("รหัส OTP ไม่ถูกต้อง", 400);
      }

      const expiresAt = parseInt(expiresAtStr || "0", 10);
      if (Date.now() > expiresAt) {
        await setSetting(`schedule_delete_otp_${id}`, "");
        await setSetting(`schedule_delete_otp_expires_${id}`, "0");
        return jsonError("รหัส OTP หมดอายุแล้ว กรุณาขอรหัสใหม่", 400);
      }

      // Clear used OTP
      await setSetting(`schedule_delete_otp_${id}`, "");
      await setSetting(`schedule_delete_otp_expires_${id}`, "0");
    }

    const deleted = await deleteSchedule(id);
    if (!deleted) return jsonError("ไม่พบนัดหมาย", 404);
    return NextResponse.json({ success: true });
  }
);

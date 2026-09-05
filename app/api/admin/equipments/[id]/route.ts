import { NextRequest, NextResponse } from "next/server";
import { withRoute, requireAuth, jsonError } from "../../../../lib/apiHelpers";
import {
  getEquipment,
  updateEquipment,
  deleteEquipment,
  listSchedules,
} from "../../../../lib/crmStore";
import { isValidDateString } from "../../../../lib/dateFormat";
import { EQUIPMENT_OWNERSHIP_SOURCES } from "../../../../lib/types";
import { getSetting, setSetting } from "../../../../lib/settingsStore";
import { recordOtpFailure, clearOtpAttempts } from "../../../../lib/otpAttempts";

/**
 * Guards the two ownership columns (spec: equipment-ownership). Returns a Thai
 * 400 for anything outside the known values — an unrecognised source is NEVER
 * quietly folded into the default, because "we sold it" is a claim about a real
 * deal and the whole point of the column is telling a confirmed classification
 * apart from a guessed one.
 *
 * An ABSENT field is not an error, and must not become one: this route takes
 * partial payloads, and `updateEquipment` merges over the stored row, so
 * omitting these two leaves the machine's own source and alert switch exactly
 * as they were. Twin of the copy in ../route.ts — duplicated rather than
 * shared, since a Next.js route module may only export route handlers.
 */
function validateOwnershipFields(
  data: Record<string, unknown>
): NextResponse | null {
  if (data.ownershipSource !== undefined) {
    const ok =
      typeof data.ownershipSource === "string" &&
      (EQUIPMENT_OWNERSHIP_SOURCES as readonly string[]).includes(
        data.ownershipSource
      );
    if (!ok) {
      return jsonError(
        'ที่มาของเครื่องไม่ถูกต้อง — ต้องเป็น "เราขายเอง" (sold_by_us) หรือ "ลูกค้าซื้อมาเอง เราดูแลให้" (customer_owned) เท่านั้น',
        400
      );
    }
  }
  if (data.warrantyAlertEnabled !== undefined) {
    const v = data.warrantyAlertEnabled;
    // 0/1 are accepted too: reads hand the client back the raw TINYINT(1) and
    // the equipment form echoes the whole record straight back on save.
    const ok = typeof v === "boolean" || v === 0 || v === 1;
    if (!ok) {
      return jsonError(
        "ค่าการเตือนประกันใกล้หมดไม่ถูกต้อง — ต้องเป็นเปิด (true) หรือปิด (false) เท่านั้น",
        400
      );
    }
  }
  return null;
}

// GET /api/admin/equipments/[id] — single equipment with joined display names.
export const GET = withRoute(
  "โหลดข้อมูลอุปกรณ์ไม่สำเร็จ",
  async (
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
  ) => {
    await requireAuth();
    const { id } = await params;
    const equipment = await getEquipment(id);
    if (!equipment) return jsonError("ไม่พบอุปกรณ์", 404);
    return NextResponse.json(equipment);
  }
);

// PUT /api/admin/equipments/[id] — update equipment details / warranty info.
export const PUT = withRoute(
  "อัปเดตอุปกรณ์ไม่สำเร็จ",
  async (
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
  ) => {
    await requireAuth();
    const { id } = await params;
    const data = await request.json();
    if (data.warrantyStartDate && !isValidDateString(data.warrantyStartDate)) {
      return jsonError("warrantyStartDate must be a valid date (YYYY-MM-DD)", 400);
    }
    if (data.warrantyEndDate && !isValidDateString(data.warrantyEndDate)) {
      return jsonError("warrantyEndDate must be a valid date (YYYY-MM-DD)", 400);
    }
    if (data.calibrationDate && !isValidDateString(data.calibrationDate)) {
      return jsonError("calibrationDate must be a valid date (YYYY-MM-DD)", 400);
    }
    const ownershipError = validateOwnershipFields(data);
    if (ownershipError) return ownershipError;
    const updated = await updateEquipment(id, data);
    if (!updated) return jsonError("ไม่พบอุปกรณ์", 404);
    return NextResponse.json(updated);
  }
);

// DELETE /api/admin/equipments/[id] — remove equipment (schedules+logs cascade).
// Deleting equipment that has one or more COMPLETED service schedules
// requires the same 6-digit emailed OTP as deleting a completed schedule
// directly (see /api/admin/schedules/[id]) — the cascade would otherwise
// delete that same protected history through an unguarded door.
export const DELETE = withRoute(
  "ลบอุปกรณ์ไม่สำเร็จ",
  async (
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
  ) => {
    await requireAuth();
    const { id } = await params;

    const equipment = await getEquipment(id);
    if (!equipment) return jsonError("ไม่พบอุปกรณ์", 404);

    const schedules = await listSchedules(id);
    const hasCompletedSchedule = schedules.some((s) => s.status === "completed");

    if (hasCompletedSchedule) {
      let otp = "";
      try {
        const body = await request.json();
        otp = String(body.otp ?? "").trim();
      } catch {
        otp = request.nextUrl.searchParams.get("otp") || "";
      }

      if (!otp || otp.length !== 6) {
        return NextResponse.json(
          { error: "กรุณาระบุรหัส OTP 6 หลักที่ถูกต้องจากอีเมล", needOtp: true },
          { status: 400 }
        );
      }

      const otpKey = `equipment_delete_otp_${id}`;
      const otpExpiresKey = `equipment_delete_otp_expires_${id}`;
      const savedOtp = await getSetting(otpKey);
      const expiresAtStr = await getSetting(otpExpiresKey);

      if (!savedOtp || otp !== savedOtp) {
        if (savedOtp) {
          const { locked } = await recordOtpFailure(otpKey, otpExpiresKey);
          if (locked) {
            return NextResponse.json(
              { error: "กรอกรหัส OTP ผิดเกินจำนวนที่กำหนด กรุณาขอรหัสใหม่", needOtp: true },
              { status: 400 }
            );
          }
        }
        return NextResponse.json(
          { error: "รหัส OTP ไม่ถูกต้อง", needOtp: true },
          { status: 400 }
        );
      }

      const expiresAt = parseInt(expiresAtStr || "0", 10);
      if (Date.now() > expiresAt) {
        await setSetting(otpKey, "");
        await setSetting(otpExpiresKey, "0");
        return NextResponse.json(
          { error: "รหัส OTP หมดอายุแล้ว กรุณาขอรหัสใหม่", needOtp: true },
          { status: 400 }
        );
      }

      await setSetting(otpKey, "");
      await setSetting(otpExpiresKey, "0");
      await clearOtpAttempts(otpKey);
    }

    const deleted = await deleteEquipment(id);
    if (!deleted) return jsonError("ไม่พบอุปกรณ์", 404);
    return NextResponse.json({ success: true });
  }
);

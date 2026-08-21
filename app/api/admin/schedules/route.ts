import { NextRequest, NextResponse } from "next/server";
import { withRoute, requireAuth, jsonError } from "../../../lib/apiHelpers";
import {
  listSchedules,
  addSchedule,
  getEquipment,
  SCHEDULE_TYPES,
} from "../../../lib/crmStore";

// GET /api/admin/schedules[?equipmentId=] — list service/call schedules.
export const GET = withRoute(
  "โหลดรายการนัดหมายไม่สำเร็จ",
  async (request: NextRequest) => {
    await requireAuth();
    const equipmentId =
      new URL(request.url).searchParams.get("equipmentId") || undefined;
    return NextResponse.json(await listSchedules(equipmentId));
  }
);

// POST /api/admin/schedules — create a new schedule for an equipment.
export const POST = withRoute(
  "สร้างนัดหมายไม่สำเร็จ",
  async (request: NextRequest) => {
    await requireAuth();
    const data = await request.json();

    if (
      !data.equipmentId ||
      typeof data.equipmentId !== "string" ||
      !data.equipmentId.trim()
    ) {
      return jsonError("equipmentId is required", 400);
    }

    // Verify equipment exists
    const equipment = await getEquipment(data.equipmentId);
    if (!equipment) {
      return jsonError("ไม่พบอุปกรณ์ที่อ้างอิง", 404);
    }

    if (
      !data.scheduleType ||
      !(SCHEDULE_TYPES as readonly string[]).includes(data.scheduleType)
    ) {
      return jsonError(
        `scheduleType must be one of: ${SCHEDULE_TYPES.join(", ")}`,
        400
      );
    }

    if (
      !data.scheduledDate ||
      typeof data.scheduledDate !== "string" ||
      !data.scheduledDate.trim()
    ) {
      return jsonError("scheduledDate is required", 400);
    }

    const created = await addSchedule(data);
    return NextResponse.json(created, { status: 201 });
  }
);

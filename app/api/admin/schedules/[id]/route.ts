import { NextRequest, NextResponse } from "next/server";
import { withRoute, requireAuth, jsonError } from "../../../../lib/apiHelpers";
import {
  getSchedule,
  updateSchedule,
  deleteSchedule,
  SCHEDULE_TYPES,
  SCHEDULE_STATUSES,
} from "../../../../lib/crmStore";

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
export const PUT = withRoute(
  "อัปเดตนัดหมายไม่สำเร็จ",
  async (
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
  ) => {
    await requireAuth();
    const { id } = await params;
    const data = await request.json();

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
export const DELETE = withRoute(
  "ลบนัดหมายไม่สำเร็จ",
  async (
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
  ) => {
    await requireAuth();
    const { id } = await params;
    const deleted = await deleteSchedule(id);
    if (!deleted) return jsonError("ไม่พบนัดหมาย", 404);
    return NextResponse.json({ success: true });
  }
);

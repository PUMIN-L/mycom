import { NextRequest, NextResponse } from "next/server";
import { withRoute, requireAuth, jsonError } from "../../../../lib/apiHelpers";
import {
  getSchedule,
  updateSchedule,
  deleteSchedule,
  SCHEDULE_TYPES,
  SCHEDULE_STATUSES,
  ScheduleCompletionRequiresLogError,
} from "../../../../lib/crmStore";
import { isValidDateString } from "../../../../lib/dateFormat";

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
    if (data.scheduledDate !== undefined && !isValidDateString(data.scheduledDate)) {
      return jsonError("scheduledDate must be a valid date (YYYY-MM-DD)", 400);
    }

    // A schedule can only become "completed" together with its result log, via
    // POST .../logs -> completeScheduleWithLog (one transaction, guarantees the
    // log<->completed invariant). Rejecting it here, not just in updateSchedule,
    // means the generic edit form can never silently complete a job with no
    // record of what was done.
    if (data.status === "completed") {
      return jsonError(
        "ต้องบันทึกผลงานผ่านหน้าจบงานเท่านั้น (แนบ service log)",
        400
      );
    }

    let updated;
    try {
      updated = await updateSchedule(id, data);
    } catch (err) {
      if (err instanceof ScheduleCompletionRequiresLogError) {
        return jsonError(
          "ต้องบันทึกผลงานผ่านหน้าจบงานเท่านั้น (แนบ service log)",
          400
        );
      }
      throw err;
    }
    if (!updated) return jsonError("ไม่พบนัดหมาย", 404);
    return NextResponse.json(updated);
  }
);

// DELETE /api/admin/schedules/[id] — remove a schedule (any status).
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

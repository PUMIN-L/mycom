import { NextRequest, NextResponse } from "next/server";
import { withRoute, requireAuth, ApiError } from "../../../../../lib/apiHelpers";
import {
  listLogs,
  completeScheduleWithLog,
  ScheduleNotPendingError,
} from "../../../../../lib/crmStore";

// GET /api/admin/schedules/[id]/logs — service/call result history.
export const GET = withRoute(
  "โหลดประวัติการทำงานไม่สำเร็จ",
  async (
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
  ) => {
    await requireAuth();
    const { id } = await params;
    return NextResponse.json(await listLogs(id));
  }
);

// POST /api/admin/schedules/[id]/logs — complete schedule + insert result log.
// Uses a transaction: the log is the sales-history record, so it must never
// exist without the status flip (or vice versa).
export const POST = withRoute(
  "บันทึกผลงานไม่สำเร็จ",
  async (
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
  ) => {
    await requireAuth();
    const { id } = await params;
    const data = await request.json();

    try {
      const log = await completeScheduleWithLog(id, data);
      return NextResponse.json(log, { status: 201 });
    } catch (error) {
      if (error instanceof ScheduleNotPendingError) {
        throw new ApiError(409, "นัดหมายนี้ไม่ได้อยู่ในสถานะ pending");
      }
      throw error;
    }
  }
);

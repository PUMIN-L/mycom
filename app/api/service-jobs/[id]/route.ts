import { NextRequest, NextResponse } from "next/server";
import { withRoute, requireAuth, jsonError } from "../../../lib/apiHelpers";
import { getJob, updateJob, deleteJob } from "../../../lib/serviceJobStore";
import {
  sanitizeJobBody,
  badRequestForShape,
  respondToJobError,
} from "../serviceJobRequest";

type Context = { params: Promise<{ id: string }> };

// GET /api/service-jobs/[id] — one sheet, with its machines in printed order.
export const GET = withRoute(
  "โหลดข้อมูลใบ Job ไม่สำเร็จ",
  async (_request: NextRequest, { params }: Context) => {
    await requireAuth();
    const { id } = await params;
    const job = await getJob(id);
    if (!job) return jsonError("ไม่พบใบ Job", 404);
    return NextResponse.json(job);
  }
);

// PUT /api/service-jobs/[id] — edit a sheet that has not been closed.
// The store refuses a completed or cancelled sheet with a Thai 400: one is
// history, the other is closed, and neither may be rewritten.
export const PUT = withRoute(
  "แก้ไขใบ Job ไม่สำเร็จ",
  async (request: NextRequest, { params }: Context) => {
    await requireAuth();
    const { id } = await params;
    const input = sanitizeJobBody(await request.json());
    const shapeError = badRequestForShape(input);
    if (shapeError) return shapeError;
    try {
      const updated = await updateJob(id, input);
      if (!updated) return jsonError("ไม่พบใบ Job", 404);
      return NextResponse.json(updated);
    } catch (error) {
      return respondToJobError(error);
    }
  }
);

// DELETE /api/service-jobs/[id] — remove a sheet issued by mistake.
// A CLOSED sheet cannot be deleted: its service_logs rows are the service
// history of real machines and name this job number.
export const DELETE = withRoute(
  "ลบใบ Job ไม่สำเร็จ",
  async (_request: NextRequest, { params }: Context) => {
    await requireAuth();
    const { id } = await params;
    try {
      const deleted = await deleteJob(id);
      if (!deleted) return jsonError("ไม่พบใบ Job", 404);
      return NextResponse.json({ success: true });
    } catch (error) {
      return respondToJobError(error);
    }
  }
);

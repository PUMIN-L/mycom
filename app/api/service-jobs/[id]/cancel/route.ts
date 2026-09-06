import { NextRequest, NextResponse } from "next/server";
import { withRoute, requireAuth, jsonError } from "../../../../lib/apiHelpers";
import { cancelJob } from "../../../../lib/serviceJobStore";
import { respondToJobError } from "../../serviceJobRequest";

// POST /api/service-jobs/[id]/cancel — the trip never happened.
//
// Only an `issued` sheet can be cancelled. A CLOSED one has already written
// service history, and cancelling it would leave service_logs describing a
// visit that the sheet itself denies — the store refuses that in Thai.
//
// The job number stays claimed in `used_docnos` forever: it may already be
// printed on paper, and a printed number must never be handed to a second
// document.
export const POST = withRoute(
  "ยกเลิกใบ Job ไม่สำเร็จ",
  async (_request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    await requireAuth();
    const { id } = await params;
    try {
      const job = await cancelJob(id);
      if (!job) return jsonError("ไม่พบใบ Job", 404);
      return NextResponse.json(job);
    } catch (error) {
      return respondToJobError(error);
    }
  }
);

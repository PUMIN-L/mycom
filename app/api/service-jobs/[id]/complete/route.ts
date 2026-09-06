import { NextRequest, NextResponse } from "next/server";
import { withRoute, requireAuth, jsonError } from "../../../../lib/apiHelpers";
import { sanitizePlainText } from "../../../../lib/sanitizeHtml";
import { completeJob } from "../../../../lib/serviceJobStore";
import { respondToJobError } from "../../serviceJobRequest";

// POST /api/service-jobs/[id]/complete — ปิดงาน: the signed paper is back.
//
// THIS is the request that writes service history — one service_logs row per
// machine on the sheet, filed under the job number the customer signed. Issuing
// the sheet deliberately wrote none: a sheet printed but never taken is not a
// visit, and a service record that claims otherwise cannot be told from a true
// one afterwards.
//
// Pressing it twice is harmless by design (see completeJob): the second call
// writes no second set of logs and returns the same closed sheet, so a
// double-click, a retried fetch or an impatient admin can never invent a visit.
//
// `workSummary` is optional — what the technician wrote by hand, typed back in.
export const POST = withRoute(
  "ปิดงานใบ Job ไม่สำเร็จ",
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    await requireAuth();
    const { id } = await params;

    // A close with no body is normal (the button sends nothing).
    let workSummary: string | null = null;
    try {
      const body = await request.json();
      if (body && body.workSummary != null) {
        workSummary = sanitizePlainText(String(body.workSummary)).substring(0, 10000);
      }
    } catch {
      workSummary = null;
    }

    try {
      const job = await completeJob(id, { workSummary });
      if (!job) return jsonError("ไม่พบใบ Job", 404);
      return NextResponse.json(job);
    } catch (error) {
      return respondToJobError(error);
    }
  }
);

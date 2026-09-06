import { NextRequest, NextResponse } from "next/server";
import { withRoute, requireAuth } from "../../lib/apiHelpers";
import { listJobs, listJobsForEquipment, createJob } from "../../lib/serviceJobStore";
import { sanitizePlainText } from "../../lib/sanitizeHtml";
import { sanitizeJobBody, badRequestForShape, respondToJobError } from "./serviceJobRequest";

// GET /api/service-jobs — list issued sheets (newest first).
// Optional filters: status, customerId, companyId, from, to (YYYY-MM-DD),
// search (job number), limit.
//
// `equipmentId` is the service HISTORY of one machine and takes a different
// road entirely (listJobsForEquipment joins service_job_equipments), so it is
// answered first and ignores the other filters rather than pretending to
// combine with them. The equipment detail view is its only caller.
export const GET = withRoute(
  "โหลดรายการใบ Job ไม่สำเร็จ",
  async (request: NextRequest) => {
    await requireAuth();
    const params = new URL(request.url).searchParams;
    const equipmentId = sanitizePlainText(params.get("equipmentId") ?? "")
      .trim()
      .substring(0, 36);
    if (equipmentId) {
      return NextResponse.json(await listJobsForEquipment(equipmentId));
    }
    const limitParam = params.get("limit");
    return NextResponse.json(
      await listJobs({
        status: params.get("status") || undefined,
        customerId: params.get("customerId") || undefined,
        companyId: params.get("companyId") || undefined,
        fromDate: params.get("from") || undefined,
        toDate: params.get("to") || undefined,
        search: params.get("search") || undefined,
        limit: limitParam ? Number(limitParam) : undefined,
      })
    );
  }
);

// POST /api/service-jobs — issue a sheet.
//
// The job number is minted by the store, inside the same transaction that
// writes the row, and is never accepted from the client: a number the browser
// chose is a number two browsers can choose.
//
// Issuing writes NO service history. The visit is recorded only when the signed
// paper comes back and someone presses ปิดงาน (POST .../[id]/complete).
export const POST = withRoute(
  "สร้างใบ Job ไม่สำเร็จ",
  async (request: NextRequest) => {
    await requireAuth();
    const input = sanitizeJobBody(await request.json());
    const shapeError = badRequestForShape(input);
    if (shapeError) return shapeError;
    try {
      return NextResponse.json(await createJob(input), { status: 201 });
    } catch (error) {
      return respondToJobError(error);
    }
  }
);

import { NextRequest, NextResponse } from "next/server";
import { withRoute, requireAuth } from "../../../lib/apiHelpers";
import { getAlerts } from "../../../lib/crmStore";

// GET /api/admin/alerts[?warrantyDays=30&scheduleDays=7]
// Returns equipment with expiring warranties + upcoming/overdue schedules.
export const GET = withRoute(
  "โหลดข้อมูลแจ้งเตือนไม่สำเร็จ",
  async (request: NextRequest) => {
    await requireAuth();
    const url = new URL(request.url);
    const warrantyDays = Math.min(
      Math.max(parseInt(url.searchParams.get("warrantyDays") || "30") || 30, 1),
      365
    );
    const scheduleDays = Math.min(
      Math.max(parseInt(url.searchParams.get("scheduleDays") || "7") || 7, 1),
      365
    );
    const calibrationDays = Math.min(
      Math.max(parseInt(url.searchParams.get("calibrationDays") || "30") || 30, 1),
      365
    );
    return NextResponse.json(await getAlerts(warrantyDays, scheduleDays, calibrationDays));
  }
);

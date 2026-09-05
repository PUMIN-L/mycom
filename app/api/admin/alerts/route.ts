import { NextRequest, NextResponse } from "next/server";
import { withRoute, requireAuth } from "../../../lib/apiHelpers";
import { getAlerts } from "../../../lib/crmStore";
import { countDueTasks } from "../../../lib/taskStore";

// GET /api/admin/alerts[?warrantyDays=30&scheduleDays=7]
// Everything the alert feed and the bell read: expiring warranties, upcoming
// equipment-scoped schedules, customer-scoped follow-up calls, incomplete
// records, missing documents, plus the manual board's due-task count.
export const GET = withRoute(
  "โหลดข้อมูลแจ้งเตือนไม่สำเร็จ",
  async (request: NextRequest) => {
    await requireAuth();
    const url = new URL(request.url);
    const warrantyDays = Math.min(
      Math.max(parseInt(url.searchParams.get("warrantyDays") || "30") || 30, 1),
      365
    );
    // Widens the equipment-scoped `upcomingSchedules` window ONLY.
    // `customerCallFollowUps` has no day window at all, by design.
    const scheduleDays = Math.min(
      Math.max(parseInt(url.searchParams.get("scheduleDays") || "7") || 7, 1),
      365
    );

    const [alerts, dueTaskCount] = await Promise.all([
      getAlerts(warrantyDays, scheduleDays),
      countDueTasks(),
    ]);
    return NextResponse.json({ ...alerts, dueTaskCount });
  }
);

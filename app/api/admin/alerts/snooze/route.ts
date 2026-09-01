import { NextRequest, NextResponse } from "next/server";
import { withRoute, requireAuth } from "../../../../lib/apiHelpers";
import { snoozeAlert } from "../../../../lib/crmStore";
import { z } from "zod";

const snoozeSchema = z.object({
  alertType: z.string().min(1),
  referenceId: z.string().min(1),
  snoozeUntil: z.string().datetime(), // Requires ISO string
});

// POST /api/admin/alerts/snooze
// Body: { alertType: string, referenceId: string, snoozeUntil: string }
export const POST = withRoute(
  "เลื่อนการแจ้งเตือนไม่สำเร็จ",
  async (request: NextRequest) => {
    await requireAuth();
    const body = await request.json();
    const parsed = snoozeSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "ข้อมูลไม่ครบถ้วนหรือไม่ถูกต้อง" }, { status: 400 });
    }

    await snoozeAlert(parsed.data.alertType, parsed.data.referenceId, parsed.data.snoozeUntil);
    return NextResponse.json({ success: true });
  }
);

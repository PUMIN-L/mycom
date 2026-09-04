import { NextRequest, NextResponse } from "next/server";
import { withRoute, requireAuth, jsonError } from "../../../lib/apiHelpers";
import {
  listSchedules,
  addSchedule,
  getEquipment,
  SCHEDULE_TYPES,
} from "../../../lib/crmStore";
import { isValidDateString } from "../../../lib/dateFormat";
import { query } from "../../../lib/db";

// GET /api/admin/schedules[?equipmentId=|?customerId=] — list service/call schedules.
export const GET = withRoute(
  "โหลดรายการนัดหมายไม่สำเร็จ",
  async (request: NextRequest) => {
    await requireAuth();
    const params = new URL(request.url).searchParams;
    const equipmentId = params.get("equipmentId") || undefined;
    const customerId = params.get("customerId") || undefined;
    return NextResponse.json(await listSchedules(equipmentId, customerId));
  }
);

// POST /api/admin/schedules — create a new schedule for EITHER an equipment
// or a customer directly (a general follow-up call not tied to any specific
// equipment — always scheduleType "phone_call").
export const POST = withRoute(
  "สร้างนัดหมายไม่สำเร็จ",
  async (request: NextRequest) => {
    await requireAuth();
    const data = await request.json();

    const hasEquipmentId = typeof data.equipmentId === "string" && data.equipmentId.trim();
    const hasCustomerId = typeof data.customerId === "string" && data.customerId.trim();

    if (!hasEquipmentId && !hasCustomerId) {
      return jsonError("equipmentId or customerId is required", 400);
    }

    if (hasEquipmentId) {
      const equipment = await getEquipment(data.equipmentId);
      if (!equipment) {
        return jsonError("ไม่พบอุปกรณ์ที่อ้างอิง", 404);
      }
      if (
        !data.scheduleType ||
        !(SCHEDULE_TYPES as readonly string[]).includes(data.scheduleType)
      ) {
        return jsonError(
          `scheduleType must be one of: ${SCHEDULE_TYPES.join(", ")}`,
          400
        );
      }
    } else {
      const [customers] = (await query(
        "SELECT id FROM customers WHERE id = ? LIMIT 1",
        [data.customerId]
      )) as any[];
      if (customers.length === 0) {
        return jsonError("ไม่พบลูกค้าที่อ้างอิง", 404);
      }
      // A customer-scoped schedule is always a phone-call follow-up — there's
      // no equipment context for a "service" visit. addSchedule() would
      // coerce this too, but reject explicitly here for a clear error instead
      // of silently overriding whatever the client asked for.
      if (data.scheduleType && data.scheduleType !== "phone_call") {
        return jsonError(
          "การนัดหมายลูกค้าโดยตรง (ไม่ผูกกับอุปกรณ์) รองรับเฉพาะประเภทโทรติดตามเท่านั้น",
          400
        );
      }
    }

    if (
      !data.scheduledDate ||
      typeof data.scheduledDate !== "string" ||
      !isValidDateString(data.scheduledDate)
    ) {
      return jsonError("scheduledDate must be a valid date (YYYY-MM-DD)", 400);
    }

    const created = await addSchedule(data);
    return NextResponse.json(created, { status: 201 });
  }
);

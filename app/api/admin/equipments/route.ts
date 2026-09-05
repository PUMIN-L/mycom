import { NextRequest, NextResponse } from "next/server";
import { withRoute, requireAuth, jsonError } from "../../../lib/apiHelpers";
import { listEquipments, addEquipment } from "../../../lib/crmStore";
import { isValidDateString } from "../../../lib/dateFormat";
import { EQUIPMENT_OWNERSHIP_SOURCES } from "../../../lib/types";

// CRM equipment registry (admin-only). Spec:
// openspec/changes/add-crm-service-tracking — document numbers are text refs.

/**
 * Guards the two ownership columns (spec: equipment-ownership). Returns a Thai
 * 400 for anything outside the known values — an unrecognised source is NEVER
 * quietly folded into the default, because "we sold it" is a claim about a
 * real deal and the whole point of the column is telling a confirmed
 * classification apart from a guessed one.
 *
 * A field that is simply ABSENT is not an error: POST then takes the store's
 * default, and PUT keeps whatever the row already holds (partial updates must
 * not reset these). Twin of the copy in ./[id]/route.ts — kept local to each
 * route file rather than exported from one, since a Next.js route module may
 * only export route handlers.
 */
function validateOwnershipFields(
  data: Record<string, unknown>
): NextResponse | null {
  if (data.ownershipSource !== undefined) {
    const ok =
      typeof data.ownershipSource === "string" &&
      (EQUIPMENT_OWNERSHIP_SOURCES as readonly string[]).includes(
        data.ownershipSource
      );
    if (!ok) {
      return jsonError(
        'ที่มาของเครื่องไม่ถูกต้อง — ต้องเป็น "เราขายเอง" (sold_by_us) หรือ "ลูกค้าซื้อมาเอง เราดูแลให้" (customer_owned) เท่านั้น',
        400
      );
    }
  }
  if (data.warrantyAlertEnabled !== undefined) {
    const v = data.warrantyAlertEnabled;
    // 0/1 are accepted too: reads hand the client back the raw TINYINT(1) and
    // the equipment form echoes the whole record straight back on save.
    const ok = typeof v === "boolean" || v === 0 || v === 1;
    if (!ok) {
      return jsonError(
        "ค่าการเตือนประกันใกล้หมดไม่ถูกต้อง — ต้องเป็นเปิด (true) หรือปิด (false) เท่านั้น",
        400
      );
    }
  }
  return null;
}

// GET /api/admin/equipments[?customerId=] — list sold equipment (+names joined).
export const GET = withRoute(
  "โหลดรายการอุปกรณ์ไม่สำเร็จ",
  async (request: NextRequest) => {
    await requireAuth();
    const customerId =
      new URL(request.url).searchParams.get("customerId") || undefined;
    return NextResponse.json(await listEquipments(customerId));
  }
);

// POST /api/admin/equipments — register a sold unit + its warranty.
export const POST = withRoute(
  "บันทึกอุปกรณ์ไม่สำเร็จ",
  async (request: NextRequest) => {
    await requireAuth();
    const data = await request.json();

    if (!data.customerId || typeof data.customerId !== "string" || !data.customerId.trim()) {
      return jsonError("customerId is required", 400);
    }
    if (!data.productId || typeof data.productId !== "string" || !data.productId.trim()) {
      return jsonError("productId is required", 400);
    }
    if (data.warrantyStartDate && !isValidDateString(data.warrantyStartDate)) {
      return jsonError("warrantyStartDate must be a valid date (YYYY-MM-DD)", 400);
    }
    if (data.warrantyEndDate && !isValidDateString(data.warrantyEndDate)) {
      return jsonError("warrantyEndDate must be a valid date (YYYY-MM-DD)", 400);
    }
    if (data.calibrationDate && !isValidDateString(data.calibrationDate)) {
      return jsonError("calibrationDate must be a valid date (YYYY-MM-DD)", 400);
    }
    const ownershipError = validateOwnershipFields(data);
    if (ownershipError) return ownershipError;

    const created = await addEquipment(data);
    return NextResponse.json(created, { status: 201 });
  }
);

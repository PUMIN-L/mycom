import { NextRequest, NextResponse } from "next/server";
import { withRoute, requireAuth, jsonError } from "../../../lib/apiHelpers";
import { listEquipments, addEquipment } from "../../../lib/crmStore";
import { isValidDateString } from "../../../lib/dateFormat";

// CRM equipment registry (admin-only). Spec:
// openspec/changes/add-crm-service-tracking — document numbers are text refs.

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

    const created = await addEquipment(data);
    return NextResponse.json(created, { status: 201 });
  }
);

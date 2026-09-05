import { NextRequest, NextResponse } from "next/server";
import { withRoute, requireAuth } from "../../../../lib/apiHelpers";
import { findEquipmentsBySerial } from "../../../../lib/crmStore";

// GET /api/admin/equipments/serial-check?serials=SN-1,SN-2 (login required) —
// which of these serials are already registered in `customer_equipments`, with
// the customer and sales record they belong to.
//
// Advisory only (task 5.4 / D13): serials are deliberately NOT unique, because
// the same machine legitimately comes back on a new bill (replacement, resale,
// re-registration). The answer only feeds a confirm dialog the user can accept,
// so "nothing found" — no param, blank values, or a lookup that failed — is a
// 200 with an empty list, never an error that could stall a save.
//
// Serials are normalized (trim + case-insensitive), de-duplicated and capped in
// `findEquipmentsBySerial`, matching the identity rule the equipment writer
// uses, so this route only has to split the parameter.
export const GET = withRoute(
  "ตรวจสอบ serial ซ้ำไม่สำเร็จ",
  async (request: NextRequest) => {
    await requireAuth();

    // Accept both `?serials=a,b` and a repeated `?serials=a&serials=b`, so a
    // whole form's worth of machines can be checked in one request.
    const serials = new URL(request.url).searchParams
      .getAll("serials")
      .flatMap((value) => value.split(","))
      .map((value) => value.trim())
      .filter(Boolean);

    if (serials.length === 0) {
      return NextResponse.json({ matches: [] });
    }

    return NextResponse.json({ matches: await findEquipmentsBySerial(serials) });
  }
);

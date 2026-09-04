import { NextRequest, NextResponse } from "next/server";
import { withRoute, requireAuth, jsonError } from "../../../../../lib/apiHelpers";
import { declineWarrantyRenewal } from "../../../../../lib/crmStore";

/**
 * POST /api/admin/equipments/[id]/decline-renewal
 * Records that the customer chose not to renew the warranty on this
 * equipment — flips status to "Expired" and appends a dated note. Triggered
 * from the "ลูกค้าไม่ต่อประกัน" action on the warranty-expiry alert.
 */
export const POST = withRoute(
  "บันทึกไม่สำเร็จ",
  async (
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
  ) => {
    await requireAuth();
    const { id } = await params;
    const updated = await declineWarrantyRenewal(id);
    if (!updated) return jsonError("ไม่พบอุปกรณ์", 404);
    return NextResponse.json(updated);
  }
);

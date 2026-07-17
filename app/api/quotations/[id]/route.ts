import { NextRequest, NextResponse } from "next/server";
import { withRoute, requireAuth } from "../../../lib/apiHelpers";
import { deleteQuotation } from "../../../lib/quotationStore";

type Ctx = { params: Promise<{ id: string }> };

// DELETE /api/quotations/[id] (login required) — remove the quotation and the
// images uploaded for it from Cloudinary. Catalog/product images are untouched.
export const DELETE = withRoute(
  "ลบใบเสนอราคาไม่สำเร็จ",
  async (_request: NextRequest, { params }: Ctx) => {
    await requireAuth();
    const { id } = await params;
    const ok = await deleteQuotation(id);
    return NextResponse.json({ success: ok });
  }
);

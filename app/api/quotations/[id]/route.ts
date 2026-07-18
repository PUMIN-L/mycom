import { NextRequest, NextResponse } from "next/server";
import { withRoute, requireAuth } from "../../../lib/apiHelpers";
import { deleteQuotation, getQuotation } from "../../../lib/quotationStore";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/quotations/[id] (login required) — fetch one to reopen in the builder.
export const GET = withRoute(
  "โหลดใบเสนอราคาไม่สำเร็จ",
  async (_request: NextRequest, { params }: Ctx) => {
    await requireAuth();
    const { id } = await params;
    const rec = await getQuotation(id);
    if (!rec) {
      return NextResponse.json({ error: "ไม่พบใบเสนอราคา" }, { status: 404 });
    }
    return NextResponse.json(rec);
  }
);

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

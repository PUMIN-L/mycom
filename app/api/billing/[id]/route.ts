import { NextRequest, NextResponse } from "next/server";
import { withRoute, requireAuth } from "../../../lib/apiHelpers";
import {
  getBillingDocument,
  deleteBillingDocument,
} from "../../../lib/billingStore";

// GET /api/billing/[id] (login required) — get a single billing document.
export const GET = withRoute(
  "โหลดเอกสารไม่สำเร็จ",
  async (_request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    await requireAuth();
    const { id } = await params;
    const doc = await getBillingDocument(id);
    if (!doc) {
      return NextResponse.json({ error: "ไม่พบเอกสาร" }, { status: 404 });
    }
    return NextResponse.json(doc);
  }
);

// DELETE /api/billing/[id] (login required) — delete a billing document.
export const DELETE = withRoute(
  "ลบเอกสารไม่สำเร็จ",
  async (_request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    await requireAuth();
    const { id } = await params;
    const deleted = await deleteBillingDocument(id);
    if (!deleted) {
      return NextResponse.json({ error: "ไม่พบเอกสาร" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  }
);

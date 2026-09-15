import { NextRequest, NextResponse } from "next/server";
import { withRoute, requireAuth } from "../../../lib/apiHelpers";
import { getPurchaseOrder, deletePurchaseOrder, PurchaseOrderNotFoundError } from "../../../lib/poStore";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/purchase-orders/[id] (login required) — fetch one to view/reopen.
// No PUT/PATCH here on purpose: a purchase order is never edited in place
// once created — see poStore.ts and the cancel/supersede routes.
export const GET = withRoute(
  "โหลดใบสั่งซื้อไม่สำเร็จ",
  async (_request: NextRequest, { params }: Ctx) => {
    await requireAuth();
    const { id } = await params;
    const rec = await getPurchaseOrder(id);
    if (!rec) {
      return NextResponse.json({ error: "ไม่พบใบสั่งซื้อ" }, { status: 404 });
    }
    return NextResponse.json(rec);
  }
);

// DELETE /api/purchase-orders/[id] (login required) — hard-delete a PO.
// Allowed for any status (active / cancelled / superseded) because a printed
// paper copy is always kept by the office; the DB row is just a convenience.
export const DELETE = withRoute(
  "ลบใบสั่งซื้อไม่สำเร็จ",
  async (_request: NextRequest, { params }: Ctx) => {
    await requireAuth();
    const { id } = await params;
    try {
      await deletePurchaseOrder(id);
    } catch (err) {
      if (err instanceof PurchaseOrderNotFoundError) {
        return NextResponse.json({ error: "ไม่พบใบสั่งซื้อ" }, { status: 404 });
      }
      throw err;
    }
    return NextResponse.json({ success: true });
  }
);

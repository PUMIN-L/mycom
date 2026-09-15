import { NextRequest, NextResponse } from "next/server";
import { withRoute, requireAuth } from "../../../../lib/apiHelpers";
import {
  cancelPurchaseOrder,
  PurchaseOrderNotFoundError,
  PurchaseOrderFinalizedError,
} from "../../../../lib/poStore";

type Ctx = { params: Promise<{ id: string }> };

// POST /api/purchase-orders/[id]/cancel (login required) — ยกเลิกใบสั่งซื้อ.
// Non-destructive: the row and its reserved docNo stay exactly as they were,
// just marked cancelled. Refuses a repeat on a PO already cancelled or
// already superseded.
export const POST = withRoute(
  "ยกเลิกใบสั่งซื้อไม่สำเร็จ",
  async (_request: NextRequest, { params }: Ctx) => {
    await requireAuth();
    const { id } = await params;
    try {
      await cancelPurchaseOrder(id, new Date().toISOString());
    } catch (err) {
      if (err instanceof PurchaseOrderNotFoundError) {
        return NextResponse.json({ error: "ไม่พบใบสั่งซื้อ" }, { status: 404 });
      }
      if (err instanceof PurchaseOrderFinalizedError) {
        return NextResponse.json(
          {
            error:
              err.reason === "cancelled"
                ? "ใบสั่งซื้อนี้ถูกยกเลิกไปแล้ว"
                : "ใบสั่งซื้อนี้ถูกออกใบใหม่แทนไปแล้ว ไม่สามารถยกเลิกได้",
          },
          { status: 409 }
        );
      }
      throw err;
    }
    return NextResponse.json({ success: true });
  }
);

import { NextRequest, NextResponse } from "next/server";
import { withRoute, requireAuth } from "../../../../lib/apiHelpers";
import {
  supersedePurchaseOrder,
  PoDocNoConflictError,
  PurchaseOrderNotFoundError,
  PurchaseOrderFinalizedError,
} from "../../../../lib/poStore";
import { computeQuoteTotals, hasNegativeLineItem } from "../../../../lib/quotationTotals";

type Ctx = { params: Promise<{ id: string }> };

// POST /api/purchase-orders/[id]/supersede (login required) —
// ออกใบสั่งซื้อใหม่แทนใบเดิม. Body carries the NEW PO's id/docNo/data (a
// brand-new document, not an edit of the old one). Mints/reserves the new
// docNo and stamps the old row's `supersededById` in one transaction — see
// poStore.ts. Refuses when the old PO is already cancelled or already
// superseded.
export const POST = withRoute(
  "ออกใบสั่งซื้อใหม่แทนใบเดิมไม่สำเร็จ",
  async (request: NextRequest, { params }: Ctx) => {
    await requireAuth();
    const { id: oldId } = await params;
    const body = await request.json();

    const id = String(body?.id ?? "").trim();
    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }
    if (JSON.stringify(body).length > 200000) {
      return NextResponse.json(
        { error: "ข้อมูลมีขนาดใหญ่เกินไป (สูงสุด 200KB)" },
        { status: 413 }
      );
    }

    const docNo = String(body?.docNo ?? "").slice(0, 255);
    const data = body?.data ?? {};
    if (hasNegativeLineItem(data) || computeQuoteTotals(data).grandTotal < 0) {
      return NextResponse.json(
        { error: "ยอดรวมสุทธิต้องไม่ติดลบ กรุณาตรวจสอบรายการสินค้า" },
        { status: 400 }
      );
    }

    const createdAt = new Date().toISOString();
    try {
      await supersedePurchaseOrder(oldId, { id, docNo, data, createdAt });
    } catch (err) {
      if (err instanceof PurchaseOrderNotFoundError) {
        return NextResponse.json({ error: "ไม่พบใบสั่งซื้อเดิม" }, { status: 404 });
      }
      if (err instanceof PurchaseOrderFinalizedError) {
        return NextResponse.json(
          {
            error:
              err.reason === "cancelled"
                ? "ใบสั่งซื้อเดิมถูกยกเลิกไปแล้ว ไม่สามารถออกใบใหม่แทนได้"
                : "ใบสั่งซื้อเดิมถูกออกใบใหม่แทนไปแล้ว",
          },
          { status: 409 }
        );
      }
      if (err instanceof PoDocNoConflictError) {
        return NextResponse.json(
          { error: "เลขที่ใบสั่งซื้อนี้ถูกใช้ไปแล้ว กรุณาเปลี่ยนเลขที่" },
          { status: 409 }
        );
      }
      throw err;
    }

    return NextResponse.json({ id });
  }
);

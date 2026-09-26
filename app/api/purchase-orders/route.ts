import { NextRequest, NextResponse } from "next/server";
import { withRoute, requireAuth } from "../../lib/apiHelpers";
import {
  createPurchaseOrder,
  PoDocNoConflictError,
  listPurchaseOrders,
} from "../../lib/poStore";
import { computeQuoteTotals, hasNegativeLineItem } from "../../lib/quotationTotals";

// GET /api/purchase-orders (login required) — list saved purchase orders
// (summary only).
export const GET = withRoute(
  "โหลดรายการใบสั่งซื้อไม่สำเร็จ",
  async () => {
    await requireAuth();
    return NextResponse.json(await listPurchaseOrders());
  }
);

// POST /api/purchase-orders (login required) — create a new purchase order.
//
// UNLIKE /api/quotations, this is create-only: a PO is never edited in place
// (see poStore.ts) — posting the same `id` twice with different `data` is
// not a supported path, only `withTransaction`'s own retry-safety uses the
// upsert underneath. Correcting an issued PO goes through
// POST /api/purchase-orders/[id]/supersede instead.
export const POST = withRoute(
  "บันทึกใบสั่งซื้อไม่สำเร็จ",
  async (request: NextRequest) => {
    await requireAuth();
    const body = await request.json();

    const id = String(body?.id ?? "").trim();
    if (!id) {
      return NextResponse.json({ error: "ต้องระบุ id ของเอกสาร" }, { status: 400 });
    }

    if (JSON.stringify(body).length > 200000) {
      return NextResponse.json(
        { error: "ข้อมูลมีขนาดใหญ่เกินไป (สูงสุด 200KB)" },
        { status: 413 }
      );
    }

    const docNo = String(body?.docNo ?? "").slice(0, 255);
    const data = body?.data ?? {};

    // `data` is otherwise opaque client state, but the grand total feeds a
    // real procurement commitment — a negative one (from a negative
    // qty/price line item) must never be silently accepted and saved.
    if (hasNegativeLineItem(data) || computeQuoteTotals(data).grandTotal < 0) {
      return NextResponse.json(
        { error: "ยอดรวมสุทธิต้องไม่ติดลบ กรุณาตรวจสอบรายการสินค้า" },
        { status: 400 }
      );
    }

    const createdAt = new Date().toISOString();
    try {
      await createPurchaseOrder({ id, docNo, data, createdAt });
    } catch (err) {
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

import { NextRequest, NextResponse } from "next/server";
import { withRoute, requireAuth } from "../../../../lib/apiHelpers";
import {
  getSalesRecord,
  updateSalesRecord,
  deleteSalesRecord,
} from "../../../../lib/salesDashboardStore";
import { syncEquipmentsForSalesRecord } from "../../../../lib/crmStore";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/admin/sales/[id] — single sales record
export const GET = withRoute(
  "โหลดรายการขายไม่สำเร็จ",
  async (_request: NextRequest, { params }: Ctx) => {
    await requireAuth();
    const { id } = await params;
    const record = await getSalesRecord(id);
    if (!record) {
      return NextResponse.json({ error: "ไม่พบรายการ" }, { status: 404 });
    }
    return NextResponse.json(record);
  }
);

// PUT /api/admin/sales/[id] — update
export const PUT = withRoute(
  "แก้ไขรายการขายไม่สำเร็จ",
  async (request: NextRequest, { params }: Ctx) => {
    await requireAuth();
    const { id } = await params;
    const body = await request.json();
    if (body.saleDate !== undefined) {
      if (!body.saleDate || !/^\d{4}-\d{2}-\d{2}$/.test(body.saleDate)) {
        return NextResponse.json(
          { error: "รูปแบบวันที่ขายไม่ถูกต้อง (YYYY-MM-DD)" },
          { status: 400 }
        );
      }
      if (isNaN(new Date(body.saleDate + "T00:00:00").getTime())) {
        return NextResponse.json(
          { error: "วันที่ไม่ถูกต้อง" },
          { status: 400 }
        );
      }
    }
    const updated = await updateSalesRecord(id, body);
    if (!updated) {
      return NextResponse.json({ error: "ไม่พบรายการ" }, { status: 404 });
    }

    // Sync equipments if sale type is equipment
    let equipmentWarning: string | null = null;
    if (body.saleType === "equipment" && Array.isArray(body.serialNumbers)) {
      const customerId = body.customerId || updated.customerId || "";
      if (customerId.trim()) {
        try {
          await syncEquipmentsForSalesRecord(id, body.serialNumbers, {
            customerId,
            productId: body.productId || updated.productId || "",
            productName: body.productName || updated.productName || "",
            quotationNumber: body.quotationRef || updated.quotationRef || "",
            warrantyCertNumber: "",
            warrantyType: "",
            warrantyStartDate: body.warrantyStartDate || updated.warrantyStartDate || null,
            warrantyEndDate: body.warrantyEndDate || updated.warrantyEndDate || null,
            status: "Active",
          });
        } catch (err: any) {
          console.error("syncEquipmentsForSalesRecord failed:", err);
          equipmentWarning = `บันทึกยอดขายสำเร็จ แต่ซิงค์อุปกรณ์ล้มเหลว: ${err.message}`;
        }
      }
    }

    // Re-fetch to include synced serial numbers in the response
    const final = await getSalesRecord(id) || updated;
    if (equipmentWarning) {
      return NextResponse.json({ ...final, warning: equipmentWarning });
    }
    return NextResponse.json(final);
  }
);

// DELETE /api/admin/sales/[id] — delete
export const DELETE = withRoute(
  "ลบรายการขายไม่สำเร็จ",
  async (_request: NextRequest, { params }: Ctx) => {
    await requireAuth();
    const { id } = await params;
    const deleted = await deleteSalesRecord(id);
    if (!deleted) {
      return NextResponse.json({ error: "ไม่พบรายการ" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  }
);

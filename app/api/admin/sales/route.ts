import { NextRequest, NextResponse } from "next/server";
import { withRoute, requireAuth } from "../../../lib/apiHelpers";
import {
  addSalesRecord,
  listSalesRecords,
} from "../../../lib/salesDashboardStore";
import { addEquipment } from "../../../lib/crmStore";

// GET /api/admin/sales — list sales records (filterable)
export const GET = withRoute(
  "โหลดรายการยอดขายไม่สำเร็จ",
  async (request: NextRequest) => {
    await requireAuth();
    const url = request.nextUrl;
    const filters = {
      salespersonId: url.searchParams.get("salespersonId") || undefined,
      customerId: url.searchParams.get("customerId") || undefined,
      categoryId: url.searchParams.get("categoryId")
        ? Number(url.searchParams.get("categoryId"))
        : undefined,
      dateFrom: url.searchParams.get("dateFrom") || undefined,
      dateTo: url.searchParams.get("dateTo") || undefined,
    };
    const records = await listSalesRecords(filters);
    return NextResponse.json(records);
  }
);

// POST /api/admin/sales — create a new sales record
export const POST = withRoute(
  "บันทึกยอดขายไม่สำเร็จ",
  async (request: NextRequest) => {
    await requireAuth();
    const body = await request.json();

    if (!body.saleDate || !/^\d{4}-\d{2}-\d{2}$/.test(body.saleDate)) {
      return NextResponse.json(
        { error: "กรุณาระบุวันที่ขาย (YYYY-MM-DD)" },
        { status: 400 }
      );
    }
    if (isNaN(new Date(body.saleDate + "T00:00:00").getTime())) {
      return NextResponse.json(
        { error: "วันที่ไม่ถูกต้อง" },
        { status: 400 }
      );
    }
    if (!body.productName && !body.productId) {
      return NextResponse.json(
        { error: "กรุณาระบุสินค้า" },
        { status: 400 }
      );
    }

    const record = await addSalesRecord(body);

    // Auto-create CustomerEquipments if customer is provided
    const createdEquipments = [];
    if (body.customerId && body.customerId.trim()) {
      // Prevent DoS: Cap the number of auto-created equipments to 50
      const maxAutoCreate = 50;
      let qty = Math.max(1, Number(body.qty) || 1);
      if (qty > maxAutoCreate) qty = maxAutoCreate;
      
      for (let i = 0; i < qty; i++) {
        const eq = await addEquipment({
          customerId: body.customerId,
          productId: body.productId || "",
          serialNumber: "", // to be filled
          quotationNumber: body.quotationRef || "",
          warrantyCertNumber: "",
          warrantyType: "",
          warrantyStartDate: null,
          warrantyEndDate: null,
          status: "Active",
        });
        createdEquipments.push(eq);
      }
    }

    return NextResponse.json({
      record,
      createdEquipments,
    }, { status: 201 });
  }
);

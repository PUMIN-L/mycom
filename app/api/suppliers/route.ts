import { NextResponse } from "next/server";
import { getAllSuppliers, createSupplier } from "../../lib/supplierStore";
import { withRoute, requireAuth, jsonError } from "../../lib/apiHelpers";

export const GET = withRoute(
  "โหลดรายชื่อซัพพลายเออร์ไม่สำเร็จ",
  async () => {
    await requireAuth();

    const rows = await getAllSuppliers();
    return NextResponse.json(rows);
  }
);

export const POST = withRoute(
  "เพิ่มซัพพลายเออร์ไม่สำเร็จ",
  async (request: Request) => {
    await requireAuth();

    const data = await request.json();
    if (!data.companyName || typeof data.companyName !== "string" || data.companyName.trim() === "") {
      return jsonError("กรุณากรอกชื่อบริษัท", 400);
    }

    const supplier = await createSupplier(data);
    return NextResponse.json(supplier);
  }
);

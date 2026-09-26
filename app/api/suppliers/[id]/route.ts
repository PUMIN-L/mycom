import { NextResponse } from "next/server";
import { getSupplier, updateSupplier, deleteSupplier } from "../../../lib/supplierStore";
import { withRoute, requireAuth, jsonError } from "../../../lib/apiHelpers";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withRoute(
  "โหลดข้อมูลซัพพลายเออร์ไม่สำเร็จ",
  async (request: Request, { params }: Ctx) => {
    await requireAuth();

    const { id } = await params;
    const supplier = await getSupplier(id);
    if (!supplier) {
      return jsonError("ไม่พบซัพพลายเออร์นี้", 404);
    }

    return NextResponse.json(supplier);
  }
);

export const PUT = withRoute(
  "แก้ไขซัพพลายเออร์ไม่สำเร็จ",
  async (request: Request, { params }: Ctx) => {
    await requireAuth();

    const { id } = await params;
    const data = await request.json();

    if (!data.companyName || typeof data.companyName !== "string" || data.companyName.trim() === "") {
      return jsonError("กรุณากรอกชื่อบริษัท", 400);
    }

    const updated = await updateSupplier(id, data);
    if (!updated) {
      return jsonError("ไม่พบซัพพลายเออร์นี้", 404);
    }

    return NextResponse.json(updated);
  }
);

export const DELETE = withRoute(
  "ลบซัพพลายเออร์ไม่สำเร็จ",
  async (request: Request, { params }: Ctx) => {
    await requireAuth();

    const { id } = await params;
    const success = await deleteSupplier(id);
    
    if (!success) {
      return jsonError("ไม่พบซัพพลายเออร์นี้", 404);
    }

    return NextResponse.json({ success: true });
  }
);

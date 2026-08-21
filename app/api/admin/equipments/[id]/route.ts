import { NextRequest, NextResponse } from "next/server";
import { withRoute, requireAuth, jsonError } from "../../../../lib/apiHelpers";
import {
  getEquipment,
  updateEquipment,
  deleteEquipment,
} from "../../../../lib/crmStore";

// GET /api/admin/equipments/[id] — single equipment with joined display names.
export const GET = withRoute(
  "โหลดข้อมูลอุปกรณ์ไม่สำเร็จ",
  async (
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
  ) => {
    await requireAuth();
    const { id } = await params;
    const equipment = await getEquipment(id);
    if (!equipment) return jsonError("ไม่พบอุปกรณ์", 404);
    return NextResponse.json(equipment);
  }
);

// PUT /api/admin/equipments/[id] — update equipment details / warranty info.
export const PUT = withRoute(
  "อัปเดตอุปกรณ์ไม่สำเร็จ",
  async (
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
  ) => {
    await requireAuth();
    const { id } = await params;
    const data = await request.json();
    const updated = await updateEquipment(id, data);
    if (!updated) return jsonError("ไม่พบอุปกรณ์", 404);
    return NextResponse.json(updated);
  }
);

// DELETE /api/admin/equipments/[id] — remove equipment (schedules+logs cascade).
export const DELETE = withRoute(
  "ลบอุปกรณ์ไม่สำเร็จ",
  async (
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
  ) => {
    await requireAuth();
    const { id } = await params;
    const deleted = await deleteEquipment(id);
    if (!deleted) return jsonError("ไม่พบอุปกรณ์", 404);
    return NextResponse.json({ success: true });
  }
);

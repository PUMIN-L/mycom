import { NextRequest, NextResponse } from "next/server";
import { withRoute, requireAuth, jsonError } from "../../../../lib/apiHelpers";
import { reorderTopics, listTopics } from "../../../../lib/taskStore";

// PATCH /api/admin/task-topics/reorder — write the whole new order at once.
// A static segment wins over the sibling [id] route, so this never collides
// with PATCH /api/admin/task-topics/<id>.
//
// The store writes every row in ONE transaction (all-or-nothing) and ignores
// ids that no longer exist, so a stale tab cannot break the reorder for the
// topics that are still there.
export const PATCH = withRoute(
  "จัดลำดับหัวข้องานไม่สำเร็จ",
  async (request: NextRequest) => {
    await requireAuth();
    const data = await request.json();

    if (!Array.isArray(data?.ids)) {
      return jsonError("กรุณาส่งลำดับหัวข้อเป็นรายการ (ids)", 400);
    }
    const ids = data.ids.map((value: unknown) => Number(value));
    if (ids.some((id: number) => !Number.isInteger(id) || id <= 0)) {
      return jsonError("รหัสหัวข้อในลำดับที่ส่งมาไม่ถูกต้อง", 400);
    }

    await reorderTopics(ids);
    return NextResponse.json({ success: true, topics: await listTopics(true) });
  }
);

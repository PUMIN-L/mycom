import { NextRequest, NextResponse } from "next/server";
import { withRoute, requireAuth, jsonError, ApiError } from "../../../../lib/apiHelpers";
import {
  getTask,
  getTopic,
  updateTask,
  deleteTask,
  TaskValidationError,
  TASK_STATUSES,
  type UpdateTaskInput,
  type TaskStatus,
} from "../../../../lib/taskStore";

// One task on the manual board. Spec: openspec/changes/add-crm-task-board.

/** Store-level validation carries a Thai, user-facing message. Surface it as a
 * 400 instead of letting `withRoute` log it as an unexpected 500. */
function toApiError(error: unknown): unknown {
  return error instanceof TaskValidationError ? new ApiError(400, error.message) : error;
}

// PATCH /api/admin/tasks/[id] — edit fields, flip status (done/pending), and/or
// REPLACE the whole link set. A field that is absent from the body is left
// alone; `dueDate` sent as null/"" clears it. Those are different requests.
export const PATCH = withRoute(
  "อัปเดตงานไม่สำเร็จ",
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    await requireAuth();
    const { id } = await params;
    const raw = await request.json();
    const data: Record<string, unknown> =
      raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};

    const task = await getTask(id);
    if (!task) return jsonError("ไม่พบงานที่ต้องการแก้ไข", 404);

    const updates: UpdateTaskInput = {};

    if (data.topicId !== undefined) {
      const topicId = Number(data.topicId);
      if (!Number.isInteger(topicId) || topicId <= 0) {
        return jsonError("กรุณาเลือกหัวข้อของงาน", 400);
      }
      const topic = await getTopic(topicId);
      if (!topic) return jsonError("ไม่พบหัวข้อที่เลือก กรุณาเลือกหัวข้ออื่น", 400);
      // A hidden topic can no longer receive work, but a task already filed
      // under one must stay editable without being forced to move.
      if (!topic.isActive && topicId !== task.topicId) {
        return jsonError("หัวข้อนี้ถูกซ่อนไปแล้ว กรุณาเลือกหัวข้ออื่น", 400);
      }
      updates.topicId = topicId;
    }

    if (data.title !== undefined) updates.title = String(data.title);
    if ("detail" in data) updates.detail = data.detail as string | null;
    if ("dueDate" in data) updates.dueDate = data.dueDate as string | null;

    if (data.status !== undefined) {
      const status = String(data.status);
      if (!(TASK_STATUSES as readonly string[]).includes(status)) {
        return jsonError(
          `สถานะของงานไม่ถูกต้อง ต้องเป็น ${TASK_STATUSES.join(" หรือ ")} เท่านั้น`,
          400
        );
      }
      updates.status = status as TaskStatus;
    }

    if (data.links !== undefined) {
      if (!Array.isArray(data.links)) {
        return jsonError("รูปแบบลิงก์ของงานไม่ถูกต้อง", 400);
      }
      updates.links = data.links;
    }

    try {
      const updated = await updateTask(id, updates);
      if (!updated) return jsonError("ไม่พบงานที่ต้องการแก้ไข", 404);
      return NextResponse.json(updated);
    } catch (error) {
      throw toApiError(error);
    }
  }
);

// DELETE /api/admin/tasks/[id] — permanent, and only ever on an explicit admin
// command. The store drops this task's own task_links rows in the same
// transaction (no FK, so no cascade) and never touches the link targets.
export const DELETE = withRoute(
  "ลบงานไม่สำเร็จ",
  async (_request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    await requireAuth();
    const { id } = await params;
    const deleted = await deleteTask(id);
    if (!deleted) return jsonError("ไม่พบงานที่ต้องการลบ", 404);
    return NextResponse.json({ success: true });
  }
);

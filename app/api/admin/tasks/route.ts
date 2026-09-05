import { NextRequest, NextResponse } from "next/server";
import { withRoute, requireAuth, jsonError, ApiError } from "../../../lib/apiHelpers";
import {
  listTasks,
  addTask,
  getTopic,
  TaskValidationError,
  TASK_STATUSES,
  type ListTasksOptions,
  type TaskStatus,
} from "../../../lib/taskStore";

// Manual task board behind /crm/alerts — post-it notes the admin writes for
// himself, NOT alerts the system computed.
// Spec: openspec/changes/add-crm-task-board.

/** Store-level validation carries a Thai, user-facing message. Surface it as a
 * 400 instead of letting `withRoute` log it as an unexpected 500. */
function toApiError(error: unknown): unknown {
  return error instanceof TaskValidationError ? new ApiError(400, error.message) : error;
}

/**
 * A task may only be filed under a topic that exists AND is still active — a
 * tab left open before the admin hid a topic must not be able to file new work
 * under it, and a missing topic is never auto-created.
 */
async function rejectUnusableTopic(rawId: unknown): Promise<Response | null> {
  const topicId = Number(rawId);
  if (!Number.isInteger(topicId) || topicId <= 0) {
    return jsonError("กรุณาเลือกหัวข้อของงาน", 400);
  }
  const topic = await getTopic(topicId);
  if (!topic) return jsonError("ไม่พบหัวข้อที่เลือก กรุณาเลือกหัวข้ออื่น", 400);
  if (!topic.isActive) {
    return jsonError("หัวข้อนี้ถูกซ่อนไปแล้ว กรุณาเลือกหัวข้ออื่น", 400);
  }
  return null;
}

// GET /api/admin/tasks[?topicId=&status=&limit=] — board listing with each
// task's links attached. Filtering is a VIEW: it writes nothing.
export const GET = withRoute(
  "โหลดรายการงานไม่สำเร็จ",
  async (request: NextRequest) => {
    await requireAuth();
    const params = new URL(request.url).searchParams;
    const options: ListTasksOptions = {};

    const rawTopicId = params.get("topicId");
    if (rawTopicId) {
      const topicId = Number(rawTopicId);
      if (!Number.isInteger(topicId) || topicId <= 0) {
        return jsonError("หัวข้อที่ใช้กรองไม่ถูกต้อง", 400);
      }
      options.topicId = topicId;
    }

    const status = params.get("status");
    if (status) {
      if (!(TASK_STATUSES as readonly string[]).includes(status)) {
        return jsonError(
          `สถานะของงานไม่ถูกต้อง ต้องเป็น ${TASK_STATUSES.join(" หรือ ")} เท่านั้น`,
          400
        );
      }
      options.status = status as TaskStatus;
    }

    const limit = Number(params.get("limit"));
    if (Number.isFinite(limit) && limit > 0) options.limit = limit;

    return NextResponse.json(await listTasks(options));
  }
);

// POST /api/admin/tasks — create one task plus all of its links in a single
// request (the store writes them in one transaction: all or nothing).
export const POST = withRoute(
  "บันทึกงานไม่สำเร็จ",
  async (request: NextRequest) => {
    await requireAuth();
    const data = await request.json();

    if (data?.links !== undefined && !Array.isArray(data.links)) {
      return jsonError("รูปแบบลิงก์ของงานไม่ถูกต้อง", 400);
    }
    const topicRejection = await rejectUnusableTopic(data?.topicId);
    if (topicRejection) return topicRejection;

    try {
      const created = await addTask({
        topicId: Number(data.topicId),
        title: data?.title,
        detail: data?.detail,
        dueDate: data?.dueDate,
        links: data?.links,
      });
      return NextResponse.json(created, { status: 201 });
    } catch (error) {
      throw toApiError(error);
    }
  }
);

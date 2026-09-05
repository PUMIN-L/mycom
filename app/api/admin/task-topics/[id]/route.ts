import { NextRequest, NextResponse } from "next/server";
import { withRoute, requireAuth, jsonError, ApiError } from "../../../../lib/apiHelpers";
import {
  getTopic,
  updateTopic,
  setTopicActive,
  deleteTopic,
  TaskValidationError,
  TopicInUseError,
} from "../../../../lib/taskStore";

// One task heading. Spec: openspec/changes/add-crm-task-board.

/** Store-level validation carries a Thai, user-facing message. Surface it as a
 * 400 instead of letting `withRoute` log it as an unexpected 500. */
function toApiError(error: unknown): unknown {
  return error instanceof TaskValidationError ? new ApiError(400, error.message) : error;
}

function parseTopicId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// PATCH /api/admin/task-topics/[id] — rename / re-emoji / recolour, and
// hide-or-restore via `isActive`. Hiding is a flag flip only: it deletes
// nothing and moves no task, so work already filed under the topic keeps
// loading and keeps showing its badge.
export const PATCH = withRoute(
  "อัปเดตหัวข้องานไม่สำเร็จ",
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    await requireAuth();
    const { id } = await params;
    const topicId = parseTopicId(id);
    if (topicId === null) return jsonError("รหัสหัวข้อไม่ถูกต้อง", 400);

    const raw = await request.json();
    const data: Record<string, unknown> =
      raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};

    if (!(await getTopic(topicId))) return jsonError("ไม่พบหัวข้อที่ต้องการแก้ไข", 404);

    try {
      if (
        data.name !== undefined ||
        data.icon !== undefined ||
        data.color !== undefined
      ) {
        await updateTopic(topicId, {
          ...(data.name !== undefined ? { name: String(data.name) } : {}),
          ...(data.icon !== undefined ? { icon: String(data.icon) } : {}),
          ...(data.color !== undefined ? { color: String(data.color) } : {}),
        });
      }
      if (data.isActive !== undefined) {
        await setTopicActive(topicId, Boolean(data.isActive));
      }
    } catch (error) {
      throw toApiError(error);
    }

    return NextResponse.json(await getTopic(topicId));
  }
);

// DELETE /api/admin/task-topics/[id] — allowed ONLY when no task references
// this topic (pending or done). `topicId` is a soft reference with no FK, so
// deleting one still in use would silently orphan that history; the admin is
// told to hide it instead.
export const DELETE = withRoute(
  "ลบหัวข้องานไม่สำเร็จ",
  async (_request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    await requireAuth();
    const { id } = await params;
    const topicId = parseTopicId(id);
    if (topicId === null) return jsonError("รหัสหัวข้อไม่ถูกต้อง", 400);

    try {
      const deleted = await deleteTopic(topicId);
      if (!deleted) return jsonError("ไม่พบหัวข้อที่ต้องการลบ", 404);
      return NextResponse.json({ success: true });
    } catch (error) {
      // Nothing was deleted — not the topic, not one task row.
      if (error instanceof TopicInUseError) return jsonError(error.message, 400);
      throw toApiError(error);
    }
  }
);

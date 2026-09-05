import { NextRequest, NextResponse } from "next/server";
import { withRoute, requireAuth, ApiError } from "../../../lib/apiHelpers";
import { listTopics, addTopic, TaskValidationError } from "../../../lib/taskStore";

// User-extensible task headings. Rows, never an enum — the owner adds his own
// over time. Spec: openspec/changes/add-crm-task-board.

/** Store-level validation carries a Thai, user-facing message. Surface it as a
 * 400 instead of letting `withRoute` log it as an unexpected 500. */
function toApiError(error: unknown): unknown {
  return error instanceof TaskValidationError ? new ApiError(400, error.message) : error;
}

// GET /api/admin/task-topics[?includeHidden=1]
// The board's filter chips and the create form want active topics only; the
// manage-topics modal asks for the hidden ones too.
export const GET = withRoute(
  "โหลดหัวข้องานไม่สำเร็จ",
  async (request: NextRequest) => {
    await requireAuth();
    const raw = new URL(request.url).searchParams.get("includeHidden");
    const includeHidden = raw === "1" || raw === "true";
    return NextResponse.json(await listTopics(includeHidden));
  }
);

// POST /api/admin/task-topics — add a heading (name + emoji + colour token).
export const POST = withRoute(
  "บันทึกหัวข้องานไม่สำเร็จ",
  async (request: NextRequest) => {
    await requireAuth();
    const data = await request.json();
    try {
      const created = await addTopic({
        name: data?.name,
        icon: data?.icon,
        color: data?.color,
      });
      return NextResponse.json(created, { status: 201 });
    } catch (error) {
      throw toApiError(error);
    }
  }
);

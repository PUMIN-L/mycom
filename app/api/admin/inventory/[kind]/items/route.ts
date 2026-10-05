import { NextResponse } from "next/server";
import { withRoute, requireAuth } from "../../../../../lib/apiHelpers";
import { addItems } from "../../../../../lib/inventoryStore";
import { inventoryKindFrom, inventoryApiError, objectBody } from "../../../../../lib/inventoryRoute";

// POST — add 1–100 pieces to an existing group (groupId) or a new one (group),
// each with its own code and serial. All or nothing.
export const POST = withRoute(
  "เพิ่มของไม่สำเร็จ",
  async (request: Request, { params }: { params: Promise<{ kind: string }> }) => {
    await requireAuth();
    const kind = await inventoryKindFrom(params);
    const body = objectBody(await request.json());
    try {
      return NextResponse.json(await addItems(kind, body), { status: 201 });
    } catch (error) {
      throw inventoryApiError(error);
    }
  }
);

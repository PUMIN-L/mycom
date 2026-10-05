import { NextResponse } from "next/server";
import { withRoute, requireAuth } from "../../../../../lib/apiHelpers";
import { createGroup } from "../../../../../lib/inventoryStore";
import { inventoryKindFrom, inventoryApiError, objectBody } from "../../../../../lib/inventoryRoute";

// POST — a new group (a model of thing) with no pieces yet.
export const POST = withRoute(
  "สร้างรายการไม่สำเร็จ",
  async (request: Request, { params }: { params: Promise<{ kind: string }> }) => {
    await requireAuth();
    const kind = await inventoryKindFrom(params);
    const body = objectBody(await request.json());
    try {
      return NextResponse.json(await createGroup(kind, body), { status: 201 });
    } catch (error) {
      throw inventoryApiError(error);
    }
  }
);

import { NextResponse } from "next/server";
import { withRoute, requireAuth } from "../../../../../../lib/apiHelpers";
import { bulkUpdateItems } from "../../../../../../lib/inventoryStore";
import { inventoryKindFrom, inventoryApiError, objectBody } from "../../../../../../lib/inventoryRoute";

// POST { ids, status?, statusParty?, statusDate?, location? } — the same
// status and/or place for many pieces. One piece that cannot take it refuses
// the lot; nothing is written.
export const POST = withRoute(
  "เปลี่ยนหลายชิ้นไม่สำเร็จ",
  async (request: Request, { params }: { params: Promise<{ kind: string }> }) => {
    await requireAuth();
    const kind = await inventoryKindFrom(params);
    const body = objectBody(await request.json());
    try {
      return NextResponse.json(await bulkUpdateItems(kind, body));
    } catch (error) {
      throw inventoryApiError(error);
    }
  }
);

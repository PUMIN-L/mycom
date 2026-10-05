import { NextResponse } from "next/server";
import { withRoute, requireAuth } from "../../../../../../../lib/apiHelpers";
import { mergeGroups } from "../../../../../../../lib/inventoryStore";
import { inventoryKindFrom, inventoryApiError, objectBody } from "../../../../../../../lib/inventoryRoute";

// POST { intoId } — move every piece of this group into `intoId`, then delete
// this group (a model that was created twice). All or nothing.
export const POST = withRoute(
  "รวมรายการไม่สำเร็จ",
  async (request: Request, { params }: { params: Promise<{ kind: string; id: string }> }) => {
    await requireAuth();
    const kind = await inventoryKindFrom(params);
    const { id } = await params;
    const body = objectBody(await request.json());
    try {
      return NextResponse.json(await mergeGroups(kind, id, body.intoId as string));
    } catch (error) {
      throw inventoryApiError(error);
    }
  }
);

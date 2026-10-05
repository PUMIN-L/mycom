import { NextResponse } from "next/server";
import { withRoute, requireAuth } from "../../../../../../lib/apiHelpers";
import { updateGroup, deleteGroup } from "../../../../../../lib/inventoryStore";
import { inventoryKindFrom, inventoryApiError, objectBody } from "../../../../../../lib/inventoryRoute";

type Ctx = { params: Promise<{ kind: string; id: string }> };

// PATCH — rename / recategorise a group (every piece in it follows).
export const PATCH = withRoute("แก้ไขรายการไม่สำเร็จ", async (request: Request, { params }: Ctx) => {
  await requireAuth();
  const kind = await inventoryKindFrom(params);
  const { id } = await params;
  const body = objectBody(await request.json());
  try {
    return NextResponse.json(await updateGroup(kind, id, body));
  } catch (error) {
    throw inventoryApiError(error);
  }
});

// DELETE — only an empty group (409 while it still holds pieces).
export const DELETE = withRoute("ลบรายการไม่สำเร็จ", async (_request: Request, { params }: Ctx) => {
  await requireAuth();
  const kind = await inventoryKindFrom(params);
  const { id } = await params;
  try {
    await deleteGroup(kind, id);
    return NextResponse.json({ success: true });
  } catch (error) {
    throw inventoryApiError(error);
  }
});

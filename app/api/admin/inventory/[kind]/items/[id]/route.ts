import { NextResponse } from "next/server";
import { withRoute, requireAuth, jsonError } from "../../../../../../lib/apiHelpers";
import { getItem, updateItem, deleteItem } from "../../../../../../lib/inventoryStore";
import { inventoryKindFrom, inventoryApiError, objectBody } from "../../../../../../lib/inventoryRoute";

type Ctx = { params: Promise<{ kind: string; id: string }> };

// GET — one piece with its group and timeline (the page a sticker's QR opens).
export const GET = withRoute("โหลดข้อมูลชิ้นนี้ไม่สำเร็จ", async (_request: Request, { params }: Ctx) => {
  await requireAuth();
  const kind = await inventoryKindFrom(params);
  const { id } = await params;
  const found = await getItem(kind, id);
  if (!found) return jsonError("ไม่พบชิ้นนี้ อาจถูกลบไปแล้ว", 404);
  return NextResponse.json(found);
});

// PATCH — the fields sent replace the current ones; the whole piece is then
// checked. Status / place / group changes go on its timeline.
export const PATCH = withRoute("แก้ไขข้อมูลไม่สำเร็จ", async (request: Request, { params }: Ctx) => {
  await requireAuth();
  const kind = await inventoryKindFrom(params);
  const { id } = await params;
  const body = objectBody(await request.json());
  try {
    return NextResponse.json(await updateItem(kind, id, body));
  } catch (error) {
    throw inventoryApiError(error);
  }
});

// DELETE — the piece and its timeline. Its code is never handed out again.
export const DELETE = withRoute("ลบไม่สำเร็จ", async (_request: Request, { params }: Ctx) => {
  await requireAuth();
  const kind = await inventoryKindFrom(params);
  const { id } = await params;
  try {
    await deleteItem(kind, id);
    return NextResponse.json({ success: true });
  } catch (error) {
    throw inventoryApiError(error);
  }
});

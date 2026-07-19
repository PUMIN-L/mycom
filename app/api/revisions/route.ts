import { NextRequest, NextResponse } from "next/server";
import { withRoute, requireAuth } from "../../lib/apiHelpers";
import {
  listRevisions,
  type RevisionEntityType,
} from "../../lib/revisionStore";

const ENTITY_TYPES: RevisionEntityType[] = ["product", "content", "document"];

// GET /api/revisions?entityType=content&entityId=abc (login required) —
// the edit history for one entity, newest first.
export const GET = withRoute("โหลดประวัติการแก้ไขไม่สำเร็จ", async (request: NextRequest) => {
  await requireAuth();
  const { searchParams } = new URL(request.url);
  const entityType = searchParams.get("entityType") ?? "";
  const entityId = searchParams.get("entityId") ?? "";

  if (!ENTITY_TYPES.includes(entityType as RevisionEntityType) || !entityId) {
    return NextResponse.json(
      { error: "entityType (product|content|document) and entityId are required" },
      { status: 400 }
    );
  }

  return NextResponse.json(
    await listRevisions(entityType as RevisionEntityType, entityId)
  );
});

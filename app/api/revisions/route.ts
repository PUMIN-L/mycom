import { NextRequest, NextResponse } from "next/server";
import { withRoute, requireAuth } from "../../lib/apiHelpers";
import {
  listRevisions,
  type RevisionEntityType,
} from "../../lib/revisionStore";

// Which entity types have a readable history.
//
// Written as a Record KEYED BY the union — not as an array of strings — so the
// compiler fails the build the moment `RevisionEntityType` gains a member that
// is not listed here. That is not hypothetical: `"customer"` joined the union
// in change `add-customer-note-search` so every write to a customer note kept
// a snapshot first, and this list was left at three. Snapshots were being
// written that this route then refused to hand back — a safety net that
// existed in the database and nowhere a person could reach it.
const ENTITY_TYPES: Record<RevisionEntityType, true> = {
  product: true,
  content: true,
  document: true,
  // The "บันทึกลูกค้า" call log. Its history is what makes the bulk
  // search-and-replace defensible, so it has to be listable.
  customer: true,
};

const ENTITY_TYPE_LIST = Object.keys(ENTITY_TYPES).join("|");

/** `Object.hasOwn`, not `in`: `"constructor" in ENTITY_TYPES` is true. */
function isEntityType(value: string): value is RevisionEntityType {
  return Object.hasOwn(ENTITY_TYPES, value);
}

// GET /api/revisions?entityType=content&entityId=abc (login required) —
// the edit history for one entity, newest first.
export const GET = withRoute("โหลดประวัติการแก้ไขไม่สำเร็จ", async (request: NextRequest) => {
  await requireAuth();
  const { searchParams } = new URL(request.url);
  const entityType = searchParams.get("entityType") ?? "";
  const entityId = searchParams.get("entityId") ?? "";

  if (!isEntityType(entityType) || !entityId) {
    return NextResponse.json(
      { error: `entityType (${ENTITY_TYPE_LIST}) and entityId are required` },
      { status: 400 }
    );
  }

  return NextResponse.json(await listRevisions(entityType, entityId));
});

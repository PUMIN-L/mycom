import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { withRoute, requireAuth } from "../../../../lib/apiHelpers";
import { getRevision } from "../../../../lib/revisionStore";
import { updateProduct } from "../../../../lib/productStore";
import { updateContent } from "../../../../lib/contentStore";
import { updateDocument } from "../../../../lib/documentStore";

type Ctx = { params: Promise<{ id: string }> };

// POST /api/revisions/[id]/restore (login required) — re-apply a snapshotted
// value to its entity. The restore is itself an update, so it snapshots the
// current value first (undo is also undoable). Restore lives here, not in
// revisionStore, so the stores → revisionStore dependency stays acyclic.
export const POST = withRoute(
  "กู้คืนเวอร์ชันไม่สำเร็จ",
  async (_request: NextRequest, { params }: Ctx) => {
    await requireAuth();
    const { id } = await params;

    const rev = await getRevision(id);
    if (!rev) {
      return NextResponse.json({ error: "Revision not found" }, { status: 404 });
    }

    const data = rev.data as Record<string, unknown>;
    switch (rev.entityType) {
      case "product":
        await updateProduct(rev.entityId, data);
        revalidateTag("products", { expire: 0 });
        break;
      case "content":
        await updateContent(rev.entityId, data);
        break;
      case "document":
        await updateDocument(rev.entityId, data);
        break;
    }

    return NextResponse.json({ success: true, entityId: rev.entityId });
  }
);

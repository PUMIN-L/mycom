import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { withRoute, requireAuth } from "../../../../lib/apiHelpers";
import { getRevision } from "../../../../lib/revisionStore";
import { updateProduct } from "../../../../lib/productStore";
import { updateContent, getContentByProductId } from "../../../../lib/contentStore";
import { updateDocument, getDocument } from "../../../../lib/documentStore";

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
      case "product": {
        // updateProduct returns undefined if the row was since deleted — the
        // snapshot can't be re-applied, so report 404 rather than a false 200.
        const updated = await updateProduct(rev.entityId, data);
        if (!updated) {
          return NextResponse.json({ error: "Product no longer exists" }, { status: 404 });
        }
        revalidateTag("products", { expire: 0 });
        break;
      }
      case "content": {
        // Enforce the same one-content-per-product invariant the PUT route does
        // (updateContent itself doesn't check), so a restore can't leave two
        // contents linked to the same product.
        const productId = data.productId;
        if (typeof productId === "string" && productId) {
          const owner = await getContentByProductId(productId);
          if (owner && owner.id !== rev.entityId) {
            return NextResponse.json(
              { error: "สินค้านี้มีเนื้อหาเชื่อมอยู่แล้ว" },
              { status: 409 }
            );
          }
        }
        const updated = await updateContent(rev.entityId, data);
        if (!updated) {
          return NextResponse.json({ error: "Content no longer exists" }, { status: 404 });
        }
        break;
      }
      case "document": {
        // updateDocument throws when the row is gone, so check first for a
        // consistent 404 instead of a 500.
        const existing = await getDocument(rev.entityId);
        if (!existing) {
          return NextResponse.json({ error: "Document no longer exists" }, { status: 404 });
        }
        await updateDocument(rev.entityId, data);
        break;
      }
    }

    return NextResponse.json({ success: true, entityId: rev.entityId });
  }
);

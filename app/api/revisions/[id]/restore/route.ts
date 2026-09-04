import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { withRoute, requireAuth } from "../../../../lib/apiHelpers";
import { getRevision } from "../../../../lib/revisionStore";
import { updateProduct, getAllCategories, getProduct } from "../../../../lib/productStore";
import { updateContent, getContentByProductId, ContentProductConflictError } from "../../../../lib/contentStore";
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
        // The snapshot's categoryId may no longer exist (category deleted
        // since) — restoring it as-is would silently orphan the product from
        // any real category. Validate before writing, don't just trust it.
        if (typeof data.categoryId === "number") {
          const categories = await getAllCategories();
          if (!categories.some((c) => c.id === data.categoryId)) {
            return NextResponse.json(
              { error: "หมวดหมู่สินค้าที่บันทึกไว้ถูกลบไปแล้ว ไม่สามารถกู้คืนได้" },
              { status: 400 }
            );
          }
        }
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
        // Pre-check the one-content-per-product invariant for a friendlier
        // 409 here (updateContent itself also enforces it, race-safe, as the
        // real backstop).
        const productId = data.productId;
        if (typeof productId === "string" && productId) {
          // The snapshot's productId may no longer exist (product deleted
          // since) — restoring it as-is would leave the content dangling.
          const product = await getProduct(productId);
          if (!product) {
            return NextResponse.json(
              { error: "สินค้าที่บันทึกไว้ถูกลบไปแล้ว ไม่สามารถกู้คืนได้" },
              { status: 400 }
            );
          }
          const owner = await getContentByProductId(productId);
          if (owner && owner.id !== rev.entityId) {
            return NextResponse.json(
              { error: "สินค้านี้มีเนื้อหาเชื่อมอยู่แล้ว" },
              { status: 409 }
            );
          }
        }
        let updated;
        try {
          updated = await updateContent(rev.entityId, data);
        } catch (err) {
          if (err instanceof ContentProductConflictError) {
            return NextResponse.json(
              { error: "สินค้านี้มีเนื้อหาเชื่อมอยู่แล้ว" },
              { status: 409 }
            );
          }
          throw err;
        }
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

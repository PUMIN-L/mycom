import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import type { RowDataPacket } from "mysql2";
import { withRoute, requireAuth, ApiError } from "../../../../lib/apiHelpers";
import { getRevision, saveRevision, type Revision } from "../../../../lib/revisionStore";
import { updateProduct, getAllCategories, getProduct } from "../../../../lib/productStore";
import { updateContent, getContentByProductId, ContentProductConflictError } from "../../../../lib/contentStore";
import { updateDocument, getDocument } from "../../../../lib/documentStore";
import { withTransaction } from "../../../../lib/db";
import { sanitizePlainText } from "../../../../lib/sanitizeHtml";
import { CUSTOMER_NOTE_MAX_LENGTH } from "../../../../lib/noteSearch";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Put back ONE column: `customers.note`.
 *
 * WHY ONLY THE NOTE, when the snapshot holds the whole customer row.
 * `note` is the only field the feature that created these snapshots ever
 * overwrites — the hand edit in `PUT /api/customers/[id]` and the bulk
 * search-and-replace in `customerNoteSearchStore.replaceInNotes` — so it is
 * the only field that ever needs undoing. Writing `name`, `phone`, `email` or
 * `companyId` back from an old snapshot would revert edits nobody asked to
 * revert, and would happily point a customer at a `companyId` that has since
 * been deleted. A restore that quietly does MORE than the edit it undoes is
 * not an undo. The response says `restoredFields: ["note"]` out loud for the
 * same reason.
 *
 * WHY A DELETED CUSTOMER IS REFUSED RATHER THAN RECREATED. Undoing an edit to
 * a note is not a reason to bring a customer back into existence; deleting the
 * customer was a separate, deliberate act (and `DELETE /api/customers/[id]`
 * guards it heavily). Refuse in Thai, like the other three types refuse a
 * deleted entity.
 *
 * IDEMPOTENCE. `withTransaction` retries this whole callback up to 3 times on
 * a transient connection loss, so everything that must not happen twice lives
 * INSIDE it: the current row is read in the attempt (never resolved before the
 * transaction opened), `saveRevision` mints its UUID inside the attempt and
 * runs through this transaction's own connection so a rolled-back attempt
 * leaves no stray snapshot, and a replay that re-reads an already-restored
 * note finds it equal and writes nothing at all.
 */
async function restoreCustomerNote(rev: Revision): Promise<Response> {
  const data = rev.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return NextResponse.json(
      { error: "ประวัติชิ้นนี้ไม่มีข้อมูลของลูกค้าเก็บไว้ จึงกู้คืนบันทึกไม่ได้" },
      { status: 400 }
    );
  }

  // The KEY has to be there. A snapshot that never carried a note (an older
  // or hand-made row) would otherwise "restore" an empty string over a live
  // call log — erasing history in the name of restoring it. A `note` of
  // `null` is different: that is a real stored value meaning "empty", and it
  // restores as "".
  if (!Object.hasOwn(data, "note")) {
    return NextResponse.json(
      {
        error:
          "ประวัติชิ้นนี้ไม่ได้เก็บบันทึกลูกค้าไว้ จึงกู้คืนไม่ได้ " +
          "ระบบจะไม่เขียนบันทึกว่างทับของเดิมให้",
      },
      { status: 400 }
    );
  }

  const raw = (data as Record<string, unknown>).note;
  if (raw !== null && raw !== undefined && typeof raw !== "string") {
    return NextResponse.json(
      { error: "บันทึกที่เก็บไว้ในประวัติชิ้นนี้ไม่ใช่ข้อความ จึงกู้คืนไม่ได้" },
      { status: 400 }
    );
  }

  // Same treatment the value gets on the way in through the customer routes.
  // `sanitizePlainText` is idempotent, so a note that was written through
  // those routes comes back out of it unchanged.
  const note = sanitizePlainText(raw ?? "");

  // The 2000-character ceiling is imposed by `sanitizePlainText(...)
  // .substring(0, 2000)` in `app/api/customers/route.ts` and
  // `[id]/route.ts` — a SILENT truncation. A snapshot longer than that (a row
  // that predates the cap, or one written straight into the database) is
  // REFUSED here, because half-restoring a call log and saying "success" is
  // worse than not restoring it: the tail would be gone with nobody told, and
  // the pre-restore snapshot below would then be the only copy of it left.
  if (note.length > CUSTOMER_NOTE_MAX_LENGTH) {
    return NextResponse.json(
      {
        error:
          `บันทึกในประวัติชิ้นนี้ยาว ${note.length} ตัวอักษร เกินเพดาน ${CUSTOMER_NOTE_MAX_LENGTH} ตัวอักษรที่ระบบเก็บได้ ` +
          "ถ้ากู้คืน ท้ายบันทึกจะถูกตัดหายไปโดยไม่มีใครรู้ ระบบจึงไม่กู้คืนให้ " +
          "กรุณาคัดลอกข้อความจากประวัติไปวางเองที่หน้าข้อมูลลูกค้า",
      },
      { status: 400 }
    );
  }

  const changed = await withTransaction(async (conn) => {
    // The FULL row, `FOR UPDATE`: the columns are what the pre-restore
    // snapshot needs (same shape the hand edit and the bulk replace store, so
    // every "customer" revision looks alike), and the lock holds the row for
    // the two statements that follow, so the note that is snapshotted is the
    // note that gets overwritten.
    const [rows] = await conn.query<RowDataPacket[]>(
      `SELECT id, companyId, name, department, phone, email, note
       FROM customers WHERE id = ? FOR UPDATE`,
      [rev.entityId]
    );

    if (rows.length === 0) {
      // Thrown, not returned, so the transaction rolls back. `ApiError` has no
      // driver `code`, so `withTransaction` treats it as a business error and
      // propagates it immediately instead of retrying; `withRoute` turns it
      // into this 404.
      throw new ApiError(
        404,
        "ไม่พบลูกค้ารายนี้แล้ว ลูกค้าถูกลบไปหลังจากบันทึกประวัตินี้ " +
          "การกู้คืนบันทึกจะไม่สร้างลูกค้าที่ถูกลบไปแล้วขึ้นมาใหม่"
      );
    }

    const current = rows[0].note === null || rows[0].note === undefined
      ? ""
      : String(rows[0].note);

    // Nothing to do — and this is also what makes a replayed attempt safe: if
    // an attempt committed and its acknowledgement was lost, the retry reads
    // the already-restored note, sees it equal, and writes neither a snapshot
    // nor an UPDATE.
    if (current === note) return false;

    // History BEFORE the overwrite. Restoring IS an edit: without this, the
    // value being replaced right now would be the one value with no way back,
    // and an undo you cannot undo is its own trap.
    await saveRevision("customer", rev.entityId, rows[0], conn);

    // The narrowest possible write: ONE column. No `companyId`, `name`,
    // `department`, `phone` or `email` appears in this statement, and
    // `__tests__/api/revisions.test.ts` asserts that from the SQL actually
    // issued rather than from this comment.
    await conn.query("UPDATE customers SET note = ? WHERE id = ?", [
      note,
      rev.entityId,
    ]);
    return true;
  });

  return NextResponse.json({
    success: true,
    entityId: rev.entityId,
    // Said in the response, not only in the comments: this restore put the
    // note back and touched nothing else on the customer.
    restoredFields: ["note"],
    changed,
    message: changed
      ? "กู้คืนบันทึกลูกค้าจากประวัติแล้ว (คืนเฉพาะบันทึก ข้อมูลอื่นของลูกค้าไม่ถูกแตะ)"
      : "บันทึกของลูกค้ารายนี้ตรงกับประวัติชิ้นนี้อยู่แล้ว จึงไม่มีอะไรถูกเปลี่ยน",
  });
}

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
      case "customer": {
        // Restores `note` and nothing else, and returns its own response
        // (which carries `restoredFields`) rather than falling through to the
        // shared one below. See `restoreCustomerNote` for why one column.
        return await restoreCustomerNote(rev);
      }
    }

    return NextResponse.json({ success: true, entityId: rev.entityId });
  }
);

import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { query, withTransaction } from "../../../lib/db";
import { sanitizePlainText } from "../../../lib/sanitizeHtml";
import { withRoute, requireAuth, jsonError } from "../../../lib/apiHelpers";
import { saveRevision } from "../../../lib/revisionStore";

// GET /api/customers/[id] — one customer, by id.
//
// The list route (`GET /api/customers`) returns everyone, and /customers has
// always used it that way because it already keeps the full list in memory
// for its own table. /crm/alerts does not, and with ~6,000 customers on the
// way, loading the entire list just to find one it already knows the id of
// would be exactly the wrong direction to make that page depend on the
// customer count. Same SELECT/JOIN as the list route, with `id` narrowed to
// one row, so this returns the identical shape.
export const GET = withRoute(
  "โหลดข้อมูลลูกค้าไม่สำเร็จ",
  async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
    await requireAuth();
    const { id } = await params;
    const [rows] = await query<RowDataPacket[]>(
      `SELECT customers.*, companies.name as companyName
       FROM customers
       LEFT JOIN companies ON customers.companyId = companies.id
       WHERE customers.id = ?`,
      [id]
    );
    if (rows.length === 0) return jsonError("ไม่พบลูกค้า", 404);
    return NextResponse.json(rows[0]);
  }
);

export const PUT = withRoute(
  // Thai: this is the message an admin actually reads when the save fails —
  // including the case that matters most here, a snapshot into `revisions`
  // that did not go through, where the note was deliberately NOT overwritten.
  "บันทึกข้อมูลลูกค้าไม่สำเร็จ",
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    await requireAuth();

    const { id } = await params;
    const data = await request.json();

    if (!data.companyId || typeof data.companyId !== "string" || data.companyId.trim() === "") {
      return jsonError("companyId is required", 400);
    }

    if (!data.name || typeof data.name !== "string" || data.name.trim() === "") {
      return jsonError("Name is required", 400);
    }

    const companyId = sanitizePlainText(data.companyId).substring(0, 255);
    const name = sanitizePlainText(data.name).substring(0, 255);
    const department = sanitizePlainText(data.department || "").substring(0, 255);
    const phone = sanitizePlainText(data.phone || "").substring(0, 255);
    const email = sanitizePlainText(data.email || "").substring(0, 255);
    const note = sanitizePlainText(data.note || "").substring(0, 2000);

    // Snapshot the PREVIOUS row before overwriting it. `customers.note` is the
    // "บันทึกลูกค้า" call log — dated lines that accumulate for years — and
    // this handler rewrites it wholesale from whatever the form posted. Until
    // now that write had no history behind it, so a paste accident or a
    // cleared textarea erased years of calls with no way back. Change
    // `add-customer-note-search` requires every path that writes a customer
    // note to keep history FIRST, this hand edit included, before the bulk
    // search-and-replace is allowed to exist at all.
    //
    // Read → snapshot → write, in ONE transaction:
    //   • If the INSERT into `revisions` fails, the UPDATE below never runs and
    //     the rollback leaves the row exactly as it was. No history means no
    //     destructive write.
    //   • `FOR UPDATE` holds the row for the few statements in between, so the
    //     snapshot is genuinely of the value being overwritten and not of one a
    //     concurrent edit has already replaced.
    //
    // The callback is IDEMPOTENT, which `withTransaction` requires because it
    // retries the whole callback up to 3 times on a transient connection loss:
    // it re-reads inside the attempt, and `saveRevision` mints its UUID inside
    // the attempt too, so a rolled-back attempt cannot leave a stray snapshot
    // behind.
    await withTransaction(async (conn) => {
      const [rows] = await conn.query<RowDataPacket[]>(
        `SELECT id, companyId, name, department, phone, email, note
         FROM customers WHERE id = ? FOR UPDATE`,
        [id]
      );

      // A row that is not there has no previous value to lose, so there is
      // nothing to snapshot and nothing this UPDATE can destroy — it simply
      // affects 0 rows, exactly as it did before this change. The snapshot is
      // skipped rather than written as `null`, which would put a revision in
      // the history that restores a customer into existence with no fields.
      //
      // NO CHANGE, NO SNAPSHOT. A revision of a customer restores exactly one
      // column, `note` (see the restore route), so a save that leaves the note
      // alone produces a snapshot that could only ever restore the value
      // already in the row — a row of history that can undo nothing. Correcting
      // a phone number used to write one anyway, and with ~6,000 customers
      // about to be imported and tidied up, a pass over their non-note fields
      // would have written tens of MB of history with nothing in it.
      //
      // The comparison is against `note`, the POST-`sanitizePlainText`,
      // POST-`substring(0, 2000)` value that the UPDATE below actually writes
      // — NOT against `data.note`. Compare the raw input and a save that only
      // changed characters the sanitizer strips (or text past the 2,000-char
      // cap) still looks like a change, and still writes a snapshot identical
      // to the live row. A stored NULL and an incoming "" are the same empty
      // note, so neither is treated as an edit.
      if (rows.length > 0) {
        const storedNote =
          rows[0].note === null || rows[0].note === undefined
            ? ""
            : String(rows[0].note);
        if (storedNote !== note) {
          await saveRevision("customer", id, rows[0], conn);
        }
      }

      await conn.query(
        `UPDATE customers SET
          companyId = ?, name = ?, department = ?, phone = ?, email = ?, note = ?
         WHERE id = ?`,
        [
          companyId,
          name,
          department,
          phone,
          email,
          note,
          id,
        ]
      );
    });

    return NextResponse.json({ success: true });
  }
);

export const DELETE = withRoute(
  "Failed to delete customer",
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    await requireAuth();

    const { id } = await params;

    // customer_equipments/sales_records reference customerId with no FK (loose
    // reference by design — see db.ts), so deleting a customer that still has
    // either would silently orphan its equipment/warranty/sales history. Check
    // before deleting, the same way companies/[id]/route.ts guards on customers.
    const [equipments] = (await query(
      "SELECT id FROM customer_equipments WHERE customerId = ? LIMIT 1",
      [id]
    )) as any[];
    if (equipments.length > 0) {
      return jsonError("Cannot delete customer with linked equipment", 400);
    }
    const [salesRecords] = (await query(
      "SELECT id FROM sales_records WHERE customerId = ? LIMIT 1",
      [id]
    )) as any[];
    if (salesRecords.length > 0) {
      return jsonError("Cannot delete customer with linked sales records", 400);
    }
    // service_schedules.customerId has an ON DELETE CASCADE FK (customer-scoped
    // call follow-ups, not tied to equipment) — without this check, deleting
    // the customer would silently wipe that call history the same way an
    // unguarded equipment delete would (equipment deletion requires an OTP
    // for exactly this reason).
    const [schedules] = (await query(
      "SELECT id FROM service_schedules WHERE customerId = ? LIMIT 1",
      [id]
    )) as any[];
    if (schedules.length > 0) {
      return jsonError("Cannot delete customer with linked call schedules", 400);
    }

    await query("DELETE FROM customers WHERE id = ?", [id]);
    return NextResponse.json({ success: true });
  }
);

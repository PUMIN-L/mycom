import { NextResponse } from "next/server";
import { query } from "../../../lib/db";
import { sanitizePlainText } from "../../../lib/sanitizeHtml";
import { withRoute, requireAuth, jsonError } from "../../../lib/apiHelpers";

export const PUT = withRoute(
  "Failed to update customer",
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
    const customerLog = sanitizePlainText(data.customerLog || "").substring(0, 2000);

    await query(
      `UPDATE customers SET
        companyId = ?, name = ?, department = ?, phone = ?, email = ?, note = ?, customerLog = ?
       WHERE id = ?`,
      [
        companyId,
        name,
        department,
        phone,
        email,
        note,
        customerLog,
        id,
      ]
    );

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

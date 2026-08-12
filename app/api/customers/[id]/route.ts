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

    await query(
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

    return NextResponse.json({ success: true });
  }
);

export const DELETE = withRoute(
  "Failed to delete customer",
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    await requireAuth();

    const { id } = await params;

    await query("DELETE FROM customers WHERE id = ?", [id]);
    return NextResponse.json({ success: true });
  }
);

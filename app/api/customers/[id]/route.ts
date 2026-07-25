import { NextResponse } from "next/server";
import { query } from "../../../lib/db";
import { getSession } from "../../../lib/session";
import { sanitizePlainText } from "../../../lib/sanitizeHtml";

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const data = await request.json();

    if (!data.companyId || typeof data.companyId !== "string" || data.companyId.trim() === "") {
      return NextResponse.json({ error: "companyId is required" }, { status: 400 });
    }

    if (!data.name || typeof data.name !== "string" || data.name.trim() === "") {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
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
  } catch (error: any) {
    console.error("PUT /api/customers/[id] error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    await query("DELETE FROM customers WHERE id = ?", [id]);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("DELETE /api/customers/[id] error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

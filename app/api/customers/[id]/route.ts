import { NextResponse } from "next/server";
import { query } from "../../../lib/db";
import { getSession } from "../../../lib/auth";

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const data = await request.json();

    if (!data.companyId) {
      return NextResponse.json({ error: "companyId is required" }, { status: 400 });
    }

    await query(
      `UPDATE customers SET 
        companyId = ?, name = ?, department = ?, phone = ?, email = ?, note = ?
       WHERE id = ?`,
      [
        data.companyId,
        data.name,
        data.department || "",
        data.phone || "",
        data.email || "",
        data.note || "",
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

import { NextResponse } from "next/server";
import { query } from "../../../lib/db";
import { getSession } from "../../../lib/session";

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const data = await request.json();

    await query(
      `UPDATE companies SET 
        name = ?, addressNo = ?, moo = ?, soi = ?, road = ?, 
        subDistrict = ?, district = ?, province = ?, postalCode = ?, phone = ?, note = ? 
       WHERE id = ?`,
      [
        data.name,
        data.addressNo || "",
        data.moo || "",
        data.soi || "",
        data.road || "",
        data.subDistrict || "",
        data.district || "",
        data.province || "",
        data.postalCode || "",
        data.phone || "",
        data.note || "",
        id,
      ]
    );

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("PUT /api/companies/[id] error:", error);
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

    // Check if there are connected customers before deleting
    const [customers] = await query("SELECT id FROM customers WHERE companyId = ?", [id]) as any[];
    if (customers.length > 0) {
      return NextResponse.json({ error: "Cannot delete company with connected customers" }, { status: 400 });
    }

    await query("DELETE FROM companies WHERE id = ?", [id]);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("DELETE /api/companies/[id] error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

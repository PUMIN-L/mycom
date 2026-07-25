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

    if (!data.name || typeof data.name !== "string" || data.name.trim() === "") {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    const name = sanitizePlainText(data.name).substring(0, 255);
    const addressNo = sanitizePlainText(data.addressNo || "").substring(0, 255);
    const moo = sanitizePlainText(data.moo || "").substring(0, 255);
    const soi = sanitizePlainText(data.soi || "").substring(0, 255);
    const road = sanitizePlainText(data.road || "").substring(0, 255);
    const subDistrict = sanitizePlainText(data.subDistrict || "").substring(0, 255);
    const district = sanitizePlainText(data.district || "").substring(0, 255);
    const province = sanitizePlainText(data.province || "").substring(0, 255);
    const postalCode = sanitizePlainText(data.postalCode || "").substring(0, 255);
    const phone = sanitizePlainText(data.phone || "").substring(0, 255);
    const note = sanitizePlainText(data.note || "").substring(0, 2000);

    await query(
      `UPDATE companies SET 
        name = ?, addressNo = ?, moo = ?, soi = ?, road = ?, 
        subDistrict = ?, district = ?, province = ?, postalCode = ?, phone = ?, note = ? 
       WHERE id = ?`,
      [
        name,
        addressNo,
        moo,
        soi,
        road,
        subDistrict,
        district,
        province,
        postalCode,
        phone,
        note,
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

    try {
      await query("DELETE FROM companies WHERE id = ?", [id]);
    } catch (dbError: any) {
      if (dbError.code === "ER_ROW_IS_REFERENCED_2" || dbError.code === "ER_ROW_IS_REFERENCED") {
        return NextResponse.json({ error: "Cannot delete company because there are customers still linked to it" }, { status: 400 });
      }
      throw dbError;
    }
    
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("DELETE /api/companies/[id] error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

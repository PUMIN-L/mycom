import { NextResponse } from "next/server";
import { query } from "../../lib/db";
import { getSession } from "../../lib/session";
import { sanitizePlainText } from "../../lib/sanitizeHtml";

export async function GET(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const [rows] = await query("SELECT * FROM companies ORDER BY createdAt DESC");
    return NextResponse.json(rows);
  } catch (error: any) {
    console.error("GET /api/companies error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const data = await request.json();
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

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
      `INSERT INTO companies (id, name, addressNo, moo, soi, road, subDistrict, district, province, postalCode, phone, note, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
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
        now,
      ]
    );

    return NextResponse.json({ id });
  } catch (error: any) {
    console.error("POST /api/companies error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

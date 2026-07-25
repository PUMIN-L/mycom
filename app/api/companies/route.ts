import { NextResponse } from "next/server";
import { query } from "../../lib/db";
import { getSession } from "../../lib/session";

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

    await query(
      `INSERT INTO companies (id, name, addressNo, moo, soi, road, subDistrict, district, province, postalCode, phone, note, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
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
        now,
      ]
    );

    return NextResponse.json({ id });
  } catch (error: any) {
    console.error("POST /api/companies error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

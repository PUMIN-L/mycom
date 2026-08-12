import { NextResponse } from "next/server";
import { query } from "../../lib/db";
import { sanitizePlainText } from "../../lib/sanitizeHtml";
import { withRoute, requireAuth, jsonError } from "../../lib/apiHelpers";

export const GET = withRoute(
  "Failed to load companies",
  async () => {
    await requireAuth();

    const [rows] = await query("SELECT * FROM companies ORDER BY createdAt DESC");
    return NextResponse.json(rows);
  }
);

export const POST = withRoute(
  "Failed to create company",
  async (request: Request) => {
    await requireAuth();

    const data = await request.json();
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    if (!data.name || typeof data.name !== "string" || data.name.trim() === "") {
      return jsonError("Name is required", 400);
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
  }
);

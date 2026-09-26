import { NextResponse } from "next/server";
import { query } from "../../lib/db";
import { withRoute, requireAuth } from "../../lib/apiHelpers";
import { readCompanyInput } from "./companyInput";

export const GET = withRoute(
  "โหลดรายชื่อบริษัทไม่สำเร็จ",
  async () => {
    await requireAuth();

    const [rows] = await query("SELECT * FROM companies ORDER BY createdAt DESC");
    return NextResponse.json(rows);
  }
);

export const POST = withRoute(
  "เพิ่มบริษัทไม่สำเร็จ",
  async (request: Request) => {
    await requireAuth();

    const { name, addressNo, moo, soi, road, subDistrict, district, province, postalCode, phone, note } =
      readCompanyInput(await request.json());
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

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

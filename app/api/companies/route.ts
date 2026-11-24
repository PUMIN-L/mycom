import { NextResponse } from "next/server";
import { query } from "../../lib/db";
import { withRoute, requireAuth } from "../../lib/apiHelpers";
import { assertSalespersonExists, readCompanyInput } from "./companyInput";

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

    const { name, addressNo, moo, soi, road, subDistrict, district, province, postalCode, phone, note, taxId, branchCode, whtPercent, salespersonId } =
      readCompanyInput(await request.json());
    await assertSalespersonExists(salespersonId);
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    await query(
      `INSERT INTO companies (id, name, addressNo, moo, soi, road, subDistrict, district, province, postalCode, phone, note, taxId, branchCode, whtPercent, salespersonId, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        taxId ?? null,
        branchCode ?? null,
        whtPercent ?? null,
        salespersonId ?? null,
        now,
      ]
    );

    return NextResponse.json({ id });
  }
);

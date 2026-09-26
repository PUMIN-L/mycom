import { NextResponse } from "next/server";
import type { ResultSetHeader } from "mysql2";
import { query } from "../../../lib/db";
import { withRoute, requireAuth, jsonError } from "../../../lib/apiHelpers";
import { readCompanyInput } from "../companyInput";

export const PUT = withRoute(
  "แก้ไขบริษัทไม่สำเร็จ",
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    await requireAuth();

    const { id } = await params;
    const { name, addressNo, moo, soi, road, subDistrict, district, province, postalCode, phone, note } =
      readCompanyInput(await request.json());

    const [result] = await query<ResultSetHeader>(
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
    // mysql2 counts MATCHED rows (FOUND_ROWS), so an unchanged save is still
    // 1 — 0 means there is no such company, which used to answer "success".
    if (result.affectedRows === 0) {
      return jsonError("ไม่พบบริษัทนี้", 404);
    }

    return NextResponse.json({ success: true });
  }
);

export const DELETE = withRoute(
  "ลบบริษัทไม่สำเร็จ",
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    await requireAuth();

    const { id } = await params;

    // Check if there are connected customers before deleting
    const [customers] = await query("SELECT id FROM customers WHERE companyId = ?", [id]) as any[];
    if (customers.length > 0) {
      return jsonError("ลบบริษัทนี้ไม่ได้ เพราะยังมีลูกค้าที่ผูกกับบริษัทนี้อยู่", 400);
    }

    try {
      await query("DELETE FROM companies WHERE id = ?", [id]);
    } catch (dbError: any) {
      if (dbError.code === "ER_ROW_IS_REFERENCED_2" || dbError.code === "ER_ROW_IS_REFERENCED") {
        return jsonError("ลบบริษัทนี้ไม่ได้ เพราะยังมีลูกค้าที่ผูกกับบริษัทนี้อยู่", 400);
      }
      throw dbError;
    }
    
    return NextResponse.json({ success: true });
  }
);

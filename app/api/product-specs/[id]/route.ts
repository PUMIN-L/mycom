import { NextResponse } from "next/server";
import { query } from "../../../lib/db";
import type { ResultSetHeader } from "mysql2";
import { withRoute, requireAuth, ApiError } from "../../../lib/apiHelpers";
import { sanitizePlainText } from "../../../lib/sanitizeHtml";

type Ctx = { params: Promise<{ id: string }> };

export const PUT = withRoute("แก้ไขสเปกไม่สำเร็จ", async (req: Request, { params }: Ctx) => {
  await requireAuth();
  
  const { id } = await params;
  const body = await req.json();

  if (!body.productId || typeof body.productId !== "string" || body.productId.trim() === "") {
    throw new ApiError(400, "กรุณาเลือกสินค้า");
  }
  if (!body.name || typeof body.name !== "string" || body.name.trim() === "") {
    throw new ApiError(400, "กรุณากรอกชื่อสเปก");
  }
  if (!body.detail || typeof body.detail !== "string" || body.detail.trim() === "") {
    throw new ApiError(400, "กรุณากรอกรายละเอียดสเปก");
  }

  const productId = sanitizePlainText(body.productId).substring(0, 255);
  const name = sanitizePlainText(body.name).substring(0, 255);
  const detail = sanitizePlainText(body.detail).substring(0, 5000);

  const [result] = await query<ResultSetHeader>(
    "UPDATE product_specs SET productId = ?, name = ?, detail = ? WHERE id = ?",
    [productId, name, detail, id]
  );

  if (result.affectedRows === 0) {
    throw new ApiError(404, "ไม่พบสเปกนี้");
  }

  return NextResponse.json({ data: { id, productId, name, detail } });
});

export const DELETE = withRoute("ลบสเปกไม่สำเร็จ", async (req: Request, { params }: Ctx) => {
  await requireAuth();
  
  const { id } = await params;

  const [result] = await query<ResultSetHeader>(
    "DELETE FROM product_specs WHERE id = ?",
    [id]
  );

  if (result.affectedRows === 0) {
    throw new ApiError(404, "ไม่พบสเปกนี้");
  }

  return NextResponse.json({ success: true });
});

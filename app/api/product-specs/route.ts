import { NextResponse } from "next/server";
import { query } from "../../lib/db";
import type { RowDataPacket } from "mysql2";
import { withRoute, requireAuth, ApiError } from "../../lib/apiHelpers";
import { sanitizePlainText } from "../../lib/sanitizeHtml";

export const dynamic = "force-dynamic";

// GET — list all specs (Requires Auth since only admins manage/view specs in CMS)
export const GET = withRoute("โหลดสเปกไม่สำเร็จ", async () => {
  await requireAuth();
  const [rows] = await query<RowDataPacket[]>(
    "SELECT * FROM product_specs ORDER BY createdAt ASC"
  );
  return NextResponse.json({ data: rows });
});

// POST — create new spec (Requires Auth)
export const POST = withRoute("เพิ่มสเปกไม่สำเร็จ", async (req: Request) => {
  await requireAuth();
  
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

  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();

  await query(
    "INSERT INTO product_specs (id, productId, name, detail, createdAt) VALUES (?, ?, ?, ?, ?)",
    [id, productId, name, detail, createdAt]
  );

  return NextResponse.json(
    { data: { id, productId, name, detail, createdAt } },
    { status: 201 }
  );
});

import { NextResponse } from "next/server";
import { query } from "../../../lib/db";
import type { ResultSetHeader } from "mysql2";
import { withRoute, requireAuth, ApiError } from "../../../lib/apiHelpers";
import { sanitizePlainText } from "../../../lib/sanitizeHtml";

export const PUT = withRoute("Failed to update spec", async (req: Request, { params }: { params: { id: string } }) => {
  await requireAuth();
  
  const { id } = params;
  const body = await req.json();

  if (!body.productId || typeof body.productId !== "string" || body.productId.trim() === "") {
    throw new ApiError(400, "productId is required");
  }
  if (!body.name || typeof body.name !== "string" || body.name.trim() === "") {
    throw new ApiError(400, "name is required");
  }
  if (!body.detail || typeof body.detail !== "string" || body.detail.trim() === "") {
    throw new ApiError(400, "detail is required");
  }

  const productId = sanitizePlainText(body.productId).substring(0, 255);
  const name = sanitizePlainText(body.name).substring(0, 255);
  const detail = sanitizePlainText(body.detail).substring(0, 5000);

  const [result] = await query<ResultSetHeader>(
    "UPDATE product_specs SET productId = ?, name = ?, detail = ? WHERE id = ?",
    [productId, name, detail, id]
  );

  if (result.affectedRows === 0) {
    throw new ApiError(404, "Spec not found");
  }

  return NextResponse.json({ data: { id, productId, name, detail } });
});

export const DELETE = withRoute("Failed to delete spec", async (req: Request, { params }: { params: { id: string } }) => {
  await requireAuth();
  
  const { id } = params;

  const [result] = await query<ResultSetHeader>(
    "DELETE FROM product_specs WHERE id = ?",
    [id]
  );

  if (result.affectedRows === 0) {
    throw new ApiError(404, "Spec not found");
  }

  return NextResponse.json({ success: true });
});

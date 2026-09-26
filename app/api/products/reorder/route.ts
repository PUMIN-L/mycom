import { NextResponse } from "next/server";
import { reorderProducts } from "../../../lib/productStore";
import { withRoute, requireAuth, jsonError } from "../../../lib/apiHelpers";
import { revalidateTag } from "next/cache";

// PUT — reorder products (login required).
export const PUT = withRoute(
  "จัดลำดับสินค้าไม่สำเร็จ",
  async (req: Request) => {
    await requireAuth();

    const { productIds } = await req.json();
    
    if (!Array.isArray(productIds)) {
      return jsonError("รูปแบบข้อมูลไม่ถูกต้อง", 400);
    }

    const success = await reorderProducts(productIds);
    if (!success) {
      return jsonError("จัดลำดับสินค้าไม่สำเร็จ", 500);
    }

    revalidateTag("products", { expire: 0 });
    return NextResponse.json({ message: "Products reordered successfully" });
  }
);

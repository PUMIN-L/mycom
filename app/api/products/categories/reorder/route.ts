import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { reorderCategories } from "../../../../lib/productStore";
import { requireAuth, withRoute } from "../../../../lib/apiHelpers";

// PUT — reorder categories (login required).
export const PUT = withRoute(
  "จัดลำดับหมวดหมู่ไม่สำเร็จ",
  async (request: NextRequest) => {
    await requireAuth();
    
    const body = await request.json();
    const { categoryIds } = body;

    if (!Array.isArray(categoryIds)) {
      return NextResponse.json(
        { error: "รูปแบบข้อมูลไม่ถูกต้อง (ต้องเป็นรายการรหัสหมวดหมู่)" },
        { status: 400 }
      );
    }

    const success = await reorderCategories(categoryIds);
    if (!success) {
      return NextResponse.json({ error: "บันทึกลำดับหมวดหมู่ไม่สำเร็จ" }, { status: 500 });
    }

    // Invalidate product cache to reflect new order
    revalidateTag("products", { expire: 0 });

    return NextResponse.json({ message: "Categories reordered successfully" });
  }
);

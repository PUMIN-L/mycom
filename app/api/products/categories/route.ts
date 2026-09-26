import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { getAllCategories, addCategory } from "../../../lib/productStore";
import { requireAuth, withRoute } from "../../../lib/apiHelpers";

// GET — list all product categories (public)
export const GET = withRoute("โหลดหมวดหมู่ไม่สำเร็จ", async () => {
  const categories = await getAllCategories();
  return NextResponse.json(categories);
});

// POST — create a new category (login required)
export const POST = withRoute(
  "สร้างหมวดหมู่ไม่สำเร็จ",
  async (request: NextRequest) => {
    await requireAuth();
    const body = await request.json();

    if (!body.name_th || !body.name_en || !body.name_zh) {
      return NextResponse.json(
        { error: "กรุณากรอกชื่อหมวดหมู่ให้ครบทั้ง 3 ภาษา (ไทย อังกฤษ จีน)" },
        { status: 400 }
      );
    }

    const newCategory = await addCategory({
      name_th: body.name_th,
      name_en: body.name_en,
      name_zh: body.name_zh,
    });
    
    // Invalidate product cache
    revalidateTag("products", { expire: 0 });
    
    return NextResponse.json(newCategory, { status: 201 });
  }
);

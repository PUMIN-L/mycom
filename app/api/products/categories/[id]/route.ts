import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { deleteCategory, getProductsByCategory, updateCategory } from "../../../../lib/productStore";
import { requireAuth, withRoute } from "../../../../lib/apiHelpers";

// DELETE — remove a category (login required). Blocked while products still use it.
export const DELETE = withRoute(
  "ลบหมวดหมู่ไม่สำเร็จ",
  async (_request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    await requireAuth();
    const { id } = await params;
    const categoryId = parseInt(id, 10);

    if (isNaN(categoryId)) {
      return NextResponse.json({ error: "รหัสหมวดหมู่ไม่ถูกต้อง" }, { status: 400 });
    }

    // Constraint check: a category can't be deleted while it still has products.
    const productsInCat = await getProductsByCategory(categoryId);
    if (productsInCat.length > 0) {
      return NextResponse.json(
        {
          error:
            "ลบหมวดหมู่นี้ไม่ได้ เพราะยังมีสินค้าอยู่ในหมวด กรุณาลบหรือย้ายสินค้าออกก่อน",
        },
        { status: 400 }
      );
    }

    const success = await deleteCategory(categoryId);
    if (!success) {
      return NextResponse.json({ error: "ไม่พบหมวดหมู่นี้" }, { status: 404 });
    }

    // Invalidate product cache
    revalidateTag("products", { expire: 0 });

    return NextResponse.json({ message: "Category deleted successfully" });
  }
);

// PUT — update a category (login required).
export const PUT = withRoute(
  "แก้ไขหมวดหมู่ไม่สำเร็จ",
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    await requireAuth();
    const { id } = await params;
    const categoryId = parseInt(id, 10);

    if (isNaN(categoryId)) {
      return NextResponse.json({ error: "รหัสหมวดหมู่ไม่ถูกต้อง" }, { status: 400 });
    }

    const body = await request.json();
    const { name_th, name_en, name_zh } = (body ?? {}) as Record<string, unknown>;

    // Strings only: a number or object would reach the sanitizer (and the SQL)
    // as something other than text.
    if (
      typeof name_th !== "string" || !name_th ||
      typeof name_en !== "string" || !name_en ||
      typeof name_zh !== "string" || !name_zh
    ) {
      return NextResponse.json(
        { error: "กรุณากรอกชื่อหมวดหมู่ให้ครบทั้ง 3 ภาษา (ไทย อังกฤษ จีน)" },
        { status: 400 }
      );
    }

    const stored = await updateCategory(categoryId, { name_th, name_en, name_zh });
    if (!stored) {
      return NextResponse.json({ error: "ไม่พบหมวดหมู่นี้" }, { status: 404 });
    }

    // Invalidate product cache
    revalidateTag("products", { expire: 0 });

    // The names as stored (sanitized) — the client renders these as HTML, so
    // it must show them rather than its own editor output.
    return NextResponse.json({
      message: "Category updated successfully",
      category: { id: categoryId, ...stored },
    });
  }
);

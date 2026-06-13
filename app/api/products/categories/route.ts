import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { getAllCategories, addCategory } from "../../../lib/productStore";
import { requireAuth, withRoute } from "../../../lib/apiHelpers";

// GET — list all product categories (public)
export const GET = withRoute("Failed to fetch categories", async () => {
  const categories = await getAllCategories();
  return NextResponse.json(categories);
});

// POST — create a new category (login required)
export const POST = withRoute(
  "Failed to create category",
  async (request: NextRequest) => {
    await requireAuth();
    const body = await request.json();

    if (!body.name_th || !body.name_en || !body.name_zh) {
      return NextResponse.json(
        { error: "Missing required category names (th, en, zh)" },
        { status: 400 }
      );
    }

    const newCategory = await addCategory({
      name_th: body.name_th,
      name_en: body.name_en,
      name_zh: body.name_zh,
    });
    
    // Invalidate product cache
    revalidateTag("products", "max");
    
    return NextResponse.json(newCategory, { status: 201 });
  }
);

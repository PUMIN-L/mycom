import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { reorderCategories } from "../../../../lib/productStore";
import { requireAuth, withRoute } from "../../../../lib/apiHelpers";

// PUT — reorder categories (login required).
export const PUT = withRoute(
  "Failed to reorder categories",
  async (request: NextRequest) => {
    await requireAuth();
    
    const body = await request.json();
    const { categoryIds } = body;

    if (!Array.isArray(categoryIds)) {
      return NextResponse.json(
        { error: "Invalid payload. Expected an array of category IDs." },
        { status: 400 }
      );
    }

    const success = await reorderCategories(categoryIds);
    if (!success) {
      return NextResponse.json({ error: "Failed to update category order in database" }, { status: 500 });
    }

    // Invalidate product cache to reflect new order
    revalidateTag("products", { expire: 0 });

    return NextResponse.json({ message: "Categories reordered successfully" });
  }
);

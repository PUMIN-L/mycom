import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { deleteCategory, getProductsByCategory } from "../../../../lib/productStore";
import { requireAuth, withRoute } from "../../../../lib/apiHelpers";

// DELETE — remove a category (login required). Blocked while products still use it.
export const DELETE = withRoute(
  "Failed to delete category",
  async (_request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    await requireAuth();
    const { id } = await params;
    const categoryId = parseInt(id, 10);

    if (isNaN(categoryId)) {
      return NextResponse.json({ error: "Invalid category ID" }, { status: 400 });
    }

    // Constraint check: a category can't be deleted while it still has products.
    const productsInCat = await getProductsByCategory(categoryId);
    if (productsInCat.length > 0) {
      return NextResponse.json(
        {
          error:
            "Cannot delete category because it contains products. Please delete or move the products first.",
        },
        { status: 400 }
      );
    }

    const success = await deleteCategory(categoryId);
    if (!success) {
      return NextResponse.json({ error: "Category not found" }, { status: 404 });
    }

    // Invalidate product cache
    revalidateTag("products", "max");

    return NextResponse.json({ message: "Category deleted successfully" });
  }
);

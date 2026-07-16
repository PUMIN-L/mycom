import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { deleteCategory, getProductsByCategory, updateCategory } from "../../../../lib/productStore";
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
    revalidateTag("products", { expire: 0 });

    return NextResponse.json({ message: "Category deleted successfully" });
  }
);

// PUT — update a category (login required).
export const PUT = withRoute(
  "Failed to update category",
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    await requireAuth();
    const { id } = await params;
    const categoryId = parseInt(id, 10);

    if (isNaN(categoryId)) {
      return NextResponse.json({ error: "Invalid category ID" }, { status: 400 });
    }

    const body = await request.json();
    const { name_th, name_en, name_zh } = body;

    if (!name_th || !name_en || !name_zh) {
      return NextResponse.json(
        { error: "Missing required name fields" },
        { status: 400 }
      );
    }

    const success = await updateCategory(categoryId, { name_th, name_en, name_zh });
    if (!success) {
      return NextResponse.json({ error: "Category not found" }, { status: 404 });
    }

    // Invalidate product cache
    revalidateTag("products", { expire: 0 });

    return NextResponse.json({ message: "Category updated successfully" });
  }
);

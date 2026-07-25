import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { getProduct, deleteProduct, updateProduct } from "../../../lib/productStore";
import {
  deleteCloudinaryImage,
  deleteCloudinaryImages,
  collectContentImageUrls,
} from "../../../lib/cloudinaryHelper";
import { requireAuth, withRoute, ApiError } from "../../../lib/apiHelpers";
import { getAllContents, deleteContent } from "../../../lib/contentStore";
import { getSession } from "../../../lib/session";

type Ctx = { params: Promise<{ id: string }> };

// GET — single product by id (public)
export const GET = withRoute(
  "Failed to fetch product",
  async (_request: NextRequest, { params }: Ctx) => {
    const { id } = await params;
    const product = await getProduct(id);
    if (!product) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }
    // Hide unpublished and pending-delete products from anonymous callers (report 404, not 403,
    // so their existence isn't disclosed).
    if (product.isPublished === false || !!product.pendingDeleteAt) {
      const session = await getSession();
      if (!session) {
        return NextResponse.json({ error: "Product not found" }, { status: 404 });
      }
    }
    return NextResponse.json(product);
  }
);

// PUT — update product (login required)
export const PUT = withRoute(
  "Failed to update product",
  async (request: NextRequest, { params }: Ctx) => {
    await requireAuth();
    const { id } = await params;
    const body = await request.json();
    const updated = await updateProduct(id, body);
    if (!updated) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }
    
    // Invalidate product cache
    revalidateTag("products", { expire: 0 });
    
    return NextResponse.json(updated);
  }
);

// DELETE — soft delete product (sets pendingDeleteAt). If already pending, hard deletes.
export const DELETE = withRoute(
  "Failed to delete product",
  async (_request: NextRequest, { params }: Ctx) => {
    await requireAuth();
    const { id } = await params;
    const product = await getProduct(id);
    if (!product) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }

    if (product.pendingDeleteAt) {
      // It's already in pending delete status, so this is a force hard-delete
      const { hardDeleteProduct } = await import("../../../lib/productDeleter");
      const success = await hardDeleteProduct(id);
      if (!success) {
        throw new ApiError(500, "Failed to hard delete product");
      }
      
      revalidateTag("products", { expire: 0 });
      return NextResponse.json({ success: true, hardDeleted: true });
    } else {
      // Soft delete: Mark as pending delete and unpublish
      const updated = await updateProduct(id, {
        isPublished: false,
        pendingDeleteAt: new Date().toISOString()
      });
      if (!updated) {
        throw new ApiError(500, "Failed to soft delete product");
      }
      
      revalidateTag("products", { expire: 0 });
      return NextResponse.json({ success: true, hardDeleted: false, pendingDeleteAt: updated.pendingDeleteAt });
    }
  }
);

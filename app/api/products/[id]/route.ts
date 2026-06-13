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
    revalidateTag("products", "max");
    
    return NextResponse.json(updated);
  }
);

// DELETE — delete product + its linked contents + Cloudinary images (login required)
export const DELETE = withRoute(
  "Failed to delete product",
  async (_request: NextRequest, { params }: Ctx) => {
    await requireAuth();
    const { id } = await params;
    const product = await getProduct(id);
    if (!product) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }

    // Delete linked contents first (and their images)
    const allContents = await getAllContents();
    const linkedContents = allContents.filter((c) => c.productId === id);
    for (const content of linkedContents) {
      const imageUrls = collectContentImageUrls(content);
      if (imageUrls.length > 0) {
        await deleteCloudinaryImages(imageUrls);
      }
      await deleteContent(content.id);
    }

    const deleted = await deleteProduct(id);
    if (!deleted) {
      throw new ApiError(500, "Failed to delete product");
    }

    // Delete the product's own image if it lives on Cloudinary
    if (product.image && product.image.includes("cloudinary.com")) {
      await deleteCloudinaryImage(product.image);
    }

    // Invalidate product cache
    revalidateTag("products", "max");

    return NextResponse.json({ success: true });
  }
);

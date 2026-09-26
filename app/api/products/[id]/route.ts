import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import {
  getProduct,
  deleteProduct,
  updateProduct,
  BestSellerRankConflictError,
} from "../../../lib/productStore";
import { requireAuth, withRoute, ApiError } from "../../../lib/apiHelpers";
import { getSession } from "../../../lib/session";

type Ctx = { params: Promise<{ id: string }> };

// GET — single product by id (public)
export const GET = withRoute(
  "โหลดข้อมูลสินค้าไม่สำเร็จ",
  async (_request: NextRequest, { params }: Ctx) => {
    const { id } = await params;
    const product = await getProduct(id);
    if (!product) {
      return NextResponse.json({ error: "ไม่พบสินค้านี้" }, { status: 404 });
    }
    // Hide unpublished and pending-delete products from anonymous callers (report 404, not 403,
    // so their existence isn't disclosed).
    const session = await getSession();
    if ((product.isPublished === false || !!product.pendingDeleteAt) && !session) {
      return NextResponse.json({ error: "ไม่พบสินค้านี้" }, { status: 404 });
    }
    // Which suppliers a product comes from is internal: the ids are read by
    // the admin edit form only, and a visitor has no business collecting them.
    if (!session) {
      const { supplierIds: _internal, ...publicProduct } = product;
      void _internal;
      return NextResponse.json(publicProduct);
    }
    return NextResponse.json(product);
  }
);

// PUT — update product (login required)
export const PUT = withRoute(
  "แก้ไขสินค้าไม่สำเร็จ",
  async (request: NextRequest, { params }: Ctx) => {
    await requireAuth();
    const { id } = await params;
    const body = await request.json();

    // Snapshot the old image URL BEFORE updating so we can tell the client
    // which image was replaced (they'll confirm deletion via a dialog).
    const existing = await getProduct(id);
    const oldImageUrl = existing?.image;

    let updated;
    try {
      updated = await updateProduct(id, body);
    } catch (err) {
      if (err instanceof BestSellerRankConflictError) {
        return NextResponse.json({ error: err.message }, { status: 409 });
      }
      throw err;
    }
    if (!updated) {
      return NextResponse.json({ error: "ไม่พบสินค้านี้" }, { status: 404 });
    }

    // Collect images that are no longer referenced so the client can show a
    // confirmation dialog. We never auto-delete from Cloudinary — the admin
    // must confirm each image deletion manually.
    const orphanedImages: string[] = [];
    if (
      oldImageUrl &&
      oldImageUrl !== updated.image &&
      oldImageUrl.includes("cloudinary.com")
    ) {
      orphanedImages.push(oldImageUrl);
    }
    
    // Invalidate product cache
    revalidateTag("products", { expire: 0 });
    
    return NextResponse.json({ ...updated, orphanedImages });
  }
);

// DELETE — soft delete product (sets pendingDeleteAt). If already pending, hard deletes.
export const DELETE = withRoute(
  "ลบสินค้าไม่สำเร็จ",
  async (_request: NextRequest, { params }: Ctx) => {
    await requireAuth();
    const { id } = await params;
    const product = await getProduct(id);
    if (!product) {
      return NextResponse.json({ error: "ไม่พบสินค้านี้" }, { status: 404 });
    }

    if (product.pendingDeleteAt) {
      // It's already in pending delete status, so this is a force hard-delete
      const { hardDeleteProduct } = await import("../../../lib/productDeleter");
      const orphanedImages = await hardDeleteProduct(id);
      if (!orphanedImages) {
        throw new ApiError(500, "ลบสินค้าถาวรไม่สำเร็จ");
      }
      
      revalidateTag("products", { expire: 0 });
      return NextResponse.json({ success: true, hardDeleted: true, orphanedImages });
    } else {
      // Soft delete: Mark as pending delete and unpublish
      const updated = await updateProduct(id, {
        isPublished: false,
        pendingDeleteAt: new Date().toISOString()
      });
      if (!updated) {
        throw new ApiError(500, "ย้ายสินค้าไปรอลบไม่สำเร็จ");
      }
      
      revalidateTag("products", { expire: 0 });
      return NextResponse.json({ success: true, hardDeleted: false, pendingDeleteAt: updated.pendingDeleteAt });
    }
  }
);

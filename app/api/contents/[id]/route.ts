import { NextRequest, NextResponse } from "next/server";
import {
  getContent,
  getAllContents,
  deleteContent,
  updateContent,
  getContentByProductId,
} from "../../../lib/contentStore";
import { collectContentImageUrls } from "../../../lib/cloudinaryHelper";
import { requireAuth, withRoute, ApiError } from "../../../lib/apiHelpers";
import { getAllProducts, isProductPublic } from "../../../lib/productStore";
import { getSession } from "../../../lib/session";
import type { ContentData } from "../../../lib/types";

type Ctx = { params: Promise<{ id: string }> };

// Content linked to a hidden (unpublished / pending-delete) product must not
// be exposed to anonymous callers — it's effectively that product's
// marketing page, so hiding the product but not the content defeats the
// point of hiding it. Admins (session present) always see everything.
async function isContentHiddenFromAnonymous(content: ContentData): Promise<boolean> {
  if (!content.productId) return false;
  const products = await getAllProducts();
  const product = products.find((p) => p.id === content.productId);
  return !!product && !isProductPublic(product);
}

// GET — single content, or all contents when id === "all" (public)
export const GET = withRoute(
  "Failed to fetch content",
  async (_request: NextRequest, { params }: Ctx) => {
    const { id } = await params;
    const session = await getSession();

    if (id === "all") {
      const contents = await getAllContents();
      if (session) return NextResponse.json(contents);
      const products = await getAllProducts();
      const hiddenProductIds = new Set(
        products.filter((p) => !isProductPublic(p)).map((p) => p.id)
      );
      const visible = contents.filter(
        (c) => !c.productId || !hiddenProductIds.has(c.productId)
      );
      return NextResponse.json(visible);
    }

    const content = await getContent(id);
    if (!content) {
      return NextResponse.json({ error: "Content not found" }, { status: 404 });
    }
    if (!session && (await isContentHiddenFromAnonymous(content))) {
      return NextResponse.json({ error: "Content not found" }, { status: 404 });
    }
    return NextResponse.json(content);
  }
);

// PUT — update content (login required)
export const PUT = withRoute(
  "Failed to update content",
  async (request: NextRequest, { params }: Ctx) => {
    await requireAuth();
    const { id } = await params;
    const body = await request.json();

    // Enforce one-content-per-product (excluding this content itself).
    if (body.productId) {
      const existingContent = await getContentByProductId(body.productId);
      if (existingContent && existingContent.id !== id) {
        return NextResponse.json(
          { error: "This product already has a content linked to it" },
          { status: 400 }
        );
      }
    }

    const updated = await updateContent(id, body);
    if (!updated) {
      return NextResponse.json({ error: "Content not found" }, { status: 404 });
    }
    return NextResponse.json(updated);
  }
);

// DELETE — delete content; return orphaned image URLs for client-side confirmation (login required)
export const DELETE = withRoute(
  "Failed to delete content",
  async (_request: NextRequest, { params }: Ctx) => {
    await requireAuth();
    const { id } = await params;

    // Fetch first so we can collect image URLs before the row is gone.
    const content = await getContent(id);
    if (!content) {
      return NextResponse.json({ error: "Content not found" }, { status: 404 });
    }
    const imageUrls = collectContentImageUrls(content);

    const deleted = await deleteContent(id);
    if (!deleted) {
      throw new ApiError(500, "Failed to delete content");
    }

    // Return orphaned images for the client to confirm deletion one-by-one.
    // We no longer auto-delete from Cloudinary.
    const orphanedImages = imageUrls.filter((u) => u.includes("cloudinary.com"));

    return NextResponse.json({ success: true, deletedImages: imageUrls.length, orphanedImages });
  }
);

import { NextRequest, NextResponse } from "next/server";
import {
  getContent,
  getAllContents,
  deleteContent,
  updateContent,
  getContentByProductId,
} from "../../../lib/contentStore";
import {
  deleteCloudinaryImages,
  collectContentImageUrls,
} from "../../../lib/cloudinaryHelper";
import { requireAuth, withRoute, ApiError } from "../../../lib/apiHelpers";

type Ctx = { params: Promise<{ id: string }> };

// GET — single content, or all contents when id === "all" (public)
export const GET = withRoute(
  "Failed to fetch content",
  async (_request: NextRequest, { params }: Ctx) => {
    const { id } = await params;

    if (id === "all") {
      const contents = await getAllContents();
      return NextResponse.json(contents);
    }

    const content = await getContent(id);
    if (!content) {
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

// DELETE — delete content + its Cloudinary images (login required)
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

    if (imageUrls.length > 0) {
      await deleteCloudinaryImages(imageUrls);
    }

    return NextResponse.json({ success: true, deletedImages: imageUrls.length });
  }
);

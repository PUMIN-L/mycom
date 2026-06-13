import { NextRequest, NextResponse } from "next/server";
import { addContent, ContentData, getContentByProductId } from "../../lib/contentStore";
import { requireAuth, withRoute } from "../../lib/apiHelpers";

// POST — create content linked to a product (login required)
export const POST = withRoute(
  "Failed to create content",
  async (request: NextRequest) => {
    await requireAuth();
    const data: ContentData = await request.json();

    if (!data.productId) {
      return NextResponse.json({ error: "Product ID is required" }, { status: 400 });
    }

    // Enforce one-content-per-product.
    const existingContent = await getContentByProductId(data.productId);
    if (existingContent) {
      return NextResponse.json(
        { error: "This product already has a content linked to it" },
        { status: 400 }
      );
    }

    const newContent = await addContent(data);
    return NextResponse.json(newContent, { status: 201 });
  }
);

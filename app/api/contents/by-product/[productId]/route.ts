import { NextRequest, NextResponse } from "next/server";
import { getContentByProductId } from "../../../../lib/contentStore";
import { withRoute } from "../../../../lib/apiHelpers";

// GET — the single content linked to a product (public)
export const GET = withRoute(
  "Failed to fetch content",
  async (_request: NextRequest, { params }: { params: Promise<{ productId: string }> }) => {
    const { productId } = await params;
    const content = await getContentByProductId(productId);

    if (!content) {
      return NextResponse.json(
        { error: "No content found for this product" },
        { status: 404 }
      );
    }
    return NextResponse.json(content);
  }
);

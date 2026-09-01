import { NextRequest, NextResponse } from "next/server";
import { getContentByProductId } from "../../../../lib/contentStore";
import { withRoute } from "../../../../lib/apiHelpers";
import { getProduct, isProductPublic } from "../../../../lib/productStore";
import { getSession } from "../../../../lib/session";

// GET — the single content linked to a product (public, unless the product
// is hidden — then it's the same as no content existing, for anonymous)
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

    const session = await getSession();
    if (!session) {
      const product = await getProduct(productId);
      if (!product || !isProductPublic(product)) {
        return NextResponse.json(
          { error: "No content found for this product" },
          { status: 404 }
        );
      }
    }

    return NextResponse.json(content);
  }
);

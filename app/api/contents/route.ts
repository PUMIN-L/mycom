import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import {
  addContent,
  ContentData,
  getContentByProductId,
  ContentProductConflictError,
} from "../../lib/contentStore";
import { requireAuth, withRoute } from "../../lib/apiHelpers";

// POST — create content linked to a product (login required)
export const POST = withRoute(
  "สร้างเนื้อหาไม่สำเร็จ",
  async (request: NextRequest) => {
    await requireAuth();
    const data: ContentData = await request.json();

    if (!data.productId) {
      return NextResponse.json({ error: "กรุณาเลือกสินค้า" }, { status: 400 });
    }

    // Enforce one-content-per-product.
    const existingContent = await getContentByProductId(data.productId);
    if (existingContent) {
      return NextResponse.json(
        { error: "สินค้านี้มีเนื้อหาผูกอยู่แล้ว" },
        { status: 400 }
      );
    }

    try {
      const newContent = await addContent(data);
      // Cached catalog reads (getAllContentsMeta + the product/category lists)
      // all hang off this one tag — see app/lib/contentStore.ts.
      revalidateTag("products", { expire: 0 });
      return NextResponse.json(newContent, { status: 201 });
    } catch (err) {
      if (err instanceof ContentProductConflictError) {
        return NextResponse.json(
          { error: "สินค้านี้มีเนื้อหาผูกอยู่แล้ว" },
          { status: 400 }
        );
      }
      throw err;
    }
  }
);

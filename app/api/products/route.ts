import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import {
  getAllProducts,
  addProduct,
  isProductPublic,
  ProductData,
  BestSellerRankConflictError,
} from "../../lib/productStore";
import { requireAuth, withRoute } from "../../lib/apiHelpers";
import { getSession } from "../../lib/session";

export const dynamic = "force-dynamic";

// GET — list products. Public callers get only published products; an
// authenticated admin gets the full list (so hidden/draft items are never
// exposed to anonymous clients, but admins can still manage them).
export const GET = withRoute("โหลดรายการสินค้าไม่สำเร็จ", async () => {
  const products = await getAllProducts();
  const session = await getSession();
  const visible = session ? products : products.filter(isProductPublic);
  return NextResponse.json(visible);
});

// POST — create new product (login required)
export const POST = withRoute(
  "เพิ่มสินค้าไม่สำเร็จ",
  async (request: NextRequest) => {
    await requireAuth();
    const data = (await request.json()) as Partial<ProductData>;

    // Validate required fields; never trust the client for server-owned fields
    // (createdAt is assigned here; isPublished is coerced to a boolean).
    if (!data.title_th || !data.title_en || !data.title_zh) {
      return NextResponse.json(
        { error: "กรุณากรอกชื่อสินค้าให้ครบทั้ง 3 ภาษา (ไทย อังกฤษ จีน)" },
        { status: 400 }
      );
    }
    if (typeof data.categoryId !== "number") {
      return NextResponse.json({ error: "รหัสหมวดหมู่ต้องเป็นตัวเลข" }, { status: 400 });
    }
    if (typeof data.image !== "string" || !data.image) {
      return NextResponse.json({ error: "กรุณาใส่รูปสินค้า" }, { status: 400 });
    }

    const product: ProductData = {
      id: typeof data.id === "string" && data.id ? data.id : crypto.randomUUID(),
      categoryId: data.categoryId,
      image: data.image,
      title_th: data.title_th,
      title_en: data.title_en,
      title_zh: data.title_zh,
      desc_th: data.desc_th ?? "",
      desc_en: data.desc_en ?? "",
      desc_zh: data.desc_zh ?? "",
      createdAt: new Date().toISOString(),
      isPublished: data.isPublished !== false,
      bestSellerRank: data.bestSellerRank ?? null,
      showBestSellerBadge: data.showBestSellerBadge !== false,
    };
    let newProduct: ProductData;
    try {
      newProduct = await addProduct(product);
    } catch (err) {
      if (err instanceof BestSellerRankConflictError) {
        return NextResponse.json({ error: err.message }, { status: 409 });
      }
      throw err;
    }

    // Invalidate the cache to ensure clients see the new product
    revalidateTag("products", { expire: 0 });

    return NextResponse.json(newProduct, { status: 201 });
  }
);

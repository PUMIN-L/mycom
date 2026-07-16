import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { getAllProducts, addProduct, ProductData } from "../../lib/productStore";
import { requireAuth, withRoute } from "../../lib/apiHelpers";
import { getSession } from "../../lib/session";

// GET — list products. Public callers get only published products; an
// authenticated admin gets the full list (so hidden/draft items are never
// exposed to anonymous clients, but admins can still manage them).
export const GET = withRoute("Failed to fetch products", async () => {
  const products = await getAllProducts();
  const session = await getSession();
  const visible = session
    ? products
    : products.filter((p) => p.isPublished !== false);
  return NextResponse.json(visible);
});

// POST — create new product (login required)
export const POST = withRoute(
  "Failed to create product",
  async (request: NextRequest) => {
    await requireAuth();
    const data: ProductData = await request.json();
    const newProduct = await addProduct(data);
    
    // Invalidate the cache to ensure clients see the new product
    revalidateTag("products", { expire: 0 });
    
    return NextResponse.json(newProduct, { status: 201 });
  }
);

import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { getAllProducts, addProduct, ProductData } from "../../lib/productStore";
import { requireAuth, withRoute } from "../../lib/apiHelpers";

// GET — list all products (public)
export const GET = withRoute("Failed to fetch products", async () => {
  const products = await getAllProducts();
  return NextResponse.json(products);
});

// POST — create new product (login required)
export const POST = withRoute(
  "Failed to create product",
  async (request: NextRequest) => {
    await requireAuth();
    const data: ProductData = await request.json();
    const newProduct = await addProduct(data);
    
    // Invalidate the cache to ensure clients see the new product
    revalidateTag("products", "max");
    
    return NextResponse.json(newProduct, { status: 201 });
  }
);

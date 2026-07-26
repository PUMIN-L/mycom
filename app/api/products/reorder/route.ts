import { NextResponse } from "next/server";
import { reorderProducts } from "../../../lib/productStore";
import { getSession } from "../../../lib/session";
import { revalidateTag } from "next/cache";

// PUT — reorder products (login required).
export async function PUT(req: Request) {
  try {
    const session = await getSession();
    
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { productIds } = await req.json();
    
    if (!Array.isArray(productIds)) {
      return NextResponse.json({ error: "Invalid data format" }, { status: 400 });
    }

    const success = await reorderProducts(productIds);
    if (!success) {
      return NextResponse.json(
        { error: "Failed to reorder products" },
        { status: 500 }
      );
    }

    revalidateTag("products", { expire: 0 });
    return NextResponse.json({ message: "Products reordered successfully" });
  } catch (error) {
    console.error("PUT /api/products/reorder error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}

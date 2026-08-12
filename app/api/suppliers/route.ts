import { NextResponse } from "next/server";
import { getAllSuppliers, createSupplier } from "../../lib/supplierStore";
import { withRoute, requireAuth, jsonError } from "../../lib/apiHelpers";

export const GET = withRoute(
  "Failed to load suppliers",
  async () => {
    await requireAuth();

    const rows = await getAllSuppliers();
    return NextResponse.json(rows);
  }
);

export const POST = withRoute(
  "Failed to create supplier",
  async (request: Request) => {
    await requireAuth();

    const data = await request.json();
    if (!data.companyName || typeof data.companyName !== "string" || data.companyName.trim() === "") {
      return jsonError("Company Name is required", 400);
    }

    const supplier = await createSupplier(data);
    return NextResponse.json(supplier);
  }
);

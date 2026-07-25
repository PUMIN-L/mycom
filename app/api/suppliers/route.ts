import { NextResponse } from "next/server";
import { getAllSuppliers, createSupplier } from "../../lib/supplierStore";
import { getSession } from "../../lib/session";

export async function GET(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rows = await getAllSuppliers();
    return NextResponse.json(rows);
  } catch (error: any) {
    console.error("GET /api/suppliers error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const data = await request.json();
    if (!data.companyName || typeof data.companyName !== "string" || data.companyName.trim() === "") {
      return NextResponse.json({ error: "Company Name is required" }, { status: 400 });
    }

    const supplier = await createSupplier(data);
    return NextResponse.json(supplier);
  } catch (error: any) {
    console.error("POST /api/suppliers error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

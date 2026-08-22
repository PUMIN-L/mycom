import { NextRequest, NextResponse } from "next/server";
import { getAllSalespeople, createSalesperson } from "../../lib/salesStore";
import { requireAuth, withRoute } from "../../lib/apiHelpers";

// GET — list all salespeople (admin only — internal staff data).
export const GET = withRoute(
  "Failed to fetch salespeople",
  async (_request: NextRequest) => {
    await requireAuth();
    const salespeople = await getAllSalespeople();
    return NextResponse.json(salespeople);
  }
);

// POST — create new salesperson (login required)
export const POST = withRoute(
  "Failed to create salesperson",
  async (request: NextRequest) => {
    await requireAuth();
    const body = await request.json();
    
    if (!body.name || body.name.trim() === "") {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }
    
    if (body.name.length > 255) {
      return NextResponse.json({ error: "Name must be less than 255 characters" }, { status: 400 });
    }

    const created = await createSalesperson(body);
    return NextResponse.json(created, { status: 201 });
  }
);

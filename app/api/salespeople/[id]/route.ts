import { NextRequest, NextResponse } from "next/server";
import { getSalesperson, updateSalesperson, deleteSalesperson } from "../../../lib/salesStore";
import { requireAuth, withRoute, ApiError } from "../../../lib/apiHelpers";

type Ctx = { params: Promise<{ id: string }> };

// GET — single salesperson (public)
export const GET = withRoute(
  "Failed to fetch salesperson",
  async (_request: NextRequest, { params }: Ctx) => {
    const { id } = await params;
    const salesperson = await getSalesperson(id);
    if (!salesperson) {
      return NextResponse.json({ error: "Salesperson not found" }, { status: 404 });
    }
    return NextResponse.json(salesperson);
  }
);

// PUT — update salesperson (login required)
export const PUT = withRoute(
  "Failed to update salesperson",
  async (request: NextRequest, { params }: Ctx) => {
    await requireAuth();
    const { id } = await params;
    const body = await request.json();
    
    if (body.name !== undefined && (body.name.trim() === "" || body.name.length > 255)) {
      return NextResponse.json({ error: "Invalid name" }, { status: 400 });
    }

    const updated = await updateSalesperson(id, body);
    if (!updated) {
      return NextResponse.json({ error: "Salesperson not found" }, { status: 404 });
    }
    return NextResponse.json(updated);
  }
);

// DELETE — delete salesperson (login required)
export const DELETE = withRoute(
  "Failed to delete salesperson",
  async (_request: NextRequest, { params }: Ctx) => {
    await requireAuth();
    const { id } = await params;
    
    const deleted = await deleteSalesperson(id);
    if (!deleted) {
      throw new ApiError(500, "Failed to delete salesperson");
    }

    return NextResponse.json({ success: true });
  }
);

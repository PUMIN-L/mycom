import { NextRequest, NextResponse } from "next/server";
import { getSalesperson, updateSalesperson, deleteSalesperson } from "../../../lib/salesStore";
import { requireAuth, withRoute, ApiError, jsonError } from "../../../lib/apiHelpers";
import { query } from "../../../lib/db";

type Ctx = { params: Promise<{ id: string }> };

// GET — single salesperson (admin only)
export const GET = withRoute(
  "Failed to fetch salesperson",
  async (_request: NextRequest, { params }: Ctx) => {
    await requireAuth();
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

    // sales_records references salespersonId with no FK (loose reference by
    // design), so deleting a salesperson that still has sales records would
    // silently orphan their sales history. Check first, the same way
    // customers/[id]/route.ts guards on linked sales records.
    const [salesRecords] = (await query(
      "SELECT id FROM sales_records WHERE salespersonId = ? LIMIT 1",
      [id]
    )) as any[];
    if (salesRecords.length > 0) {
      return jsonError("Cannot delete salesperson with linked sales records", 400);
    }

    const deleted = await deleteSalesperson(id);
    if (!deleted) {
      throw new ApiError(500, "Failed to delete salesperson");
    }

    return NextResponse.json({ success: true });
  }
);

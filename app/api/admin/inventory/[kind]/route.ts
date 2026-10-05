import { NextResponse } from "next/server";
import { withRoute, requireAuth } from "../../../../lib/apiHelpers";
import { listInventory } from "../../../../lib/inventoryStore";
import { inventoryKindFrom } from "../../../../lib/inventoryRoute";

// The asset register (/assets) or stock (/stock), whole: every group and every
// piece (no timelines). The page searches and filters it in the browser.
// Spec: openspec/changes/add-inventory-tracking.
export const GET = withRoute(
  "โหลดรายการไม่สำเร็จ",
  async (_request: Request, { params }: { params: Promise<{ kind: string }> }) => {
    await requireAuth();
    const kind = await inventoryKindFrom(params);
    return NextResponse.json(await listInventory(kind));
  }
);

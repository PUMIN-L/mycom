import { NextRequest, NextResponse } from "next/server";
import { withRoute, requireAuth } from "../../../../lib/apiHelpers";
import {
  getSalesRecord,
  updateSalesRecord,
  deleteSalesRecord,
} from "../../../../lib/salesDashboardStore";
import {
  syncEquipmentRowsForSalesRecord,
  cleanupEquipmentsForSalesRecord,
  type EquipmentRowInput,
} from "../../../../lib/crmStore";

type Ctx = { params: Promise<{ id: string }> };

/**
 * The machines this save is talking about, as (row id, serial) pairs.
 *
 * The edit form loads the sale's machines and sends them back in
 * `equipments: [{ id, serialNumber }]`, so each box stays bound to the row it
 * was loaded from even while its serial is still blank or being corrected —
 * position alone used to decide that, and got it wrong whenever the admin typed
 * the serials in any order but the rows' (invisible) creation order.
 *
 * `serialNumbers` remains the fallback for any client that sends only serials
 * (and for a box the admin added beyond the machines that were loaded): a row
 * with no id behaves exactly as it always has — serial first, then position.
 *
 * The pairing is built BEFORE the qty clamp and sliced as ONE list: ids and
 * serials sliced separately is precisely how an off-by-one rebind would be
 * reintroduced, and pass 0 would then write it confidently.
 */
function equipmentRowsFromBody(body: any): EquipmentRowInput[] | null {
  // An EMPTY `equipments` array is not an instruction to detach every machine
  // on the bill — an equipment sale always has qty >= 1, so it only ever means
  // the client had nothing to say here. Falling through to `serialNumbers`
  // keeps the pre-existing behaviour for a caller that sends both (which the
  // sale forms do); taking the empty list at face value would unlink every
  // machine on the sale, orphaning its warranty and service history.
  if (Array.isArray(body.equipments) && body.equipments.length > 0) {
    return body.equipments.map((raw: unknown) => {
      const row = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
      const id = typeof row.id === "string" ? row.id.trim() : "";
      const serialNumber =
        typeof row.serialNumber === "string" ? row.serialNumber : "";
      return id ? { id, serialNumber } : { serialNumber };
    });
  }
  if (Array.isArray(body.serialNumbers)) {
    return body.serialNumbers.map((sn: unknown) => ({ serialNumber: String(sn ?? "") }));
  }
  return null;
}

// GET /api/admin/sales/[id] — single sales record
export const GET = withRoute(
  "โหลดรายการขายไม่สำเร็จ",
  async (_request: NextRequest, { params }: Ctx) => {
    await requireAuth();
    const { id } = await params;
    const record = await getSalesRecord(id);
    if (!record) {
      return NextResponse.json({ error: "ไม่พบรายการ" }, { status: 404 });
    }
    return NextResponse.json(record);
  }
);

// PUT /api/admin/sales/[id] — update
export const PUT = withRoute(
  "แก้ไขรายการขายไม่สำเร็จ",
  async (request: NextRequest, { params }: Ctx) => {
    await requireAuth();
    const { id } = await params;
    const body = await request.json();
    if (body.saleDate !== undefined) {
      if (!body.saleDate || !/^\d{4}-\d{2}-\d{2}$/.test(body.saleDate)) {
        return NextResponse.json(
          { error: "รูปแบบวันที่ขายไม่ถูกต้อง (YYYY-MM-DD)" },
          { status: 400 }
        );
      }
      if (isNaN(new Date(body.saleDate + "T00:00:00").getTime())) {
        return NextResponse.json(
          { error: "วันที่ไม่ถูกต้อง" },
          { status: 400 }
        );
      }
    }
    const updated = await updateSalesRecord(id, body);
    if (!updated) {
      return NextResponse.json({ error: "ไม่พบรายการ" }, { status: 404 });
    }

    // Sync equipments if sale type is equipment
    let equipmentWarning: string | null = null;
    const equipmentRows =
      body.saleType === "equipment" ? equipmentRowsFromBody(body) : null;
    if (equipmentRows) {
      const customerId = body.customerId || updated.customerId || "";
      // Trim the machine list to match qty (frontend may send stale entries beyond qty)
      const qty = Math.max(1, Math.min(50, Number(body.qty || updated.qty) || 1));
      const trimmedRows = equipmentRows.slice(0, qty);
      try {
        await syncEquipmentRowsForSalesRecord(id, trimmedRows, {
          customerId,
          productId: body.productId || updated.productId || "",
          productName: body.productName || updated.productName || "",
          quotationNumber: body.quotationRef || updated.quotationRef || "",
          warrantyCertNumber: "",
          warrantyType: "",
          warrantyStartDate: body.warrantyStartDate || updated.warrantyStartDate || null,
          warrantyEndDate: body.warrantyEndDate || updated.warrantyEndDate || null,
          // Only ever reaches a BRAND-NEW machine: the sync no longer writes
          // status onto an existing row, so a re-save cannot resurrect a
          // machine someone marked หมดอายุ.
          status: "Active",
        });
      } catch (err: any) {
        console.error("syncEquipmentRowsForSalesRecord failed:", err);
        equipmentWarning = `บันทึกยอดขายสำเร็จ แต่ซิงค์อุปกรณ์ล้มเหลว: ${err.message}`;
      }
    } else if (body.saleType === "service") {
      // Changed from equipment → service: clean up orphan equipment records
      try {
        await cleanupEquipmentsForSalesRecord(id);
      } catch (err) {
        console.error("Failed to cleanup equipments on type change:", err);
      }
    }

    // Re-fetch to include synced serial numbers in the response
    const final = await getSalesRecord(id) || updated;
    if (equipmentWarning) {
      return NextResponse.json({ ...final, warning: equipmentWarning });
    }
    return NextResponse.json(final);
  }
);

// DELETE /api/admin/sales/[id] — delete
export const DELETE = withRoute(
  "ลบรายการขายไม่สำเร็จ",
  async (_request: NextRequest, { params }: Ctx) => {
    await requireAuth();
    const { id } = await params;
    // Clean up linked equipment records first
    try {
      await cleanupEquipmentsForSalesRecord(id);
    } catch (err) {
      console.error("Failed to cleanup equipments for sales record:", err);
    }
    const deleted = await deleteSalesRecord(id);
    if (!deleted) {
      return NextResponse.json({ error: "ไม่พบรายการ" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  }
);

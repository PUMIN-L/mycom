import { NextRequest, NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { withRoute, requireAuth } from "../../../../../lib/apiHelpers";
import { getSalesRecord } from "../../../../../lib/salesDashboardStore";
import { listLineItemsForSale } from "../../../../../lib/saleLineItemStore";
import { query } from "../../../../../lib/db";

type Ctx = { params: Promise<{ id: string }> };

// Machines attached to this sale. `productName` falls back to the live catalog
// title exactly the way the equipment list does, so a row saved without a name
// of its own still reads as something.
const EQUIPMENT_FOR_SALE_SQL = `
  SELECT e.id, e.salesRecordId, e.customerId, e.productId,
         COALESCE(NULLIF(e.productName, ''), p.title_th, '') AS productName,
         e.serialNumber, e.quotationNumber, e.warrantyCertNumber, e.warrantyType,
         e.warrantyStartDate, e.warrantyEndDate, e.calibrationDate, e.status,
         e.createdAt
    FROM customer_equipments e
    LEFT JOIN products p ON e.productId = p.id
   WHERE e.salesRecordId = ?
   ORDER BY e.createdAt ASC`;

/**
 * GET /api/admin/sales/[id]/items — the contents of one bill: its
 * `sales_record_items` lines plus the `customer_equipments` rows linked to it.
 *
 * Feeds the expandable row of the sales table (Phase 3), which loads this
 * lazily per expanded row rather than for every row on page load.
 *
 * `quotationId` comes back alongside so the caller can offer "open the source
 * quotation" without a second request; it is a SOFT link (quotations are
 * purged on their own retention schedule), so a non-null id here is no promise
 * that the quotation still exists — the caller degrades to a disabled button,
 * never an error.
 */
export const GET = withRoute(
  "โหลดรายการสินค้าในใบขายไม่สำเร็จ",
  async (_request: NextRequest, { params }: Ctx) => {
    await requireAuth();
    const { id } = await params;

    const record = await getSalesRecord(id);
    if (!record) {
      return NextResponse.json({ error: "ไม่พบรายการ" }, { status: 404 });
    }

    const [items, equipmentRows] = await Promise.all([
      listLineItemsForSale(id),
      query<RowDataPacket[]>(EQUIPMENT_FOR_SALE_SQL, [id]),
    ]);
    const equipments = Array.isArray(equipmentRows?.[0]) ? equipmentRows[0] : [];

    return NextResponse.json({
      salesRecordId: id,
      quotationId:
        (record as unknown as { quotationId?: string | null }).quotationId || null,
      quotationRef: record.quotationRef || "",
      items,
      equipments,
    });
  }
);

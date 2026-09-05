import { NextRequest, NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { withRoute, requireAuth } from "../../../lib/apiHelpers";
import {
  createSaleWithLineItems,
  listSalesRecords,
} from "../../../lib/salesDashboardStore";
import type { SaleLineItem } from "../../../lib/saleLineItemStore";
import type { EquipmentRowInput } from "../../../lib/crmStore";
import type { SalesRecord } from "../../../lib/types";
import { query } from "../../../lib/db";

/**
 * Sale payload. Two accepted shapes, both ending in the SAME atomic write:
 *
 *   • multi-line (new): `items[]` + `equipments[]`, one line per product and
 *     one row per physical machine — a bill can mix models, prices and
 *     warranties.
 *   • single-product (legacy): the flat `productId`/`qty`/`unitPrice` +
 *     `serialNumbers[]` fields the existing dashboard form still posts. It is
 *     normalized into exactly one line item here, so a legacy sale is stored
 *     identically to a one-line new sale — without that, it would carry no
 *     `sales_record_items` row and would silently vanish from the product /
 *     category reports, which now read line items only.
 */
type SaleBody = Partial<SalesRecord> & {
  quotationId?: string | null;
  items?: unknown;
  equipments?: unknown;
};

/** Mirrors crmStore's own per-sale cap, so an over-long list is refused with a
 * message instead of being silently truncated by the store. */
const MAX_EQUIPMENT_ROWS = 50;

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

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

/** A field the caller left out entirely (or cleared) — the store's default applies. */
function isAbsent(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    (typeof value === "string" && value.trim() === "")
  );
}

/**
 * Task 7.2 — line-item validation. Anything that would land as a nonsense
 * amount is rejected here, naming the offending line and field in Thai, rather
 * than being clamped into a plausible-looking number by the store.
 */
function validateItems(items: unknown): string | null {
  if (!Array.isArray(items) || items.length === 0) {
    return "กรุณาระบุรายการสินค้าอย่างน้อย 1 รายการ";
  }
  const money: Array<[keyof SaleLineItem, string]> = [
    ["unitPrice", "ราคาต่อหน่วย"],
    ["costAmount", "ต้นทุนสินค้า"],
  ];
  for (let i = 0; i < items.length; i++) {
    const raw = items[i];
    const at = `รายการที่ ${i + 1}`;
    if (!raw || typeof raw !== "object") return `${at}: ข้อมูลรายการสินค้าไม่ถูกต้อง`;
    const item = raw as Record<string, unknown>;

    const qty = Number(item.qty);
    if (!Number.isFinite(qty) || qty < 1) {
      return `${at}: จำนวน (qty) ต้องเป็นตัวเลขตั้งแต่ 1 ขึ้นไป`;
    }
    for (const [field, label] of money) {
      if (isAbsent(item[field])) continue; // omitted → 0
      const n = Number(item[field]);
      if (!Number.isFinite(n) || n < 0) {
        return `${at}: ${label} (${field}) ต้องเป็นตัวเลขที่ไม่ติดลบ`;
      }
    }
  }
  return null;
}

/**
 * Task 7.2, amended by report 7 — SHAPE ONLY.
 *
 * A serial is NO LONGER required. The owner hit the real case the old rule
 * assumed away (the machine is sold and the bill has to be recorded before the
 * serial is in hand), so a machine may be saved with `serialNumber: ""` and is
 * chased afterwards by the «ข้อมูลไม่ครบ» alert category, which already fires
 * on `serialNumber = '' OR serialNumber IS NULL OR warrantyStartDate IS NULL`
 * (`getAlerts`). Re-adding the requirement here would silently re-block the
 * form, which no longer blocks on its own.
 *
 * What is still refused: a row that is not an object at all, and a
 * `serialNumber` that is present but not a string (an object/array would land
 * in the column as "[object Object]" — that is a malformed request, not a
 * machine whose serial is not known yet).
 *
 * A serial that DUPLICATES an existing machine is deliberately NOT rejected:
 * duplicates are legal and are surfaced as a confirmable warning in the form
 * (D12), so blocking them here would make that confirmation impossible to
 * honour.
 */
function validateEquipments(rows: unknown[]): string | null {
  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i];
    const at = `เครื่องที่ ${i + 1}`;
    if (!raw || typeof raw !== "object") return `${at}: ข้อมูลอุปกรณ์ไม่ถูกต้อง`;
    const serial = (raw as Record<string, unknown>).serialNumber;
    if (serial !== undefined && serial !== null && typeof serial !== "string") {
      return `${at}: รูปแบบ Serial Number (serialNumber) ไม่ถูกต้อง`;
    }
  }
  return null;
}

/** The legacy flat payload, expressed as the one line item it has always been. */
function legacyLineItem(body: SaleBody): Partial<SaleLineItem> {
  return {
    productId: body.productId || "",
    productName: body.productName || "",
    categoryId: body.categoryId ?? null,
    qty: body.qty,
    unitPrice: body.unitPrice,
    totalAmount: body.totalAmount,
    costAmount: body.costAmount,
    quotationItemId: null,
    sortOrder: 0,
  };
}

/**
 * Legacy machines: bare serials that inherit the sale-level product, warranty
 * dates and quotation number. The old route created `min(qty, 50)` rows and
 * ignored serials beyond that — the cap is preserved exactly.
 *
 * Report 7 changed ONE thing: the list is PADDED up to `limit` instead of
 * stopping at whatever the caller typed. It used to be impossible to get here
 * with a short (or blank) list — the route refused the request — but now that a
 * serial may be left for later, "3 machines sold, no serial typed" has to
 * become THREE rows with a blank serial, not zero. Each of them is one physical
 * machine the «ข้อมูลไม่ครบ» alert can then chase; dropping them would lose the
 * machines silently, which is exactly what the alert is meant to prevent.
 */
function legacyEquipments(body: SaleBody): EquipmentRowInput[] {
  if (body.saleType !== "equipment") return [];
  const qty = Math.max(1, Number(body.qty) || 1);
  const limit = Math.min(qty, MAX_EQUIPMENT_ROWS);
  const serials = Array.isArray(body.serialNumbers) ? body.serialNumbers : [];
  return Array.from({ length: limit }, (_, i) => ({
    serialNumber: String(serials[i] ?? "").trim(),
  }));
}

async function listEquipmentsForSale(salesRecordId: string) {
  const [rows] = await query<RowDataPacket[]>(EQUIPMENT_FOR_SALE_SQL, [salesRecordId]);
  return Array.isArray(rows) ? rows : [];
}

// GET /api/admin/sales — list sales records (filterable)
export const GET = withRoute(
  "โหลดรายการยอดขายไม่สำเร็จ",
  async (request: NextRequest) => {
    await requireAuth();
    const url = request.nextUrl;
    const filters = {
      salespersonId: url.searchParams.get("salespersonId") || undefined,
      customerId: url.searchParams.get("customerId") || undefined,
      categoryId: url.searchParams.get("categoryId")
        ? Number(url.searchParams.get("categoryId"))
        : undefined,
      dateFrom: url.searchParams.get("dateFrom") || undefined,
      dateTo: url.searchParams.get("dateTo") || undefined,
    };
    const records = await listSalesRecords(filters);
    return NextResponse.json(records);
  }
);

// POST /api/admin/sales — create a sales record, its line items and its
// machines in ONE transaction. There is no partial success to report any more,
// so the old HTTP 207 branch is gone: the write either lands whole or nothing
// is written at all and the caller gets an error.
export const POST = withRoute(
  "บันทึกยอดขายไม่สำเร็จ",
  async (request: NextRequest) => {
    await requireAuth();
    const body = (await request.json()) as SaleBody;

    if (!body.saleDate || !/^\d{4}-\d{2}-\d{2}$/.test(body.saleDate)) {
      return badRequest("กรุณาระบุวันที่ขาย (YYYY-MM-DD)");
    }
    if (isNaN(new Date(body.saleDate + "T00:00:00").getTime())) {
      return badRequest("วันที่ไม่ถูกต้อง");
    }
    if (body.deliveryRef && !body.invoiceRef) {
      return badRequest(
        "ถ้าระบุอ้างอิงเลขใบส่งสินค้า ต้องระบุอ้างอิงเลขใบ invoice ด้วย"
      );
    }

    let items: Partial<SaleLineItem>[];
    let equipments: EquipmentRowInput[];

    if (body.items !== undefined) {
      const itemsError = validateItems(body.items);
      if (itemsError) return badRequest(itemsError);

      if (body.equipments !== undefined && !Array.isArray(body.equipments)) {
        return badRequest("ข้อมูลอุปกรณ์ (equipments) ไม่ถูกต้อง");
      }
      const rows = (body.equipments as unknown[]) || [];
      if (rows.length > MAX_EQUIPMENT_ROWS) {
        return badRequest(
          `บันทึกอุปกรณ์ได้สูงสุด ${MAX_EQUIPMENT_ROWS} เครื่องต่อใบขาย 1 ใบ (ส่งมา ${rows.length} เครื่อง)`
        );
      }
      const equipmentError = validateEquipments(rows);
      if (equipmentError) return badRequest(equipmentError);

      items = body.items as Partial<SaleLineItem>[];
      equipments = rows as EquipmentRowInput[];
    } else {
      if (!body.productName && !body.productId) {
        return badRequest("กรุณาระบุสินค้า");
      }
      // Report 7 — the per-machine "ขาดชิ้นที่ N" blocker is GONE from this
      // branch too: the flat form is the plain "เพิ่มรายการขาย" form, so
      // leaving the rule here would keep refusing exactly the bill the owner
      // asked to be able to record. Only the SHAPE is still checked (an
      // equipment sale must send a serial array, even one full of blanks);
      // `legacyEquipments` pads it to one row per machine and the
      // «ข้อมูลไม่ครบ» alert takes it from there.
      if (body.saleType === "equipment" && !Array.isArray(body.serialNumbers)) {
        return badRequest("ข้อมูล Serial Number ไม่ถูกต้อง");
      }
      items = [legacyLineItem(body)];
      equipments = legacyEquipments(body);
    }

    // `quotationId` and `quotationRef` both ride along on `body` (task 7.7):
    // the store persists whichever is present, so a hand-typed reference with
    // no quotation selected is stored just as happily as a linked one.
    const record = await createSaleWithLineItems({ sale: body, items, equipments });
    const createdEquipments = await listEquipmentsForSale(record.id);

    return NextResponse.json({ record, createdEquipments }, { status: 201 });
  }
);

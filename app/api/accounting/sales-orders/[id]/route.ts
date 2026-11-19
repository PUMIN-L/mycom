import { NextRequest } from "next/server";
import { withRoute, jsonError } from "../../../../lib/apiHelpers";
import { bangkokDateString } from "../../../../lib/dateFormat";
import { noStoreJson, requireAccountingUser } from "../../../../lib/accounting/guard";
import { salesOrderDetail, updateSalesOrder, updateSalesOrderSchedule } from "../../../../lib/accounting/salesOrders";
import { deletionImpact } from "../../../../lib/accounting/documents";
import { cleanOrderInput } from "../../../../lib/accounting/orderRules";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/accounting/sales-orders/[id] — the PO, its delivery progress, its
// invoices, the discounts they already carry, its deposits and payment plan
// (where each item stands as of today in Bangkok), and what deleting it would do.
export const GET = withRoute("โหลด PO ลูกค้าไม่สำเร็จ", async (_request: NextRequest, { params }: Ctx) => {
  await requireAccountingUser();
  const { id } = await params;
  const detail = await salesOrderDetail(id, bangkokDateString(new Date()));
  if (!detail) return jsonError("ไม่พบ PO ลูกค้านี้", 404);
  return noStoreJson({ ...detail, impact: await deletionImpact(id) });
});

// PUT /api/accounting/sales-orders/[id] — saves over the PO, lines and all,
// while nothing has been invoiced from it ({ …order, expectedUpdatedAt }).
export const PUT = withRoute("บันทึก PO ลูกค้าไม่สำเร็จ", async (request: NextRequest, { params }: Ctx) => {
  const { actor } = await requireAccountingUser();
  const { id } = await params;
  const body = (await request.json()) as Record<string, unknown>;
  const expected = typeof body.expectedUpdatedAt === "string" ? body.expectedUpdatedAt : undefined;
  return noStoreJson(await updateSalesOrder(id, cleanOrderInput(body), actor, expected));
});

// PATCH /api/accounting/sales-orders/[id] — { expectedDeliveryDate,
// storageNote, note }: the schedule and notes, any time before it is cancelled.
export const PATCH = withRoute("บันทึก PO ลูกค้าไม่สำเร็จ", async (request: NextRequest, { params }: Ctx) => {
  const { actor } = await requireAccountingUser();
  const { id } = await params;
  const body = (await request.json()) as Record<string, unknown>;
  const text = (v: unknown) => (typeof v === "string" ? v : "");
  return noStoreJson(
    await updateSalesOrderSchedule(id, { expectedDeliveryDate: text(body.expectedDeliveryDate), storageNote: text(body.storageNote), note: text(body.note) }, actor)
  );
});

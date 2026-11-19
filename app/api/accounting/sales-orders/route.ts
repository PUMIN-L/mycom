import { NextRequest } from "next/server";
import { withRoute, ApiError } from "../../../lib/apiHelpers";
import { bangkokDateString, isValidDateString } from "../../../lib/dateFormat";
import { noStoreJson, requireAccountingUser } from "../../../lib/accounting/guard";
import { createSalesOrder, listSalesOrders } from "../../../lib/accounting/salesOrders";
import { cleanOrderInput } from "../../../lib/accounting/orderRules";

// GET /api/accounting/sales-orders[?from=YYYY-MM-DD&to=YYYY-MM-DD&q=…] —
// customer POs, newest first, each with what it still holds; `to` exclusive.
export const GET = withRoute("โหลดรายการ PO ลูกค้าไม่สำเร็จ", async (request: NextRequest) => {
  await requireAccountingUser();
  const params = request.nextUrl.searchParams;
  const from = params.get("from") || undefined;
  const to = params.get("to") || undefined;
  if ((from && !isValidDateString(from)) || (to && !isValidDateString(to))) throw new ApiError(400, "ช่วงวันที่ไม่ถูกต้อง");
  const q = (params.get("q") || "").slice(0, 100);
  return noStoreJson(await listSalesOrders({ from, to, q, today: bangkokDateString(new Date()) }));
});

// POST /api/accounting/sales-orders — a customer PO received (not a sale yet).
export const POST = withRoute("บันทึก PO ลูกค้าไม่สำเร็จ", async (request: NextRequest) => {
  const { actor } = await requireAccountingUser();
  return noStoreJson(await createSalesOrder(cleanOrderInput(await request.json()), actor), { status: 201 });
});

import { NextRequest } from "next/server";
import { withRoute, ApiError } from "../../../lib/apiHelpers";
import { noStoreJson, requireAccountingUser } from "../../../lib/accounting/guard";
import { commissionCostsFor, commissionMonth } from "../../../lib/accounting/commissionData";

// GET /api/accounting/commission?month=YYYY-MM — the commission month by PO
// date (ARCHITECTURE.md §8h): each customer PO in the ladder's order with its
// profit, place on the ladder, ฟอร์ด / พี่ต่อ / บริษัท shares and where it
// stands; the month's totals per person; invoices not from a PO, counted.
// `&withCosts=1` adds every PO's cost breakdown (`costs`, by PO id) — for the
// month's Excel, read in one go.
export const GET = withRoute("โหลดค่าคอมมิชชั่นไม่สำเร็จ", async (request: NextRequest) => {
  await requireAccountingUser();
  const params = request.nextUrl.searchParams;
  const data = await commissionMonth(params.get("month") ?? "");
  if (!data) throw new ApiError(400, "เดือนไม่ถูกต้อง");
  if (params.get("withCosts") !== "1") return noStoreJson(data);
  const costs = await commissionCostsFor(data.rows.map((r) => ({ id: r.id, customerPoNo: r.customerPoNo })));
  return noStoreJson({ ...data, costs });
});

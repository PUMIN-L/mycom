import { withRoute } from "../../../../lib/apiHelpers";
import { bangkokDateString } from "../../../../lib/dateFormat";
import { noStoreJson, requireAccountingUser } from "../../../../lib/accounting/guard";
import { orderBacklog } from "../../../../lib/accounting/salesOrders";

// GET /api/accounting/sales-orders/backlog — the dashboard's "ยอดรอส่งของ
// (ณ วันนี้)": every customer PO still holding something, ex VAT, as of
// today in Bangkok — kept out of the sales figures.
export const GET = withRoute("โหลดยอดรอส่งของไม่สำเร็จ", async () => {
  await requireAccountingUser();
  return noStoreJson(await orderBacklog(bangkokDateString(new Date())));
});

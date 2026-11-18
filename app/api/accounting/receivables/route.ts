import { withRoute } from "../../../lib/apiHelpers";
import { bangkokDateString } from "../../../lib/dateFormat";
import { noStoreJson, requireAccountingUser } from "../../../lib/accounting/guard";
import { receivables } from "../../../lib/accounting/payments";

// GET /api/accounting/receivables — every issued invoice still owed, by
// customer and age as of today (Bangkok), and the 50 ทวิ certificates the
// customers have not sent yet.
export const GET = withRoute("โหลดลูกหนี้คงค้างไม่สำเร็จ", async () => {
  await requireAccountingUser();
  return noStoreJson(await receivables(bangkokDateString(new Date())));
});

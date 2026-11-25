import { NextRequest } from "next/server";
import { withRoute } from "../../../../lib/apiHelpers";
import { noStoreJson, requireAccountingUser } from "../../../../lib/accounting/guard";
import { confirmRatesChange, loadRates } from "../../../../lib/accounting/commissionRates";

// GET /api/accounting/commission/rates — the commission rate sets in force (one
// from the beginning, later ones by the month they start) and the history of
// every change (ARCHITECTURE.md §8h).
export const GET = withRoute("โหลดตารางอัตราค่าคอมไม่สำเร็จ", async () => {
  await requireAccountingUser();
  return noStoreJson(await loadRates());
});

// PUT /api/accounting/commission/rates — { otp }: the 6-digit code from the
// owner's email. It saves the change stored WITH that code (POST …/otp) —
// nothing else the request carries — then emails the latest tables.
export const PUT = withRoute("บันทึกตารางอัตราค่าคอมไม่สำเร็จ", async (request: NextRequest) => {
  const { actor } = await requireAccountingUser();
  const body = (await request.json()) as Record<string, unknown> | null;
  return noStoreJson(await confirmRatesChange(body?.otp, actor));
});

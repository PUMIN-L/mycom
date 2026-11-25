import { NextRequest } from "next/server";
import { withRoute } from "../../../../../../lib/apiHelpers";
import { noStoreJson, requireAccountingUser } from "../../../../../../lib/accounting/guard";
import { voidPayout } from "../../../../../../lib/accounting/commissionPayouts";

type Ctx = { params: Promise<{ id: string }> };

// POST /api/accounting/commission/payouts/[id]/void — { reason }: undoes a
// paid-out mark (ARCHITECTURE.md §8h). Never deleted: the mark stays, with who
// undid it, when and why, and the PO may be marked again.
export const POST = withRoute("ยกเลิกการบันทึกจ่ายค่าคอมไม่สำเร็จ", async (request: NextRequest, { params }: Ctx) => {
  const { actor } = await requireAccountingUser();
  const { id } = await params;
  const body = (await request.json()) as Record<string, unknown> | null;
  await voidPayout(id, body?.reason, actor);
  return noStoreJson({ ok: true });
});

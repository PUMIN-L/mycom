import { NextRequest } from "next/server";
import { withRoute } from "../../../../../lib/apiHelpers";
import { requirePassword } from "../../../../../lib/twoFactorReauth";
import { noStoreJson, requireAccountingUser } from "../../../../../lib/accounting/guard";
import { voidPayment } from "../../../../../lib/accounting/payments";

type Ctx = { params: Promise<{ id: string }> };

// POST /api/accounting/payments/[id]/void — { reason, password }: voids a
// payment recorded by mistake, and its receipt with it. The password again —
// it changes what the customer owes and voids a document that may be with
// them. The reason is checked first, so a typo there spends no password try.
export const POST = withRoute("ยกเลิกรายการรับชำระไม่สำเร็จ", async (request: NextRequest, { params }: Ctx) => {
  const { user, actor } = await requireAccountingUser();
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  if (!reason) return noStoreJson({ error: "กรุณาบอกเหตุผลที่ยกเลิก" }, { status: 400 });
  const denied = await requirePassword(user, body?.password);
  if (denied) return denied;
  return noStoreJson(await voidPayment(id, reason, actor));
});

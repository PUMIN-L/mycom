import { NextRequest } from "next/server";
import { withRoute } from "../../../../../lib/apiHelpers";
import { requirePassword } from "../../../../../lib/twoFactorReauth";
import { noStoreJson, requireAccountingUser } from "../../../../../lib/accounting/guard";
import { voidCreditNote } from "../../../../../lib/accounting/creditNotes";

type Ctx = { params: Promise<{ id: string }> };

// POST /api/accounting/credit-notes/[id]/void — { reason, password }: a tax
// document voided (its number kept). The reason is checked first, so a typo
// there spends no password try.
export const POST = withRoute("ยกเลิกใบลดหนี้ไม่สำเร็จ", async (request: NextRequest, { params }: Ctx) => {
  const { user, actor } = await requireAccountingUser();
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  if (!reason) return noStoreJson({ error: "กรุณาบอกเหตุผลที่ยกเลิก" }, { status: 400 });
  const denied = await requirePassword(user, body?.password);
  if (denied) return denied;
  return noStoreJson(await voidCreditNote(id, reason, actor));
});

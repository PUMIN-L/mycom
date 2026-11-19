import { NextRequest } from "next/server";
import { withRoute } from "../../../../../lib/apiHelpers";
import { requirePassword } from "../../../../../lib/twoFactorReauth";
import { noStoreJson, requireAccountingUser } from "../../../../../lib/accounting/guard";
import { voidInvoice } from "../../../../../lib/accounting/documents";

type Ctx = { params: Promise<{ id: string }> };

// POST /api/accounting/documents/[id]/void — { reason, password }: voids an
// issued invoice (its number kept; its sale and history-free machines go).
// The reason is checked first, so a typo there spends no password try.
export const POST = withRoute("ยกเลิกใบแจ้งหนี้ไม่สำเร็จ", async (request: NextRequest, { params }: Ctx) => {
  const { user, actor } = await requireAccountingUser();
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  if (!reason) return noStoreJson({ error: "กรุณาบอกเหตุผลที่ยกเลิก" }, { status: 400 });
  const denied = await requirePassword(user, body?.password);
  if (denied) return denied;
  return noStoreJson(await voidInvoice(id, reason, actor));
});

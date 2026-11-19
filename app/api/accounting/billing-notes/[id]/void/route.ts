import { NextRequest } from "next/server";
import { withRoute } from "../../../../../lib/apiHelpers";
import { noStoreJson, requireAccountingUser } from "../../../../../lib/accounting/guard";
import { voidBillingNote } from "../../../../../lib/accounting/billingNotes";

type Ctx = { params: Promise<{ id: string }> };

// POST /api/accounting/billing-notes/[id]/void — { reason }: the billing note
// cancelled (not a tax document, so no password). Refused once money was
// received against it.
export const POST = withRoute("ยกเลิกใบวางบิลไม่สำเร็จ", async (request: NextRequest, { params }: Ctx) => {
  const { actor } = await requireAccountingUser();
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  return noStoreJson(await voidBillingNote(id, typeof body?.reason === "string" ? body.reason : "", actor));
});

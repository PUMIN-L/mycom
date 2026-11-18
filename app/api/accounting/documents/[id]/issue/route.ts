import { NextRequest } from "next/server";
import { withRoute } from "../../../../../lib/apiHelpers";
import { noStoreJson, requireAccountingUser } from "../../../../../lib/accounting/guard";
import { issueInvoice } from "../../../../../lib/accounting/documents";

type Ctx = { params: Promise<{ id: string }> };

// POST /api/accounting/documents/[id]/issue ({ expectedUpdatedAt }) — gives
// the draft its number and locks it; its /dashboard sale and machines are
// created in the same transaction.
export const POST = withRoute("ออกเอกสารไม่สำเร็จ", async (request: NextRequest, { params }: Ctx) => {
  const { actor } = await requireAccountingUser();
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const expected = typeof body?.expectedUpdatedAt === "string" ? body.expectedUpdatedAt : undefined;
  return noStoreJson(await issueInvoice(id, actor, expected));
});

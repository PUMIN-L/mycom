import { NextRequest } from "next/server";
import { withRoute } from "../../../../lib/apiHelpers";
import { noStoreJson, requireAccountingUser } from "../../../../lib/accounting/guard";
import { updateCert50 } from "../../../../lib/accounting/payments";

type Ctx = { params: Promise<{ id: string }> };

// PATCH /api/accounting/payments/[id] — { cert50Received, cert50Note }: the
// customer's 50 ทวิ certificate came in (and where the paper is kept), or not.
// No file is stored — the owner's choice.
export const PATCH = withRoute("บันทึก 50 ทวิ ไม่สำเร็จ", async (request: NextRequest, { params }: Ctx) => {
  const { actor } = await requireAccountingUser();
  const { id } = await params;
  const body = (await request.json()) as Record<string, unknown>;
  return noStoreJson(
    await updateCert50(id, { received: body?.cert50Received === true, note: typeof body?.cert50Note === "string" ? body.cert50Note : "" }, actor)
  );
});

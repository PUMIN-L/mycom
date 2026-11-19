import { NextRequest } from "next/server";
import { withRoute, jsonError } from "../../../../lib/apiHelpers";
import { noStoreJson, requireAccountingUser } from "../../../../lib/accounting/guard";
import { billingNoteDetail } from "../../../../lib/accounting/billingNotes";
import { deletionImpact } from "../../../../lib/accounting/documents";
import { getSellerProfile, getSellerVersion } from "../../../../lib/accounting/settings";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/accounting/billing-notes/[id] — the billing note, its invoices as
// they stand now, the payments received against it, our company as it
// prints, and what deleting it would do.
export const GET = withRoute("โหลดใบวางบิลไม่สำเร็จ", async (_request: NextRequest, { params }: Ctx) => {
  await requireAccountingUser();
  const { id } = await params;
  const detail = await billingNoteDetail(id);
  if (!detail) return jsonError("ไม่พบใบวางบิลนี้", 404);
  const seller = detail.note.sellerVersionId ? await getSellerVersion(detail.note.sellerVersionId) : (await getSellerProfile()).seller;
  return noStoreJson({ ...detail, seller, impact: await deletionImpact(id) });
});

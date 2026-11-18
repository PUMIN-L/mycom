import { NextRequest } from "next/server";
import { withRoute, jsonError } from "../../../../lib/apiHelpers";
import { requirePassword } from "../../../../lib/twoFactorReauth";
import { noStoreJson, requireAccountingUser } from "../../../../lib/accounting/guard";
import { deleteAccDocument, deletionImpact, getAccDocument, updateInvoiceDraft } from "../../../../lib/accounting/documents";
import { cleanInvoiceInput } from "../../../../lib/accounting/invoiceRules";
import { getSellerProfile, getSellerVersion } from "../../../../lib/accounting/settings";
import { receiptDetail } from "../../../../lib/accounting/payments";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/accounting/documents/[id] — the document, its lines, our company
// as it prints on it (its own version once issued; the current one on a
// draft), and what deleting it would do. A receipt also brings the payment it
// records and the invoice it pays (`receipt`) — it prints both.
export const GET = withRoute("โหลดเอกสารไม่สำเร็จ", async (_request: NextRequest, { params }: Ctx) => {
  await requireAccountingUser();
  const { id } = await params;
  const doc = await getAccDocument(id);
  if (!doc) return jsonError("ไม่พบเอกสารนี้", 404);
  const seller = doc.sellerVersionId ? await getSellerVersion(doc.sellerVersionId) : (await getSellerProfile()).seller;
  const receipt = doc.docType === "RE" ? await receiptDetail(id, doc.relatedDocId) : undefined;
  return noStoreJson({ document: doc, seller, impact: await deletionImpact(id), ...(receipt ? { receipt } : {}) });
});

// PUT /api/accounting/documents/[id] — saves over a DRAFT ({ …invoice, expectedUpdatedAt }).
// (A receipt is never a draft — updateInvoiceDraft refuses anything issued.)
export const PUT = withRoute("บันทึกร่างเอกสารไม่สำเร็จ", async (request: NextRequest, { params }: Ctx) => {
  const { actor } = await requireAccountingUser();
  const { id } = await params;
  const body = (await request.json()) as Record<string, unknown>;
  const expected = typeof body.expectedUpdatedAt === "string" ? body.expectedUpdatedAt : undefined;
  return noStoreJson(await updateInvoiceDraft(id, cleanInvoiceInput(body), actor, expected));
});

// DELETE /api/accounting/documents/[id] — a draft as is; an ISSUED document
// only with the password again ({ password }) — it takes its sale and
// machines with it.
export const DELETE = withRoute("ลบเอกสารไม่สำเร็จ", async (request: NextRequest, { params }: Ctx) => {
  const { user, actor } = await requireAccountingUser();
  const { id } = await params;
  const impact = await deletionImpact(id);
  if (!impact) return jsonError("ไม่พบเอกสารนี้", 404);
  let passwordChecked = false;
  if (impact.status !== "draft") {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const denied = await requirePassword(user, body?.password);
    if (denied) return denied;
    passwordChecked = true;
  }
  return noStoreJson(await deleteAccDocument(id, actor, { passwordChecked }));
});

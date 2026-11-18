import { NextRequest } from "next/server";
import { withRoute } from "../../../../lib/apiHelpers";
import { noStoreJson, requireAccountingUser } from "../../../../lib/accounting/guard";
import { recentExternalNotes, recordExternalInvoice } from "../../../../lib/accounting/documents";
import { cleanExternalFields, cleanInvoiceInput } from "../../../../lib/accounting/invoiceRules";

// GET /api/accounting/documents/external — where outside papers were kept
// lately (the storage field suggests them).
export const GET = withRoute("โหลดข้อมูลไม่สำเร็จ", async () => {
  await requireAccountingUser();
  return noStoreJson({ notes: await recentExternalNotes() });
});

// POST /api/accounting/documents/external — records an invoice issued
// elsewhere ({ …invoice, docNo, externalNote, vatSatangOverride }): issued at
// once, with its dashboard sale; never one of our numbers.
export const POST = withRoute("บันทึกเอกสารไม่สำเร็จ", async (request: NextRequest) => {
  const { actor } = await requireAccountingUser();
  const body = await request.json();
  return noStoreJson(await recordExternalInvoice(cleanInvoiceInput(body), cleanExternalFields(body), actor), { status: 201 });
});

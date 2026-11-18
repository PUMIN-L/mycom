import { NextRequest } from "next/server";
import { withRoute } from "../../../../../lib/apiHelpers";
import { noStoreJson, requireAccountingUser } from "../../../../../lib/accounting/guard";
import { updateExternalReference } from "../../../../../lib/accounting/documents";

type Ctx = { params: Promise<{ id: string }> };

// PATCH /api/accounting/documents/[id]/external — { docNo, externalNote, reason }:
// fixes a typo in an outside document's number or storage note. The reason
// goes in the audit log.
export const PATCH = withRoute("แก้ไขเอกสารไม่สำเร็จ", async (request: NextRequest, { params }: Ctx) => {
  const { actor } = await requireAccountingUser();
  const { id } = await params;
  const body = (await request.json()) as Record<string, unknown>;
  const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  return noStoreJson(
    await updateExternalReference(id, { docNo: text(body.docNo), externalNote: text(body.externalNote), reason: text(body.reason) }, actor)
  );
});

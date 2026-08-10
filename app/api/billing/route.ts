import { NextRequest, NextResponse } from "next/server";
import { withRoute, requireAuth } from "../../lib/apiHelpers";
import {
  saveBillingDocumentAtomic,
  BillingDocNoConflictError,
  listBillingDocuments,
} from "../../lib/billingStore";
import type { BillingDocType } from "../../lib/billingNumber";

// GET /api/billing (login required) — list saved billing documents.
// Optional ?docType=invoice|billing_note|receipt filter.
export const GET = withRoute("โหลดรายการเอกสารไม่สำเร็จ", async (request: NextRequest) => {
  await requireAuth();
  const url = new URL(request.url);
  const docType = url.searchParams.get("docType") as BillingDocType | null;
  const validTypes: BillingDocType[] = ["invoice", "billing_note", "receipt"];
  const filter = docType && validTypes.includes(docType) ? docType : undefined;
  return NextResponse.json(await listBillingDocuments(filter));
});

// POST /api/billing (login required) — save/upsert a billing document.
export const POST = withRoute(
  "บันทึกเอกสารไม่สำเร็จ",
  async (request: NextRequest) => {
    await requireAuth();
    const body = await request.json();

    const id = String(body?.id ?? "").trim();
    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    if (JSON.stringify(body).length > 200000) {
      return NextResponse.json(
        { error: "ข้อมูลมีขนาดใหญ่เกินไป (สูงสุด 200KB)" },
        { status: 413 }
      );
    }

    const validTypes: BillingDocType[] = ["invoice", "billing_note", "receipt"];
    const docType: BillingDocType = validTypes.includes(body?.docType)
      ? body.docType
      : "invoice";
    const docNo = String(body?.docNo ?? "").slice(0, 255);
    const linkedQuotationId = body?.linkedQuotationId
      ? String(body.linkedQuotationId).slice(0, 36)
      : null;
    const createdAt = new Date().toISOString();

    try {
      await saveBillingDocumentAtomic({
        id,
        docType,
        docNo,
        linkedQuotationId,
        data: body?.data ?? {},
        paymentMethod: body?.paymentMethod ?? null,
        paymentDate: body?.paymentDate ?? null,
        paymentRef: body?.paymentRef ?? null,
        createdAt,
      });
    } catch (err) {
      if (err instanceof BillingDocNoConflictError) {
        return NextResponse.json(
          { error: "เลขที่เอกสารนี้ถูกใช้ไปแล้ว กรุณาเปลี่ยนเลขที่" },
          { status: 409 }
        );
      }
      throw err;
    }

    return NextResponse.json({ id });
  }
);

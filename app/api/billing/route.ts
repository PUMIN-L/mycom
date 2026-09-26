import { NextRequest, NextResponse } from "next/server";
import { withRoute, requireAuth } from "../../lib/apiHelpers";
import {
  saveBillingDocumentAtomic,
  BillingDocNoConflictError,
  listBillingDocuments,
} from "../../lib/billingStore";
import type { BillingDocType } from "../../lib/billingNumber";
import { sanitizePlainText } from "../../lib/sanitizeHtml";
import { computeQuoteTotals, hasNegativeLineItem } from "../../lib/quotationTotals";
import { isValidDateString } from "../../lib/dateFormat";

// Matches the DB columns (paymentMethod VARCHAR(50), paymentDate VARCHAR(20),
// paymentRef VARCHAR(255)) and strips HTML — every other free-text field in
// this codebase is sanitized on write; these three were being stored raw.
//
// ⚠️ THESE THREE COLUMNS ARE DISPLAY DATA, NOT PAYMENT DATA. They are written on
// EVERY save of EVERY document type, not just receipts: the builder's
// emptyState() initialises paymentMethod = "โอนเงิน" and paymentDate = today for
// a brand-new document of ANY type, and handleSave/handleDownload post all three
// unconditionally (only the FORM section that lets the admin edit them is
// receipt-only). So an INVOICE saved today already carries a paymentDate for a
// payment that never happened.
//
// The receivables feature therefore NEVER reads them as evidence of payment.
// `paidAmount` starts at 0 for every existing row and only ever moves through
// `billing_payments`. Backfilling from `paymentDate IS NOT NULL` — the
// obvious-looking migration — would have marked essentially every invoice in the
// database as settled in full on the day this shipped, and the ledger would have
// read ฿0 owed. They also hold no amount at all, only method/date/ref.
//
// They stay exactly as they are: the printed sheet's "การชำระเงิน / Payment"
// block reads them, so touching them changes printed documents.
function cleanOptionalField(value: unknown, maxLen: number): string | null {
  if (value == null) return null;
  const cleaned = sanitizePlainText(String(value)).substring(0, maxLen);
  return cleaned || null;
}

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
      return NextResponse.json({ error: "ต้องระบุ id ของเอกสาร" }, { status: 400 });
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
    const data = body?.data ?? {};

    // ครบกำหนดชำระ. Validated BEFORE it reaches the column: dueDate is a VARCHAR
    // compared and sorted LEXICALLY by every ageing query, so one malformed
    // value would silently break all of them. An absent/blank value stores NULL,
    // and NULL IS NEVER OVERDUE.
    const rawDueDate = String(body?.dueDate ?? "").trim();
    if (rawDueDate && !isValidDateString(rawDueDate)) {
      return NextResponse.json(
        { error: "รูปแบบวันครบกำหนดชำระไม่ถูกต้อง" },
        { status: 400 }
      );
    }
    const dueDate = rawDueDate || null;

    // The invoice an ใบเสร็จรับเงิน settles. The store creates the matching
    // billing_payments row in the same transaction, so issuing a receipt and
    // recording the payment stay ONE action.
    const settlesDocId = body?.settlesDocId
      ? String(body.settlesDocId).slice(0, 36)
      : null;

    // The row this save REPLACES. "แก้ไข (New Ver.)" mints a new uuid and a new
    // docNo and saves a SECOND row; without this stamp the original keeps its
    // debt too and every corrected invoice is billed twice.
    const supersedesId = body?.supersedesId
      ? String(body.supersedesId).slice(0, 36)
      : null;

    // `data` is otherwise opaque client state, but the grand total feeds
    // real business documents — a negative one (from a negative qty/price
    // line item) must never be silently accepted and saved.
    if (hasNegativeLineItem(data) || computeQuoteTotals(data).grandTotal < 0) {
      return NextResponse.json(
        { error: "ยอดรวมสุทธิต้องไม่ติดลบ กรุณาตรวจสอบรายการสินค้า" },
        { status: 400 }
      );
    }

    const createdAt = new Date().toISOString();

    try {
      await saveBillingDocumentAtomic({
        id,
        docType,
        docNo,
        linkedQuotationId,
        data,
        paymentMethod: cleanOptionalField(body?.paymentMethod, 50),
        paymentDate: cleanOptionalField(body?.paymentDate, 20),
        paymentRef: cleanOptionalField(body?.paymentRef, 255),
        createdAt,
        dueDate,
        settlesDocId,
        supersedesId,
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

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { withRoute, requireAuth } from "../../../../lib/apiHelpers";
import {
  addBillingPayment,
  listBillingPayments,
} from "../../../../lib/billingPayments";
import { getBillingDocument } from "../../../../lib/billingStore";
import { sanitizePlainText } from "../../../../lib/sanitizeHtml";
import { isValidDateString } from "../../../../lib/dateFormat";
import { PAYMENT_METHODS } from "../../../../lib/paymentMethods";
import { parsePositiveMoney } from "../../../../lib/moneyAmount";

/** GET /api/billing/[id]/payments — the full history, voided rows included.
 *  The ledger's "ประวัติการรับชำระ" disclosure renders voided rows struck
 *  through, so they must NOT be filtered out here. */
export const GET = withRoute(
  "โหลดประวัติการรับชำระไม่สำเร็จ",
  async (_request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    await requireAuth();
    const { id } = await params;
    return NextResponse.json(await listBillingPayments(id));
  }
);

/**
 * POST /api/billing/[id]/payments — "บันทึกรับชำระ".
 *
 * ONE action for the ordinary case: the modal pre-fills the outstanding
 * balance, today's Bangkok date and "โอนเงิน", and the admin presses ยืนยัน.
 * Typing a smaller amount is the deposit case, and the SAME single button
 * collects the balance later, again pre-filled with what is left. The admin
 * never operates a ledger; the word "งวด" never appears.
 *
 * OVERPAYMENT IS ALLOWED, not blocked — a customer really can transfer too
 * much, and refusing would force the admin to record a false amount. The
 * confirmation happens in the UI (a ConfirmDialog stating the excess); the
 * server's job is to store what actually arrived.
 */
export const POST = withRoute(
  "บันทึกการรับชำระไม่สำเร็จ",
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    await requireAuth();
    const { id } = await params;
    const body = await request.json().catch(() => ({}));

    const doc = await getBillingDocument(id);
    if (!doc) {
      return NextResponse.json({ error: "ไม่พบเอกสาร" }, { status: 404 });
    }
    if (doc.cancelledAt) {
      return NextResponse.json(
        { error: "เอกสารนี้ถูกยกเลิกแล้ว ไม่สามารถบันทึกรับชำระได้" },
        { status: 409 }
      );
    }

    // Zero and negative are refused: a refund is not a payment, and a ฿0 row is
    // noise in a financial history. A correction goes through the void path.
    // Settled to the satang BEFORE that check (parsePositiveMoney), so the
    // amount checked is the amount stored — 0.004 is a ฿0.00 row, not "more
    // than 0" — and "is this document paid?" is always compared in the same
    // decimal space as DECIMAL(12,2).
    const parsed = parsePositiveMoney(body?.amount);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    const amount = parsed.amount;

    const paidDate = String(body?.paidDate ?? "").trim();
    if (!isValidDateString(paidDate)) {
      return NextResponse.json(
        { error: "รูปแบบวันที่ไม่ถูกต้อง (ต้องเป็น YYYY-MM-DD)" },
        { status: 400 }
      );
    }

    const rawMethod = String(body?.method ?? "").trim();
    const method = (PAYMENT_METHODS as readonly string[]).includes(rawMethod)
      ? rawMethod
      : PAYMENT_METHODS[0];

    const { paidAmount } = await addBillingPayment({
      id: randomUUID(),
      billingDocumentId: id,
      amount,
      paidDate,
      method,
      ref: sanitizePlainText(String(body?.ref ?? "")).slice(0, 255),
      note: body?.note ? sanitizePlainText(String(body.note)).slice(0, 1000) : null,
      createdAt: new Date().toISOString(),
    });

    return NextResponse.json({
      success: true,
      paidAmount,
      outstanding: Math.max(0, (doc.totalAmount ?? 0) - paidAmount),
    });
  }
);

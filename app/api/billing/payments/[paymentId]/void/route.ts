import { NextRequest, NextResponse } from "next/server";
import { withRoute, requireAuth } from "../../../../../lib/apiHelpers";
import {
  voidBillingPayment,
  BillingPaymentNotVoidableError,
} from "../../../../../lib/billingPayments";
import { sanitizePlainText } from "../../../../../lib/sanitizeHtml";

/**
 * POST /api/billing/payments/[paymentId]/void — correct a payment.
 *
 * There is deliberately NO DELETE anywhere in this feature. A payment is a
 * financial record: a mistyped deposit is VOIDED (with its reason, visible and
 * struck through in the history) and a corrected one is added alongside it. The
 * cached `paidAmount` is re-summed over the surviving rows in the same
 * transaction, so the balance is right the instant the void lands.
 */
export const POST = withRoute(
  "ยกเลิกรายการรับชำระไม่สำเร็จ",
  async (
    request: NextRequest,
    { params }: { params: Promise<{ paymentId: string }> }
  ) => {
    await requireAuth();
    const { paymentId } = await params;
    const body = await request.json().catch(() => ({}));
    const reason = sanitizePlainText(String(body?.reason ?? "")).slice(0, 255);

    try {
      const result = await voidBillingPayment(
        paymentId,
        reason || "แก้ไขรายการรับชำระ",
        new Date().toISOString()
      );
      return NextResponse.json({ success: true, ...result });
    } catch (error) {
      if (error instanceof BillingPaymentNotVoidableError) {
        return NextResponse.json(
          { error: "ไม่พบรายการรับชำระ หรือรายการนี้ถูกยกเลิกไปแล้ว" },
          { status: 409 }
        );
      }
      throw error;
    }
  }
);

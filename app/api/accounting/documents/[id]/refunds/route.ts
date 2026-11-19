import { NextRequest } from "next/server";
import { withRoute } from "../../../../../lib/apiHelpers";
import { noStoreJson, requireAccountingUser } from "../../../../../lib/accounting/guard";
import { recordRefund } from "../../../../../lib/accounting/creditNotes";
import { PAYMENT_METHODS, type PaymentMethod } from "../../../../../lib/accounting/paymentRules";

type Ctx = { params: Promise<{ id: string }> };

// POST /api/accounting/documents/[id]/refunds — { paidDate, method,
// bankAccountId, amountSatang, note }: money handed back to the customer (a
// credit note took off more than was owed).
export const POST = withRoute("บันทึกคืนเงินไม่สำเร็จ", async (request: NextRequest, { params }: Ctx) => {
  const { actor } = await requireAccountingUser();
  const { id } = await params;
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const method: PaymentMethod = PAYMENT_METHODS.some((m) => m.value === b.method) ? (b.method as PaymentMethod) : "transfer";
  const amount = Number(b.amountSatang);
  await recordRefund(
    id,
    { paidDate: text(b.paidDate, 10), method, bankAccountId: method === "cash" ? "" : text(b.bankAccountId, 36), amountSatang: Number.isFinite(amount) ? Math.round(amount) : -1, note: text(b.note, 501) },
    actor
  );
  return noStoreJson({ ok: true }, { status: 201 });
});

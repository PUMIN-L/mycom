import { NextResponse } from "next/server";
import { withRoute, requireAuth } from "../../../lib/apiHelpers";
import { listOpenInvoices } from "../../../lib/billingStore";

/**
 * GET /api/billing/open-invoices — the invoices that still owe money.
 *
 * Feeds the ใบเสร็จรับเงิน builder's "ชำระให้ใบแจ้งหนี้" dropdown. A receipt
 * DISCHARGES debt; it never creates it, so naming the invoice is what turns
 * issuing a receipt into recording the payment — one action, in one transaction
 * (see syncReceiptPayment). A receipt saved without one settles nothing, and the
 * ledger nudges about it rather than guessing which invoice it belonged to.
 *
 * Reads only denormalised columns — no JSON blob is parsed for this.
 */
export const GET = withRoute("โหลดรายการใบแจ้งหนี้ไม่สำเร็จ", async () => {
  await requireAuth();
  return NextResponse.json(await listOpenInvoices());
});

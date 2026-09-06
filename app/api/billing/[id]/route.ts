import { NextRequest, NextResponse } from "next/server";
import { withRoute, requireAuth } from "../../../lib/apiHelpers";
import {
  getBillingDocument,
  deleteBillingDocument,
  BillingDocumentHasPaymentsError,
} from "../../../lib/billingStore";

// GET /api/billing/[id] (login required) — get a single billing document.
export const GET = withRoute(
  "โหลดเอกสารไม่สำเร็จ",
  async (_request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    await requireAuth();
    const { id } = await params;
    const doc = await getBillingDocument(id);
    if (!doc) {
      return NextResponse.json({ error: "ไม่พบเอกสาร" }, { status: 404 });
    }
    return NextResponse.json(doc);
  }
);

// DELETE /api/billing/[id] (login required) — delete a billing document.
//
// REFUSES once money is attached. `billing_payments` deliberately carries no
// FOREIGN KEY (house rule: this app hard-deletes documents, and an FK would
// either block that or cascade financial records away), so nothing at the
// database level stops this DELETE from orphaning payment rows — this 409 is
// that stop. The admin cancels the document instead, which keeps the payment
// history and the reserved docNo.
export const DELETE = withRoute(
  "ลบเอกสารไม่สำเร็จ",
  async (_request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    await requireAuth();
    const { id } = await params;
    try {
      const deleted = await deleteBillingDocument(id);
      if (!deleted) {
        return NextResponse.json({ error: "ไม่พบเอกสาร" }, { status: 404 });
      }
    } catch (error) {
      if (error instanceof BillingDocumentHasPaymentsError) {
        return NextResponse.json(
          {
            error:
              "เอกสารนี้มีการรับชำระเงินแล้ว ไม่สามารถลบได้ — หากต้องการยกเลิกเอกสารให้กด ยกเลิกเอกสาร",
          },
          { status: 409 }
        );
      }
      throw error;
    }
    return NextResponse.json({ success: true });
  }
);

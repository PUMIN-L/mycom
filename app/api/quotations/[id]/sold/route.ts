import { NextRequest, NextResponse } from "next/server";
import { withRoute, requireAuth } from "../../../../lib/apiHelpers";
import { getSoldQuotationItems } from "../../../../lib/saleLineItemStore";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/quotations/[id]/sold (login required) — which lines of this
// quotation have already been recorded as sold, summed across EVERY sales
// record that references it (a customer who takes the remaining machines a
// month later produces a second sale against the same quotation).
//
// Advisory only (task 5.4 / D12): the sale form uses this for the
// "ขายไปแล้ว X/Y รายการ" banner and to pre-tick just the unsold lines, then
// lets the user confirm past the warning. So it must never be the thing that
// fails a save — a quotation that was never converted (or one already purged,
// since sales keep only a soft link to it) is an empty result, not a 404, and
// `getSoldQuotationItems` swallows lookup failures into an empty list too.
//
// `soldCount` is the X of "X/Y": lines of this quotation with at least one
// recorded sale. Y is the quotation's own line count, which the caller already
// has from `GET /api/quotations/[id]`.
export const GET = withRoute(
  "โหลดรายการที่บันทึกขายแล้วไม่สำเร็จ",
  async (_request: NextRequest, { params }: Ctx) => {
    await requireAuth();
    const { id } = await params;
    const items = await getSoldQuotationItems(id);
    return NextResponse.json({
      quotationId: id,
      soldCount: items.length,
      items,
    });
  }
);

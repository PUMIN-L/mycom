import { NextRequest } from "next/server";
import { withRoute, ApiError } from "../../../../../lib/apiHelpers";
import { noStoreJson, requireAccountingUser } from "../../../../../lib/accounting/guard";
import { COMMISSION_KIND_REQUIRED, commissionKindOf } from "../../../../../lib/accounting/commission";
import { setSalesOrderCommission } from "../../../../../lib/accounting/commissionOwner";
import { notifyCommissionOwnerChanged } from "../../../../../lib/accounting/commissionEmails";

type Ctx = { params: Promise<{ id: string }> };

// PUT /api/accounting/sales-orders/[id]/commission — { commissionOf: "ford" | "tor" }:
// whose commission a customer PO is (ARCHITECTURE.md §8h). A SWITCH from one
// person to the other emails the owner's fixed inbox (the owner, 2026-11-25);
// the first choice does not. The email goes after the change is saved and a
// failed one never undoes it: `emailSent` is true / false, or null when none
// was due.
export const PUT = withRoute("บันทึกค่าคอมของ PO ไม่สำเร็จ", async (request: NextRequest, { params }: Ctx) => {
  const { actor } = await requireAccountingUser();
  const { id } = await params;
  const body = (await request.json()) as Record<string, unknown> | null;
  const kind = commissionKindOf(body?.commissionOf);
  if (!kind) throw new ApiError(400, COMMISSION_KIND_REQUIRED);
  const change = await setSalesOrderCommission(id, kind, actor);
  const emailSent =
    change.from !== null && change.from !== change.to
      ? await notifyCommissionOwnerChanged({
          customerPoNo: change.order.customerPoNo,
          buyerName: change.order.buyerName,
          issueDate: change.order.issueDate,
          from: change.from,
          to: change.to,
          username: actor.username,
          at: new Date().toISOString(),
        })
      : null;
  return noStoreJson({ order: change.order, emailSent });
});

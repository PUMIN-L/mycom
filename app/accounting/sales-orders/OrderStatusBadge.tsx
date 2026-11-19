"use client";

import { ORDER_STATUS_LABELS, ORDER_STATUS_STYLES, type OrderStatus } from "../../lib/accounting/orderRules";

/** A customer PO's state as a pill — red "เกินกำหนดส่ง" while late with something still to deliver. */
export default function OrderStatusBadge({ status, late = false }: { status: OrderStatus; late?: boolean }) {
  return (
    <span className={`inline-block px-3 py-1 rounded-md text-sm font-semibold whitespace-nowrap ${late ? "bg-red-50 text-red-600" : ORDER_STATUS_STYLES[status]}`}>
      {late ? "เกินกำหนดส่ง" : ORDER_STATUS_LABELS[status]}
    </span>
  );
}

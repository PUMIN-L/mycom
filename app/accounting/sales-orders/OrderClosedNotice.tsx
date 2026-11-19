import Link from "next/link";

/** In place of a delivery form: why this PO takes no more deliveries, and the way back to it. */
export default function OrderClosedNotice({ reason, orderId, customerPoNo }: { reason: string; orderId: string; customerPoNo: string }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-8 text-center space-y-3">
      <p className="text-gray-700">{reason}</p>
      <Link href={`/accounting/sales-orders/${encodeURIComponent(orderId)}`} className="font-semibold text-sky-700 hover:text-sky-800">
        กลับไปที่ PO {customerPoNo}
      </Link>
    </div>
  );
}

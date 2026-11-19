"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import AccountingFrame from "../../AccountingFrame";
import InvoiceEditor from "../InvoiceEditor";
import Spinner from "../../../components/Spinner";
import { useAccountingLookups } from "../../useAccountingLookups";
import { useAccountingSettings } from "../../useAccountingSettings";
import OrderClosedNotice from "../../sales-orders/OrderClosedNotice";
import { deliveryOrderOf, orderClosedReason, useOrderDetail } from "../../sales-orders/orderClient";

export default function NewInvoicePage() {
  return (
    <AccountingFrame tab="invoices" title="สร้างใบแจ้งหนี้">
      {/* useSearchParams (?fromOrder=) needs a Suspense boundary. */}
      <Suspense>
        <NewInvoice />
      </Suspense>
    </AccountingFrame>
  );
}

function Loading() {
  return (
    <div className="flex justify-center py-16">
      <Spinner className="h-6 w-6 text-sky-600" />
    </div>
  );
}

function Failed({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="bg-white rounded-2xl border border-red-100 p-6 text-center space-y-3">
      <p className="text-red-700">{message}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="px-5 py-2.5 rounded-xl border border-gray-300 font-semibold hover:bg-gray-50">ลองใหม่</button>
      )}
    </div>
  );
}

/**
 * A new invoice — or, with ?fromOrder=<customer PO>, a DELIVERY: it opens with
 * everything the PO still holds, each line bounded by what is left of it.
 */
function NewInvoice() {
  const router = useRouter();
  const fromOrder = useSearchParams().get("fromOrder");
  const lookups = useAccountingLookups();
  const { state, retry } = useAccountingSettings();
  const order = useOrderDetail(fromOrder);

  if (state.status === "loading" || order.status === "loading") return <Loading />;
  if (state.status === "error") return <Failed message={state.message} onRetry={retry} />;
  if (order.status === "error") return <Failed message={order.message} />;
  const closed = order.status === "ok" ? orderClosedReason(order.detail) : null;
  if (order.status === "ok" && closed) {
    return <OrderClosedNotice reason={closed} orderId={order.detail.order.id} customerPoNo={order.detail.order.customerPoNo} />;
  }
  const { settings } = state;
  return (
    <div className="space-y-4">
      {!settings.sellerVersionId && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          บันทึกเป็นร่างได้ แต่ยังออกเอกสารไม่ได้จนกว่าจะตั้งข้อมูลบริษัท — <Link href="/accounting/settings" className="font-semibold underline">ไปตั้งค่าบัญชี</Link>
        </p>
      )}
      <InvoiceEditor
        key={order.status === "ok" ? order.detail.order.id : "blank"}
        initial={null}
        order={order.status === "ok" ? deliveryOrderOf(order.detail) : null}
        vatRate={settings.vatRate}
        defaultCreditDays={settings.creditDays}
        seller={settings.sellerVersionId ? settings.seller : null}
        lookups={lookups}
        onSaved={(doc) => router.replace(`/accounting/invoices/${doc.id}`)}
        onIssued={(doc) => router.replace(`/accounting/invoices/${doc.id}`)}
      />
    </div>
  );
}

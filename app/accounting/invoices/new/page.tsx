"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import AccountingFrame from "../../AccountingFrame";
import InvoiceEditor from "../InvoiceEditor";
import Spinner from "../../../components/Spinner";
import { useAccountingLookups } from "../../useAccountingLookups";
import { useAccountingSettings } from "../../useAccountingSettings";

export default function NewInvoicePage() {
  return (
    <AccountingFrame tab="invoices" title="สร้างใบแจ้งหนี้">
      <NewInvoice />
    </AccountingFrame>
  );
}

function NewInvoice() {
  const router = useRouter();
  const lookups = useAccountingLookups();
  const { state, retry } = useAccountingSettings();

  if (state.status === "loading") {
    return (
      <div className="flex justify-center py-16">
        <Spinner className="h-6 w-6 text-sky-600" />
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div role="alert" className="bg-white rounded-2xl border border-red-100 p-6 text-center space-y-3">
        <p className="text-red-700">{state.message}</p>
        <button type="button" onClick={retry} className="px-5 py-2.5 rounded-xl border border-gray-300 font-semibold hover:bg-gray-50">ลองใหม่</button>
      </div>
    );
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
        initial={null}
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

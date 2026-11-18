"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import AccountingFrame from "../../AccountingFrame";
import InvoiceEditor from "../InvoiceEditor";
import Spinner from "../../../components/Spinner";
import { useAccountingLookups } from "../../useAccountingLookups";
import { useAccountingSettings } from "../../useAccountingSettings";

/**
 * Recording an invoice issued elsewhere (step 3): the same form as a new
 * invoice, plus the number as printed and where the paper is kept — no file.
 */
export default function RecordExternalInvoicePage() {
  return (
    <AccountingFrame tab="invoices" title="บันทึกเอกสารที่ออกจากที่อื่น">
      <RecordExternal />
    </AccountingFrame>
  );
}

function RecordExternal() {
  const router = useRouter();
  const lookups = useAccountingLookups();
  const { state, retry } = useAccountingSettings();
  const [notes, setNotes] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/accounting/documents/external", { cache: "no-store" });
        const body = res.ok ? await res.json() : { notes: [] };
        if (!cancelled) setNotes(Array.isArray(body?.notes) ? body.notes : []);
      } catch {
        /* suggestions only — the field still takes typing */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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
    <InvoiceEditor
      mode="external"
      noteSuggestions={notes}
      initial={null}
      vatRate={settings.vatRate}
      defaultCreditDays={settings.creditDays}
      seller={settings.sellerVersionId ? settings.seller : null}
      lookups={lookups}
      onSaved={() => {}}
      onIssued={(doc) => router.replace(`/accounting/invoices/${doc.id}`)}
    />
  );
}

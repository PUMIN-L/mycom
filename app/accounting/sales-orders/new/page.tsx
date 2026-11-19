"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import AccountingFrame from "../../AccountingFrame";
import InvoiceEditor from "../../invoices/InvoiceEditor";
import SearchableDropdown from "../../../components/SearchableDropdown";
import Spinner from "../../../components/Spinner";
import { errorMessageOf } from "../../../lib/apiErrorMessage";
import { formatDisplayDate } from "../../../lib/dateFormat";
import { useAccountingLookups } from "../../useAccountingLookups";
import { useAccountingSettings } from "../../useAccountingSettings";
import { orderSeedFromQuotation, type OrderSeed, type QuotationRecordView } from "../quotationSeed";

export default function NewSalesOrderPage() {
  return (
    <AccountingFrame tab="orders" title="รับ PO ลูกค้า">
      <NewSalesOrder />
    </AccountingFrame>
  );
}

interface QuotationSummary {
  id: string;
  docNo: string;
  createdAt: string;
  customer: string;
  total: number;
}

/**
 * A customer PO received — typed in, or opened from the quotation the
 * customer accepted (its lines and customer filled in to check).
 */
function NewSalesOrder() {
  const router = useRouter();
  const lookups = useAccountingLookups();
  const { state, retry } = useAccountingSettings();
  const [quotations, setQuotations] = useState<QuotationSummary[] | null>(null);
  const [picked, setPicked] = useState("");
  const [seed, setSeed] = useState<{ key: string; seed: OrderSeed } | null>(null);
  const [seedError, setSeedError] = useState<string | null>(null);
  const [seeding, setSeeding] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/quotations?limit=200", { cache: "no-store" });
        const rows = res.ok ? await res.json() : [];
        if (!cancelled) setQuotations(Array.isArray(rows) ? rows : []);
      } catch {
        if (!cancelled) setQuotations([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const fillFrom = async (id: string) => {
    setPicked(id);
    setSeedError(null);
    if (!id) {
      setSeed(null);
      return;
    }
    setSeeding(true);
    try {
      const res = await fetch(`/api/quotations/${encodeURIComponent(id)}`, { cache: "no-store" });
      if (!res.ok) {
        setSeedError(await errorMessageOf(res, "โหลดใบเสนอราคาไม่สำเร็จ"));
        return;
      }
      const rec: QuotationRecordView = await res.json();
      setSeed({ key: `${id}-${Date.now()}`, seed: orderSeedFromQuotation(rec, lookups.products, lookups.companies) });
    } catch {
      setSeedError("โหลดใบเสนอราคาไม่สำเร็จ ตรวจสอบการเชื่อมต่อแล้วลองใหม่");
    } finally {
      setSeeding(false);
    }
  };

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
      <section className="bg-white rounded-2xl border border-gray-200 p-5 space-y-2" aria-labelledby="order-from-quotation">
        <h2 id="order-from-quotation" className="text-base font-bold text-gray-900">เติมจากใบเสนอราคา (ไม่บังคับ)</h2>
        <p className="text-sm text-gray-500">เลือกใบเสนอราคาที่ลูกค้าตกลง ระบบเติมลูกค้าและรายการให้ตรวจ — เลือกก่อนกรอก เพราะจะแทนที่สิ่งที่กรอกไว้</p>
        <div className="flex flex-wrap items-center gap-3">
          {/* Waits for the catalog: a line is goods (a machine) only when its product is known. */}
          <fieldset disabled={lookups.status === "loading" || seeding} className="w-full sm:w-[28rem]">
            <SearchableDropdown
              id="order-quotation"
              value={picked}
              onChange={(v) => void fillFrom(v)}
              placeholder={quotations === null || lookups.status === "loading" ? "กำลังโหลดใบเสนอราคา…" : "เลือกใบเสนอราคา"}
              options={[
                { value: "", label: "— ไม่ใช้ใบเสนอราคา —" },
                ...(quotations ?? []).map((q) => ({
                  value: q.id,
                  label: `${q.docNo} · ${q.customer}`,
                  subLabel: `${formatDisplayDate(q.createdAt)} · ${Number(q.total || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })} บาท`,
                })),
              ]}
              buttonClassName="h-[42px] rounded-xl !border-gray-200"
            />
          </fieldset>
          {seeding && <Spinner className="h-5 w-5 text-sky-600" />}
        </div>
        {seedError && <p role="alert" className="text-sm text-red-600">{seedError}</p>}
        {seed && <p className="text-sm text-amber-800">✎ เติมจากใบเสนอราคาแล้ว — ตรวจประเภทสินค้า/บริการ ราคา และเลขที่ PO ของลูกค้าก่อนบันทึก</p>}
      </section>

      <InvoiceEditor
        key={seed?.key ?? "blank"}
        mode="order"
        initial={null}
        seed={seed?.seed ?? null}
        vatRate={settings.vatRate}
        defaultCreditDays={settings.creditDays}
        seller={settings.sellerVersionId ? settings.seller : null}
        lookups={lookups}
        onSaved={(doc) => router.replace(`/accounting/sales-orders/${doc.id}`)}
        onIssued={() => {}}
      />
    </div>
  );
}

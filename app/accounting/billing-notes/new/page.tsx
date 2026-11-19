"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import AccountingFrame from "../../AccountingFrame";
import DatePicker from "../../../components/DatePicker";
import SearchableDropdown from "../../../components/SearchableDropdown";
import Spinner from "../../../components/Spinner";
import { errorMessageOf } from "../../../lib/apiErrorMessage";
import { bangkokDateString, formatDisplayDate, toLocalDateString } from "../../../lib/dateFormat";
import { formatSatang } from "../../../lib/accounting/money";
import { BILLING_LIMITS, billingNoteProblems, firstBillingProblem } from "../../../lib/accounting/billingRules";
import { useAccountingLookups } from "../../useAccountingLookups";

export default function NewBillingNotePage() {
  return (
    <AccountingFrame tab="billing" title="ออกใบวางบิล">
      {/* useSearchParams (?companyId= / ?buyerName=) needs a Suspense boundary. */}
      <Suspense>
        <NewBillingNote />
      </Suspense>
    </AccountingFrame>
  );
}

interface OpenInvoiceView {
  id: string;
  docNo: string | null;
  issueDate: string;
  dueDate: string | null;
  totalSatang: number;
  outstandingSatang: number;
  billedOn: { id: string; docNo: string | null }[];
}

type Load = { status: "idle" } | { status: "loading" } | { status: "error"; message: string } | { status: "ok"; invoices: OpenInvoiceView[] };

const FIELD = "w-full border border-gray-200 rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-sky-500";
const LABEL = "block text-sm font-semibold text-gray-700 mb-1";

/**
 * A billing note for one customer: their invoices still owing (all ticked),
 * the date it is handed over and the date agreed to pay — numbered when made.
 */
function NewBillingNote() {
  const router = useRouter();
  const search = useSearchParams();
  const lookups = useAccountingLookups();
  const [companyId, setCompanyId] = useState(search.get("companyId") ?? "");
  const [buyerName, setBuyerName] = useState(search.get("buyerName") ?? "");
  // The customer the list was loaded for — a name is looked up when asked, not on every key.
  const [customer, setCustomer] = useState<{ companyId: string; buyerName: string }>({ companyId: search.get("companyId") ?? "", buyerName: search.get("buyerName") ?? "" });
  const [load, setLoad] = useState<Load>({ status: "idle" });
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [issueDate, setIssueDate] = useState(bangkokDateString(new Date()));
  const [dueDate, setDueDate] = useState("");
  const [note, setNote] = useState("");
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!customer.companyId && !customer.buyerName.trim()) return;
    let cancelled = false;
    (async () => {
      setLoad({ status: "loading" });
      try {
        const params = new URLSearchParams(customer.companyId ? { companyId: customer.companyId } : { buyerName: customer.buyerName.trim() });
        const res = await fetch(`/api/accounting/billing-notes/open-invoices?${params}`, { cache: "no-store" });
        if (!res.ok) {
          const message = await errorMessageOf(res, "โหลดใบแจ้งหนี้ค้างชำระไม่สำเร็จ");
          if (!cancelled) setLoad({ status: "error", message });
          return;
        }
        const rows: unknown = await res.json();
        if (cancelled) return;
        if (!Array.isArray(rows)) {
          setLoad({ status: "error", message: "โหลดใบแจ้งหนี้ค้างชำระไม่สำเร็จ" });
          return;
        }
        const invoices = rows as OpenInvoiceView[];
        setLoad({ status: "ok", invoices });
        setPicked(new Set(invoices.map((i) => i.id)));
      } catch {
        if (!cancelled) setLoad({ status: "error", message: "โหลดใบแจ้งหนี้ค้างชำระไม่สำเร็จ ตรวจสอบการเชื่อมต่อแล้วลองใหม่" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [customer]);

  const invoices = load.status === "ok" ? load.invoices : [];
  const chosen = invoices.filter((i) => picked.has(i.id));
  const total = chosen.reduce((s, i) => s + i.outstandingSatang, 0);
  const input = { companyId: customer.companyId, buyerName: customer.buyerName.trim(), invoiceIds: chosen.map((i) => i.id), issueDate, dueDate, note: note.trim() };
  const problems = billingNoteProblems(input);
  const shown = attempted ? problems : {};
  const company = lookups.companies.find((c) => c.id === customer.companyId);

  const toggle = (id: string) =>
    setPicked((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const create = async () => {
    if (busy) return;
    setAttempted(true);
    setError(null);
    if (firstBillingProblem(problems)) return;
    setBusy(true);
    try {
      const res = await fetch("/api/accounting/billing-notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        setError(await errorMessageOf(res, "ออกใบวางบิลไม่สำเร็จ"));
        return;
      }
      const doc: { id: string } = await res.json();
      router.replace(`/accounting/billing-notes/${doc.id}`);
    } catch {
      setError("ออกใบวางบิลไม่สำเร็จ ตรวจสอบการเชื่อมต่อแล้วลองใหม่");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4 max-w-4xl">
      <section className="bg-white rounded-2xl border border-gray-200 p-5 space-y-3" aria-labelledby="billing-customer">
        <h2 id="billing-customer" className="text-base font-bold text-gray-900">ลูกค้า</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label htmlFor="billing-company" className={LABEL}>บริษัทลูกค้า</label>
            <SearchableDropdown
              id="billing-company"
              value={companyId}
              onChange={(id) => {
                setCompanyId(id);
                setBuyerName("");
                setCustomer({ companyId: id, buyerName: "" });
              }}
              placeholder={lookups.status === "loading" ? "กำลังโหลดรายชื่อ…" : "เลือกบริษัท"}
              options={[{ value: "", label: "— ลูกค้าที่ไม่ได้อยู่ในรายชื่อ (พิมพ์ชื่อ) —" }, ...lookups.companies.map((c) => ({ value: c.id, label: c.name, subLabel: c.taxId || undefined }))]}
              buttonClassName="h-[42px] rounded-xl !border-gray-200"
            />
          </div>
          {!companyId && (
            <div>
              <label htmlFor="billing-buyerName" className={LABEL}>ชื่อลูกค้าตามใบแจ้งหนี้</label>
              <div className="flex gap-2">
                <input id="billing-buyerName" className={FIELD} value={buyerName} onChange={(e) => setBuyerName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && setCustomer({ companyId: "", buyerName })} />
                <button type="button" onClick={() => setCustomer({ companyId: "", buyerName })}
                  className="px-4 py-2 rounded-xl border border-sky-200 text-sky-700 font-semibold hover:bg-sky-50 whitespace-nowrap">
                  ค้นหา
                </button>
              </div>
            </div>
          )}
        </div>
        {shown.buyerName && <p className="text-sm text-red-600">{shown.buyerName}</p>}
      </section>

      <section className="bg-white rounded-2xl border border-gray-200 p-5 space-y-3" aria-labelledby="billing-invoices">
        <div className="flex items-center justify-between gap-3">
          <h2 id="billing-invoices" className="text-base font-bold text-gray-900">
            ใบแจ้งหนี้ค้างชำระ{company ? ` · ${company.name}` : customer.buyerName ? ` · ${customer.buyerName}` : ""}
          </h2>
          {invoices.length > 1 && (
            <button type="button" onClick={() => setPicked(picked.size === invoices.length ? new Set() : new Set(invoices.map((i) => i.id)))}
              className="text-sm font-semibold text-sky-700 hover:text-sky-800">
              {picked.size === invoices.length ? "ไม่เลือกทั้งหมด" : "เลือกทั้งหมด"}
            </button>
          )}
        </div>
        {load.status === "idle" && <p className="text-sm text-gray-500">เลือกลูกค้าก่อน</p>}
        {load.status === "loading" && <Spinner className="h-5 w-5 text-sky-600" />}
        {load.status === "error" && <p role="alert" className="text-sm text-red-600">{load.message}</p>}
        {load.status === "ok" && invoices.length === 0 && <p className="text-sm text-gray-500">ลูกค้ารายนี้ไม่มีใบแจ้งหนี้ค้างชำระ</p>}
        {invoices.length > 0 && (
          <ul className="divide-y divide-gray-100 text-sm" data-testid="billing-candidates">
            {invoices.map((inv) => (
              <li key={inv.id} className="py-2.5">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input type="checkbox" className="mt-1 h-4 w-4 accent-sky-600" checked={picked.has(inv.id)} onChange={() => toggle(inv.id)} aria-label={`วางบิล ${inv.docNo}`} />
                  <span className="flex-1 min-w-0 tabular-nums">
                    <span className="font-semibold text-gray-900">{inv.docNo}</span>
                    <span className="text-gray-500"> · {formatDisplayDate(inv.issueDate)}{inv.dueDate && ` · ครบ ${formatDisplayDate(inv.dueDate)}`}</span>
                    {inv.billedOn.length > 0 && (
                      <span className="block text-xs text-amber-700">อยู่ในใบวางบิล {inv.billedOn.map((b) => b.docNo).join(", ")} แล้ว — วางบิลซ้ำได้ถ้าใบเดิมหาย</span>
                    )}
                  </span>
                  <span className="font-semibold tabular-nums">{formatSatang(inv.outstandingSatang)}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
        {shown.invoiceIds && <p className="text-sm text-red-600">{shown.invoiceIds}</p>}
        <p className="text-right font-bold tabular-nums" data-testid="billing-total">รวม {chosen.length} ใบ · {formatSatang(total)} บาท</p>
      </section>

      <section className="bg-white rounded-2xl border border-gray-200 p-5 grid grid-cols-1 md:grid-cols-2 gap-4" aria-label="วันที่และหมายเหตุ">
        <div>
          <label htmlFor="billing-issueDate" className={LABEL}>วันที่วางบิล</label>
          <DatePicker id="billing-issueDate" selected={issueDate ? new Date(`${issueDate}T00:00:00`) : null}
            onChange={(d) => setIssueDate(d ? toLocalDateString(d) : "")} className={FIELD} />
          {shown.issueDate && <p className="mt-1 text-sm text-red-600">{shown.issueDate}</p>}
        </div>
        <div>
          <label htmlFor="billing-dueDate" className={LABEL}>นัดชำระ / นัดรับเช็ค (ไม่บังคับ)</label>
          <DatePicker id="billing-dueDate" selected={dueDate ? new Date(`${dueDate}T00:00:00`) : null}
            onChange={(d) => setDueDate(d ? toLocalDateString(d) : "")} className={FIELD} />
          {shown.dueDate && <p className="mt-1 text-sm text-red-600">{shown.dueDate}</p>}
        </div>
        <div className="md:col-span-2">
          <label htmlFor="billing-note" className={LABEL}>หมายเหตุ (พิมพ์ในใบวางบิล)</label>
          <textarea id="billing-note" rows={2} className={`${FIELD} resize-none`} maxLength={BILLING_LIMITS.note} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      </section>

      {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      <div className="flex flex-wrap gap-3 justify-end">
        <Link href="/accounting/billing-notes" className="px-5 py-2.5 rounded-xl border border-gray-300 font-semibold hover:bg-gray-50">ยกเลิก</Link>
        <button type="button" onClick={() => void create()} disabled={busy} className="px-5 py-2.5 rounded-xl bg-green-600 text-white font-semibold hover:bg-green-700 disabled:opacity-60">
          {busy ? "กำลังออก…" : "ออกใบวางบิล"}
        </button>
      </div>
    </div>
  );
}

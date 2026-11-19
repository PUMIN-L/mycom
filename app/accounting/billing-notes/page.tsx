"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import AccountingFrame from "../AccountingFrame";
import SearchBox from "../../components/SearchBox";
import SearchableDropdown from "../../components/SearchableDropdown";
import Spinner from "../../components/Spinner";
import { errorMessageOf } from "../../lib/apiErrorMessage";
import { bangkokDateString, formatDisplayDate } from "../../lib/dateFormat";
import { RANGES, rangeOf, type RangeKey } from "../invoices/listHelpers";
import { formatSatang } from "../../lib/accounting/money";
import { BILLING_STATUS_LABELS, BILLING_STATUS_STYLES, type BillingStatus } from "../../lib/accounting/billingRules";

interface Row {
  id: string;
  docNo: string | null;
  billingStatus: BillingStatus;
  issueDate: string;
  dueDate: string | null;
  buyerName: string;
  totalSatang: number;
  outstandingSatang: number;
  invoiceCount: number;
}

export default function BillingNoteListPage() {
  return (
    <AccountingFrame
      tab="billing"
      title="ใบวางบิล"
      actions={
        <Link href="/accounting/billing-notes/new" className="px-6 py-2.5 rounded-xl bg-green-600 text-white font-semibold hover:bg-green-700 shadow-sm">
          + ออกใบวางบิล
        </Link>
      }
    >
      <BillingNoteList />
    </AccountingFrame>
  );
}

/** Billing notes, newest first — each with what its invoices still owe now. */
function BillingNoteList() {
  const router = useRouter();
  const [range, setRange] = useState<RangeKey>("this-year");
  const [rows, setRows] = useState<Row[]>([]);
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [loadError, setLoadError] = useState("");
  const [reload, setReload] = useState(0);
  const [search, setSearch] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { from, to } = rangeOf(range, bangkokDateString(new Date()));
      const params = new URLSearchParams();
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      try {
        const res = await fetch(`/api/accounting/billing-notes?${params}`, { cache: "no-store" });
        if (!res.ok) {
          const message = await errorMessageOf(res, "โหลดรายการใบวางบิลไม่สำเร็จ");
          if (!cancelled) {
            setLoadError(message);
            setStatus("error");
          }
          return;
        }
        const list: unknown = await res.json();
        if (cancelled) return;
        if (!Array.isArray(list)) {
          setLoadError("โหลดรายการใบวางบิลไม่สำเร็จ");
          setStatus("error");
          return;
        }
        setRows(list as Row[]);
        setStatus("ok");
      } catch {
        if (!cancelled) {
          setLoadError("โหลดรายการใบวางบิลไม่สำเร็จ ตรวจสอบการเชื่อมต่อแล้วลองใหม่");
          setStatus("error");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [range, reload]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? rows.filter((r) => [r.docNo, r.buyerName].some((v) => String(v ?? "").toLowerCase().includes(q))) : rows;
  }, [rows, search]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2 justify-end">
        <div className="w-40">
          <SearchableDropdown
            id="billing-range"
            value={range}
            onChange={(v) => {
              setStatus("loading");
              setRange(v as RangeKey);
            }}
            options={RANGES}
            searchable={false}
            buttonClassName="h-[42px] rounded-xl !border-gray-200"
          />
        </div>
        <SearchBox value={search} onChange={setSearch} label="ค้นหาใบวางบิล" placeholder="ค้นหา เลขที่ ลูกค้า" className="w-full sm:w-72" />
      </div>

      {status === "loading" && (
        <div className="flex justify-center py-16">
          <Spinner className="h-6 w-6 text-sky-600" />
        </div>
      )}
      {status === "error" && (
        <div role="alert" className="bg-white rounded-2xl border border-red-100 p-6 text-center space-y-3">
          <p className="text-red-700">{loadError}</p>
          <button type="button" onClick={() => { setStatus("loading"); setReload((n) => n + 1); }} className="px-5 py-2.5 rounded-xl border border-gray-300 font-semibold hover:bg-gray-50">
            ลองใหม่
          </button>
        </div>
      )}
      {status === "ok" && visible.length === 0 && (
        <div className="bg-white rounded-2xl border border-gray-200 p-10 text-center text-gray-500">
          {rows.length === 0 ? "ยังไม่มีใบวางบิลในช่วงนี้ — ออกได้จากหน้าลูกหนี้คงค้าง หรือกด + ออกใบวางบิล" : "ไม่พบใบวางบิลที่ตรงกับคำค้น"}
        </div>
      )}
      {status === "ok" && visible.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm" data-testid="billing-table">
            <thead>
              <tr className="bg-sky-600 text-white text-left">
                <th className="py-3 px-4 font-semibold">วันที่</th>
                <th className="py-3 px-4 font-semibold">เลขที่</th>
                <th className="py-3 px-4 font-semibold">ลูกค้า</th>
                <th className="py-3 px-4 font-semibold">นัดชำระ</th>
                <th className="py-3 px-4 font-semibold text-right">ยอดวางบิล</th>
                <th className="py-3 px-4 font-semibold text-right">ยังค้าง</th>
                <th className="py-3 px-4 font-semibold">สถานะ</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr key={r.id} className="border-t border-gray-100 hover:bg-sky-50/40 cursor-pointer tabular-nums" onClick={() => router.push(`/accounting/billing-notes/${r.id}`)}>
                  <td className="py-3 px-4 whitespace-nowrap">{formatDisplayDate(r.issueDate)}</td>
                  <td className="py-3 px-4">
                    <Link href={`/accounting/billing-notes/${r.id}`} onClick={(e) => e.stopPropagation()} className="font-semibold hover:text-sky-700">{r.docNo}</Link>
                  </td>
                  <td className="py-3 px-4">
                    {r.buyerName}
                    <span className="text-xs text-gray-500"> · {r.invoiceCount} ใบ</span>
                  </td>
                  <td className="py-3 px-4 whitespace-nowrap">{r.dueDate ? formatDisplayDate(r.dueDate) : "—"}</td>
                  <td className="py-3 px-4 text-right">{formatSatang(r.totalSatang)}</td>
                  <td className="py-3 px-4 text-right font-semibold">{r.outstandingSatang > 0 ? formatSatang(r.outstandingSatang) : "—"}</td>
                  <td className="py-3 px-4">
                    <span className={`inline-block px-3 py-1 rounded-md text-sm font-semibold whitespace-nowrap ${BILLING_STATUS_STYLES[r.billingStatus]}`}>
                      {BILLING_STATUS_LABELS[r.billingStatus]}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

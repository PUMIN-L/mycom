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

interface Row {
  id: string;
  docNo: string | null;
  status: string;
  issueDate: string;
  buyerName: string;
  totalSatang: number;
  invoiceId: string | null;
  invoiceNo: string | null;
  reason: string;
}

export default function CreditNoteListPage() {
  return (
    <AccountingFrame tab="credits" title="ใบลดหนี้">
      <CreditNoteList />
    </AccountingFrame>
  );
}

/** Credit notes, newest first, each with the invoice it was set against. */
function CreditNoteList() {
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
        const res = await fetch(`/api/accounting/credit-notes?${params}`, { cache: "no-store" });
        if (!res.ok) {
          const message = await errorMessageOf(res, "โหลดรายการใบลดหนี้ไม่สำเร็จ");
          if (!cancelled) {
            setLoadError(message);
            setStatus("error");
          }
          return;
        }
        const list: unknown = await res.json();
        if (cancelled) return;
        if (!Array.isArray(list)) {
          setLoadError("โหลดรายการใบลดหนี้ไม่สำเร็จ");
          setStatus("error");
          return;
        }
        setRows(list as Row[]);
        setStatus("ok");
      } catch {
        if (!cancelled) {
          setLoadError("โหลดรายการใบลดหนี้ไม่สำเร็จ ตรวจสอบการเชื่อมต่อแล้วลองใหม่");
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
    return q ? rows.filter((r) => [r.docNo, r.buyerName, r.invoiceNo].some((v) => String(v ?? "").toLowerCase().includes(q))) : rows;
  }, [rows, search]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2 justify-between">
        <p className="text-sm text-gray-500">ออกใบลดหนี้ได้จากหน้าใบแจ้งหนี้ที่ออกแล้ว — ปุ่ม «ออกใบลดหนี้»</p>
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-40">
            <SearchableDropdown
              id="credit-range"
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
          <SearchBox value={search} onChange={setSearch} label="ค้นหาใบลดหนี้" placeholder="ค้นหา เลขที่ ลูกค้า ใบแจ้งหนี้" className="w-full sm:w-72" />
        </div>
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
          {rows.length === 0 ? "ยังไม่มีใบลดหนี้ในช่วงนี้" : "ไม่พบใบลดหนี้ที่ตรงกับคำค้น"}
        </div>
      )}
      {status === "ok" && visible.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-200 overflow-x-auto">
          <table className="w-full text-sm" data-testid="credit-table">
            <thead>
              <tr className="bg-sky-600 text-white text-left">
                <th className="py-3 px-4 font-semibold">วันที่</th>
                <th className="py-3 px-4 font-semibold">เลขที่</th>
                <th className="py-3 px-4 font-semibold">ลูกค้า</th>
                <th className="py-3 px-4 font-semibold">ของใบแจ้งหนี้</th>
                <th className="py-3 px-4 font-semibold">เหตุที่ลดหนี้</th>
                <th className="py-3 px-4 font-semibold text-right">ยอดลดหนี้</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => {
                const voided = r.status === "void";
                return (
                  <tr key={r.id} className={`border-t border-gray-100 hover:bg-sky-50/40 cursor-pointer tabular-nums ${voided ? "text-gray-400" : ""}`} onClick={() => router.push(`/accounting/credit-notes/${r.id}`)}>
                    <td className="py-3 px-4 whitespace-nowrap">{formatDisplayDate(r.issueDate)}</td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      <Link href={`/accounting/credit-notes/${r.id}`} onClick={(e) => e.stopPropagation()} className={`font-semibold hover:text-sky-700 ${voided ? "line-through" : ""}`}>{r.docNo}</Link>
                      {voided && <span className="ml-2 text-xs font-semibold">ยกเลิก</span>}
                    </td>
                    <td className="py-3 px-4">{r.buyerName}</td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      {r.invoiceId ? (
                        <Link href={`/accounting/invoices/${r.invoiceId}`} onClick={(e) => e.stopPropagation()} className="text-sky-700 hover:text-sky-800">{r.invoiceNo}</Link>
                      ) : "—"}
                    </td>
                    <td className="py-3 px-4 max-w-xs truncate" title={r.reason}>{r.reason}</td>
                    <td className={`py-3 px-4 text-right font-semibold ${voided ? "line-through" : ""}`}>{formatSatang(r.totalSatang)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

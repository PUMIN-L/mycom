"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import AccountingFrame from "../AccountingFrame";
import StatusBadge from "../StatusBadge";
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
  isTaxInvoice: boolean;
  issueDate: string;
  buyerName: string;
  projectName: string;
  totalSatang: number;
  relatedDocId: string | null;
  relatedDocNo: string | null;
}

export default function ReceiptListPage() {
  return (
    <AccountingFrame tab="receipts" title="ใบเสร็จรับเงิน">
      <ReceiptList />
    </AccountingFrame>
  );
}

/**
 * Every receipt, newest first — each one comes from รับชำระเงิน on an invoice,
 * so there is no "create" here. A voided one stays listed (its number is used).
 */
function ReceiptList() {
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
      const params = new URLSearchParams({ type: "RE" });
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      try {
        const res = await fetch(`/api/accounting/documents?${params}`, { cache: "no-store" });
        if (!res.ok) {
          const message = await errorMessageOf(res, "โหลดรายการใบเสร็จไม่สำเร็จ");
          if (!cancelled) {
            setLoadError(message);
            setStatus("error");
          }
          return;
        }
        const list: Row[] = await res.json();
        if (cancelled) return;
        setRows(list);
        setStatus("ok");
      } catch {
        if (!cancelled) {
          setLoadError("โหลดรายการใบเสร็จไม่สำเร็จ ตรวจสอบการเชื่อมต่อแล้วลองใหม่");
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
    if (!q) return rows;
    return rows.filter((r) => [r.docNo, r.buyerName, r.projectName, r.relatedDocNo].some((v) => String(v ?? "").toLowerCase().includes(q)));
  }, [rows, search]);
  const liveTotal = useMemo(() => visible.filter((r) => r.status !== "void").reduce((s, r) => s + r.totalSatang, 0), [visible]);

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <p className="text-sm text-gray-600">
          ใบเสร็จออกจากปุ่ม <span className="font-semibold">รับชำระเงิน</span> ในหน้าใบแจ้งหนี้
        </p>
        <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
          <div className="w-40">
            <SearchableDropdown
              id="receipt-range"
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
          <SearchBox value={search} onChange={setSearch} label="ค้นหาใบเสร็จ" placeholder="ค้นหา เลขที่ ลูกค้า ใบแจ้งหนี้" className="w-full sm:w-72" />
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
          <button type="button" onClick={() => { setStatus("loading"); setReload((n) => n + 1); }}
            className="px-5 py-2.5 rounded-xl border border-gray-300 font-semibold hover:bg-gray-50">
            ลองใหม่
          </button>
        </div>
      )}
      {status === "ok" && visible.length === 0 && (
        <div className="bg-white rounded-2xl border border-gray-200 p-10 text-center text-gray-500">
          {rows.length === 0 ? "ยังไม่มีใบเสร็จในช่วงนี้" : "ไม่พบใบเสร็จที่ตรงกับคำค้น"}
        </div>
      )}
      {status === "ok" && visible.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          <table className="w-full hidden md:table" data-testid="receipt-table">
            <thead>
              <tr className="bg-sky-600 text-white text-left text-sm">
                <th className="py-3 px-4 font-semibold">วันที่</th>
                <th className="py-3 px-4 font-semibold">เลขที่</th>
                <th className="py-3 px-4 font-semibold">ลูกค้า</th>
                <th className="py-3 px-4 font-semibold">อ้างอิงใบแจ้งหนี้</th>
                <th className="py-3 px-4 font-semibold text-right">ยอดรับ</th>
                <th className="py-3 px-4 font-semibold">สถานะ</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr key={r.id} className="border-t border-gray-100 hover:bg-sky-50/40 cursor-pointer" onClick={() => router.push(`/accounting/receipts/${r.id}`)}>
                  <td className="py-3 px-4 tabular-nums whitespace-nowrap">{formatDisplayDate(r.issueDate)}</td>
                  <td className="py-3 px-4">
                    <Link href={`/accounting/receipts/${r.id}`} onClick={(e) => e.stopPropagation()} className="font-semibold tabular-nums hover:text-sky-700">
                      {r.docNo}
                    </Link>
                    {r.isTaxInvoice && <div className="text-xs text-gray-500">ใบเสร็จ/ใบกำกับภาษี</div>}
                  </td>
                  <td className="py-3 px-4">
                    <div className="text-gray-900">{r.buyerName}</div>
                    {r.projectName && <div className="text-xs text-gray-500">{r.projectName}</div>}
                  </td>
                  <td className="py-3 px-4 tabular-nums">
                    {r.relatedDocId ? (
                      <Link href={`/accounting/invoices/${r.relatedDocId}`} onClick={(e) => e.stopPropagation()} className="text-sky-700 hover:text-sky-800">
                        {r.relatedDocNo ?? "—"}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className={`py-3 px-4 text-right tabular-nums font-semibold ${r.status === "void" ? "line-through text-gray-400" : ""}`}>{formatSatang(r.totalSatang)}</td>
                  <td className="py-3 px-4"><StatusBadge status={r.status === "void" ? "void" : "paid"} /></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-gray-200 bg-gray-50 text-sm">
                <td colSpan={4} className="py-3 px-4 text-gray-600">รวม (ไม่นับที่ยกเลิก)</td>
                <td className="py-3 px-4 text-right tabular-nums font-bold">{formatSatang(liveTotal)}</td>
                <td />
              </tr>
            </tfoot>
          </table>

          <ul className="md:hidden divide-y divide-gray-100">
            {visible.map((r) => (
              <li key={r.id}>
                <Link href={`/accounting/receipts/${r.id}`} className="block p-4 space-y-1">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-semibold tabular-nums">{r.docNo}</span>
                    <StatusBadge status={r.status === "void" ? "void" : "paid"} />
                  </div>
                  <div className="text-gray-900">{r.buyerName}</div>
                  <div className="flex justify-between text-sm text-gray-500 tabular-nums">
                    <span>{formatDisplayDate(r.issueDate)}{r.relatedDocNo && ` · ${r.relatedDocNo}`}</span>
                    <span className={`font-semibold ${r.status === "void" ? "line-through text-gray-400" : "text-gray-900"}`}>{formatSatang(r.totalSatang)}</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

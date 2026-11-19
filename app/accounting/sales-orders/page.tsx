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
import { ORDER_STATUS_LABELS, type OrderStatus } from "../../lib/accounting/orderRules";
import OrderStatusBadge from "./OrderStatusBadge";

interface Row {
  id: string;
  customerPoNo: string;
  issueDate: string;
  expectedDeliveryDate: string | null;
  buyerName: string;
  projectName: string;
  orderStatus: OrderStatus;
  totalSatang: number;
  vatBaseSatang: number;
  backlogSatang: number;
  late: boolean;
}
interface Backlog {
  totals: { backlogSatang: number; count: number; lateSatang: number; lateCount: number };
}

const STATUS_ORDER: OrderStatus[] = ["open", "partial", "complete", "cancelled"];

export default function SalesOrderListPage() {
  return (
    <AccountingFrame
      tab="orders"
      title="PO ลูกค้า"
      actions={
        <Link href="/accounting/sales-orders/new" className="px-6 py-2.5 rounded-xl bg-green-600 text-white font-semibold hover:bg-green-700 shadow-sm">
          + รับ PO ลูกค้า
        </Link>
      }
    >
      <SalesOrderList />
    </AccountingFrame>
  );
}

/**
 * What customers have ordered: a PO stays รอส่งของ / ส่งบางส่วน until its
 * deliveries (invoices) take everything — and none of it is a sale until then.
 */
function SalesOrderList() {
  const router = useRouter();
  const [range, setRange] = useState<RangeKey>("this-year");
  const [rows, setRows] = useState<Row[]>([]);
  const [backlog, setBacklog] = useState<Backlog | null>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [loadError, setLoadError] = useState("");
  const [reload, setReload] = useState(0);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<OrderStatus | "all">("all");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { from, to } = rangeOf(range, bangkokDateString(new Date()));
      const params = new URLSearchParams();
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      try {
        const [listRes, backlogRes] = await Promise.all([
          fetch(`/api/accounting/sales-orders?${params}`, { cache: "no-store" }),
          fetch("/api/accounting/sales-orders/backlog", { cache: "no-store" }),
        ]);
        if (!listRes.ok) {
          const message = await errorMessageOf(listRes, "โหลดรายการ PO ลูกค้าไม่สำเร็จ");
          if (!cancelled) {
            setLoadError(message);
            setStatus("error");
          }
          return;
        }
        const list: unknown = await listRes.json();
        const totals = (backlogRes.ok ? await backlogRes.json().catch(() => null) : null) as Partial<Backlog> | null;
        if (cancelled) return;
        if (!Array.isArray(list)) {
          setLoadError("โหลดรายการ PO ลูกค้าไม่สำเร็จ");
          setStatus("error");
          return;
        }
        setRows(list as Row[]);
        // The cards are extra: without a sound answer they are left out, the list stays.
        setBacklog(totals?.totals && typeof totals.totals.backlogSatang === "number" ? (totals as Backlog) : null);
        setStatus("ok");
      } catch {
        if (!cancelled) {
          setLoadError("โหลดรายการ PO ลูกค้าไม่สำเร็จ ตรวจสอบการเชื่อมต่อแล้วลองใหม่");
          setStatus("error");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [range, reload]);

  const counts = useMemo(() => {
    const c: Partial<Record<OrderStatus, number>> = {};
    for (const r of rows) c[r.orderStatus] = (c[r.orderStatus] ?? 0) + 1;
    return c;
  }, [rows]);
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (tab === "all" || r.orderStatus === tab) &&
        (!q || [r.customerPoNo, r.buyerName, r.projectName].some((v) => String(v ?? "").toLowerCase().includes(q)))
    );
  }, [rows, tab, search]);

  return (
    <div className="space-y-5">
      {backlog && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4" data-testid="order-summary">
          <Card label="รอส่งของทั้งหมด (ก่อน VAT)" value={`฿${formatSatang(backlog.totals.backlogSatang)}`} note={`${backlog.totals.count} PO · ณ วันนี้`} tone="text-orange-600" />
          <Card label="เกินกำหนดส่ง" value={`฿${formatSatang(backlog.totals.lateSatang)}`} note={`${backlog.totals.lateCount} PO`} tone={backlog.totals.lateCount > 0 ? "text-red-600" : "text-gray-900"} />
          <Card label="ยังไม่นับเป็นยอดขาย" value="จนกว่าจะส่งของ" note="ส่งแล้วออกใบแจ้งหนี้ → เป็นยอดขายใน dashboard" tone="text-gray-700 text-lg" />
        </div>
      )}

      <div className="flex flex-col lg:flex-row lg:items-center gap-3">
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="สถานะ PO">
          {(["all", ...STATUS_ORDER] as const)
            .filter((s) => s === "all" || (counts[s] ?? 0) > 0 || s === tab)
            .map((s) => (
              <button
                key={s}
                type="button"
                role="tab"
                aria-selected={tab === s}
                onClick={() => setTab(s)}
                className={`px-3.5 py-1.5 rounded-full text-sm font-semibold border transition-colors ${
                  tab === s ? "bg-sky-600 text-white border-sky-600" : "bg-white text-gray-600 border-gray-200 hover:border-gray-400"
                }`}
              >
                {s === "all" ? "ทั้งหมด" : ORDER_STATUS_LABELS[s]} {s === "all" ? rows.length : counts[s] ?? 0}
              </button>
            ))}
        </div>
        <div className="flex flex-wrap items-center gap-2 lg:ml-auto">
          <div className="w-40">
            <SearchableDropdown
              id="order-range"
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
          <SearchBox value={search} onChange={setSearch} label="ค้นหา PO ลูกค้า" placeholder="ค้นหา เลขที่ PO ลูกค้า โปรเจค" className="w-full sm:w-72" />
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
          {rows.length === 0 ? "ยังไม่มี PO ลูกค้าในช่วงนี้ — กด + รับ PO ลูกค้า เมื่อลูกค้าส่ง PO มา" : "ไม่พบ PO ที่ตรงกับตัวกรอง"}
        </div>
      )}
      {status === "ok" && visible.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          <table className="w-full hidden md:table" data-testid="order-table">
            <thead>
              <tr className="bg-sky-600 text-white text-left text-sm">
                <th className="py-3 px-4 font-semibold">วันที่ PO</th>
                <th className="py-3 px-4 font-semibold">เลขที่ PO ลูกค้า</th>
                <th className="py-3 px-4 font-semibold">ลูกค้า / โปรเจค</th>
                <th className="py-3 px-4 font-semibold">กำหนดส่ง</th>
                <th className="py-3 px-4 font-semibold text-right">ยอด PO (ก่อน VAT)</th>
                <th className="py-3 px-4 font-semibold text-right">รอส่ง</th>
                <th className="py-3 px-4 font-semibold">สถานะ</th>
                <th className="py-3 px-2"><span className="sr-only">ส่งของ</span></th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr key={r.id} className="border-t border-gray-100 hover:bg-sky-50/40 cursor-pointer" onClick={() => router.push(`/accounting/sales-orders/${r.id}`)}>
                  <td className="py-3 px-4 tabular-nums whitespace-nowrap">{formatDisplayDate(r.issueDate)}</td>
                  <td className="py-3 px-4">
                    <Link href={`/accounting/sales-orders/${r.id}`} onClick={(e) => e.stopPropagation()} className="font-semibold tabular-nums hover:text-sky-700">
                      {r.customerPoNo}
                    </Link>
                  </td>
                  <td className="py-3 px-4">
                    <div className="text-gray-900">{r.buyerName}</div>
                    {r.projectName && <div className="text-xs text-gray-500">{r.projectName}</div>}
                  </td>
                  <td className={`py-3 px-4 tabular-nums whitespace-nowrap ${r.late ? "text-red-600 font-semibold" : ""}`}>
                    {r.expectedDeliveryDate ? formatDisplayDate(r.expectedDeliveryDate) : "—"}
                  </td>
                  <td className="py-3 px-4 text-right tabular-nums">{formatSatang(r.vatBaseSatang)}</td>
                  <td className="py-3 px-4 text-right tabular-nums font-semibold">{r.backlogSatang > 0 ? formatSatang(r.backlogSatang) : "—"}</td>
                  <td className="py-3 px-4"><OrderStatusBadge status={r.orderStatus} late={r.late} /></td>
                  <td className="py-3 px-2" onClick={(e) => e.stopPropagation()}>
                    {(r.orderStatus === "open" || r.orderStatus === "partial") && (
                      <Link href={`/accounting/invoices/new?fromOrder=${encodeURIComponent(r.id)}`}
                        className="px-3 py-1.5 rounded-lg bg-green-600 text-white text-sm font-semibold hover:bg-green-700 whitespace-nowrap">
                        ส่งของ ▸
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <ul className="md:hidden divide-y divide-gray-100">
            {visible.map((r) => (
              <li key={r.id}>
                <Link href={`/accounting/sales-orders/${r.id}`} className="block p-4 space-y-1">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-semibold tabular-nums">{r.customerPoNo}</span>
                    <OrderStatusBadge status={r.orderStatus} late={r.late} />
                  </div>
                  <div className="text-gray-900">{r.buyerName}</div>
                  <div className="flex justify-between text-sm text-gray-500 tabular-nums">
                    <span>{r.expectedDeliveryDate ? `ส่ง ${formatDisplayDate(r.expectedDeliveryDate)}` : formatDisplayDate(r.issueDate)}</span>
                    <span className="font-semibold text-gray-900">{r.backlogSatang > 0 ? `รอส่ง ${formatSatang(r.backlogSatang)}` : formatSatang(r.vatBaseSatang)}</span>
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

function Card({ label, value, note, tone }: { label: string; value: string; note: string; tone: string }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-5">
      <p className="text-sm text-gray-500">{label}</p>
      <p className={`text-2xl font-bold tabular-nums ${tone}`}>{value}</p>
      <p className="text-xs text-gray-400">{note}</p>
    </div>
  );
}

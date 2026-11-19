"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import AccountingFrame from "../AccountingFrame";
import StatusBadge, { StatusDot } from "../StatusBadge";
import DocumentDeleteDialog, { type DeletionImpactView } from "../DocumentDeleteDialog";
import SearchBox from "../../components/SearchBox";
import SearchableDropdown from "../../components/SearchableDropdown";
import Spinner from "../../components/Spinner";
import { errorMessageOf } from "../../lib/apiErrorMessage";
import { bangkokDateString, formatDisplayDate } from "../../lib/dateFormat";
import { RANGES, rangeOf, type RangeKey } from "./listHelpers";
import { formatSatang } from "../../lib/accounting/money";
import { STATUS_LABELS, displayStatusOf, type DisplayStatus } from "../../lib/accounting/invoiceRules";

interface Row {
  id: string;
  docNo: string | null;
  status: string;
  source: string;
  isTaxInvoice: boolean;
  issueDate: string;
  dueDate: string | null;
  buyerName: string;
  projectName: string;
  customerPoNo: string;
  totalSatang: number;
  paidSatang: number;
  /** What its credit notes took off it — counts as settled in its status (step 8). */
  creditedSatang?: number;
}
interface Summary {
  outstandingSatang: number;
  outstandingCount: number;
  overdueSatang: number;
  overdueCount: number;
  issuedInMonthSatang: number;
}

const STATUS_ORDER: DisplayStatus[] = ["draft", "awaiting", "overdue", "partial", "paid", "void"];

export default function InvoiceListPage() {
  return (
    <AccountingFrame
      tab="invoices"
      title="ใบส่งสินค้า / ใบแจ้งหนี้ / ใบกำกับภาษี"
      actions={
        <>
          <Link href="/accounting/invoices/record-external" className="px-4 py-2.5 rounded-xl border border-gray-300 bg-white text-gray-700 font-semibold hover:bg-gray-50">
            บันทึกเอกสารจากที่อื่น
          </Link>
          <Link href="/accounting/invoices/new" className="px-6 py-2.5 rounded-xl bg-green-600 text-white font-semibold hover:bg-green-700 shadow-sm">
            + สร้างใหม่
          </Link>
        </>
      }
    >
      <InvoiceList />
    </AccountingFrame>
  );
}

function InvoiceList() {
  const router = useRouter();
  const today = bangkokDateString(new Date());
  const [range, setRange] = useState<RangeKey>("this-year");
  const [rows, setRows] = useState<Row[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [loadError, setLoadError] = useState("");
  const [reload, setReload] = useState(0);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<DisplayStatus | "all">("all");
  const [deleting, setDeleting] = useState<{ id: string; label: string; impact: DeletionImpactView } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { from, to } = rangeOf(range, bangkokDateString(new Date()));
      const params = new URLSearchParams({ type: "INV" });
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      try {
        const [listRes, sumRes] = await Promise.all([
          fetch(`/api/accounting/documents?${params}`, { cache: "no-store" }),
          fetch("/api/accounting/documents/summary", { cache: "no-store" }),
        ]);
        if (!listRes.ok) {
          const message = await errorMessageOf(listRes, "โหลดรายการเอกสารไม่สำเร็จ");
          if (!cancelled) {
            setLoadError(message);
            setStatus("error");
          }
          return;
        }
        const list: Row[] = await listRes.json();
        const sum: Summary | null = sumRes.ok ? await sumRes.json() : null;
        if (cancelled) return;
        setRows(list);
        setSummary(sum);
        setStatus("ok");
      } catch {
        if (!cancelled) {
          setLoadError("โหลดรายการเอกสารไม่สำเร็จ ตรวจสอบการเชื่อมต่อแล้วลองใหม่");
          setStatus("error");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [range, reload]);

  const withStatus = useMemo(() => rows.map((r) => ({ ...r, display: displayStatusOf(r, today) })), [rows, today]);
  const counts = useMemo(() => {
    const c: Partial<Record<DisplayStatus, number>> = {};
    for (const r of withStatus) c[r.display] = (c[r.display] ?? 0) + 1;
    return c;
  }, [withStatus]);
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return withStatus.filter(
      (r) =>
        (tab === "all" || r.display === tab) &&
        (!q || [r.docNo, r.buyerName, r.projectName, r.customerPoNo].some((v) => String(v ?? "").toLowerCase().includes(q)))
    );
  }, [withStatus, tab, search]);

  const askDelete = async (row: Row) => {
    setNotice(null);
    const res = await fetch(`/api/accounting/documents/${encodeURIComponent(row.id)}`, { cache: "no-store" });
    if (!res.ok) {
      setNotice(await errorMessageOf(res, "โหลดเอกสารไม่สำเร็จ"));
      return;
    }
    const body = await res.json();
    setDeleting({ id: row.id, label: row.docNo ?? "ร่างใบแจ้งหนี้", impact: body.impact });
  };

  return (
    <div className="space-y-5">
      {summary && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4" data-testid="invoice-summary">
          <SummaryCard label="รอเก็บเงินทั้งหมด" value={summary.outstandingSatang} note={`${summary.outstandingCount} ใบ`} tone="text-orange-600" />
          <SummaryCard label="เกินกำหนดชำระ" value={summary.overdueSatang} note={`${summary.overdueCount} ใบ`} tone={summary.overdueCount > 0 ? "text-red-600" : "text-gray-900"} />
          <SummaryCard label="ออกเอกสารเดือนนี้" value={summary.issuedInMonthSatang} note="ยอดรวมสุทธิ" tone="text-gray-900" />
        </div>
      )}

      <div className="flex flex-col lg:flex-row lg:items-center gap-3">
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="สถานะเอกสาร">
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
                {s === "all" ? "ทั้งหมด" : STATUS_LABELS[s]} {s === "all" ? withStatus.length : counts[s] ?? 0}
              </button>
            ))}
        </div>
        <div className="flex flex-wrap items-center gap-2 lg:ml-auto">
          <div className="w-40">
            <SearchableDropdown
              id="invoice-range"
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
          <SearchBox value={search} onChange={setSearch} label="ค้นหาเอกสาร" placeholder="ค้นหา เลขที่ ลูกค้า PO โปรเจค" className="w-full sm:w-72" />
        </div>
      </div>

      {notice && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{notice}</p>}

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
          {rows.length === 0 ? "ยังไม่มีเอกสารในช่วงนี้ — กด + สร้างใหม่ เพื่อออกใบแรก" : "ไม่พบเอกสารที่ตรงกับตัวกรอง"}
        </div>
      )}
      {status === "ok" && visible.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          <table className="w-full hidden md:table" data-testid="invoice-table">
            <thead>
              <tr className="bg-sky-600 text-white text-left text-sm">
                <th className="py-3 px-4 font-semibold">วันที่</th>
                <th className="py-3 px-4 font-semibold">เลขที่เอกสาร</th>
                <th className="py-3 px-4 font-semibold">ชื่อลูกค้า / โปรเจค</th>
                <th className="py-3 px-4 font-semibold">วันครบกำหนด</th>
                <th className="py-3 px-4 font-semibold text-right">ยอดรวมสุทธิ</th>
                <th className="py-3 px-4 font-semibold">สถานะ</th>
                <th className="py-3 px-2"><span className="sr-only">ทำรายการ</span></th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr key={r.id} className="border-t border-gray-100 hover:bg-sky-50/40 cursor-pointer" onClick={() => router.push(`/accounting/invoices/${r.id}`)}>
                  <td className="py-3 px-4 tabular-nums whitespace-nowrap">{formatDisplayDate(r.issueDate)}</td>
                  <td className="py-3 px-4">
                    <span className="inline-flex items-center gap-2 font-semibold tabular-nums">
                      <StatusDot status={r.display} />
                      <Link href={`/accounting/invoices/${r.id}`} onClick={(e) => e.stopPropagation()} className="hover:text-sky-700">
                        {r.docNo ?? "ร่าง"}
                      </Link>
                      {r.source === "external" && <ExternalTag />}
                    </span>
                  </td>
                  <td className="py-3 px-4">
                    <div className="text-gray-900">{r.buyerName}</div>
                    {(r.projectName || r.customerPoNo) && (
                      <div className="text-xs text-gray-500">{[r.projectName, r.customerPoNo && `PO ${r.customerPoNo}`].filter(Boolean).join(" · ")}</div>
                    )}
                  </td>
                  <td className={`py-3 px-4 tabular-nums whitespace-nowrap ${r.display === "overdue" ? "text-red-600 font-semibold" : ""}`}>
                    {r.dueDate ? formatDisplayDate(r.dueDate) : "—"}
                  </td>
                  <td className="py-3 px-4 text-right tabular-nums font-semibold">{formatSatang(r.totalSatang)}</td>
                  <td className="py-3 px-4"><StatusBadge status={r.display} /></td>
                  <td className="py-3 px-2" onClick={(e) => e.stopPropagation()}>
                    <RowMenu
                      label={r.docNo ?? "ร่าง"}
                      items={[
                        { label: r.status === "draft" ? "แก้ไข" : "ดู / พิมพ์", onSelect: () => router.push(`/accounting/invoices/${r.id}`) },
                        { label: "ลบ", danger: true, onSelect: () => void askDelete(r) },
                      ]}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <ul className="md:hidden divide-y divide-gray-100">
            {visible.map((r) => (
              <li key={r.id}>
                <Link href={`/accounting/invoices/${r.id}`} className="block p-4 space-y-1">
                  <div className="flex items-center justify-between gap-3">
                    <span className="inline-flex items-center gap-2 font-semibold tabular-nums">
                      <StatusDot status={r.display} />
                      {r.docNo ?? "ร่าง"}
                      {r.source === "external" && <ExternalTag />}
                    </span>
                    <StatusBadge status={r.display} />
                  </div>
                  <div className="text-gray-900">{r.buyerName}</div>
                  <div className="flex justify-between text-sm text-gray-500 tabular-nums">
                    <span>{formatDisplayDate(r.issueDate)}{r.dueDate && ` · ครบ ${formatDisplayDate(r.dueDate)}`}</span>
                    <span className="font-semibold text-gray-900">{formatSatang(r.totalSatang)}</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {deleting && (
        <DocumentDeleteDialog
          documentId={deleting.id}
          label={deleting.label}
          impact={deleting.impact}
          onCancel={() => setDeleting(null)}
          onDeleted={() => {
            setDeleting(null);
            setNotice(null);
            setStatus("loading");
            setReload((n) => n + 1);
          }}
        />
      )}
    </div>
  );
}

/** A document issued elsewhere and only recorded here. */
function ExternalTag() {
  return (
    <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-[11px] font-semibold" title="ออกจากที่อื่น บันทึกไว้ในระบบ">
      ภายนอก
    </span>
  );
}

function SummaryCard({ label, value, note, tone }: { label: string; value: number; note: string; tone: string }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-5">
      <p className="text-sm text-gray-500">{label}</p>
      <p className={`text-2xl font-bold tabular-nums ${tone}`}>฿{formatSatang(value)}</p>
      <p className="text-xs text-gray-400">{note}</p>
    </div>
  );
}

/** The ⋯ button of a row and its short menu. Closes on a choice, a click elsewhere, or Esc. */
function RowMenu({ label, items }: { label: string; items: { label: string; danger?: boolean; onSelect: () => void }[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div className="relative" ref={ref} data-dropdown-panel={open ? "" : undefined}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`ทำรายการกับ ${label}`}
        onClick={() => setOpen((v) => !v)}
        className="w-9 h-9 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 font-bold"
      >
        ⋯
      </button>
      {open && (
        <ul role="menu" className="absolute right-0 top-10 z-20 w-40 bg-white border border-gray-200 rounded-xl shadow-lg py-1">
          {items.map((item) => (
            <li key={item.label} role="none">
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  item.onSelect();
                }}
                className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-50 ${item.danger ? "text-red-600" : "text-gray-800"}`}
              >
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

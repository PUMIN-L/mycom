"use client";

import Link from "next/link";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import SearchableDropdown from "../../components/SearchableDropdown";
import Spinner from "../../components/Spinner";
import { errorMessageOf } from "../../lib/apiErrorMessage";
import { bangkokCurrentMonth, formatDisplayDate } from "../../lib/dateFormat";
import { monthLabel } from "../../lib/accounting/exportRules";
import { formatSatang } from "../../lib/accounting/money";
import { COMMISSION_KIND_LABELS, type CommissionKind } from "../../lib/accounting/commission";
import { effectiveMonthLabel, formatWholeBaht } from "../../lib/accounting/commissionRateChange";

// The commission month (ARCHITECTURE.md §8h): the customer POs of the month (by
// PO date) in the ladder's order — whose, profit, place on the ladder, the
// three shares, where each stands — the month's totals per person, a chooser
// for a PO nobody chose yet, and each PO's costs on a click (loaded once).

type Status = "unassigned" | "not-delivered" | "cost-missing" | "awaiting-payment" | "payable";

interface MonthRow {
  id: string;
  customerPoNo: string;
  buyerName: string;
  issueDate: string;
  kind: CommissionKind | null;
  profitSatang: number | null;
  ladderFromSatang: number | null;
  ladderToSatang: number | null;
  fordSatang: number;
  torSatang: number;
  companySatang: number;
  commissionStatus: Status;
}
interface PersonTotals {
  totalSatang: number;
  payableSatang: number;
  waitingSatang: number;
}
interface MonthAnswer {
  month: string;
  rateSet: { id: string | null; effectiveMonth: string };
  rows: MonthRow[];
  totals: { ford: PersonTotals; tor: PersonTotals; companySatang: number; profitSatang: number; unassigned: number };
  invoicesWithoutPo: number;
}
interface DeliveryCosts {
  saleId: string;
  saleDate: string;
  invoiceRef: string;
  credit: boolean;
  salesSatang: number;
  costMissing: boolean;
  items: { productName: string; qty: number; costSatang: number }[];
  costs: { costType: string; typeLabel: string; label: string; note: string; amountSatang: number; counted: boolean }[];
}
interface CostsAnswer {
  poId: string;
  deliveries: DeliveryCosts[];
  totals: { salesSatang: number; costSatang: number; profitSatang: number; notCountedSatang: number; waitingCostSalesSatang: number };
}

type Load<T> = { status: "loading" } | { status: "error"; message: string } | { status: "ok"; data: T };

const isMonth = (v: unknown): v is MonthAnswer =>
  !!v && typeof v === "object" && Array.isArray((v as MonthAnswer).rows) && !!(v as MonthAnswer).totals && !!(v as MonthAnswer).rateSet;
const isCosts = (v: unknown): v is CostsAnswer => !!v && typeof v === "object" && Array.isArray((v as CostsAnswer).deliveries) && !!(v as CostsAnswer).totals;

const STATUS: Record<Status, { text: string; tone: string }> = {
  payable: { text: "จ่ายได้", tone: "border-green-200 bg-green-50 text-green-800" },
  "awaiting-payment": { text: "รอลูกค้าจ่าย", tone: "border-amber-200 bg-amber-50 text-amber-800" },
  "not-delivered": { text: "ยังส่งของไม่ครบ", tone: "border-gray-200 bg-gray-50 text-gray-700" },
  "cost-missing": { text: "ยังไม่กรอกต้นทุน", tone: "border-amber-200 bg-amber-50 text-amber-800" },
  unassigned: { text: "ยังไม่เลือกค่าคอมของใคร", tone: "border-red-200 bg-red-50 text-red-700" },
};

const KIND_OPTIONS = [
  { value: "ford", label: COMMISSION_KIND_LABELS.ford },
  { value: "tor", label: COMMISSION_KIND_LABELS.tor },
];

/** The 24 months up to this one, newest first. */
function recentMonths(): { value: string; label: string }[] {
  const [y, m] = bangkokCurrentMonth().split("-").map(Number);
  return Array.from({ length: 24 }, (_, i) => {
    const index = y * 12 + (m - 1) - i;
    const month = `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
    return { value: month, label: monthLabel(month) };
  });
}

const TH = "px-3 py-2 text-left text-xs font-semibold text-gray-500 whitespace-nowrap";
const TD = "px-3 py-2 align-top";

export default function MonthView() {
  const months = useMemo(() => recentMonths(), []);
  const [month, setMonth] = useState(months[0].value);
  const [reloadKey, setReloadKey] = useState(0);
  const [state, setState] = useState<{ key: string; load: Load<MonthAnswer> }>({ key: "", load: { status: "loading" } });
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [costs, setCosts] = useState<Record<string, Load<CostsAnswer>>>({});
  const requested = useRef(new Set<string>());
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [assigning, setAssigning] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; warn: boolean } | null>(null);

  const key = `${month}|${reloadKey}`;
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let load: Load<MonthAnswer>;
      try {
        const res = await fetch(`/api/accounting/commission?month=${encodeURIComponent(month)}`, { cache: "no-store" });
        if (!res.ok) load = { status: "error", message: await errorMessageOf(res, "โหลดค่าคอมมิชชั่นไม่สำเร็จ") };
        else {
          const body = await res.json().catch(() => null);
          load = isMonth(body) ? { status: "ok", data: body } : { status: "error", message: "โหลดค่าคอมมิชชั่นไม่สำเร็จ" };
        }
      } catch {
        load = { status: "error", message: "โหลดค่าคอมมิชชั่นไม่สำเร็จ ตรวจสอบการเชื่อมต่อแล้วลองใหม่" };
      }
      if (!cancelled) setState({ key: `${month}|${reloadKey}`, load });
    })();
    return () => {
      cancelled = true;
    };
  }, [month, reloadKey]);
  const load: Load<MonthAnswer> = state.key === key ? state.load : { status: "loading" };

  /** Opens a PO's costs — fetched the first time only (again after a failure). */
  const openCosts = async (id: string) => {
    setOpen((s) => new Set(s).add(id));
    if (requested.current.has(id)) return;
    requested.current.add(id);
    setCosts((c) => ({ ...c, [id]: { status: "loading" } }));
    let next: Load<CostsAnswer>;
    try {
      const res = await fetch(`/api/accounting/commission/orders/${encodeURIComponent(id)}/costs`, { cache: "no-store" });
      if (!res.ok) next = { status: "error", message: await errorMessageOf(res, "โหลดต้นทุนไม่สำเร็จ") };
      else {
        const body = await res.json().catch(() => null);
        next = isCosts(body) ? { status: "ok", data: body } : { status: "error", message: "โหลดต้นทุนไม่สำเร็จ" };
      }
    } catch {
      next = { status: "error", message: "โหลดต้นทุนไม่สำเร็จ ตรวจสอบการเชื่อมต่อแล้วลองใหม่" };
    }
    if (next.status === "error") requested.current.delete(id);
    setCosts((c) => ({ ...c, [id]: next }));
  };
  const closeCosts = (id: string) =>
    setOpen((s) => {
      const n = new Set(s);
      n.delete(id);
      return n;
    });

  const assign = async (id: string) => {
    const choice = choices[id];
    if (!choice || assigning) return;
    setAssigning(id);
    setNotice(null);
    try {
      const res = await fetch(`/api/accounting/sales-orders/${encodeURIComponent(id)}/commission`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commissionOf: choice }),
      });
      if (!res.ok) {
        setNotice({ text: await errorMessageOf(res, "บันทึกค่าคอมของ PO ไม่สำเร็จ"), warn: true });
        return;
      }
      setNotice({ text: "บันทึกค่าคอมของ PO แล้ว", warn: false });
      setReloadKey((n) => n + 1);
    } catch {
      setNotice({ text: "บันทึกค่าคอมของ PO ไม่สำเร็จ ตรวจสอบการเชื่อมต่อแล้วลองใหม่", warn: true });
    } finally {
      setAssigning(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="w-56">
          <label htmlFor="commission-month" className="block text-sm font-semibold text-gray-700 mb-1">เดือนของ PO</label>
          <SearchableDropdown
            id="commission-month"
            value={month}
            onChange={setMonth}
            options={months}
            searchable={false}
            buttonClassName="h-[42px] rounded-xl !border-gray-200"
          />
        </div>
        {load.status === "ok" && load.data.rows.length > 0 && (
          <div className="flex gap-2">
            <button type="button" onClick={() => load.data.rows.forEach((r) => void openCosts(r.id))} className="px-3 py-2 rounded-xl border border-gray-300 text-sm font-semibold hover:bg-gray-50">
              เปิดต้นทุนทั้งหมด
            </button>
            <button type="button" onClick={() => setOpen(new Set())} className="px-3 py-2 rounded-xl border border-gray-300 text-sm font-semibold hover:bg-gray-50">
              ปิดต้นทุนทั้งหมด
            </button>
          </div>
        )}
      </div>

      {notice && (
        <p role="status" className={`rounded-xl border px-4 py-2 text-sm ${notice.warn ? "border-amber-200 bg-amber-50 text-amber-900" : "border-green-200 bg-green-50 text-green-800"}`}>
          {notice.text}
        </p>
      )}

      {load.status === "loading" && (
        <div className="flex justify-center py-16">
          <Spinner className="h-6 w-6 text-sky-600" />
        </div>
      )}
      {load.status === "error" && (
        <div role="alert" className="bg-white rounded-2xl border border-red-100 p-6 text-center space-y-3">
          <p className="text-red-700">{load.message}</p>
          <button type="button" onClick={() => setReloadKey((n) => n + 1)} className="px-5 py-2.5 rounded-xl border border-gray-300 font-semibold hover:bg-gray-50">
            ลองใหม่
          </button>
        </div>
      )}
      {load.status === "ok" && (
        <MonthBody
          data={load.data}
          open={open}
          costs={costs}
          choices={choices}
          assigning={assigning}
          onChoose={(id, v) => setChoices((c) => ({ ...c, [id]: v }))}
          onAssign={(id) => void assign(id)}
          onOpen={(id) => void openCosts(id)}
          onClose={closeCosts}
        />
      )}
    </div>
  );
}

function MonthBody({
  data,
  open,
  costs,
  choices,
  assigning,
  onChoose,
  onAssign,
  onOpen,
  onClose,
}: {
  data: MonthAnswer;
  open: Set<string>;
  costs: Record<string, Load<CostsAnswer>>;
  choices: Record<string, string>;
  assigning: string | null;
  onChoose: (id: string, value: string) => void;
  onAssign: (id: string) => void;
  onOpen: (id: string) => void;
  onClose: (id: string) => void;
}) {
  const { totals } = data;
  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <PersonCard who="ford" name="ฟอร์ด" t={totals.ford} />
        <PersonCard who="tor" name="พี่ต่อ" t={totals.tor} />
        <div className="bg-white rounded-2xl border border-gray-200 p-4">
          <p className="text-sm font-semibold text-gray-500">ส่วนของบริษัท</p>
          <p className="text-2xl font-bold text-gray-900 tabular-nums" data-testid="total-company">{formatSatang(totals.companySatang)}</p>
          <p className="text-xs text-gray-500 tabular-nums">กำไรที่นับในเดือนนี้ {formatSatang(totals.profitSatang)}</p>
        </div>
      </div>

      <p className="text-xs text-gray-500">
        คิดตามตารางอัตรา {effectiveMonthLabel(data.rateSet.effectiveMonth)} · ขั้นบันไดนับกำไรสะสมของเดือนตามวันที่ PO รวม PO ที่ลูกค้ายังไม่จ่าย · จ่ายค่าคอมได้เมื่อส่งของครบ ลูกค้าจ่ายครบ และกรอกต้นทุนแล้ว
      </p>
      {totals.unassigned > 0 && (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          มี PO ที่ยังไม่เลือกค่าคอมของใคร {totals.unassigned} ใบ — เลือกได้ในตารางด้านล่าง ยังไม่นับจนกว่าจะเลือก
        </p>
      )}
      {data.invoicesWithoutPo > 0 && (
        <p className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-2 text-sm text-gray-700">
          ใบแจ้งหนี้ที่ไม่ได้ออกจาก PO ในเดือนนี้ {data.invoicesWithoutPo} ใบ — ไม่นับค่าคอม (ค่าคอมอิงตาม PO)
        </p>
      )}

      {data.rows.length === 0 ? (
        <p className="bg-white rounded-2xl border border-gray-200 p-8 text-center text-gray-500">ไม่มี PO ลูกค้าที่ลงวันที่ในเดือนนี้</p>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-200 overflow-x-auto">
          <table className="w-full text-sm tabular-nums">
            <thead className="bg-gray-50">
              <tr>
                <th className={TH}>วันที่ PO</th>
                <th className={TH}>PO / ลูกค้า</th>
                <th className={TH}>ค่าคอมของ</th>
                <th className={`${TH} text-right`}>กำไร</th>
                <th className={TH}>ช่วงในบันได</th>
                <th className={`${TH} text-right`}>ฟอร์ด</th>
                <th className={`${TH} text-right`}>พี่ต่อ</th>
                <th className={`${TH} text-right`}>บริษัท</th>
                <th className={TH}>สถานะ</th>
                <th className={TH}></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.rows.map((r) => {
                const isOpen = open.has(r.id);
                const status = STATUS[r.commissionStatus] ?? STATUS.unassigned;
                return (
                  <Fragment key={r.id}>
                    <tr data-testid={`po-row-${r.id}`}>
                      <td className={`${TD} whitespace-nowrap`}>{formatDisplayDate(r.issueDate)}</td>
                      <td className={TD}>
                        <Link href={`/accounting/sales-orders/${encodeURIComponent(r.id)}`} className="font-semibold text-sky-700 hover:underline">
                          {r.customerPoNo}
                        </Link>
                        <p className="text-xs text-gray-500">{r.buyerName}</p>
                      </td>
                      <td className={TD}>
                        {r.kind ? (
                          COMMISSION_KIND_LABELS[r.kind]
                        ) : (
                          <div className="flex items-center gap-2 min-w-56">
                            <div className="flex-1">
                              <label htmlFor={`assign-${r.id}`} className="sr-only">ค่าคอมของ {r.customerPoNo}</label>
                              <SearchableDropdown
                                id={`assign-${r.id}`}
                                value={choices[r.id] ?? ""}
                                onChange={(v) => onChoose(r.id, v)}
                                options={KIND_OPTIONS}
                                placeholder="— เลือก —"
                                searchable={false}
                                buttonClassName="h-9 rounded-lg !border-gray-200 text-sm"
                              />
                            </div>
                            <button
                              type="button"
                              onClick={() => onAssign(r.id)}
                              disabled={!choices[r.id] || assigning !== null}
                              className="px-3 py-1.5 rounded-lg bg-sky-600 text-white text-xs font-semibold hover:bg-sky-700 disabled:opacity-50"
                            >
                              บันทึก
                            </button>
                          </div>
                        )}
                      </td>
                      <td className={`${TD} text-right`}>{r.profitSatang === null ? "—" : formatSatang(r.profitSatang)}</td>
                      <td className={`${TD} whitespace-nowrap text-gray-600`}>
                        {r.kind === "ford" && r.ladderFromSatang !== null && r.ladderToSatang !== null && r.ladderToSatang > r.ladderFromSatang
                          ? `${formatWholeBaht(r.ladderFromSatang)} – ${formatWholeBaht(r.ladderToSatang)}`
                          : "—"}
                      </td>
                      <td className={`${TD} text-right`}>{formatSatang(r.fordSatang)}</td>
                      <td className={`${TD} text-right`}>{formatSatang(r.torSatang)}</td>
                      <td className={`${TD} text-right text-gray-500`}>{formatSatang(r.companySatang)}</td>
                      <td className={TD}>
                        <span className={`inline-block whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-semibold ${status.tone}`}>{status.text}</span>
                      </td>
                      <td className={TD}>
                        <button
                          type="button"
                          aria-expanded={isOpen}
                          onClick={() => (isOpen ? onClose(r.id) : onOpen(r.id))}
                          className="whitespace-nowrap text-xs font-semibold text-sky-700 hover:underline"
                        >
                          {isOpen ? "ซ่อนต้นทุน" : "ดูต้นทุน"}
                        </button>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td colSpan={10} className="bg-gray-50/70 px-4 py-3">
                          <CostsPanel id={r.id} load={costs[r.id] ?? { status: "loading" }} onRetry={() => onOpen(r.id)} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function PersonCard({ who, name, t }: { who: "ford" | "tor"; name: string; t: PersonTotals }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-4 space-y-1">
      <p className="text-sm font-semibold text-gray-500">{name} · ทั้งเดือน</p>
      <p className="text-2xl font-bold text-gray-900 tabular-nums" data-testid={`total-${who}`}>{formatSatang(t.totalSatang)}</p>
      <p className="text-sm text-green-800 tabular-nums">
        จ่ายได้ตอนนี้ <span data-testid={`payable-${who}`}>{formatSatang(t.payableSatang)}</span>
      </p>
      <p className="text-sm text-amber-800 tabular-nums">
        รอ <span data-testid={`waiting-${who}`}>{formatSatang(t.waitingSatang)}</span>
      </p>
    </div>
  );
}

/** What a PO's profit is made of — by delivery, the totals the commission counts. */
function CostsPanel({ id, load, onRetry }: { id: string; load: Load<CostsAnswer>; onRetry: () => void }) {
  if (load.status === "loading") return <Spinner className="h-4 w-4 text-sky-600" />;
  if (load.status === "error") {
    return (
      <p role="alert" className="text-sm text-red-700">
        {load.message}{" "}
        <button type="button" onClick={onRetry} className="font-semibold underline">ลองใหม่</button>
      </p>
    );
  }
  const { deliveries, totals } = load.data;
  // Deliveries are numbered; a credit note is not one.
  const titles = deliveries.reduce<string[]>(
    (acc, d) => [...acc, d.credit ? "ใบลดหนี้" : `ส่งของครั้งที่ ${acc.filter((t) => t !== "ใบลดหนี้").length + 1}`],
    []
  );
  return (
    <div data-testid={`costs-${id}`} className="space-y-3 text-sm">
      {deliveries.length === 0 && <p className="text-gray-500">ยังไม่มีการส่งของจาก PO นี้ จึงยังไม่มีต้นทุน</p>}
      {deliveries.map((d, index) => {
        const title = titles[index];
        return (
          <div key={d.saleId} className="space-y-1">
            <p className="font-semibold text-gray-800">
              {title} · {d.invoiceRef || "—"} · {formatDisplayDate(d.saleDate)} · ยอดขาย {formatSatang(d.salesSatang)}{" "}
              <Link href={`/dashboard?edit=${encodeURIComponent(d.saleId)}`} className="ml-1 text-xs font-semibold text-sky-700 hover:underline">
                แก้ต้นทุน
              </Link>
            </p>
            {d.costMissing && (
              <p className="inline-block rounded border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800">ยังไม่กรอกต้นทุน — ครั้งนี้ยังไม่นับ</p>
            )}
            <ul className="pl-4 space-y-0.5 text-gray-700">
              {d.items.map((i, k) => (
                <li key={`i${k}`} className="flex justify-between gap-4 max-w-xl">
                  <span>{`ต้นทุนสินค้า: ${i.productName} × ${i.qty}`}</span>
                  <span>{formatSatang(i.costSatang)}</span>
                </li>
              ))}
              {d.costs.map((c, k) => (
                <li key={`c${k}`} className={`flex justify-between gap-4 max-w-xl ${c.counted ? "" : "text-gray-400"}`}>
                  <span>
                    {`${c.typeLabel}${c.label ? `: ${c.label}` : ""}${c.note ? ` (${c.note})` : ""}`}
                    {!c.counted && " — ไม่นำมาหัก"}
                  </span>
                  <span>{formatSatang(c.amountSatang)}</span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
      {deliveries.length > 0 && (
        <div className="border-t border-gray-200 pt-2 space-y-0.5">
          <p className="font-semibold text-gray-900">{`ยอดขาย ${formatSatang(totals.salesSatang)} − ต้นทุน ${formatSatang(totals.costSatang)} = กำไร ${formatSatang(totals.profitSatang)}`}</p>
          {totals.waitingCostSalesSatang > 0 && (
            <p className="text-xs text-amber-800">ยังไม่นับยอดขาย {formatSatang(totals.waitingCostSalesSatang)} ของครั้งที่ยังไม่กรอกต้นทุน</p>
          )}
          {totals.notCountedSatang > 0 && (
            <p className="text-xs text-gray-500">ค่าคอมมิชชั่นที่ลงไว้เป็นต้นทุน {formatSatang(totals.notCountedSatang)} ไม่นำมาหักจากกำไร</p>
          )}
        </div>
      )}
    </div>
  );
}

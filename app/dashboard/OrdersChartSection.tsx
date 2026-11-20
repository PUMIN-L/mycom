"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { errorMessageOf } from "../lib/apiErrorMessage";
import { formatSatang } from "../lib/accounting/money";
import {
  bucketOrders,
  orderChartGrain,
  orderChartGrains,
  orderChartRange,
  ORDER_CHART_GRAIN_LABEL,
  type OrderChartGrain,
  type OrderDay,
} from "../lib/accounting/orderChart";
import type { PeriodType } from "../lib/dashboardPeriod";

/** Its own colour: not the sales green, the cost amber or the backlog's. */
const PO_BLUE = "#0284c7";
const FAILED = "โหลดยอดตาม PO ลูกค้าไม่สำเร็จ";

/** The answer belongs to the range it was asked for (`for`), so a slower answer
 *  for another range is never shown under this one's heading. */
type State =
  | { status: "loading" }
  | { status: "hidden" }
  | { status: "error"; for: string; message: string }
  | { status: "ok"; for: string; days: OrderDay[] };

const isOrderDay = (value: unknown): value is OrderDay => {
  const day = value as OrderDay | null;
  return !!day && typeof day.date === "string" && typeof day.count === "number" && typeof day.exVatSatang === "number";
};

/** Short baht for the axis: 1.5M, 250K, 900. */
function axisBaht(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toLocaleString("th-TH", { maximumFractionDigits: 1 })}M`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toLocaleString("th-TH", { maximumFractionDigits: 1 })}K`;
  return value.toLocaleString("th-TH");
}

interface ChartRow {
  name: string;
  title: string;
  satang: number;
  baht: number;
  count: number;
}

function OrdersTooltip({ active, payload }: { active?: boolean; payload?: { payload?: ChartRow }[] }) {
  const row = active ? payload?.[0]?.payload : undefined;
  if (!row) return null;
  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-3 shadow-lg text-sm">
      <div className="font-semibold text-gray-900 mb-1">{row.title}</div>
      <div className="font-medium" style={{ color: PO_BLUE }}>
        ฿{formatSatang(row.satang)} · {row.count} PO
      </div>
    </div>
  );
}

/**
 * "ยอดตาม PO ลูกค้า" — the customer POs received in the period the page shows,
 * by their PO date: counted the moment a PO is recorded, not when it is
 * delivered or paid (the owner, 2026-11-20). Open POs only, ex VAT like every
 * sales figure here. Kept apart from the sales chart — sales count when each
 * delivery is invoiced — so a deal is never in one chart twice.
 *
 * Its bars can be divided by week, month, quarter or year — and by day for a
 * month — whichever draws more than one bar for the page's period
 * (`orderChartGrains`); by year it draws the five years up to the period's.
 * A choice the next period cannot use falls back to that period's own way.
 */
export default function OrdersChartSection({
  periodType,
  range,
  label,
}: {
  periodType: PeriodType;
  range: { start: string; end: string };
  label: string;
}) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  /** What the admin picked — null until they pick (the period's own way). */
  const [chosen, setChosen] = useState<OrderChartGrain | null>(null);

  const grains = orderChartGrains(periodType);
  const grain = chosen && grains.includes(chosen) ? chosen : orderChartGrain(periodType);
  const drawn = orderChartRange(range, grain);
  const { start, end } = drawn;
  const key = `${start}|${end}`;

  useEffect(() => {
    let cancelled = false;
    const asked = `${start}|${end}`;
    (async () => {
      try {
        const res = await fetch(`/api/accounting/sales-orders/by-date?from=${encodeURIComponent(start)}&to=${encodeURIComponent(end)}`, {
          cache: "no-store",
        });
        // The module switched off for this deployment: nothing to show.
        if (res.status === 404) {
          if (!cancelled) setState({ status: "hidden" });
          return;
        }
        if (!res.ok) {
          const message = await errorMessageOf(res, FAILED);
          if (!cancelled) setState({ status: "error", for: asked, message });
          return;
        }
        const data = (await res.json()) as { days?: unknown } | null;
        if (cancelled) return;
        // A side section must never take the dashboard down with it.
        if (!data || !Array.isArray(data.days) || !data.days.every(isOrderDay)) {
          setState({ status: "error", for: asked, message: FAILED });
          return;
        }
        setState({ status: "ok", for: asked, days: data.days });
      } catch {
        if (!cancelled) setState({ status: "error", for: asked, message: `${FAILED} ตรวจสอบการเชื่อมต่อแล้วลองใหม่` });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [start, end, attempt]);

  if (state.status === "hidden") return null;
  const current = (state.status === "ok" || state.status === "error") && state.for === key ? state : null;
  const heading = grain === "year" ? `ปี ${Number(start.slice(0, 4)) + 543}–${Number(end.slice(0, 4)) - 1 + 543}` : label;

  return (
    <section className="bg-white rounded-2xl p-6 shadow-sm border border-sky-100 mb-8" aria-labelledby="orders-chart-title" data-testid="orders-chart-section">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 mb-4">
        <div>
          <h2 id="orders-chart-title" className="text-lg font-bold text-gray-800">
            ยอดตาม PO ลูกค้า {heading}
          </h2>
          <p data-testid="orders-chart-note" className="text-sm text-gray-500">
            นับทันทีที่รับ PO ตามวันที่ใน PO — ไม่ต้องรอส่งของหรือรับเงิน · ยอดก่อน VAT · ไม่รวม PO ที่ยกเลิก ·
            แยกจากยอดขาย (ยอดขายนับเมื่อออกใบแจ้งหนี้)
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 sm:justify-end">
          <div role="group" aria-label="แบ่งแท่งกราฟ PO" className="flex flex-wrap items-center bg-gray-100 rounded-lg p-1">
            <span aria-hidden="true" className="px-2 text-xs text-gray-500">
              แบ่งตาม
            </span>
            {grains.map((g) => (
              <button
                key={g}
                type="button"
                aria-pressed={grain === g}
                onClick={() => setChosen(g)}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${grain === g ? "bg-white shadow-sm text-sky-700" : "text-gray-500"}`}
              >
                {ORDER_CHART_GRAIN_LABEL[g]}
              </button>
            ))}
          </div>
          <Link href="/accounting/sales-orders" className="text-sm font-semibold text-sky-700 hover:text-sky-800 whitespace-nowrap">
            ดู PO ทั้งหมด
          </Link>
        </div>
      </div>

      {!current && <div className="h-65 rounded-xl bg-gray-100 animate-pulse" aria-label="กำลังโหลดยอดตาม PO ลูกค้า" />}
      {current?.status === "error" && (
        <div role="alert" className="text-sm space-y-2">
          <p className="text-red-700">{current.message}</p>
          <button
            type="button"
            onClick={() => {
              setState({ status: "loading" });
              setAttempt((n) => n + 1);
            }}
            className="font-semibold text-sky-700 hover:text-sky-800"
          >
            ลองใหม่
          </button>
        </div>
      )}
      {current?.status === "ok" && <OrdersChartBody days={current.days} range={drawn} grain={grain} />}
    </section>
  );
}

function OrdersChartBody({ days, range, grain }: { days: OrderDay[]; range: { start: string; end: string }; grain: OrderChartGrain }) {
  const buckets = bucketOrders(days, range, grain);
  const total = buckets.reduce((sum, b) => ({ count: sum.count + b.count, exVatSatang: sum.exVatSatang + b.exVatSatang }), { count: 0, exVatSatang: 0 });

  if (total.count === 0) {
    return (
      <div className="flex flex-wrap items-center gap-3 text-sm text-gray-500">
        <p>ยังไม่มี PO ลูกค้าในช่วงนี้</p>
        <Link
          href="/accounting/sales-orders/new"
          className="px-4 py-2 rounded-full bg-white border border-sky-300 text-sky-800 text-sm font-semibold hover:bg-sky-50"
        >
          + รับ PO ลูกค้า
        </Link>
      </div>
    );
  }

  const rows: ChartRow[] = buckets.map((b) => ({ name: b.name, title: b.title, satang: b.exVatSatang, baht: b.exVatSatang / 100, count: b.count }));
  return (
    <div className="space-y-3">
      <p data-testid="orders-chart-total" className="text-sm text-gray-600">
        รวม {total.count} PO · <span className="text-xl font-bold tabular-nums text-gray-900">฿{formatSatang(total.exVatSatang)}</span>{" "}
        <span className="text-xs text-gray-500">(ก่อน VAT)</span>
      </p>
      <div className="h-65">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
            <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#6b7280" }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
            <YAxis tickFormatter={axisBaht} tick={{ fontSize: 11, fill: "#6b7280" }} axisLine={false} tickLine={false} />
            <Tooltip content={<OrdersTooltip />} />
            <Bar dataKey="baht" name="ยอดตาม PO" fill={PO_BLUE} radius={[4, 4, 0, 0]} maxBarSize={40} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      {/* The same figures as text — for a screen reader, and for anyone reading the numbers rather than the bars. */}
      <ul className="sr-only" data-testid="orders-chart-values">
        {buckets.map((b) => (
          <li key={b.key}>
            {b.name}: ฿{formatSatang(b.exVatSatang)} ({b.count} PO)
          </li>
        ))}
      </ul>
    </div>
  );
}

"use client";

import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { fmt, fmtDec, stripHtml, type TopItem } from "./types";
import { categorySlices } from "./categorySlices";

/**
 * สัดส่วนตามหมวดหมู่ — a donut with its key underneath.
 *
 * The names and percentages used to sit around the pie as slice labels, in
 * 10px type and the slice's own colour. The card is a third of the row, so a
 * long category name ran past its edge and was cut ("ไม่ระบุหมวด 13.7…").
 * They now live in a list below the chart, in ink colours, where a long name
 * wraps instead of being cut, each with its share and its amount. The donut
 * keeps identity by colour only beside that list, never alone.
 */
export default function CategoryShareChart({ items }: { items: readonly TopItem[] }) {
  // Category names are RICH TEXT (the editor wraps them in <p>…</p>), so every
  // place that prints one — key and tooltip — goes through stripHtml.
  const slices = categorySlices(items).map((slice) => ({ ...slice, name: stripHtml(slice.name) }));

  if (slices.length === 0) {
    return <div className="h-64 flex items-center justify-center text-gray-400 text-sm">ยังไม่มีข้อมูล</div>;
  }

  const total = slices.reduce((sum, slice) => sum + slice.revenue, 0);

  return (
    <div>
      <div className="relative h-52">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            {/* A 2px white edge parts neighbouring slices; no labels on the
                chart itself — the list below carries the names. */}
            <Pie
              data={slices}
              dataKey="revenue"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius="60%"
              outerRadius="95%"
              stroke="#ffffff"
              strokeWidth={2}
              label={false}
              labelLine={false}
            >
              {slices.map((slice) => (
                <Cell key={slice.key} fill={slice.color} />
              ))}
            </Pie>
            {/* Returning [value, name] replaces BOTH halves of the default
                "name : value" row — the name half is where tags used to show. */}
            <Tooltip formatter={((value: number, name: unknown) => ["฿" + fmtDec(value), String(name ?? "")]) as never} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-xs text-gray-500">ยอดรวม</span>
          <span className="text-sm font-bold text-gray-900 tabular-nums">฿{fmt(total)}</span>
        </div>
      </div>

      <ul className="mt-4 space-y-2.5" aria-label="สัดส่วนยอดขายตามหมวดหมู่">
        {slices.map((slice) => (
          <li key={slice.key} className="flex items-start gap-2.5 text-sm">
            <span aria-hidden="true" className="mt-1 h-3 w-3 shrink-0 rounded-sm" style={{ backgroundColor: slice.color }} />
            <span className="min-w-0 flex-1 break-words text-gray-700">{slice.name}</span>
            <span className="shrink-0 text-right tabular-nums leading-tight">
              <span className="block font-semibold text-gray-900">{slice.percentage}%</span>
              <span className="block text-xs text-gray-500">฿{fmt(slice.revenue)}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

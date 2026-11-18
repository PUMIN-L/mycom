import { addMonthsToDateString } from "../../lib/dateFormat";

// The invoice list's date presets. Pure; kept out of page.tsx — a Next.js
// page file may export only the page (and its config).

export type RangeKey = "this-month" | "last-month" | "3-months" | "this-year" | "last-year" | "all";

export const RANGES: { value: RangeKey; label: string }[] = [
  { value: "this-month", label: "เดือนนี้" },
  { value: "last-month", label: "เดือนก่อน" },
  { value: "3-months", label: "3 เดือนล่าสุด" },
  { value: "this-year", label: "ปีนี้" },
  { value: "last-year", label: "ปีก่อน" },
  { value: "all", label: "ทั้งหมด" },
];

/** [from, to) of a preset, as Bangkok calendar days ("all": no bounds). */
export function rangeOf(key: RangeKey, today: string): { from?: string; to?: string } {
  const monthStart = `${today.slice(0, 7)}-01`;
  const yearStart = `${today.slice(0, 4)}-01-01`;
  switch (key) {
    case "this-month":
      return { from: monthStart, to: addMonthsToDateString(monthStart, 1) };
    case "last-month":
      return { from: addMonthsToDateString(monthStart, -1), to: monthStart };
    case "3-months":
      return { from: addMonthsToDateString(monthStart, -2), to: addMonthsToDateString(monthStart, 1) };
    case "this-year":
      return { from: yearStart, to: addMonthsToDateString(yearStart, 12) };
    case "last-year":
      return { from: addMonthsToDateString(yearStart, -12), to: yearStart };
    default:
      return {};
  }
}

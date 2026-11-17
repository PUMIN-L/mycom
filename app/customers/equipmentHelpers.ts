// The อุปกรณ์ที่ขาย tab of /customers: warranty status, its wording, the
// filters and the sort. Pure — EquipmentTab renders it, the tests pin it.
import type { CustomerEquipment } from "../lib/types";
import { displayText } from "../lib/stripHtml";
import { thCompare } from "../lib/thCompare";
import type { SearchableDropdownOption } from "../components/SearchableDropdown";

/**
 * Days until the warranty ends (0 on its last day, negative once past), or
 * null when there is no usable end date. Counted in local calendar days, both
 * ends at midnight. `now` is for the tests.
 */
export function warrantyDaysLeft(endDate: unknown, now: Date = new Date()): number | null {
  if (!endDate || typeof endDate !== "string") return null;
  const parts = endDate.split("T")[0].split("-");
  if (parts.length < 3) return null;
  const [year, month, day] = parts.map(Number);
  const end = new Date(year, month - 1, day).getTime();
  if (isNaN(end)) return null;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const diff = Math.round((end - today) / 86400000);
  return isNaN(diff) ? null : diff;
}

export type WarrantyState = "active" | "expired" | "unknown";

/**
 * Where the machine's warranty stands. Expired: marked so, or its end date
 * has PASSED — the end date itself is the last day it still holds (it used to
 * read "หมดแล้ว" in one column and "Active" in the next on that day).
 * Unknown: no end date, and not marked expired — nothing to claim either way.
 */
export function warrantyState(eq: Pick<CustomerEquipment, "status" | "warrantyEndDate">, now: Date = new Date()): WarrantyState {
  const daysLeft = warrantyDaysLeft(eq.warrantyEndDate, now);
  if (eq.status === "Expired" || (daysLeft !== null && daysLeft < 0)) return "expired";
  return daysLeft === null ? "unknown" : "active";
}

/** The status as shown, and as exported. */
export const WARRANTY_STATE_LABEL: Record<WarrantyState, string> = {
  active: "อยู่ในประกัน",
  expired: "หมดประกัน",
  unknown: "ไม่ระบุวันหมด",
};

/** Under the end date: how long is left, and how loudly to say it. */
export function warrantyLeftText(daysLeft: number | null): { text: string; tone: "expired" | "soon" | "fine" } | null {
  if (daysLeft === null) return null;
  if (daysLeft < 0) return { text: "หมดแล้ว", tone: "expired" };
  if (daysLeft === 0) return { text: "หมดวันนี้", tone: "soon" };
  return { text: `เหลือ ${daysLeft.toLocaleString("th-TH")} วัน`, tone: daysLeft <= 30 ? "soon" : "fine" };
}

/**
 * The warranty filter. Every label says it is the warranty filter, the chosen
 * one included: the closed button sits beside the ownership filter, and a bare
 * "ทั้งหมด (All)" said neither what it filtered nor in which language.
 */
export const WARRANTY_FILTER_OPTIONS: SearchableDropdownOption[] = [
  { value: "all", label: "ประกัน: ทั้งหมด" },
  { value: "expired", label: "ประกัน: หมดแล้ว" },
  { value: "expiring_30", label: "ประกัน: หมดภายใน 30 วัน" },
  { value: "expiring_60", label: "ประกัน: หมดใน 31–60 วัน" },
];

/** Whether a machine passes the warranty filter. */
export function matchesWarrantyFilter(
  eq: Pick<CustomerEquipment, "status" | "warrantyEndDate">,
  filter: string,
  now: Date = new Date()
): boolean {
  if (filter === "all") return true;
  const state = warrantyState(eq, now);
  const daysLeft = warrantyDaysLeft(eq.warrantyEndDate, now);
  if (filter === "expired") return state === "expired";
  if (state !== "active" || daysLeft === null) return false;
  if (filter === "expiring_30") return daysLeft <= 30;
  if (filter === "expiring_60") return daysLeft > 30 && daysLeft <= 60;
  return true;
}

/** The search box: customer, company, product, serial number or quotation. */
export function matchesEquipmentSearch(
  eq: Pick<CustomerEquipment, "customerName" | "companyName" | "productName" | "serialNumber" | "quotationNumber">,
  query: string
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [eq.customerName, eq.companyName, displayText(eq.productName), eq.serialNumber, eq.quotationNumber].some((v) =>
    (v || "").toLowerCase().includes(q)
  );
}

export type EquipmentSortKey = "customer" | "product" | "serial" | "warrantyEnd";
export interface EquipmentSort {
  key: EquipmentSortKey;
  dir: "asc" | "desc";
}

/** `a` against `b`, a blank one last either way (as a spreadsheet sorts). */
function blanksLast(a: string, b: string, sign: 1 | -1): number {
  if (!a !== !b) return a ? -1 : 1;
  return sign * thCompare(a, b);
}

/**
 * The list in the order asked for, or as the API sent it (newest first)
 * without one. By customer: name, then company; by the warranty's end: the
 * date, machines with none last either way.
 */
export function sortEquipments<T extends CustomerEquipment>(list: readonly T[], sort: EquipmentSort | null): T[] {
  if (!sort) return [...list];
  const sign = sort.dir === "asc" ? 1 : -1;
  const keyOf = (eq: T): string => {
    if (sort.key === "customer") return (eq.customerName || "").trim();
    if (sort.key === "product") return displayText(eq.productName).trim();
    if (sort.key === "serial") return (eq.serialNumber || "").trim();
    return (eq.warrantyEndDate || "").slice(0, 10);
  };
  return [...list].sort((a, b) => {
    const primary =
      sort.key === "warrantyEnd"
        ? (() => {
            const x = keyOf(a);
            const y = keyOf(b);
            if (!x !== !y) return x ? -1 : 1;
            return sign * (x < y ? -1 : x > y ? 1 : 0);
          })()
        : blanksLast(keyOf(a), keyOf(b), sign);
    if (primary) return primary;
    return sort.key === "customer" ? blanksLast(a.companyName || "", b.companyName || "", sign) : 0;
  });
}

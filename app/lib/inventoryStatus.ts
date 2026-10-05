// The statuses of the asset register and of stock, and what each one asks
// for. Pure — the store validates with it and the pages render from it, so a
// status is added or relabelled in one place.
//
// `statusParty` / `statusDate` are two shared columns whose meaning depends on
// the status (borrower + return date, repair shop, reserved for, sold to +
// date, disposal date). A status that does not use one leaves it empty: the
// store clears it on every save, so a borrower's name never lingers on an
// item that has come back. The old value stays in the item's timeline.

import type { InventoryKind } from "./types";

export interface StatusField {
  label: string;
  required: boolean;
}

export interface InventoryStatusDef {
  key: string;
  label: string;
  /** Tailwind classes for the status badge. */
  badge: string;
  /** Text detail this status carries in `statusParty`, if any. */
  party?: StatusField;
  /** Date this status carries in `statusDate`, if any. */
  date?: StatusField & {
    /** The date may not be before the purchase date (a sale, a disposal). */
    notBeforePurchase?: boolean;
  };
  /** The piece has left the company: hidden by default, not counted in value. */
  gone?: boolean;
}

const ASSET_STATUSES: readonly InventoryStatusDef[] = [
  { key: "in_use", label: "ใช้งานอยู่", badge: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  { key: "in_storage", label: "เก็บในคลัง", badge: "bg-sky-50 text-sky-700 border-sky-200" },
  {
    key: "repair",
    label: "ส่งซ่อม",
    badge: "bg-amber-50 text-amber-700 border-amber-200",
    party: { label: "ส่งซ่อมที่", required: false },
  },
  {
    key: "loaned",
    label: "ยืมออก",
    badge: "bg-violet-50 text-violet-700 border-violet-200",
    party: { label: "ผู้ยืม", required: true },
    date: { label: "กำหนดคืน", required: false },
  },
  {
    key: "disposed",
    label: "ขาย/จำหน่ายแล้ว",
    badge: "bg-gray-100 text-gray-600 border-gray-200",
    date: { label: "วันที่จำหน่าย", required: true, notBeforePurchase: true },
    gone: true,
  },
  { key: "broken", label: "ชำรุด/ทิ้ง", badge: "bg-red-50 text-red-700 border-red-200", gone: true },
];

const STOCK_STATUSES: readonly InventoryStatusDef[] = [
  { key: "available", label: "พร้อมขาย", badge: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  {
    key: "reserved",
    label: "จองแล้ว",
    badge: "bg-violet-50 text-violet-700 border-violet-200",
    party: { label: "จองให้", required: true },
  },
  {
    key: "repair",
    label: "ส่งซ่อม",
    badge: "bg-amber-50 text-amber-700 border-amber-200",
    party: { label: "ส่งซ่อมที่", required: false },
  },
  {
    key: "sold",
    label: "ขายแล้ว",
    badge: "bg-gray-100 text-gray-600 border-gray-200",
    party: { label: "ขายให้", required: false },
    date: { label: "วันที่ขาย", required: true, notBeforePurchase: true },
    gone: true,
  },
  { key: "returned", label: "คืนผู้ขาย", badge: "bg-gray-100 text-gray-600 border-gray-200", gone: true },
  { key: "broken", label: "ชำรุด", badge: "bg-red-50 text-red-700 border-red-200", gone: true },
];

const STATUSES: Record<InventoryKind, readonly InventoryStatusDef[]> = {
  asset: ASSET_STATUSES,
  stock: STOCK_STATUSES,
};

export function inventoryStatuses(kind: InventoryKind): readonly InventoryStatusDef[] {
  return STATUSES[kind];
}

/** The definition of `status` in `kind`, or undefined when it is not one. */
export function inventoryStatus(kind: InventoryKind, status: string): InventoryStatusDef | undefined {
  return STATUSES[kind].find((s) => s.key === status);
}

/** The status a new piece starts in. */
export function defaultInventoryStatus(kind: InventoryKind): string {
  return kind === "asset" ? "in_use" : "available";
}

/** The label of a status; an unknown key (edited outside the app) as itself. */
export function inventoryStatusLabel(kind: InventoryKind, status: string): string {
  return inventoryStatus(kind, status)?.label ?? status;
}

/** Whether the piece has left the company (sold, disposed, broken, returned). */
export function isGoneStatus(kind: InventoryKind, status: string): boolean {
  return inventoryStatus(kind, status)?.gone === true;
}

/** "ผู้ยืม: สมชาย · กำหนดคืน: 2026-10-20" — the extra fields of a status as
 *  one line, for the timeline and the export. Empty fields are left out. */
export function statusDetailText(
  kind: InventoryKind,
  status: string,
  party: string,
  date: string | null
): string {
  const def = inventoryStatus(kind, status);
  if (!def) return "";
  const parts: string[] = [];
  if (def.party && party) parts.push(`${def.party.label}: ${party}`);
  if (def.date && date) parts.push(`${def.date.label}: ${date}`);
  return parts.join(" · ");
}

// ── Codes ────────────────────────────────────────────────────────────────────

export const INVENTORY_CODE_PREFIX: Record<InventoryKind, string> = {
  asset: "AS",
  stock: "ST",
};

/** "AS-0001": at least four digits, more once the count passes 9999. */
export function formatInventoryCode(kind: InventoryKind, seq: number): string {
  return `${INVENTORY_CODE_PREFIX[kind]}-${String(seq).padStart(4, "0")}`;
}

// ── Pages ────────────────────────────────────────────────────────────────────

/** The base path of each register's pages (/assets, /stock). */
export const INVENTORY_BASE_PATH: Record<InventoryKind, string> = {
  asset: "/assets",
  stock: "/stock",
};

export const INVENTORY_TITLE: Record<InventoryKind, string> = {
  asset: "ทรัพย์สินบริษัท",
  stock: "สต็อกสินค้า",
};

/** What a register calls the price it records. */
export const INVENTORY_PRICE_LABEL: Record<InventoryKind, string> = {
  asset: "ราคาซื้อ",
  stock: "ราคาทุน",
};

/** The largest number of pieces one "add" may create. */
export const MAX_ITEMS_PER_ADD = 100;

/** The largest number of pieces one bulk change may touch. */
export const MAX_ITEMS_PER_BULK = 500;

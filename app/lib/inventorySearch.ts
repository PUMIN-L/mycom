// Search, filters and totals for the /assets and /stock pages. Pure, and run
// in the browser: a register is loaded whole (hundreds to a few thousand
// pieces), so typing filters instantly without asking the server.

import type { InventoryGroup, InventoryItem, InventoryKind } from "./types";
import { inventoryStatusLabel, isGoneStatus } from "./inventoryStatus";

export interface InventoryFilters {
  /** Free text: every word must appear somewhere in the piece or its group. */
  query: string;
  /** Statuses to show; empty means "all that are still here" (see showGone). */
  statuses: string[];
  category: string;
  location: string;
  supplier: string;
  /** Purchase date range, inclusive, YYYY-MM-DD. */
  dateFrom: string;
  dateTo: string;
  /** Also show pieces that have left (sold, disposed, broken, returned). */
  showGone: boolean;
}

export const EMPTY_FILTERS: InventoryFilters = {
  query: "",
  statuses: [],
  category: "",
  location: "",
  supplier: "",
  dateFrom: "",
  dateTo: "",
  showGone: false,
};

/** Whether anything narrows the list (showing gone pieces does not). */
export function isFiltering(f: InventoryFilters): boolean {
  return (
    f.query.trim() !== "" ||
    f.statuses.length > 0 ||
    f.category !== "" ||
    f.location !== "" ||
    f.supplier !== "" ||
    f.dateFrom !== "" ||
    f.dateTo !== ""
  );
}

const fold = (s: string) => s.toLocaleLowerCase("th").normalize("NFC");

/** The words of a search, lower-cased; empty words dropped. */
export function searchWords(query: string): string[] {
  return fold(query).split(/\s+/).filter(Boolean);
}

/** Everything a search may match for one piece. */
function haystack(kind: InventoryKind, item: InventoryItem, group: InventoryGroup | undefined): string {
  return fold(
    [
      group?.name,
      group?.brand,
      group?.model,
      group?.category,
      item.code,
      item.serialNumber,
      item.location,
      item.supplierName,
      item.custodian,
      item.statusParty,
      item.note,
      inventoryStatusLabel(kind, item.status),
    ]
      .filter(Boolean)
      .join("\n")
  );
}

/** Same value for a filter: case and surrounding space do not count, as in
 *  suggestionsFrom, which offers "Ohaus" and "ohaus " as one choice. */
function sameText(a: string, b: string): boolean {
  return fold(a.trim()) === fold(b.trim());
}

/** Does the piece pass every filter except the status ones? */
function passesBase(
  kind: InventoryKind,
  item: InventoryItem,
  group: InventoryGroup | undefined,
  f: InventoryFilters,
  words: string[]
): boolean {
  if (f.category && !sameText(group?.category ?? "", f.category)) return false;
  if (f.location && !sameText(item.location, f.location)) return false;
  if (f.supplier && !sameText(item.supplierName, f.supplier)) return false;
  if (f.dateFrom && item.purchaseDate < f.dateFrom) return false;
  if (f.dateTo && item.purchaseDate > f.dateTo) return false;
  if (words.length > 0) {
    const text = haystack(kind, item, group);
    if (!words.every((w) => text.includes(w))) return false;
  }
  return true;
}

function passesStatus(kind: InventoryKind, item: InventoryItem, f: InventoryFilters): boolean {
  if (f.statuses.length > 0) return f.statuses.includes(item.status);
  return f.showGone || !isGoneStatus(kind, item.status);
}

export interface GroupView {
  group: InventoryGroup;
  /** The group's pieces that pass the filters, oldest code first. */
  items: InventoryItem[];
  /** Of those, how many in each status. */
  counts: Record<string, number>;
  /** Of those, the total price of the ones still here. */
  value: number;
}

export interface InventoryView {
  groups: GroupView[];
  /** Every piece shown, across groups. */
  items: InventoryItem[];
  /** Pieces per status among those passing every filter EXCEPT status — so
   *  a status card shows its real count even while the list shows another. */
  statusCounts: Record<string, number>;
  /** Total price of the shown pieces still here. */
  value: number;
}

export type InventorySort = "name" | "newest" | "value" | "count";

/** The list the page shows for `filters`. A group appears when it has a piece
 *  that passes — or, with nothing narrowing the list, always, so a group
 *  that was just created (or emptied) can still be seen and used. */
export function buildInventoryView(
  kind: InventoryKind,
  groups: InventoryGroup[],
  items: InventoryItem[],
  filters: InventoryFilters,
  sort: InventorySort = "name"
): InventoryView {
  const words = searchWords(filters.query);
  const groupById = new Map(groups.map((g) => [g.id, g]));
  const statusCounts: Record<string, number> = {};
  const byGroup = new Map<string, InventoryItem[]>();
  let value = 0;
  const shown: InventoryItem[] = [];

  for (const item of items) {
    const group = groupById.get(item.groupId);
    if (!passesBase(kind, item, group, filters, words)) continue;
    statusCounts[item.status] = (statusCounts[item.status] ?? 0) + 1;
    if (!passesStatus(kind, item, filters)) continue;
    shown.push(item);
    if (!isGoneStatus(kind, item.status)) value += item.price;
    const list = byGroup.get(item.groupId) ?? [];
    list.push(item);
    byGroup.set(item.groupId, list);
  }

  const filtering = isFiltering(filters);
  const views: GroupView[] = [];
  for (const group of groups) {
    const list = (byGroup.get(group.id) ?? []).sort((a, b) => a.seq - b.seq);
    if (list.length === 0 && filtering) continue;
    const counts: Record<string, number> = {};
    let groupValue = 0;
    for (const it of list) {
      counts[it.status] = (counts[it.status] ?? 0) + 1;
      if (!isGoneStatus(kind, it.status)) groupValue += it.price;
    }
    views.push({ group, items: list, counts, value: roundBaht(groupValue) });
  }

  const latest = (v: GroupView) => v.items.reduce((m, it) => (it.purchaseDate > m ? it.purchaseDate : m), "");
  const byName = (a: GroupView, b: GroupView) => a.group.name.localeCompare(b.group.name, "th");
  views.sort((a, b) => {
    if (sort === "newest") return latest(b).localeCompare(latest(a)) || byName(a, b);
    if (sort === "value") return b.value - a.value || byName(a, b);
    if (sort === "count") return b.items.length - a.items.length || byName(a, b);
    return byName(a, b);
  });

  return { groups: views, items: shown, statusCounts, value: roundBaht(value) };
}

/** Sums of satang-rounded prices drift in floating point (0.1 + 0.2). */
function roundBaht(n: number): number {
  return Math.round(n * 100) / 100;
}

/** The distinct non-empty values, most used first — for "pick what you
 *  typed before" suggestions. Values differing only in case or surrounding
 *  space count as one, shown as first seen. */
export function suggestionsFrom(values: Iterable<string>): string[] {
  const seen = new Map<string, { value: string; count: number; order: number }>();
  let order = 0;
  for (const raw of values) {
    const value = (raw ?? "").trim();
    if (!value) continue;
    const key = fold(value);
    const hit = seen.get(key);
    if (hit) hit.count++;
    else seen.set(key, { value, count: 1, order: order++ });
  }
  return [...seen.values()].sort((a, b) => b.count - a.count || a.order - b.order).map((e) => e.value);
}

/**
 * A filter's choices: "all" first, then the values in use — and the value the
 * filter is set to even when nothing carries it any more (every piece moved
 * out of that place), or the box would read "all" while still filtering.
 */
export function filterChoices(values: Iterable<string>, current: string, allLabel: string): { value: string; label: string }[] {
  const list = suggestionsFrom(values);
  if (current && !list.some((v) => sameText(v, current))) list.unshift(current);
  return [{ value: "", label: allLabel }, ...list.map((v) => ({ value: v, label: v }))];
}

/** Other pieces (of this register) already carrying `serial`, ignoring case
 *  and surrounding space — for the "this serial is already in use" warning. */
export function itemsWithSerial(items: InventoryItem[], serial: string, exceptIds: string[] = []): InventoryItem[] {
  const key = fold(serial.trim());
  if (!key) return [];
  return items.filter((it) => !exceptIds.includes(it.id) && fold(it.serialNumber.trim()) === key);
}

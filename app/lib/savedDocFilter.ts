import { bangkokDateString, isValidDateString } from "./dateFormat";

// Filtering and bulk-selection for the saved-documents list (/billing/saved:
// quotations + invoices + billing notes + receipts in one table). Pure
// functions, no React and no fetch, so the rules a mistaken bulk delete would
// hang on are unit-testable: which rows a date range covers, and exactly what
// "เลือกทั้งหมด" is about to tick.

/** What this module needs of a row; the page's own type carries more. */
export interface SavedDocRow {
  id: string;
  docType: string;
  docNo: string;
  createdAt: string;
  customer: string;
}

export interface SavedDocFilterInput {
  /** A tab value, or "all" / null for every type. */
  docType?: string | null;
  /** Free text over docNo + customer. */
  search?: string | null;
  /** "YYYY-MM-DD", inclusive, Bangkok calendar day. Blank/invalid = no bound. */
  from?: string | null;
  to?: string | null;
}

/**
 * The Bangkok calendar day a document was saved on, or null if `createdAt` is
 * missing or unparseable.
 *
 * Bangkok, NOT UTC and NOT the viewer's clock. `createdAt` is an ISO instant
 * (`new Date().toISOString()`, written on a Vercel box whose clock is UTC), so
 * a document saved at 06:00 on the 27th in the office is stored as
 * `…-26T23:00Z`. Comparing `createdAt.slice(0, 10)` against a date picked in
 * the office would file that document under the 26th and drop it out of a
 * "27th" filter — the day the admin watched it being made. Every other date
 * comparison in this app is a Bangkok day (dateFormat.ts) and so is this one.
 */
export function savedOnBangkokDate(createdAt: string | null | undefined): string | null {
  if (!createdAt) return null;
  const time = new Date(createdAt).getTime();
  if (!Number.isFinite(time)) return null;
  return bangkokDateString(new Date(time));
}

/** A bound is used only when it is a real "YYYY-MM-DD"; anything else is "unset". */
function bound(value: string | null | undefined): string | null {
  return value && isValidDateString(value) ? value : null;
}

/**
 * Is `from` after `to`? Such a range covers nothing, which on screen looks
 * exactly like "there are no documents" — so the page says so instead of
 * showing an empty table (see `hasImpossibleRange` at the call site).
 */
export function isImpossibleRange(from?: string | null, to?: string | null): boolean {
  const start = bound(from);
  const end = bound(to);
  return start !== null && end !== null && start > end;
}

/**
 * Does the document fall inside the range? Both ends are INCLUSIVE, and either
 * may be left off (from alone = "that day onwards", to alone = "up to that
 * day", neither = everything).
 *
 * A row whose date cannot be read is IN when no range is set — it is still a
 * real document and the list is its only door — and OUT as soon as one is,
 * because "delete the documents from this range" must never sweep up a
 * document that could not be shown to be in it.
 */
export function isWithinBangkokDateRange(
  createdAt: string | null | undefined,
  from?: string | null,
  to?: string | null
): boolean {
  const start = bound(from);
  const end = bound(to);
  if (start === null && end === null) return true;
  const day = savedOnBangkokDate(createdAt);
  if (day === null) return false;
  if (start !== null && day < start) return false;
  if (end !== null && day > end) return false;
  return true;
}

/** Tab + search + date range, in that order. Row order is preserved. */
export function filterSavedDocs<T extends SavedDocRow>(
  rows: readonly T[],
  { docType, search, from, to }: SavedDocFilterInput = {}
): T[] {
  const needle = (search ?? "").trim().toLowerCase();
  return rows.filter((row) => {
    if (docType && docType !== "all" && row.docType !== docType) return false;
    if (
      needle &&
      !(row.docNo || "").toLowerCase().includes(needle) &&
      !(row.customer || "").toLowerCase().includes(needle)
    ) {
      return false;
    }
    return isWithinBangkokDateRange(row.createdAt, from, to);
  });
}

/**
 * How many documents one press of ลบที่เลือก may delete. Each one is its own
 * HTTP request, run one at a time (the server refuses some, and a refusal has
 * to be reported per document), so an unbounded "select all" over two years of
 * documents would be hundreds of sequential requests behind a frozen button.
 * Reached by pressing the button again, never by a silent trim.
 */
export const BULK_DELETE_MAX_ITEMS = 100;

export interface SelectAllPlan {
  /** The ids to tick. */
  ids: string[];
  /** How many will be ticked. */
  selectedCount: number;
  /** Rows on screen — the "y" of "x จาก y". */
  scopeCount: number;
  /** Left out by the cap; a fact to announce, not to hide. */
  cappedOut: number;
}

/**
 * What "เลือกทั้งหมด" will do, computed before it does it, so the button can
 * say it out loud. Scope is the rows currently on screen — never the whole
 * list — so a tab or a date range genuinely narrows what a bulk delete can
 * reach.
 */
export function selectAllPlan(
  rows: readonly SavedDocRow[],
  cap: number = BULK_DELETE_MAX_ITEMS
): SelectAllPlan {
  const limit = Math.max(0, Math.floor(cap));
  const ids = rows.slice(0, limit).map((row) => row.id);
  return {
    ids,
    selectedCount: ids.length,
    scopeCount: rows.length,
    cappedOut: Math.max(0, rows.length - ids.length),
  };
}

/**
 * The ticked ids that are still on screen, in the order they appear there.
 *
 * The selection outlives a filter change, so this is what a bulk delete acts
 * on: narrowing the tab or the dates must shrink what the button can delete,
 * or an admin who ticked 40 rows, switched tab and pressed ลบที่เลือก would
 * delete documents that are no longer in front of him.
 */
export function visibleSelection(
  rows: readonly SavedDocRow[],
  selected: ReadonlySet<string>
): SavedDocRow[] {
  return rows.filter((row) => selected.has(row.id));
}

/** `rows` grouped by type and counted, e.g. "ใบเสนอราคา 12 ใบ · ใบเสร็จ 2 ใบ",
 *  so the confirmation names the KINDS of document about to be deleted — the
 *  one line that gives away a bulk delete aimed at the wrong tab. */
export function summariseByDocType(
  rows: readonly SavedDocRow[],
  labelOf: (docType: string) => string
): string {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.docType, (counts.get(row.docType) ?? 0) + 1);
  return [...counts.entries()].map(([type, n]) => `${labelOf(type)} ${n} ใบ`).join(" · ");
}

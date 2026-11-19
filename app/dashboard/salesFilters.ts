import type { SalesRecord } from "../lib/types";
import { displayText } from "../lib/stripHtml";
import { fmtThaiDate } from "./types";

// Which sales /dashboard's table shows — and therefore which it exports. Pure.
//
// The table keeps to the period picked at the top of the page (or to every
// period, when the admin asks for that), so the sales it lists are the ones the
// cards, the charts and the Top 10 lists above it count. A row of a Top 10 list
// narrows it further to that product or company: by the SAME keys the
// dashboard API groups by, so "3 ดีล" on the row is 3 bills in the table.

/** What a click on a Top 10 row — or a leaderboard row — narrows the table to. */
export type SalesFocus =
  | { kind: "product"; id: string; name: string }
  | { kind: "company"; id: string; name: string }
  /** By the sale's salespersonId, as the leaderboard groups — never by a name typed into the search (item 10). */
  | { kind: "salesperson"; id: string; name: string };

/** The id the dashboard API gives a product or a company the sale has none of. */
export const UNSPECIFIED_ID = "unspecified";
/** The name it gives a line item with no product name. */
const UNNAMED_PRODUCT = "ไม่ระบุสินค้า";

export interface DateRange {
  /** First day, "YYYY-MM-DD". */
  start: string;
  /** The day after the last one (exclusive). */
  end: string;
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** The products on a bill: its line items — or, from a list sent without them, the one product the record names. */
function productsOf(r: SalesRecord): { productId: string; productName: string }[] {
  return r.lineItems && r.lineItems.length > 0 ? r.lineItems : [{ productId: r.productId, productName: r.productName }];
}

export function inDateRange(r: SalesRecord, range: DateRange): boolean {
  const day = String(r.saleDate ?? "").slice(0, 10);
  return day >= range.start && day < range.end;
}

/**
 * Whether the bill belongs to the Top 10 row. Products are grouped by
 * (productId, productName) of the LINE ITEM — a bill counts for every product
 * on it, not just the one its own columns name; companies by the sale's
 * companyId. No id at all is `UNSPECIFIED_ID`, as the API sends it.
 */
export function matchesFocus(r: SalesRecord, focus: SalesFocus): boolean {
  if (focus.kind === "company") return (r.companyId || UNSPECIFIED_ID) === focus.id;
  // "ไม่ระบุเซลล์" is the sales with none — not every sale, as the name search made it.
  if (focus.kind === "salesperson") return (r.salespersonId || UNSPECIFIED_ID) === focus.id;
  return productsOf(r).some(
    (line) => (line.productId || UNSPECIFIED_ID) === focus.id && sameName(line.productName || UNNAMED_PRODUCT, focus.name)
  );
}

/**
 * Free-text search: any product on the bill, the customer, company,
 * salesperson, the date (as stored and as shown, in พ.ศ.), and every document
 * number on it — quotation, PO, delivery note, invoice, receipt.
 */
export function matchesSearch(r: SalesRecord, search: string): boolean {
  const q = search.trim().toLowerCase();
  if (!q) return true;
  const haystack = [
    r.productName,
    ...(r.lineItems ?? []).map((line) => line.productName),
    r.customerName,
    r.companyName,
    r.salespersonName,
    r.saleDate,
    fmtThaiDate(r.saleDate),
    r.quotationRef,
    r.poRef,
    r.deliveryRef,
    r.invoiceRef,
    r.receiptRef,
  ]
    .filter(Boolean)
    .map((v) => displayText(String(v)))
    .join(" ")
    .toLowerCase();
  return haystack.includes(q);
}

/** The sales the table shows: in `range` (every period when null), of `focus` (when set), matching `search`. */
export function filterSalesRecords(
  records: readonly SalesRecord[],
  { range, focus, search }: { range: DateRange | null; focus: SalesFocus | null; search: string }
): SalesRecord[] {
  return records.filter(
    (r) => (!range || inDateRange(r, range)) && (!focus || matchesFocus(r, focus)) && matchesSearch(r, search)
  );
}

/** The export's file name: the period's own value ("2026", "2026-Q4", "2026-10"), or "all". */
export function salesExportFileName(periodValue: string | null): string {
  return `sales-report-${periodValue ?? "all"}.xlsx`;
}

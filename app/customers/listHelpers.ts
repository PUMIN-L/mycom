// Searching, sorting and naming for the lists on /customers. Pure — the page
// renders them, the tests pin them.
import type { Customer } from "../lib/types";
import { sortCustomersByNoteActivity, hasCustomerNote, customerNoteActivityAt } from "../lib/customerOrder";

export type SortDir = "asc" | "desc";
export interface SortState<K extends string> {
  key: K;
  dir: SortDir;
}

// One collator, built once: `localeCompare(b, "th", options)` builds a new
// one on EVERY call, and sorting ~6,000 customers is ~80,000 calls.
const TH_COLLATOR = new Intl.Collator("th", { numeric: true, sensitivity: "base" });

/** Thai-aware, case-blind, with numbers compared as numbers ("ร้าน 2" < "ร้าน 10"). */
export function thCompare(a: string, b: string): number {
  return TH_COLLATOR.compare(a || "", b || "");
}

/**
 * `a` against `b` in direction `sign` (1 ascending, -1 descending), with a
 * BLANK value last either way — as a spreadsheet sorts. A customer with no
 * company, or a company with no province, has nothing to be placed by, and
 * a run of them at the top of an A→Z list hid the rows that do.
 */
function compareBlanksLast(a: string | undefined, b: string | undefined, sign: 1 | -1): number {
  const blankA = !(a || "").trim();
  const blankB = !(b || "").trim();
  if (blankA !== blankB) return blankA ? 1 : -1;
  return sign * thCompare(a || "", b || "");
}

const digitsOf = (s: string | null | undefined) => (s || "").replace(/\D/g, "");

/** A query that is a phone number as people type one: digits with spaces,
 *  dashes, dots, brackets or a leading "+". */
const PHONE_LIKE = /^\+?[\d\s().-]+$/;

/**
 * Whether a customer matches the search box: by name, company or email — and
 * by PHONE, comparing digits only, so "081-234 5678" finds 0812345678. The
 * phone is consulted only for a query that IS a number — "ร้าน 2024" is a
 * name, not a phone containing 2024 — and only from three digits, or a "1"
 * would match nearly everyone. "+66 81…" is the same number as "081…".
 */
export function matchesCustomerSearch(
  c: Pick<Customer, "name" | "companyName" | "email" | "phone">,
  query: string
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if ((c.name || "").toLowerCase().includes(q)) return true;
  if ((c.companyName || "").toLowerCase().includes(q)) return true;
  if ((c.email || "").toLowerCase().includes(q)) return true;
  if (!PHONE_LIKE.test(q)) return false;
  let qDigits = digitsOf(q);
  if (q.startsWith("+66")) qDigits = "0" + qDigits.slice(2);
  return qDigits.length >= 3 && digitsOf(c.phone).includes(qDigits);
}

export type CustomerSortKey = "activity" | "name" | "company";
export const DEFAULT_CUSTOMER_SORT: SortState<CustomerSortKey> = { key: "activity", dir: "desc" };

/**
 * The customer list in the order asked for. "activity" is the note order the
 * page has always used (most recently noted first); ascending flips the noted
 * customers but keeps those WITHOUT a note last either way — a row with no
 * date has nothing to sort by. Name and company sort Thai-aware (a customer
 * with no company last), ties keeping the note order.
 */
export function sortCustomers<T extends Customer>(list: readonly T[], sort: SortState<CustomerSortKey>): T[] {
  const byActivity = sortCustomersByNoteActivity([...list]);
  if (sort.key === "activity") {
    if (sort.dir === "desc") return byActivity;
    const noted = byActivity.filter(hasCustomerNote).reverse();
    return [...noted, ...byActivity.filter((c) => !hasCustomerNote(c))];
  }
  const field = sort.key === "name" ? (c: T) => c.name : (c: T) => c.companyName || "";
  const sign = sort.dir === "asc" ? 1 : -1;
  return byActivity.sort((a, b) => compareBlanksLast(field(a), field(b), sign));
}

export interface CompanyLike {
  name: string;
  province?: string;
  district?: string;
}

/** "อำเภอ/เขต, จังหวัด", or "" when neither is known. */
export function companyLocation(c: CompanyLike): string {
  return [c.district, c.province].map((s) => (s || "").trim()).filter(Boolean).join(", ");
}

export function matchesCompanySearch(
  c: CompanyLike,
  { name, province, district }: { name: string; province: string; district: string }
): boolean {
  const has = (value: string | undefined, q: string) => (value || "").toLowerCase().includes(q.trim().toLowerCase());
  return has(c.name, name) && has(c.province, province) && has(c.district, district);
}

export type CompanySortKey = "name" | "location";

/** Sorted as asked, or left in the order given (newest first, from the API).
 *  By location: province, then district within it — blanks last. */
export function sortCompanies<T extends CompanyLike>(list: readonly T[], sort: SortState<CompanySortKey> | null): T[] {
  if (!sort) return [...list];
  const sign = sort.dir === "asc" ? 1 : -1;
  const compare = (a: T, b: T) =>
    sort.key === "name"
      ? compareBlanksLast(a.name, b.name, sign)
      : compareBlanksLast(a.province, b.province, sign) || compareBlanksLast(a.district, b.district, sign);
  return [...list].sort(compare);
}

/** Sorted by name as asked, or left in the order given. */
export function sortByName<T extends { name: string }>(list: readonly T[], sort: SortState<"name"> | null): T[] {
  if (!sort) return [...list];
  const sign = sort.dir === "asc" ? 1 : -1;
  return [...list].sort((a, b) => sign * thCompare(a.name, b.name));
}

/** The next sort after a click on `key`'s header: a new column starts
 *  ascending (dates newest-first), the same column flips. */
export function nextSort<K extends string>(current: SortState<K> | null, key: K, firstDir: SortDir = "asc"): SortState<K> {
  if (current && current.key === key) return { key, dir: current.dir === "asc" ? "desc" : "asc" };
  return { key, dir: firstDir };
}

export type CustomersTab = "customers" | "companies" | "salespeople" | "equipments";

/** The `?tab=` each tab writes, so a refresh opens the same tab. Customers is
 *  the default and writes none; equipment keeps the spelling the dashboard's
 *  link already uses. */
export const TAB_PARAM: Record<CustomersTab, string | null> = {
  customers: null,
  companies: "companies",
  salespeople: "salespeople",
  equipments: "equipment",
};

/** A deep link's one-shot parameters — what to open on arrival. */
const DEEP_LINK_KEYS = ["customerId", "customer", "id", "equipmentId", "edit_eq", "action"];

/**
 * The page's query string with `tab` set for `tab`. A deep link's parameters
 * go: they named what to open on ARRIVAL, and left behind they would reopen a
 * machine or a customer on the next refresh of a different tab. Anything else
 * is kept.
 */
export function searchWithTab(search: string, tab: CustomersTab): string {
  const params = new URLSearchParams(search);
  for (const key of DEEP_LINK_KEYS) params.delete(key);
  const value = TAB_PARAM[tab];
  if (value) params.set("tab", value);
  else params.delete("tab");
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

/** Whether the note-activity column's "recently updated" highlight is on any row. */
export function anyRecentlyNoted(list: readonly Customer[], isRecent: (c: Customer) => boolean): boolean {
  return list.some((c) => customerNoteActivityAt(c) !== null && isRecent(c));
}

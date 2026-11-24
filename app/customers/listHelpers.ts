// Searching, sorting and naming for the lists on /customers. Pure — the page
// renders them, the tests pin them.
import type { Customer } from "../lib/types";
import { sortCustomersByNoteActivity, hasCustomerNote, customerNoteActivityAt } from "../lib/customerOrder";
import { thCompare } from "../lib/thCompare";
import { provinceName, provinceSearchText } from "../lib/thaiProvinces";

export { thCompare };

export type SortDir = "asc" | "desc";
export interface SortState<K extends string> {
  key: K;
  dir: SortDir;
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

/** Between two numbers in one phone field: a comma, slash, semicolon, bar,
 *  "หรือ" or "or" (as lib/phone.ts splits them). */
const PHONE_SEPARATOR = /\s*(?:,|\/|;|\||หรือ|\bor\b)\s*/i;

/** A number's digits as dialled at home: "+66 81…" and "081…" are one number. */
function localDigits(text: string): string {
  const digits = digitsOf(text);
  return text.trim().startsWith("+66") ? "0" + digits.slice(2) : digits;
}

/** The query as matched: trimmed, lower-case, one space between words. */
function normalizeQuery(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Whether some space-separated word of `text` starts with `prefix`. */
function startsAWord(text: string, prefix: string): boolean {
  return text.split(" ").some((word) => word.startsWith(prefix));
}

/**
 * Whether the query is in these texts, ignoring case: the whole phrase in one
 * of them, or else every word of it somewhere among them — "สมชาย QC" finds
 * คุณสมชาย of the QC department, "ศรีราชา ชลบุรี" a company by its district
 * and province.
 *
 * A one-letter word, and a number, must START a word there: "บริษัท ก" means
 * บริษัท ก, not every company whose people's names hold a ก ("ลูกค้า"); "ร้าน
 * 5" means ร้าน 5…, not ร้าน 05 or ร้าน 15; "ลูกค้า 00" is not ลูกค้า 100.
 * Longer words may sit anywhere — Thai runs words together ("คุณสมชาย").
 */
function everyWordIn(q: string, texts: readonly (string | null | undefined)[]): boolean {
  const haystack = texts.map((t) => (t || "").toLowerCase().replace(/\s+/g, " "));
  if (haystack.some((t) => t.includes(q))) return true;
  const words = q.split(" ");
  if (words.length < 2) return false;
  return words.every((word) => {
    const atStart = word.length === 1 || /^\d+$/.test(word);
    return haystack.some((t) => (atStart ? startsAWord(t, word) : t.includes(word)));
  });
}

/**
 * Whether the query is (part of) one of the numbers in a phone field,
 * comparing digits only, so "081-234 5678" finds 0812345678 and "+66 81…"
 * finds 081…. Only for a query that IS a number — "ร้าน 2024" is a name, not a
 * phone containing 2024 — and only from three digits, or a "1" would match
 * nearly everyone. Each number of "02-123-4567, 081-…" is matched on its own,
 * so the digits of two numbers are never read as one.
 */
function phoneMatches(q: string, phone: string | null | undefined): boolean {
  if (!PHONE_LIKE.test(q)) return false;
  const wanted = localDigits(q);
  if (wanted.length < 3) return false;
  return (phone || "").split(PHONE_SEPARATOR).some((part) => localDigits(part).includes(wanted));
}

/**
 * Whether a customer matches the search box: every word in their name,
 * company, department or e-mail — or the phone, by its digits.
 */
export function matchesCustomerSearch(
  c: Pick<Customer, "name" | "companyName" | "email" | "phone"> & { department?: string | null },
  query: string
): boolean {
  const q = normalizeQuery(query);
  if (!q) return true;
  if (everyWordIn(q, [c.name, c.companyName, c.department, c.email])) return true;
  return phoneMatches(q, c.phone);
}

/** A salesperson by name or e-mail — or the phone, by its digits. */
export function matchesSalespersonSearch(
  s: { name: string; email?: string | null; phone?: string | null },
  query: string
): boolean {
  const q = normalizeQuery(query);
  if (!q) return true;
  if (everyWordIn(q, [s.name, s.email])) return true;
  return phoneMatches(q, s.phone);
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
  id?: string;
  name: string;
  province?: string;
  district?: string;
  subDistrict?: string;
  postalCode?: string;
  phone?: string;
}

/** The จังหวัด column: the province by its official name — "กทม." and
 *  "กรุงเทพฯ" are both shown as กรุงเทพมหานคร. "" when unknown. */
export function companyProvince(c: CompanyLike): string {
  return provinceName(c.province).trim();
}

/** The อำเภอ column: the district as typed, "" when unknown. */
export function companyDistrict(c: CompanyLike): string {
  return (c.district || "").trim();
}

/**
 * Whether a company matches the search box: every word in its name or
 * address (ตำบล, อำเภอ, จังหวัด, รหัสไปรษณีย์) — "แล็บ ชลบุรี" — or the phone,
 * by its digits. One box: there used to be three (name / province /
 * district), side by side.
 */
export function matchesCompanySearch(c: CompanyLike, query: string): boolean {
  const q = normalizeQuery(query);
  if (!q) return true;
  // The province under every name it goes by: "กทม" finds กรุงเทพมหานคร.
  if (everyWordIn(q, [c.name, c.subDistrict, c.district, provinceSearchText(c.province), c.postalCode])) return true;
  return phoneMatches(q, c.phone);
}

export type CompanySortKey = "name" | "province" | "district" | "customers";

/**
 * Sorted as asked, or left in the order given (newest first, from the API).
 * By province: province, then district within it; by district: district, then
 * province — blanks last either way. By customers:
 * how many each has (`customerCounts`, by company id), ties by name.
 */
export function sortCompanies<T extends CompanyLike>(
  list: readonly T[],
  sort: SortState<CompanySortKey> | null,
  customerCounts?: ReadonlyMap<string, number>
): T[] {
  if (!sort) return [...list];
  const sign = sort.dir === "asc" ? 1 : -1;
  const countOf = (c: T) => (c.id && customerCounts?.get(c.id)) || 0;
  const compare = (a: T, b: T) =>
    sort.key === "name"
      ? compareBlanksLast(a.name, b.name, sign)
      : sort.key === "customers"
        ? sign * (countOf(a) - countOf(b)) || thCompare(a.name, b.name)
        : sort.key === "district"
          ? compareBlanksLast(a.district, b.district, sign) || compareBlanksLast(provinceName(a.province), provinceName(b.province), sign)
          : compareBlanksLast(provinceName(a.province), provinceName(b.province), sign) || compareBlanksLast(a.district, b.district, sign);
  return [...list].sort(compare);
}

/** How many customers each company has, by company id. */
export function countCustomersByCompany(customers: readonly { companyId?: string | null }[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const c of customers) {
    if (c.companyId) counts.set(c.companyId, (counts.get(c.companyId) || 0) + 1);
  }
  return counts;
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

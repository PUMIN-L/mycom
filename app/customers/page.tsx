"use client";
import { useState, useEffect, useRef, useMemo, useCallback, Suspense } from "react";
import AdminHomeButton from "../components/AdminHomeButton";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "../context/AuthContext";
import Toast from "../components/Toast";
import Link from "next/link";
import EquipmentTab from "./EquipmentTab";
import DeleteDialog from "./DeleteDialog";
import { CompanyForm, CustomerForm, SalespersonForm } from "./EntityForms";
import { CompanyWindow, SalespersonWindow } from "./ViewWindows";
import { KIND_NOUN, type DeleteKind } from "./linkHelpers";
import type { Company, Salesperson } from "./types";
// ค้นหา–แทนที่ใน "บันทึกลูกค้า" — an ADDITION to this tab, never a replacement.
// It owns its own data and its own network calls, and it does not touch the
// ชื่อลูกค้า/ชื่อบริษัท box below it, which still filters `filteredCustomers`
// exactly as it always has.
import CustomerNoteSearchPanel from "../components/CustomerNoteSearchPanel";
import Pagination from "../components/Pagination";
import SortableTh from "../components/SortableTh";
import CopyText from "../components/CopyText";
import RowActions, { openOnKey } from "../components/RowActions";
import SearchBox from "../components/SearchBox";
import { downloadExcel } from "../lib/xlsxExport";
import { formatThaiPhone } from "../lib/phone";
import type { Customer } from "../lib/types";
import {
  customerNoteActivityAt,
  isNoteRecentlyUpdated,
} from "../lib/customerOrder";
import { bangkokDateString, displayDateTimeParts } from "../lib/dateFormat";
import {
  DEFAULT_CUSTOMER_SORT,
  anyRecentlyNoted,
  companyLocation,
  countCustomersByCompany,
  matchesCompanySearch,
  matchesCustomerSearch,
  matchesSalespersonSearch,
  nextSort,
  searchWithTab,
  sortByName,
  sortCompanies,
  sortCustomers,
  type CompanySortKey,
  type CustomerSortKey,
  type CustomersTab,
  type SortState,
} from "./listHelpers";

const CUSTOMERS_PER_PAGE = 50;
const TAB_ORDER: readonly CustomersTab[] = ["customers", "companies", "salespeople", "equipments"];
const COMPANIES_PER_PAGE = 50;

/** One look for every list on this page (and the equipment tab): a light
 *  header band, compact rows — a few thousand customers is a list to scan,
 *  not a gallery. */
const TH = "px-4 py-3 text-xs font-semibold";
const TD = "px-4 py-3";
/** A row reached with Tab shows it — the same ring on every list. */
const ROW_FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-orange-300";
const PRIMARY_BUTTON =
  "bg-orange-500 hover:bg-orange-600 text-white px-5 py-2.5 rounded-xl font-medium transition-all shadow-sm hover:shadow-md flex items-center gap-2";
const SECONDARY_BUTTON =
  "bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 px-5 py-2.5 rounded-xl font-medium transition-all shadow-sm flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed";

/** The empty-table message: "nothing matches" when a search is narrowing the
 *  list (with a way to clear it) — not "there is no data", which is what the
 *  three lists used to say about a search that found nothing. */
function EmptyRows({
  colSpan,
  searching,
  emptyText,
  noMatchText,
  onClear,
  icon,
}: {
  colSpan: number;
  searching: boolean;
  emptyText: string;
  noMatchText: string;
  onClear: () => void;
  icon: React.ReactNode;
}) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-12 text-center text-gray-500">
        <div className="flex flex-col items-center justify-center gap-3">
          {icon}
          <p>{searching ? noMatchText : emptyText}</p>
          {searching && (
            <button type="button" onClick={onClear} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-xl hover:bg-gray-200 transition-all text-sm font-semibold">
              ล้างคำค้น
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

/**
 * "อัปเดตล่าสุด" cell. Laid out in parts so every row's date lines up: the day
 * is zero-padded and the digits are tabular (the cell sets `tabular-nums`;
 * Inter supports it), and the month — the one part whose LETTERS differ in
 * width, `Jul` vs `Sep` — sits in a fixed-width box, so the year and time
 * start at the same x on every row.
 */
function NoteUpdatedAt({ value }: { value: string | null }) {
  const p = displayDateTimeParts(value);
  if (!p) return <>-</>;
  return (
    <>
      {p.day} <span className="inline-block w-[2.2em]">{p.month}</span> {p.year} {p.time}
    </>
  );
}
// The Viewing Customer modal itself — extracted (spec:
// open-customer-profile-in-place) so /crm/alerts can open the exact same
// view (department/email/phone, บันทึกลูกค้า, นัดโทรลูกค้า, and the
// "สร้างสิ่งที่ต้องทำ" button) in place of navigating to /customers, instead
// of a second copy of all of that living in that page's own file. This page
// keeps only the STATE of which customer is being viewed; everything else
// that used to be inline here now lives inside the component.
import CustomerDetailsModal from "../components/modals/CustomerDetailsModal";

/** The three lists this page loads itself (the equipment tab loads its own). */
type ListKey = "customers" | "companies" | "salespeople";
const LIST_KEYS: readonly ListKey[] = ["customers", "companies", "salespeople"];
const LIST_URL: Record<ListKey, string> = {
  customers: "/api/customers",
  companies: "/api/companies",
  salespeople: "/api/salespeople",
};
/**
 * Where each list stands. "error" is a list that has NEVER loaded — shown as
 * a failure with ลองใหม่, not as an empty list: "ยังไม่มีข้อมูลลูกค้า" and a
 * tab reading "ลูกค้า 0" made a failed load look like every customer was
 * gone. A list that loaded once and then fails to reload stays "ok", showing
 * what it had.
 */
type ListStatus = "loading" | "ok" | "error";
const LOAD_FAILED: Record<ListKey, string> = {
  customers: "โหลดรายชื่อลูกค้าไม่สำเร็จ",
  companies: "โหลดรายชื่อบริษัทไม่สำเร็จ",
  salespeople: "โหลดรายชื่อพนักงานขายไม่สำเร็จ",
};

/** In place of a list that could not be loaded: what failed, and a retry. */
function LoadErrorRow({ colSpan, message, onRetry }: { colSpan: number; message: string; onRetry: () => void }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-14 text-center">
        <div role="alert" className="flex flex-col items-center justify-center gap-3">
          <svg aria-hidden="true" className="w-12 h-12 text-red-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
          <p className="text-gray-800 font-semibold">{message}</p>
          <p className="text-sm text-gray-500">ตรวจสอบการเชื่อมต่อแล้วลองใหม่อีกครั้ง</p>
          <button type="button" onClick={onRetry} className={PRIMARY_BUTTON}>
            ลองใหม่
          </button>
        </div>
      </td>
    </tr>
  );
}

// Deep-link `?tab=` values. Task-board link chips (and the dashboard's existing
// `/customers?tab=equipment` link) are hand-written URLs, so every spelling a
// caller might reasonably use maps to a real tab; anything else is ignored and
// the page opens on its normal default.
const DEEP_LINK_TABS: Record<string, CustomersTab> = {
  customer: "customers",
  customers: "customers",
  company: "companies",
  companies: "companies",
  sales: "salespeople",
  salesperson: "salespeople",
  salespeople: "salespeople",
  equipment: "equipments",
  equipments: "equipments",
};

// Drop the deep-link parameters once they have been acted on, so closing the
// modal (or a refresh) doesn't reopen it. Same trick as `app/suppliers/page.tsx`.
function stripDeepLinkParams(keys: string[]) {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);
  keys.forEach((key) => params.delete(key));
  const qs = params.toString();
  window.history.replaceState({}, "", window.location.pathname + (qs ? `?${qs}` : ""));
}

function CustomersInner() {
  const router = useRouter();
  const { isLoggedIn, isLoading } = useAuth();
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState<CustomersTab>("customers");
  // A tab picked here is written to the URL (`?tab=`), so a refresh opens the
  // same tab — the page used to fall back to ลูกค้า every time. Replaced, not
  // pushed: Back still leaves the page rather than walking through tabs.
  const selectTab = (tab: CustomersTab) => {
    setActiveTab(tab);
    if (typeof window !== "undefined") {
      window.history.replaceState({}, "", window.location.pathname + searchWithTab(window.location.search, tab));
    }
  };

  // ── Deep linking ───────────────────────────────────────────────────────────
  // A task-board link chip points here to open one customer, or one machine's
  // detail modal on the equipment tab. Those chips are soft links: the customer
  // or machine they name may well have been deleted since (the whole point of
  // `task_links` carrying no foreign keys), so a dead id must land on the normal
  // page plus a plain notice — never an error page and never a blank screen.
  const [deepLinkNotice, setDeepLinkNotice] = useState<string | null>(null);
  const [pendingCustomerId, setPendingCustomerId] = useState<string | null>(null);
  const deepLinkReadRef = useRef(false);

  useEffect(() => {
    // Read once per mount: after this the URL is rewritten, and re-reading it
    // would only fight the user's own clicking around.
    if (deepLinkReadRef.current) return;
    deepLinkReadRef.current = true;

    const rawTab = (searchParams.get("tab") || "").trim().toLowerCase();
    const tabFromParam = DEEP_LINK_TABS[rawTab];
    const bareId = (searchParams.get("id") || "").trim();
    const customerId =
      (searchParams.get("customerId") || searchParams.get("customer") || "").trim() ||
      (tabFromParam !== "equipments" ? bareId : "");
    const equipmentId =
      (searchParams.get("equipmentId") || searchParams.get("edit_eq") || "").trim() ||
      (tabFromParam === "equipments" ? bareId : "");

    // An explicit tab wins; otherwise the kind of id given picks the tab for us.
    const tab = tabFromParam || (equipmentId ? "equipments" : customerId ? "customers" : null);
    if (tab) setActiveTab(tab);

    // Nothing to deep-link to — the page behaves exactly as it always has.
    if (!customerId && !equipmentId) return;

    // The customer list is fetched below; opening waits for it (see next effect).
    if (customerId) setPendingCustomerId(customerId);

    if (equipmentId) {
      // `EquipmentTab` already opens a machine's detail modal from
      // `?edit_eq=<id>&action=view`, which it reads off window.location once its
      // own list has loaded. Normalising the URL here — synchronously, before
      // that tab is even mounted — is what makes the friendlier `?equipmentId=`
      // spelling work without reaching into that component.
      if (typeof window !== "undefined") {
        window.history.replaceState(
          {},
          "",
          `${window.location.pathname}?tab=equipment&edit_eq=${encodeURIComponent(equipmentId)}&action=view`
        );
      }
      // That component stays silent when the id matches nothing, so confirm the
      // machine separately: one cheap GET, purely to be able to say "ถูกลบไปแล้ว"
      // instead of leaving the admin staring at a list that never opened.
      (async () => {
        try {
          const res = await fetch(`/api/admin/equipments/${encodeURIComponent(equipmentId)}`);
          if (res.status === 404) {
            setDeepLinkNotice("ไม่พบเครื่องที่ลิงก์อ้างถึง (อาจถูกลบไปแล้ว) — แสดงรายการอุปกรณ์ตามปกติ");
            // `EquipmentTab` only clears these params when it *finds* the
            // machine, so a dead id would otherwise sit in the URL and replay
            // this notice on every refresh. The tab itself stays.
            stripDeepLinkParams(["equipmentId", "edit_eq", "action", "id"]);
          }
        } catch {
          // A network hiccup is not proof the machine is gone: say nothing and
          // let the equipment tab load normally.
        }
      })();
    }
  }, [searchParams]);

  const [companies, setCompanies] = useState<Company[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [salespeople, setSalespeople] = useState<Salesperson[]>([]);
  const [isLoadingData, setIsLoadingData] = useState(true);
  // Per list, so one that failed says so on its own tab while the others work.
  // The tab counts wait for "ok" (a "0" before then is a lie) but survive a
  // REFETCH — every save reloads the lists, and the counts blinking out each
  // time was noise.
  const [listStatus, setListStatus] = useState<Record<ListKey, ListStatus>>({
    customers: "loading",
    companies: "loading",
    salespeople: "loading",
  });
  // Whether `/api/customers` has answered. A deep link that finds no matching
  // customer means two very different things depending on this, and an empty
  // list is not by itself proof of a failure (a fresh DB has none).
  const customersLoaded = listStatus.customers === "ok";

  // The open add / edit form, and what it opened with: a row with an id
  // edits it, anything else (`{}`, `{ companyId }`) adds one.
  const [companyForm, setCompanyForm] = useState<Partial<Company> | null>(null);
  const [customerForm, setCustomerForm] = useState<Partial<Customer> | null>(null);
  const [salespersonForm, setSalespersonForm] = useState<Partial<Salesperson> | null>(null);

  const [viewingCompany, setViewingCompany] = useState<Company | null>(null);
  const [viewingCustomer, setViewingCustomer] = useState<Customer | null>(null);
  const [viewingSalesperson, setViewingSalesperson] = useState<Salesperson | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<{ kind: DeleteKind; id: string; name: string } | null>(null);

  // One search box per tab. Companies used to have three (name / province /
  // district) side by side; one box takes every word of all three now.
  const [searchCustomerName, setSearchCustomerName] = useState("");
  const [searchCompany, setSearchCompany] = useState("");
  const [searchSalespersonName, setSearchSalespersonName] = useState("");
  // The note search-and-replace (CustomerNoteSearchPanel), folded away until
  // asked for: open, it sat ABOVE the name search as a second, bigger search
  // box, and a name typed into it brought up a red "แทนที่ทั้งหมด".
  const [showNoteSearch, setShowNoteSearch] = useState(false);

  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  useEffect(() => {
    if (!isLoading && !isLoggedIn) {
      router.replace("/login");
    }
  }, [isLoggedIn, isLoading, router]);

  // Second half of the customer deep link (the reader sits at the top of this
  // component): the id can only be matched once the customer list has arrived.
  useEffect(() => {
    if (!pendingCustomerId || isLoadingData) return;
    const target = customers.find((c) => c.id === pendingCustomerId);
    if (target) {
      setViewingCustomer(target);
    } else if (!customersLoaded) {
      // Distinguish "the list never loaded" from "this customer is gone" —
      // claiming a deletion that didn't happen would be worse than saying nothing.
      setDeepLinkNotice("เปิดลูกค้าที่ลิงก์อ้างถึงไม่ได้ เพราะโหลดรายชื่อลูกค้าไม่สำเร็จ");
    } else {
      setDeepLinkNotice("ไม่พบลูกค้าที่ลิงก์อ้างถึง (อาจถูกลบไปแล้ว) — แสดงหน้ารายชื่อลูกค้าตามปกติ");
    }
    setPendingCustomerId(null);
    stripDeepLinkParams(["customerId", "customer", "id"]);
  }, [pendingCustomerId, customers, customersLoaded, isLoadingData]);

  // One timer at a time: a second toast (two copies in a row) used to be cut
  // short by the FIRST one's timer. Stable, so fetchData can be too.
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useCallback((message: string, type: "success" | "error") => {
    setToast({ message, type });
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 3000);
  }, []);
  useEffect(() => () => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
  }, []);

  // The router through a ref: fetchData must never change, or everything
  // holding it would see a new one on every render.
  const routerRef = useRef(router);
  useEffect(() => {
    routerRef.current = router;
  }, [router]);
  // Which lists have loaded at least once — a reload that fails keeps what
  // they show; only a list that never loaded becomes an error.
  const everLoadedRef = useRef<Record<ListKey, boolean>>({ customers: false, companies: false, salespeople: false });
  const loadSeqRef = useRef(0);

  const fetchData = useCallback(async () => {
    // Only the latest load is applied: a save and then a quick delete start
    // two, and the first answering last would bring the deleted row back.
    const seq = ++loadSeqRef.current;
    const isLatest = () => seq === loadSeqRef.current;
    setIsLoadingData(true);
    const results = await Promise.all(
      LIST_KEYS.map(async (key) => {
        try {
          const res = await fetch(LIST_URL[key]);
          if (res.status === 401) return { key, unauthorized: true as const };
          if (!res.ok) return { key, rows: null };
          const body = await res.json();
          return { key, rows: Array.isArray(body) ? body : null };
        } catch (err) {
          console.error(`Failed to load ${key}`, err);
          return { key, rows: null };
        }
      })
    );
    if (!isLatest()) return;
    if (results.some((r) => "unauthorized" in r)) {
      routerRef.current.replace("/login");
      return;
    }
    const status = {} as Record<ListKey, ListStatus>;
    let failedReload = false;
    let failedFirst = false;
    for (const r of results as { key: ListKey; rows: unknown[] | null }[]) {
      if (r.rows) {
        if (r.key === "customers") setCustomers(r.rows as Customer[]);
        else if (r.key === "companies") setCompanies(r.rows as Company[]);
        else setSalespeople(r.rows as Salesperson[]);
        everLoadedRef.current[r.key] = true;
        status[r.key] = "ok";
      } else if (everLoadedRef.current[r.key]) {
        failedReload = true;
        status[r.key] = "ok";
      } else {
        failedFirst = true;
        status[r.key] = "error";
      }
    }
    setListStatus(status);
    setIsLoadingData(false);
    if (failedReload) showToast("โหลดข้อมูลล่าสุดไม่สำเร็จ กรุณาลองใหม่", "error");
    else if (failedFirst) showToast("โหลดข้อมูลบางส่วนไม่สำเร็จ กรุณาลองใหม่", "error");
  }, [showToast]);

  useEffect(() => {
    if (isLoggedIn) fetchData();
  }, [isLoggedIn, fetchData]);

  /** ลองใหม่ on a list that failed: it shows as loading again meanwhile. */
  const retryLoad = () => {
    setListStatus((s) => {
      const next = { ...s };
      for (const key of LIST_KEYS) if (next[key] === "error") next[key] = "loading";
      return next;
    });
    fetchData();
  };

  // ── Add / edit / delete ────────────────────────────────────────────────────
  // The forms (./EntityForms) and the delete dialog (./DeleteDialog) do their
  // own saving and say their own errors; the page closes them, says it worked
  // and reloads the lists.

  const onCompanySaved = () => {
    setCompanyForm(null);
    showToast("บันทึกข้อมูลบริษัทสำเร็จ", "success");
    fetchData();
  };
  /** A company added from inside the customer form, which stays open: on the
   *  list at once (the form's dropdown reads it), then confirmed by a reload. */
  const onCompanyCreated = (company: Company) => {
    if (company.id) setCompanies((prev) => [company, ...prev.filter((c) => c.id !== company.id)]);
    showToast("เพิ่มบริษัทแล้ว และเลือกให้ลูกค้ารายนี้แล้ว", "success");
    fetchData();
  };
  const onCustomerSaved = () => {
    setCustomerForm(null);
    showToast("บันทึกข้อมูลลูกค้าสำเร็จ", "success");
    fetchData();
  };
  const onSalespersonSaved = () => {
    setSalespersonForm(null);
    showToast("บันทึกข้อมูลพนักงานขายสำเร็จ", "success");
    fetchData();
  };

  const onDeleted = () => {
    if (!deleteTarget) return;
    const { kind, id } = deleteTarget;
    // Off the list at once; the reload below confirms it.
    if (kind === "customer") {
      setCustomers((prev) => prev.filter((c) => c.id !== id));
      setViewingCustomer((v) => (v?.id === id ? null : v));
    } else if (kind === "company") {
      setCompanies((prev) => prev.filter((c) => c.id !== id));
      setViewingCompany((v) => (v?.id === id ? null : v));
    } else {
      setSalespeople((prev) => prev.filter((s) => s.id !== id));
      setViewingSalesperson((v) => (v?.id === id ? null : v));
    }
    setDeleteTarget(null);
    showToast(KIND_NOUN[kind].done, "success");
    fetchData();
  };

  // Companies: filtered, sorted when a header is clicked (newest first, as the
  // API sends them, until then), and paged like customers — the whole list in
  // one table was thousands of rows.
  const [companySort, setCompanySort] = useState<SortState<CompanySortKey> | null>(null);
  const [companyPage, setCompanyPage] = useState(1);
  // How many customers each company has — a column, and a sort.
  const customerCounts = useMemo(() => countCustomersByCompany(customers), [customers]);
  const filteredCompanies = useMemo(
    () => sortCompanies(companies.filter((c) => matchesCompanySearch(c, searchCompany)), companySort, customerCounts),
    [companies, searchCompany, companySort, customerCounts]
  );
  const sortCompaniesBy = (key: CompanySortKey) => {
    // A count starts with the most; names and places start ก→ฮ.
    setCompanySort((s) => nextSort(s, key, key === "customers" ? "desc" : "asc"));
    setCompanyPage(1);
  };
  const companyTotalPages = Math.max(1, Math.ceil(filteredCompanies.length / COMPANIES_PER_PAGE));
  const safeCompanyPage = Math.min(companyPage, companyTotalPages);
  const pagedCompanies = filteredCompanies.slice(
    (safeCompanyPage - 1) * COMPANIES_PER_PAGE,
    safeCompanyPage * COMPANIES_PER_PAGE
  );
  const companySearching = searchCompany.trim() !== "";

  // Sorted HERE rather than by GET /api/customers: that route feeds several
  // dropdowns elsewhere that keep its createdAt order. Deriving the order from
  // `customers` also means a note saved from CustomerDetailsModal — which
  // patches this list in place instead of refetching — moves that customer to
  // the top at once.
  //
  // Memoized on exactly what it reads. Every keystroke anywhere on this page
  // (the edit-customer form, the company search on another tab) re-renders it,
  // and re-sorting ~6,000 customers on each of those is tens of milliseconds
  // of typing lag for a list that did not change.
  //
  // The search box also finds a phone number (digits only) and an e-mail; a
  // clicked header sorts by name or company instead of the note order.
  const [customerSort, setCustomerSort] = useState<SortState<CustomerSortKey>>(DEFAULT_CUSTOMER_SORT);
  const filteredCustomers = useMemo(
    () => sortCustomers(customers.filter((c) => matchesCustomerSearch(c, searchCustomerName)), customerSort),
    [customers, searchCustomerName, customerSort]
  );
  const customerSearching = searchCustomerName.trim() !== "";
  const sortCustomersBy = (key: CustomerSortKey) => {
    // Dates start newest-first (the default order); names start ก→ฮ.
    setCustomerSort((s) => nextSort(s, key, key === "activity" ? "desc" : "asc"));
    setCustomerPage(1);
  };

  // Paged: ~2,000 customers as one table was tens of thousands of DOM nodes,
  // all re-rendered on every keystroke in the edit form (its state lives on
  // this page). Only the RENDERED rows are paged — sorting, the count, Excel
  // export and deep links all still work from the full `filteredCustomers`.
  // The clamp is derived, not stored, so a shrinking list (delete, search)
  // can never strand the view on an empty page.
  const [customerPage, setCustomerPage] = useState(1);
  const customerTotalPages = Math.max(1, Math.ceil(filteredCustomers.length / CUSTOMERS_PER_PAGE));
  const safeCustomerPage = Math.min(customerPage, customerTotalPages);
  const pagedCustomers = filteredCustomers.slice(
    (safeCustomerPage - 1) * CUSTOMERS_PER_PAGE,
    safeCustomerPage * CUSTOMERS_PER_PAGE
  );

  // "Now" for the recently-updated highlight. Held in state and ticked once a
  // minute, so a row stops being highlighted when its 12 hours run out without
  // a reload — and so render stays pure (no Date.now() in the row loop).
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const [salespersonSort, setSalespersonSort] = useState<SortState<"name"> | null>(null);
  const filteredSalespeople = sortByName(
    salespeople.filter((s) => matchesSalespersonSearch(s, searchSalespersonName)),
    salespersonSort
  );
  const salespersonSearching = searchSalespersonName.trim() !== "";

  const copied = () => showToast("คัดลอกแล้ว", "success");
  const copyFailed = () => showToast("คัดลอกไม่สำเร็จ", "error");

  const [isExportingCustomers, setIsExportingCustomers] = useState(false);

  const handleExportCustomers = async () => {
    if (isExportingCustomers) return;
    if (filteredCustomers.length === 0) {
      showToast("ไม่มีข้อมูลลูกค้าสำหรับส่งออก", "error");
      return;
    }
    
    setIsExportingCustomers(true);
    try {
      const rows = filteredCustomers.map((c) => ({
        "ชื่อลูกค้า": c.name,
        "บริษัท": c.companyName || "-",
        "แผนก": c.department || "-",
        "เบอร์โทร": c.phone || "-",
        "อีเมล": c.email || "-",
        "บันทึกลูกค้า": c.note || "-"
      }));

      // Dated, so a second export does not land as "customers_export (1)".
      await downloadExcel(`customers_${bangkokDateString(new Date())}.xlsx`, [
        { name: "Customers", rows, columnWidths: [25, 30, 20, 15, 30, 40] },
      ]);
      showToast("ส่งออกไฟล์ลูกค้าสำเร็จ", "success");
    } catch (err) {
      console.error(err);
      showToast("เกิดข้อผิดพลาดในการส่งออกไฟล์", "error");
    } finally {
      setIsExportingCustomers(false);
    }
  };

  // A page change from the pager at the BOTTOM of a long table left the view
  // down there, at the end of the new page: back to the top of the list.
  const listTopRef = useRef<HTMLDivElement>(null);
  const showListTop = () => {
    const top = listTopRef.current;
    if (top && top.getBoundingClientRect().top < 0) top.scrollIntoView?.({ block: "start" });
  };
  const goToCustomerPage = (page: number) => {
    setCustomerPage(page);
    showListTop();
  };
  const goToCompanyPage = (page: number) => {
    setCompanyPage(page);
    showListTop();
  };

  // Each list: skeleton rows only until it first arrives. A reload after a
  // save keeps the rows (and the pager) on screen — the table used to flash
  // to five grey bars and back, and the page jumped with it.
  const firstLoad = (key: ListKey) => listStatus[key] === "loading";

  if (isLoading || !isLoggedIn) return null;

  return (
    // pb-32: the admin bell floats over the bottom-left corner, and it covered
    // the pager's "แสดง 1 ถึง 50 จาก …".
    <div className="min-h-screen bg-[#F8FAFC] pt-12 pb-32 font-sans">
      {toast && <Toast message={toast.message} type={toast.type} />}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        
        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-10 gap-4">
          <div>
            <h1 className="text-4xl font-extrabold text-gray-900 tracking-tight">ลูกค้าและบริษัท</h1>
            <p className="text-gray-500 mt-2 text-lg">จัดการรายชื่อลูกค้าและข้อมูลบริษัทคู่ค้าของคุณ</p>
          </div>
          <div className="flex gap-3 items-center flex-wrap">
            <Link href="/dashboard" className="px-5 py-2.5 bg-white border border-gray-200 text-gray-700 font-semibold rounded-xl hover:bg-gray-50 hover:shadow-sm transition-all flex items-center gap-2">
              📊 Dashboard ยอดขาย
            </Link>
            <AdminHomeButton />
          </div>
        </div>

        {/* Deep-link notice — a link chip pointed at a record that is no longer
            here. The page itself is fine; this just explains the empty landing. */}
        {deepLinkNotice && (
          <div className="mb-6 flex items-start gap-3 bg-amber-50 border border-amber-200 text-amber-800 rounded-2xl px-5 py-4">
            <span className="text-lg leading-none mt-0.5">⚠️</span>
            <p className="flex-1 text-sm font-medium">{deepLinkNotice}</p>
            <button
              type="button"
              onClick={() => setDeepLinkNotice(null)}
              aria-label="ปิดข้อความแจ้งเตือน"
              className="p-1 text-amber-500 hover:text-amber-700 hover:bg-amber-100 rounded-full transition-colors shrink-0"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
            </button>
          </div>
        )}

        {/* Tabs — short Thai names, each with how many it holds. */}
        {/* A real tab strip (WAI-ARIA tabs): one Tab stop — the open tab —
            and ←/→, Home/End to move between them. */}
        <div
          className="flex flex-wrap gap-1 bg-gray-200/50 p-1.5 rounded-2xl w-fit mb-6 shadow-inner"
          role="tablist"
          aria-label="ประเภทข้อมูล"
          onKeyDown={(e) => {
            const i = TAB_ORDER.indexOf(activeTab);
            const next =
              e.key === "ArrowRight" ? TAB_ORDER[(i + 1) % TAB_ORDER.length]
              : e.key === "ArrowLeft" ? TAB_ORDER[(i - 1 + TAB_ORDER.length) % TAB_ORDER.length]
              : e.key === "Home" ? TAB_ORDER[0]
              : e.key === "End" ? TAB_ORDER[TAB_ORDER.length - 1]
              : null;
            if (!next) return;
            e.preventDefault();
            selectTab(next);
            document.getElementById(`customers-tab-${next}`)?.focus();
          }}
        >
          {([
            { tab: "customers", label: "ลูกค้า", count: listStatus.customers === "ok" ? customers.length : null },
            { tab: "companies", label: "บริษัท", count: listStatus.companies === "ok" ? companies.length : null },
            { tab: "salespeople", label: "พนักงานขาย", count: listStatus.salespeople === "ok" ? salespeople.length : null },
            { tab: "equipments", label: "อุปกรณ์ที่ขาย", count: null },
          ] as const).map(({ tab, label, count }) => (
            <button
              key={tab}
              type="button"
              role="tab"
              id={`customers-tab-${tab}`}
              aria-selected={activeTab === tab}
              aria-controls="customers-tabpanel"
              tabIndex={activeTab === tab ? 0 : -1}
              onClick={() => selectTab(tab)}
              className={`py-2.5 px-5 rounded-xl font-semibold text-sm transition-all duration-200 flex items-center gap-2 ${
                activeTab === tab ? "bg-white text-orange-600 shadow-sm" : "text-gray-600 hover:text-gray-900 hover:bg-gray-200/50"
              }`}
            >
              {label}
              {/* The space is for screen readers ("ลูกค้า 3", not "ลูกค้า3");
                  in a flex row it takes no room — the gap spaces the badge. */}
              {count !== null && (
                <>
                  {" "}
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full tabular-nums ${activeTab === tab ? "bg-orange-100 text-orange-700" : "bg-gray-200 text-gray-600"}`}>
                    {count.toLocaleString("th-TH")}
                  </span>
                </>
              )}
            </button>
          ))}
        </div>

        {/* Content Area */}
        <div
          ref={listTopRef}
          id="customers-tabpanel"
          role="tabpanel"
          aria-labelledby={`customers-tab-${activeTab}`}
          className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden scroll-mt-4"
        >
          {activeTab === "companies" && (
            <div className="p-6">
              <div className="flex flex-wrap justify-between items-center gap-3 mb-5">
                <div className="flex items-center gap-3">
                  <div className="bg-orange-100 text-orange-600 p-2.5 rounded-xl">
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"></path></svg>
                  </div>
                  <h2 className="text-xl font-bold text-gray-800">
                    บริษัททั้งหมด
                    {listStatus.companies === "ok" && (
                      <span className="text-gray-400 text-base font-normal tabular-nums" data-testid="company-count">
                        {" "}({companySearching ? `พบ ${filteredCompanies.length.toLocaleString("th-TH")} จาก ${companies.length.toLocaleString("th-TH")}` : companies.length.toLocaleString("th-TH")})
                      </span>
                    )}
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => { setCompanyForm({}); }}
                  className={PRIMARY_BUTTON}
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4"></path></svg>
                  เพิ่มบริษัท
                </button>
              </div>

              {/* One box: name, address or phone — every word must match. */}
              <SearchBox
                className="mb-5 w-full md:max-w-xl"
                label="ค้นหาบริษัท"
                placeholder="ค้นหาชื่อบริษัท อำเภอ จังหวัด หรือเบอร์โทร..."
                value={searchCompany}
                onChange={(value) => { setSearchCompany(value); setCompanyPage(1); }}
              />

              <div className="overflow-x-auto">
                <table className="w-full text-left whitespace-nowrap">
                  <thead>
                    <tr className="bg-gray-50 text-gray-500 uppercase tracking-wider">
                      <SortableTh className={`${TH} rounded-l-xl`} dir={companySort?.key === "name" ? companySort.dir : null} onSort={() => sortCompaniesBy("name")}>ชื่อบริษัท</SortableTh>
                      {/* The province / district the search box matches on. */}
                      <SortableTh className={TH} dir={companySort?.key === "location" ? companySort.dir : null} onSort={() => sortCompaniesBy("location")}>อำเภอ / จังหวัด</SortableTh>
                      {/* How many of its people are on the customers tab. */}
                      <SortableTh className={TH} dir={companySort?.key === "customers" ? companySort.dir : null} onSort={() => sortCompaniesBy("customers")}>ลูกค้า</SortableTh>
                      <th className={TH}>เบอร์โทร</th>
                      <th className={TH}>หมายเหตุ</th>
                      <th className={`${TH} text-right rounded-r-xl`}>จัดการ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {listStatus.companies === "error" ? (
                      <LoadErrorRow colSpan={6} message={LOAD_FAILED.companies} onRetry={retryLoad} />
                    ) : firstLoad("companies") ? (
                      Array.from({ length: 5 }).map((_, i) => (
                        <tr key={i} className="animate-pulse">
                          <td className={TD}><div className="h-5 bg-gray-200 rounded w-40"></div></td>
                          <td className={TD}><div className="h-5 bg-gray-200 rounded w-32"></div></td>
                          <td className={TD}><div className="h-5 bg-gray-200 rounded w-8"></div></td>
                          <td className={TD}><div className="h-5 bg-gray-200 rounded w-24"></div></td>
                          <td className={TD}><div className="h-5 bg-gray-200 rounded w-48"></div></td>
                          <td className={`${TD} text-right`}><div className="h-5 bg-gray-200 rounded w-12 ml-auto"></div></td>
                        </tr>
                      ))
                    ) : pagedCompanies.map(c => (
                      <tr
                        key={c.id}
                        tabIndex={0}
                        aria-label={`ดูข้อมูล ${c.name}`}
                        onClick={() => setViewingCompany(c)}
                        onKeyDown={openOnKey(() => setViewingCompany(c))}
                        className={`hover:bg-gray-50 ${ROW_FOCUS} transition-colors group cursor-pointer`}
                      >
                        <td className={TD}>
                          <p className="font-semibold text-gray-900">{c.name}</p>
                        </td>
                        <td className={`${TD} text-gray-600 text-sm`}>{companyLocation(c) || "-"}</td>
                        <td className={`${TD} text-gray-600 tabular-nums`} data-testid="company-customer-count">
                          {listStatus.customers === "ok" ? (customerCounts.get(c.id) || 0).toLocaleString("th-TH") : "-"}
                        </td>
                        <td className={`${TD} text-gray-600`}>
                          <CopyText value={formatThaiPhone(c.phone)} onCopied={copied} onFailed={copyFailed} />
                        </td>
                        <td className={TD}>
                          <p className="text-gray-500 text-sm truncate max-w-xs">{c.note || "-"}</p>
                        </td>
                        <td className={TD}>
                          <RowActions
                            name={c.name}
                            onEdit={() => setCompanyForm(c)}
                            onDelete={() => setDeleteTarget({ kind: "company", id: c.id, name: c.name })}
                          />
                        </td>
                      </tr>
                    ))}
                    {listStatus.companies === "ok" && filteredCompanies.length === 0 && (
                      <EmptyRows
                        colSpan={6}
                        searching={companySearching}
                        emptyText="ยังไม่มีข้อมูลบริษัท"
                        noMatchText="ไม่พบบริษัทที่ตรงกับคำค้น"
                        onClear={() => { setSearchCompany(""); setCompanyPage(1); }}
                        icon={<svg className="w-12 h-12 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"></path></svg>}
                      />
                    )}
                  </tbody>
                </table>
              </div>
              {listStatus.companies === "ok" && (
                <Pagination
                  page={safeCompanyPage}
                  totalPages={companyTotalPages}
                  totalItems={filteredCompanies.length}
                  perPage={COMPANIES_PER_PAGE}
                  onPageChange={goToCompanyPage}
                  testId="company-pagination"
                />
              )}
            </div>
          )}

          {activeTab === "customers" && (
            <div className="p-6">
              <div className="flex flex-wrap justify-between items-center gap-3 mb-5">
                <div className="flex items-center gap-3">
                  <div className="bg-orange-100 text-orange-600 p-2.5 rounded-xl">
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"></path></svg>
                  </div>
                  <h2 className="text-xl font-bold text-gray-800">
                    ลูกค้าทั้งหมด
                    {listStatus.customers === "ok" && (
                      <span className="text-gray-400 text-base font-normal tabular-nums" data-testid="customer-count">
                        {" "}({customerSearching ? `พบ ${filteredCustomers.length.toLocaleString("th-TH")} จาก ${customers.length.toLocaleString("th-TH")}` : customers.length.toLocaleString("th-TH")})
                      </span>
                    )}
                  </h2>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={handleExportCustomers}
                    disabled={isExportingCustomers || listStatus.customers !== "ok"}
                    className={SECONDARY_BUTTON}
                  >
                    {isExportingCustomers ? (
                      <div className="w-5 h-5 border-2 border-gray-500 border-t-transparent rounded-full animate-spin"></div>
                    ) : (
                      <svg aria-hidden="true" className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
                    )}
                    ส่งออก Excel
                  </button>
                  <button
                    type="button"
                    onClick={() => { setCustomerForm({}); }}
                    className={PRIMARY_BUTTON}
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4"></path></svg>
                    เพิ่มลูกค้า
                  </button>
                </div>
              </div>

              {/* The list's one search box — name, company, department,
                  e-mail or phone — and, beside it, the way into the note
                  search-and-replace. */}
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-3 w-full md:w-auto md:flex-1">
                  <SearchBox
                    className="w-full md:max-w-xl md:flex-1"
                    label="ค้นหาลูกค้า"
                    placeholder="ค้นหาชื่อลูกค้า บริษัท แผนก เบอร์โทร หรืออีเมล..."
                    value={searchCustomerName}
                    onChange={(value) => {
                      setSearchCustomerName(value);
                      setCustomerPage(1);
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowNoteSearch((open) => !open)}
                    aria-expanded={showNoteSearch}
                    aria-controls={showNoteSearch ? "customer-note-search" : undefined}
                    className={`px-4 py-2.5 rounded-xl text-sm font-semibold border transition-colors flex items-center gap-2 ${
                      showNoteSearch
                        ? "bg-orange-50 border-orange-200 text-orange-700 hover:bg-orange-100"
                        : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50"
                    }`}
                  >
                    <svg aria-hidden="true" className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
                    {showNoteSearch ? "ปิดค้นหาในบันทึก" : "ค้นหา-แทนที่ในบันทึก"}
                  </button>
                </div>
                {/* What a green row means — it was never said anywhere. */}
                {listStatus.customers === "ok" && anyRecentlyNoted(filteredCustomers, (c) => isNoteRecentlyUpdated(c, now)) && (
                  <p className="flex items-center gap-2 text-xs text-gray-500" data-testid="recent-note-legend">
                    <span aria-hidden="true" className="inline-block w-3 h-3 rounded-sm bg-green-100 border border-green-200" />
                    แถวสีเขียว = บันทึกลูกค้าถูกแก้ภายใน 12 ชั่วโมงที่ผ่านมา
                  </p>
                )}
              </div>

              {/* ── ค้นหาคำใน "บันทึกลูกค้า" ────────────────────────────────
                  A SECOND, separate search: it looks inside every customer's
                  note instead of filtering this list by name, and can replace
                  what it finds. Folded away until its button is pressed. */}
              {showNoteSearch && (
                <div id="customer-note-search">
                  <CustomerNoteSearchPanel
                    autoFocus
                    onToast={showToast}
                    onOpenCustomer={(customerId) => {
                      const target = customers.find((c) => c.id === customerId);
                      if (target) setViewingCustomer(target);
                      else showToast("ไม่พบลูกค้ารายนี้ในรายการแล้ว กรุณาโหลดหน้าใหม่", "error");
                    }}
                    // A replaced note changes what this list holds, so it is
                    // re-read rather than patched from the report.
                    onReplaced={fetchData}
                    onUnauthorized={() => router.replace("/login")}
                  />
                </div>
              )}

              <div className="overflow-x-auto">
                <table className="w-full text-left whitespace-nowrap">
                  <thead>
                    <tr className="bg-gray-50 text-gray-500 uppercase tracking-wider">
                      <SortableTh className={`${TH} rounded-l-xl`} dir={customerSort.key === "name" ? customerSort.dir : null} onSort={() => sortCustomersBy("name")}>ชื่อลูกค้า</SortableTh>
                      <SortableTh className={TH} dir={customerSort.key === "company" ? customerSort.dir : null} onSort={() => sortCustomersBy("company")}>บริษัท</SortableTh>
                      <th className={TH}>แผนก</th>
                      <th className={TH}>เบอร์โทร</th>
                      <SortableTh className={TH} dir={customerSort.key === "activity" ? customerSort.dir : null} onSort={() => sortCustomersBy("activity")}>บันทึกล่าสุด</SortableTh>
                      <th className={`${TH} text-right rounded-r-xl`}>จัดการ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {listStatus.customers === "error" ? (
                      <LoadErrorRow colSpan={6} message={LOAD_FAILED.customers} onRetry={retryLoad} />
                    ) : firstLoad("customers") ? (
                      Array.from({ length: 5 }).map((_, i) => (
                        <tr key={i} className="animate-pulse">
                          <td className={TD}><div className="h-5 bg-gray-200 rounded w-28 mb-1.5"></div><div className="h-3.5 bg-gray-200 rounded w-36"></div></td>
                          <td className={TD}><div className="h-5 bg-gray-200 rounded w-32"></div></td>
                          <td className={TD}><div className="h-5 bg-gray-200 rounded w-24"></div></td>
                          <td className={TD}><div className="h-5 bg-gray-200 rounded w-24"></div></td>
                          <td className={TD}><div className="h-5 bg-gray-200 rounded w-32"></div></td>
                          <td className={`${TD} text-right`}><div className="h-5 bg-gray-200 rounded w-12 ml-auto"></div></td>
                        </tr>
                      ))
                    ) : pagedCustomers.map(c => (
                      <tr
                        key={c.id}
                        tabIndex={0}
                        aria-label={`ดูข้อมูล ${c.name}`}
                        onClick={() => setViewingCustomer(c)}
                        onKeyDown={openOnKey(() => setViewingCustomer(c))}
                        // Note changed in the last 12 hours → pastel green
                        // (green-100; green-50 was near-invisible on a white table).
                        className={`${isNoteRecentlyUpdated(c, now) ? "bg-green-100 hover:bg-green-200/60" : "hover:bg-gray-50"} ${ROW_FOCUS} transition-colors group cursor-pointer`}
                      >
                        {/* No initial-letter avatar: most names start with
                            "คุณ", so nearly every circle read "ค". */}
                        <td className={TD}>
                          <p className="font-semibold text-gray-900">{c.name}</p>
                          {c.email && (
                            <CopyText value={c.email} onCopied={copied} onFailed={copyFailed} className="text-sm text-gray-500" />
                          )}
                        </td>
                        <td className={`${TD} text-gray-700 font-medium`}>{c.companyName || "-"}</td>
                        <td className={`${TD} text-gray-600`}>{c.department || "-"}</td>
                        <td className={`${TD} text-gray-600 tabular-nums`}>
                          <CopyText value={formatThaiPhone(c.phone)} onCopied={copied} onFailed={copyFailed} />
                        </td>
                        <td className={`${TD} text-gray-600 tabular-nums`} data-testid="customer-note-updated-at">
                          <NoteUpdatedAt value={customerNoteActivityAt(c)} />
                        </td>
                        <td className={TD}>
                          <RowActions
                            name={c.name}
                            onEdit={() => setCustomerForm(c)}
                            onDelete={() => setDeleteTarget({ kind: "customer", id: c.id, name: c.name })}
                          />
                        </td>
                      </tr>
                    ))}
                    {listStatus.customers === "ok" && filteredCustomers.length === 0 && (
                      <EmptyRows
                        colSpan={6}
                        searching={customerSearching}
                        emptyText="ยังไม่มีข้อมูลลูกค้า"
                        noMatchText="ไม่พบลูกค้าที่ตรงกับคำค้น"
                        onClear={() => { setSearchCustomerName(""); setCustomerPage(1); }}
                        icon={<svg className="w-12 h-12 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"></path></svg>}
                      />
                    )}
                  </tbody>
                </table>
              </div>
              {listStatus.customers === "ok" && (
                <Pagination
                  page={safeCustomerPage}
                  totalPages={customerTotalPages}
                  totalItems={filteredCustomers.length}
                  perPage={CUSTOMERS_PER_PAGE}
                  onPageChange={goToCustomerPage}
                  testId="customer-pagination"
                />
              )}
            </div>
          )}

          {activeTab === "salespeople" && (
            <div className="p-6">
              <div className="flex flex-wrap justify-between items-center gap-3 mb-5">
                <div className="flex items-center gap-3">
                  <div className="bg-orange-100 text-orange-600 p-2.5 rounded-xl">
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"></path></svg>
                  </div>
                  <h2 className="text-xl font-bold text-gray-800">
                    พนักงานขายทั้งหมด
                    {listStatus.salespeople === "ok" && (
                      <span className="text-gray-400 text-base font-normal tabular-nums" data-testid="salesperson-count">
                        {" "}({salespersonSearching ? `พบ ${filteredSalespeople.length.toLocaleString("th-TH")} จาก ${salespeople.length.toLocaleString("th-TH")}` : salespeople.length.toLocaleString("th-TH")})
                      </span>
                    )}
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => { setSalespersonForm({}); }}
                  className={PRIMARY_BUTTON}
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4"></path></svg>
                  เพิ่มพนักงานขาย
                </button>
              </div>

              <SearchBox
                className="mb-4 w-full md:max-w-md"
                label="ค้นหาพนักงานขาย"
                placeholder="ค้นหาชื่อ เบอร์โทร หรืออีเมล..."
                value={searchSalespersonName}
                onChange={setSearchSalespersonName}
              />

              <div className="overflow-x-auto">
                <table className="w-full text-left whitespace-nowrap">
                  <thead>
                    <tr className="bg-gray-50 text-gray-500 uppercase tracking-wider">
                      <SortableTh className={`${TH} rounded-l-xl`} dir={salespersonSort?.dir ?? null} onSort={() => setSalespersonSort((s) => nextSort(s, "name"))}>ชื่อพนักงานขาย</SortableTh>
                      <th className={TH}>เบอร์โทร</th>
                      <th className={TH}>อีเมล</th>
                      <th className={`${TH} text-right rounded-r-xl`}>จัดการ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {listStatus.salespeople === "error" ? (
                      <LoadErrorRow colSpan={4} message={LOAD_FAILED.salespeople} onRetry={retryLoad} />
                    ) : firstLoad("salespeople") ? (
                      Array.from({ length: 5 }).map((_, i) => (
                        <tr key={i} className="animate-pulse">
                          <td className={TD}><div className="h-5 bg-gray-200 rounded w-28"></div></td>
                          <td className={TD}><div className="h-5 bg-gray-200 rounded w-24"></div></td>
                          <td className={TD}><div className="h-5 bg-gray-200 rounded w-32"></div></td>
                          <td className={`${TD} text-right`}><div className="h-5 bg-gray-200 rounded w-12 ml-auto"></div></td>
                        </tr>
                      ))
                    ) : filteredSalespeople.map(s => (
                      <tr
                        key={s.id}
                        tabIndex={0}
                        aria-label={`ดูข้อมูล ${s.name}`}
                        onClick={() => setViewingSalesperson(s)}
                        onKeyDown={openOnKey(() => setViewingSalesperson(s))}
                        className={`hover:bg-gray-50 ${ROW_FOCUS} transition-colors group cursor-pointer`}
                      >
                        <td className={TD}>
                          <p className="font-semibold text-gray-900">{s.name}</p>
                        </td>
                        <td className={`${TD} text-gray-600 tabular-nums`}>
                          <CopyText value={formatThaiPhone(s.phone)} onCopied={copied} onFailed={copyFailed} />
                        </td>
                        <td className={`${TD} text-gray-600`}>
                          <CopyText value={s.email} onCopied={copied} onFailed={copyFailed} />
                        </td>
                        <td className={TD}>
                          <RowActions
                            name={s.name}
                            onEdit={() => setSalespersonForm(s)}
                            onDelete={() => setDeleteTarget({ kind: "salesperson", id: s.id, name: s.name })}
                          />
                        </td>
                      </tr>
                    ))}
                    {listStatus.salespeople === "ok" && filteredSalespeople.length === 0 && (
                      <EmptyRows
                        colSpan={4}
                        searching={salespersonSearching}
                        emptyText="ยังไม่มีข้อมูลพนักงานขาย"
                        noMatchText="ไม่พบพนักงานขายที่ตรงกับคำค้น"
                        onClear={() => setSearchSalespersonName("")}
                        icon={<svg className="w-12 h-12 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"></path></svg>}
                      />
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === "equipments" && (
            <EquipmentTab showToast={showToast} />
          )}
        </div>
      </div>

      {/* The read-only windows (./ViewWindows, CustomerDetailsModal). Each is
          a dialog: Esc and the backdrop close it, แก้ไข opens its form. All
          sit at z-100 — over the admin bell (z-90), which used to float on
          top of them and lead off the page when clicked. */}
      {viewingCompany && (
        <CompanyWindow
          company={viewingCompany}
          customers={customers}
          customersLoaded={customersLoaded}
          onClose={() => setViewingCompany(null)}
          onEdit={() => {
            const company = viewingCompany;
            setViewingCompany(null);
            setCompanyForm(company);
          }}
          onOpenCustomer={(customer) => {
            setViewingCompany(null);
            setViewingCustomer(customer);
          }}
          onAddCustomer={() => {
            const companyId = viewingCompany.id;
            setViewingCompany(null);
            setCustomerForm({ companyId });
          }}
          onCopied={copied}
          onCopyFailed={copyFailed}
        />
      )}

      {/* The customer's window — CustomerDetailsModal (spec:
          open-customer-profile-in-place), shared with /crm/alerts so it can
          open the exact same view without navigating here. */}
      {viewingCustomer && (
        <CustomerDetailsModal
          customer={viewingCustomer}
          onClose={() => setViewingCustomer(null)}
          onSaved={(updated) => {
            setViewingCustomer(updated);
            setCustomers((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
          }}
          showToast={showToast}
          onEdit={() => {
            const customer = viewingCustomer;
            setViewingCustomer(null);
            setCustomerForm(customer);
          }}
          onOpenCompany={
            companies.some((c) => c.id === viewingCustomer.companyId)
              ? () => {
                  const company = companies.find((c) => c.id === viewingCustomer.companyId);
                  setViewingCustomer(null);
                  if (company) setViewingCompany(company);
                }
              : undefined
          }
        />
      )}

      {viewingSalesperson && (
        <SalespersonWindow
          salesperson={viewingSalesperson}
          onClose={() => setViewingSalesperson(null)}
          onEdit={() => {
            const salesperson = viewingSalesperson;
            setViewingSalesperson(null);
            setSalespersonForm(salesperson);
          }}
          onCopied={copied}
          onCopyFailed={copyFailed}
        />
      )}

      {/* Add / edit forms (./EntityForms): each asks before throwing typing
          away, and saves once however often บันทึกข้อมูล is pressed. */}
      {companyForm && (
        <CompanyForm
          company={companyForm}
          companies={companies}
          onClose={() => setCompanyForm(null)}
          onSaved={onCompanySaved}
        />
      )}
      {customerForm && (
        <CustomerForm
          customer={customerForm}
          companies={companies}
          customers={customers}
          onClose={() => setCustomerForm(null)}
          onSaved={onCustomerSaved}
          onCompanyCreated={onCompanyCreated}
        />
      )}
      {salespersonForm && (
        <SalespersonForm
          salesperson={salespersonForm}
          salespeople={salespeople}
          onClose={() => setSalespersonForm(null)}
          onSaved={onSalespersonSaved}
        />
      )}

      {/* Delete: says what still points at the record, before ลบ. */}
      {deleteTarget && (
        <DeleteDialog
          key={`${deleteTarget.kind}:${deleteTarget.id}`}
          kind={deleteTarget.kind}
          id={deleteTarget.id}
          name={deleteTarget.name}
          onClose={() => setDeleteTarget(null)}
          onDeleted={onDeleted}
        />
      )}
    </div>
  );
}

export default function Customers() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center bg-[#F8FAFC]"><div className="w-8 h-8 border-4 border-orange-500 border-t-transparent rounded-full animate-spin"></div></div>}>
      <CustomersInner />
    </Suspense>
  );
}

"use client";
import { useState, useEffect, useRef, useMemo, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "../context/AuthContext";
import Toast from "../components/Toast";
import Link from "next/link";
import EquipmentTab from "./EquipmentTab";
import SearchableDropdown from "../components/SearchableDropdown";
// ค้นหา–แทนที่ใน "บันทึกลูกค้า" — an ADDITION to this tab, never a replacement.
// It owns its own data and its own network calls, and it does not touch the
// ชื่อลูกค้า/ชื่อบริษัท box below it, which still filters `filteredCustomers`
// exactly as it always has.
import CustomerNoteSearchPanel from "../components/CustomerNoteSearchPanel";
import Pagination from "../components/Pagination";
import SortableTh from "../components/SortableTh";
import CopyText from "../components/CopyText";
import { downloadExcel } from "../lib/xlsxExport";
import type { Customer } from "../lib/types";
import {
  customerNoteActivityAt,
  isNoteRecentlyUpdated,
} from "../lib/customerOrder";
import { displayDateTimeParts } from "../lib/dateFormat";
import {
  DEFAULT_CUSTOMER_SORT,
  anyRecentlyNoted,
  companyLocation,
  matchesCompanySearch,
  matchesCustomerSearch,
  nextSort,
  searchWithTab,
  sortByName,
  sortCompanies,
  sortCustomers,
  thCompare,
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
const SEARCH_INPUT =
  "bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 focus:bg-white focus:ring-2 focus:ring-orange-500 outline-none transition-all";
const PRIMARY_BUTTON =
  "bg-orange-500 hover:bg-orange-600 text-white px-5 py-2.5 rounded-xl font-medium transition-all shadow-sm hover:shadow-md flex items-center gap-2";
const SECONDARY_BUTTON =
  "bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 px-5 py-2.5 rounded-xl font-medium transition-all shadow-sm flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed";

/** Edit and delete for a row. Delete waits for the row to be hovered or
 *  focused — a red "ลบ" on every one of thousands of rows was one slip away. */
function RowActions({ name, onEdit, onDelete }: { name: string; onEdit: () => void; onDelete: () => void }) {
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  // Enter / Space are the button's own; any other key (Esc) still bubbles.
  const stopActivation = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") e.stopPropagation();
  };
  return (
    <div className="flex items-center justify-end gap-1">
      <button
        type="button"
        onClick={(e) => { stop(e); onEdit(); }}
        onKeyDown={stopActivation}
        aria-label={`แก้ไข ${name}`}
        title="แก้ไข"
        className="p-1.5 text-gray-400 hover:text-orange-600 hover:bg-orange-50 rounded-lg transition-colors"
      >
        <svg aria-hidden="true" className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
      </button>
      <button
        type="button"
        onClick={(e) => { stop(e); onDelete(); }}
        onKeyDown={stopActivation}
        aria-label={`ลบ ${name}`}
        title="ลบ"
        className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100"
      >
        <svg aria-hidden="true" className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
      </button>
    </div>
  );
}

/** Enter / Space on a FOCUSED row opens it — rows were mouse-only. A key
 *  pressed on a button inside the row is that button's. */
function openOnKey(open: () => void) {
  return (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      open();
    }
  };
}

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

interface Company {
  id: string;
  name: string;
  addressNo: string;
  moo: string;
  soi: string;
  road: string;
  subDistrict: string;
  district: string;
  province: string;
  postalCode: string;
  phone: string;
  note: string;
}

interface Salesperson {
  id: string;
  name: string;
  phone: string;
  email: string;
  note: string;
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
  // Whether `/api/customers` actually answered. A deep link that finds no
  // matching customer means two very different things depending on this, and an
  // empty list is not by itself proof of a failure (a fresh DB has none).
  const [customersLoaded, setCustomersLoaded] = useState(false);
  // Whether the lists have arrived at least once. The tab counts wait for it
  // (a "0" before then is a lie), but not for a REFETCH — every save reloads
  // the lists, and the counts blinking out each time was noise.
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  
  const [isCompanyModalOpen, setIsCompanyModalOpen] = useState(false);
  const [isCustomerModalOpen, setIsCustomerModalOpen] = useState(false);
  const [isSalespersonModalOpen, setIsSalespersonModalOpen] = useState(false);
  
  const [editingCompany, setEditingCompany] = useState<Partial<Company> | null>(null);
  const [editingCustomer, setEditingCustomer] = useState<Partial<Customer> | null>(null);
  const [editingSalesperson, setEditingSalesperson] = useState<Partial<Salesperson> | null>(null);
  
  const [viewingCompany, setViewingCompany] = useState<Company | null>(null);
  const [viewingCustomer, setViewingCustomer] = useState<Customer | null>(null);
  const [viewingSalesperson, setViewingSalesperson] = useState<Salesperson | null>(null);

  const [deleteConfirmCompany, setDeleteConfirmCompany] = useState<Company | null>(null);
  const [deleteConfirmCustomer, setDeleteConfirmCustomer] = useState<Customer | null>(null);
  const [deleteConfirmSalesperson, setDeleteConfirmSalesperson] = useState<Salesperson | null>(null);

  const [companySubmitAttempted, setCompanySubmitAttempted] = useState(false);
  const [customerSubmitAttempted, setCustomerSubmitAttempted] = useState(false);
  const [salespersonSubmitAttempted, setSalespersonSubmitAttempted] = useState(false);

  const [searchCustomerName, setSearchCustomerName] = useState("");
  // Whether the "ค้นหาคำในบันทึกลูกค้า" block is open. Closed by default: the
  // customers tab is a list, and a search-and-replace panel that is always
  // expanded above it would push that list off the screen for the many visits
  // that have nothing to do with notes.

  const [searchCompanyName, setSearchCompanyName] = useState("");
  const [searchProvince, setSearchProvince] = useState("");
  const [searchDistrict, setSearchDistrict] = useState("");
  const [searchSalespersonName, setSearchSalespersonName] = useState("");

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

  const fetchData = async () => {
    setIsLoadingData(true);
    try {
      const [compRes, custRes, salesRes] = await Promise.all([
        fetch("/api/companies"),
        fetch("/api/customers"),
        fetch("/api/salespeople")
      ]);
      if (compRes.ok) setCompanies(await compRes.json());
      if (custRes.ok) setCustomers(await custRes.json());
      setCustomersLoaded(custRes.ok);
      if (salesRes.ok) setSalespeople(await salesRes.json());
      if (!compRes.ok || !custRes.ok || !salesRes.ok) {
        showToast("โหลดข้อมูลบางส่วนไม่สำเร็จ กรุณาลองใหม่", "error");
      }
    } catch (err) {
      console.error(err);
      setCustomersLoaded(false);
      showToast("Error fetching data", "error");
    } finally {
      setIsLoadingData(false);
      setHasLoadedOnce(true);
    }
  };

  useEffect(() => {
    if (isLoggedIn) fetchData();
  }, [isLoggedIn]);

  // One timer at a time: a second toast (two copies in a row) used to be cut
  // short by the FIRST one's timer.
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = (message: string, type: "success" | "error") => {
    setToast({ message, type });
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 3000);
  };
  useEffect(() => () => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
  }, []);

  const handleSaveCompany = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCompany?.name || editingCompany.name.trim() === "") {
      showToast("กรุณากรอกชื่อบริษัท", "error");
      return;
    }
    if (editingCompany.name.length > 255) {
      showToast("ชื่อบริษัทต้องไม่เกิน 255 ตัวอักษร", "error");
      return;
    }
    if ((editingCompany.note || "").length > 2000) {
      showToast("หมายเหตุต้องไม่เกิน 2000 ตัวอักษร", "error");
      return;
    }

    try {
      const method = editingCompany.id ? "PUT" : "POST";
      const url = editingCompany.id ? `/api/companies/${editingCompany.id}` : "/api/companies";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editingCompany)
      });

      if (!res.ok) throw new Error("Failed to save");
      
      showToast("บันทึกข้อมูลบริษัทสำเร็จ", "success");
      setIsCompanyModalOpen(false);
      fetchData();
    } catch (err) {
      console.error(err);
      showToast("เกิดข้อผิดพลาดในการบันทึก", "error");
    }
  };

  const executeDeleteCompany = async () => {
    if (!deleteConfirmCompany) return;
    try {
      const res = await fetch(`/api/companies/${deleteConfirmCompany.id}`, { method: "DELETE" });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "Failed to delete");
      }
      showToast("ลบบริษัทสำเร็จ", "success");
      setDeleteConfirmCompany(null);
      fetchData();
    } catch (err: any) {
      showToast(err.message || "เกิดข้อผิดพลาดในการลบ", "error");
    }
  };

  const handleSaveCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCustomer?.name || editingCustomer.name.trim() === "" || !editingCustomer?.companyId) {
      // สังกัดบริษัท is a `SearchableDropdown`, not a native <select required>,
      // so the browser no longer blocks this submit or fires `onInvalid` when no
      // company is picked — this guard is the only thing standing between an
      // empty companyId and the API. Flipping `customerSubmitAttempted` here is
      // what `onInvalid` used to do: it is the flag both required fields read to
      // paint themselves red after a failed attempt.
      setCustomerSubmitAttempted(true);
      showToast("กรุณากรอกข้อมูลให้ครบถ้วน", "error");
      return;
    }
    if (editingCustomer.name.length > 255) {
      showToast("ชื่อลูกค้าต้องไม่เกิน 255 ตัวอักษร", "error");
      return;
    }
    if ((editingCustomer.note || "").length > 2000) {
      showToast("บันทึกลูกค้าต้องไม่เกิน 2000 ตัวอักษร", "error");
      return;
    }
    try {
      const method = editingCustomer.id ? "PUT" : "POST";
      const url = editingCustomer.id ? `/api/customers/${editingCustomer.id}` : "/api/customers";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editingCustomer)
      });

      if (!res.ok) throw new Error("Failed to save");
      
      showToast("บันทึกข้อมูลลูกค้าสำเร็จ", "success");
      setIsCustomerModalOpen(false);
      fetchData();
    } catch (err) {
      console.error(err);
      showToast("เกิดข้อผิดพลาดในการบันทึก", "error");
    }
  };

  const executeDeleteCustomer = async () => {
    if (!deleteConfirmCustomer) return;
    try {
      const res = await fetch(`/api/customers/${deleteConfirmCustomer.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete");
      showToast("ลบลูกค้าสำเร็จ", "success");
      setDeleteConfirmCustomer(null);
      fetchData();
    } catch (err) {
      showToast("เกิดข้อผิดพลาดในการลบ", "error");
    }
  };

  const handleSaveSalesperson = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingSalesperson?.name || editingSalesperson.name.trim() === "") {
      showToast("กรุณากรอกชื่อพนักงานขาย", "error");
      return;
    }
    if (editingSalesperson.name.length > 255) {
      showToast("ชื่อพนักงานขายต้องไม่เกิน 255 ตัวอักษร", "error");
      return;
    }
    
    try {
      const method = editingSalesperson.id ? "PUT" : "POST";
      const url = editingSalesperson.id ? `/api/salespeople/${editingSalesperson.id}` : "/api/salespeople";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editingSalesperson)
      });

      if (!res.ok) throw new Error("Failed to save");
      
      showToast("บันทึกข้อมูลพนักงานขายสำเร็จ", "success");
      setIsSalespersonModalOpen(false);
      fetchData();
    } catch (err) {
      console.error(err);
      showToast("เกิดข้อผิดพลาดในการบันทึก", "error");
    }
  };

  const executeDeleteSalesperson = async () => {
    if (!deleteConfirmSalesperson) return;
    try {
      const res = await fetch(`/api/salespeople/${deleteConfirmSalesperson.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete");
      showToast("ลบพนักงานขายสำเร็จ", "success");
      setDeleteConfirmSalesperson(null);
      fetchData();
    } catch (err) {
      showToast("เกิดข้อผิดพลาดในการลบ", "error");
    }
  };

  // Companies: filtered, sorted when a header is clicked (newest first, as the
  // API sends them, until then), and paged like customers — the whole list in
  // one table was thousands of rows.
  const [companySort, setCompanySort] = useState<SortState<CompanySortKey> | null>(null);
  const [companyPage, setCompanyPage] = useState(1);
  const filteredCompanies = useMemo(
    () =>
      sortCompanies(
        companies.filter((c) =>
          matchesCompanySearch(c, { name: searchCompanyName, province: searchProvince, district: searchDistrict })
        ),
        companySort
      ),
    [companies, searchCompanyName, searchProvince, searchDistrict, companySort]
  );
  const companyTotalPages = Math.max(1, Math.ceil(filteredCompanies.length / COMPANIES_PER_PAGE));
  const safeCompanyPage = Math.min(companyPage, companyTotalPages);
  const pagedCompanies = filteredCompanies.slice(
    (safeCompanyPage - 1) * COMPANIES_PER_PAGE,
    safeCompanyPage * COMPANIES_PER_PAGE
  );
  const companySearching = !!(searchCompanyName.trim() || searchProvince.trim() || searchDistrict.trim());

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
    salespeople.filter((s) => s.name.toLowerCase().includes(searchSalespersonName.trim().toLowerCase())),
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

      await downloadExcel("customers_export.xlsx", [
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

  if (isLoading || !isLoggedIn) return null;

  return (
    <div className="min-h-screen bg-[#F8FAFC] py-12 font-sans">
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
            <Link href="/adminpanel" className="px-5 py-2.5 bg-white border border-gray-200 text-gray-700 font-semibold rounded-xl hover:bg-gray-50 hover:shadow-sm transition-all flex items-center gap-2">
              <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"></path></svg>
              ไปที่หน้าระบบจัดการ
            </Link>
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
            { tab: "customers", label: "ลูกค้า", count: customers.length },
            { tab: "companies", label: "บริษัท", count: companies.length },
            { tab: "salespeople", label: "พนักงานขาย", count: salespeople.length },
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
              {count !== null && hasLoadedOnce && (
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
          id="customers-tabpanel"
          role="tabpanel"
          aria-labelledby={`customers-tab-${activeTab}`}
          className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden"
        >
          {activeTab === "companies" && (
            <div className="p-6">
              <div className="flex flex-wrap justify-between items-center gap-3 mb-5">
                <div className="flex items-center gap-3">
                  <div className="bg-orange-100 text-orange-600 p-2.5 rounded-xl">
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"></path></svg>
                  </div>
                  <h2 className="text-xl font-bold text-gray-800">บริษัททั้งหมด <span className="text-gray-400 text-base font-normal">({filteredCompanies.length})</span></h2>
                </div>
                <button
                  type="button"
                  onClick={() => { setEditingCompany({}); setCompanySubmitAttempted(false); setIsCompanyModalOpen(true); }}
                  className={PRIMARY_BUTTON}
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4"></path></svg>
                  เพิ่มบริษัท
                </button>
              </div>

              {/* Search Filters for Companies */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5">
                <input
                  type="text"
                  placeholder="ค้นหาชื่อบริษัท..."
                  className={SEARCH_INPUT}
                  value={searchCompanyName}
                  onChange={(e) => { setSearchCompanyName(e.target.value); setCompanyPage(1); }}
                />
                <input
                  type="text"
                  placeholder="ค้นหาจังหวัด..."
                  className={SEARCH_INPUT}
                  value={searchProvince}
                  onChange={(e) => { setSearchProvince(e.target.value); setCompanyPage(1); }}
                />
                <input
                  type="text"
                  placeholder="ค้นหาอำเภอ/เขต..."
                  className={SEARCH_INPUT}
                  value={searchDistrict}
                  onChange={(e) => { setSearchDistrict(e.target.value); setCompanyPage(1); }}
                />
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left whitespace-nowrap">
                  <thead>
                    <tr className="bg-gray-50 text-gray-500 uppercase tracking-wider">
                      <SortableTh className={`${TH} rounded-l-xl`} dir={companySort?.key === "name" ? companySort.dir : null} onSort={() => { setCompanySort((s) => nextSort(s, "name")); setCompanyPage(1); }}>ชื่อบริษัท</SortableTh>
                      {/* The province / district the search boxes above filter on —
                          it used to be searchable but nowhere to be seen. */}
                      <SortableTh className={TH} dir={companySort?.key === "location" ? companySort.dir : null} onSort={() => { setCompanySort((s) => nextSort(s, "location")); setCompanyPage(1); }}>อำเภอ / จังหวัด</SortableTh>
                      <th className={TH}>เบอร์โทร</th>
                      <th className={TH}>หมายเหตุ</th>
                      <th className={`${TH} text-right rounded-r-xl`}>จัดการ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {isLoadingData ? (
                      Array.from({ length: 5 }).map((_, i) => (
                        <tr key={i} className="animate-pulse">
                          <td className={TD}><div className="h-5 bg-gray-200 rounded w-40"></div></td>
                          <td className={TD}><div className="h-5 bg-gray-200 rounded w-32"></div></td>
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
                        <td className={`${TD} text-gray-600`}>
                          <CopyText value={c.phone} onCopied={copied} onFailed={copyFailed} />
                        </td>
                        <td className={TD}>
                          <p className="text-gray-500 text-sm truncate max-w-xs">{c.note || "-"}</p>
                        </td>
                        <td className={TD}>
                          <RowActions
                            name={c.name}
                            onEdit={() => { setEditingCompany(c); setCompanySubmitAttempted(false); setIsCompanyModalOpen(true); }}
                            onDelete={() => setDeleteConfirmCompany(c)}
                          />
                        </td>
                      </tr>
                    ))}
                    {!isLoadingData && filteredCompanies.length === 0 && (
                      <EmptyRows
                        colSpan={5}
                        searching={companySearching}
                        emptyText="ยังไม่มีข้อมูลบริษัท"
                        noMatchText="ไม่พบบริษัทที่ตรงกับคำค้น"
                        onClear={() => { setSearchCompanyName(""); setSearchProvince(""); setSearchDistrict(""); setCompanyPage(1); }}
                        icon={<svg className="w-12 h-12 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"></path></svg>}
                      />
                    )}
                  </tbody>
                </table>
              </div>
              {!isLoadingData && (
                <Pagination
                  page={safeCompanyPage}
                  totalPages={companyTotalPages}
                  totalItems={filteredCompanies.length}
                  perPage={COMPANIES_PER_PAGE}
                  onPageChange={setCompanyPage}
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
                  <h2 className="text-xl font-bold text-gray-800">ลูกค้าทั้งหมด <span className="text-gray-400 text-base font-normal">({filteredCustomers.length})</span></h2>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={handleExportCustomers}
                    disabled={isExportingCustomers}
                    className={SECONDARY_BUTTON}
                  >
                    {isExportingCustomers ? (
                      <div className="w-5 h-5 border-2 border-gray-500 border-t-transparent rounded-full animate-spin"></div>
                    ) : (
                      <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
                    )}
                    Export
                  </button>
                  <button
                    type="button"
                    onClick={() => { setEditingCustomer({}); setCustomerSubmitAttempted(false); setIsCustomerModalOpen(true); }}
                    className={PRIMARY_BUTTON}
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4"></path></svg>
                    เพิ่มลูกค้า
                  </button>
                </div>
              </div>

              {/* ── ค้นหาคำใน "บันทึกลูกค้า" ────────────────────────────────
                  A SECOND, separate search: it looks inside every customer's
                  note instead of filtering this list by name. It is collapsed
                  until asked for, and the ชื่อลูกค้า/ชื่อบริษัท box below is
                  untouched by it. */}
                <CustomerNoteSearchPanel
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

              {/* Search Filters for Customers — name, company, phone or e-mail. */}
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <input
                  type="text"
                  placeholder="ค้นหาชื่อลูกค้า บริษัท เบอร์โทร หรืออีเมล..."
                  className={`w-full md:w-1/2 lg:w-2/5 ${SEARCH_INPUT}`}
                  value={searchCustomerName}
                  onChange={(e) => {
                    setSearchCustomerName(e.target.value);
                    setCustomerPage(1);
                  }}
                />
                {/* What a green row means — it was never said anywhere. */}
                {!isLoadingData && anyRecentlyNoted(filteredCustomers, (c) => isNoteRecentlyUpdated(c, now)) && (
                  <p className="flex items-center gap-2 text-xs text-gray-500" data-testid="recent-note-legend">
                    <span aria-hidden="true" className="inline-block w-3 h-3 rounded-sm bg-green-100 border border-green-200" />
                    แถวสีเขียว = บันทึกลูกค้าถูกแก้ภายใน 12 ชั่วโมงที่ผ่านมา
                  </p>
                )}
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left whitespace-nowrap">
                  <thead>
                    <tr className="bg-gray-50 text-gray-500 uppercase tracking-wider">
                      <SortableTh className={`${TH} rounded-l-xl`} dir={customerSort.key === "name" ? customerSort.dir : null} onSort={() => sortCustomersBy("name")}>ชื่อลูกค้า</SortableTh>
                      <SortableTh className={TH} dir={customerSort.key === "company" ? customerSort.dir : null} onSort={() => sortCustomersBy("company")}>บริษัท</SortableTh>
                      <th className={TH}>แผนก</th>
                      <th className={TH}>เบอร์โทร</th>
                      <SortableTh className={TH} dir={customerSort.key === "activity" ? customerSort.dir : null} onSort={() => sortCustomersBy("activity")}>อัปเดตล่าสุด</SortableTh>
                      <th className={`${TH} text-right rounded-r-xl`}>จัดการ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {isLoadingData ? (
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
                        <td className={`${TD} text-gray-600`}>
                          <CopyText value={c.phone} onCopied={copied} onFailed={copyFailed} />
                        </td>
                        <td className={`${TD} text-gray-600 tabular-nums`} data-testid="customer-note-updated-at">
                          <NoteUpdatedAt value={customerNoteActivityAt(c)} />
                        </td>
                        <td className={TD}>
                          <RowActions
                            name={c.name}
                            onEdit={() => { setEditingCustomer(c); setCustomerSubmitAttempted(false); setIsCustomerModalOpen(true); }}
                            onDelete={() => setDeleteConfirmCustomer(c)}
                          />
                        </td>
                      </tr>
                    ))}
                    {!isLoadingData && filteredCustomers.length === 0 && (
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
              {!isLoadingData && (
                <Pagination
                  page={safeCustomerPage}
                  totalPages={customerTotalPages}
                  totalItems={filteredCustomers.length}
                  perPage={CUSTOMERS_PER_PAGE}
                  onPageChange={setCustomerPage}
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
                  <h2 className="text-xl font-bold text-gray-800">พนักงานขายทั้งหมด <span className="text-gray-400 text-base font-normal">({filteredSalespeople.length})</span></h2>
                </div>
                <button
                  type="button"
                  onClick={() => { setEditingSalesperson({}); setSalespersonSubmitAttempted(false); setIsSalespersonModalOpen(true); }}
                  className={PRIMARY_BUTTON}
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4"></path></svg>
                  เพิ่มพนักงานขาย
                </button>
              </div>

              {/* Search Filters for Salespeople */}
              <div className="mb-4">
                <input
                  type="text"
                  placeholder="ค้นหาชื่อพนักงานขาย..."
                  className={`w-full md:w-1/3 ${SEARCH_INPUT}`}
                  value={searchSalespersonName}
                  onChange={(e) => setSearchSalespersonName(e.target.value)}
                />
              </div>

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
                    {isLoadingData ? (
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
                        <td className={`${TD} text-gray-600`}>
                          <CopyText value={s.phone} onCopied={copied} onFailed={copyFailed} />
                        </td>
                        <td className={`${TD} text-gray-600`}>
                          <CopyText value={s.email} onCopied={copied} onFailed={copyFailed} />
                        </td>
                        <td className={TD}>
                          <RowActions
                            name={s.name}
                            onEdit={() => { setEditingSalesperson(s); setSalespersonSubmitAttempted(false); setIsSalespersonModalOpen(true); }}
                            onDelete={() => setDeleteConfirmSalesperson(s)}
                          />
                        </td>
                      </tr>
                    ))}
                    {!isLoadingData && filteredSalespeople.length === 0 && (
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

      {/* Viewing Company Modal */}
      {viewingCompany && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-gray-900/40 backdrop-blur-sm" onClick={() => setViewingCompany(null)}></div>
          <div className="relative bg-white rounded-3xl shadow-2xl max-w-xl w-full max-h-[90vh] overflow-y-auto p-8 transform transition-all">
            <div className="absolute top-0 right-0 p-4">
              <button type="button" aria-label="ปิด" onClick={() => setViewingCompany(null)} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
              </button>
            </div>
            <div className="flex items-center gap-4 mb-6">
              <div className="w-16 h-16 bg-orange-100 text-orange-600 rounded-2xl flex items-center justify-center shrink-0">
                <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"></path></svg>
              </div>
              <div>
                <h2 className="text-2xl font-bold text-gray-900">{viewingCompany.name}</h2>
                <p className="text-gray-500">ข้อมูลบริษัท</p>
              </div>
            </div>
            
            <div className="space-y-6">
              <div className="bg-gray-50 rounded-2xl p-5 border border-gray-100">
                <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">รายละเอียดที่อยู่</h3>
                <p className="text-gray-800 leading-relaxed">
                  {viewingCompany.addressNo ? `เลขที่ ${viewingCompany.addressNo} ` : ""}
                  {viewingCompany.moo ? `หมู่ ${viewingCompany.moo} ` : ""}
                  {viewingCompany.soi ? `ซอย ${viewingCompany.soi} ` : ""}
                  {viewingCompany.road ? `ถนน ${viewingCompany.road} ` : ""}
                  <br/>
                  {viewingCompany.subDistrict ? `ตำบล/แขวง ${viewingCompany.subDistrict} ` : ""}
                  {viewingCompany.district ? `อำเภอ/เขต ${viewingCompany.district} ` : ""}
                  <br/>
                  {viewingCompany.province ? `จังหวัด ${viewingCompany.province} ` : ""}
                  {viewingCompany.postalCode ? `${viewingCompany.postalCode}` : ""}
                  {!viewingCompany.addressNo && !viewingCompany.province && <span className="text-gray-400 italic">ไม่มีข้อมูลที่อยู่</span>}
                </p>
              </div>
              
              <div className="bg-gray-50 rounded-2xl p-5 border border-gray-100">
                <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-1">เบอร์โทรศัพท์</h3>
                <p className="text-gray-800 font-medium">
                  <CopyText value={viewingCompany.phone} onCopied={copied} onFailed={copyFailed} />
                </p>
              </div>

              {viewingCompany.note && (
                <div className="bg-orange-50 rounded-2xl p-5 border border-orange-100">
                  <h3 className="text-sm font-semibold text-orange-400 uppercase tracking-wider mb-2">หมายเหตุ</h3>
                  <p className="text-orange-900">{viewingCompany.note}</p>
                </div>
              )}

              {/* The company's contacts — from the customer list this page
                  already holds, so no extra request. Each opens that
                  customer's own window. (A hard-coded "สถานะ: Active" box sat
                  here before; nothing ever set it.) */}
              {(() => {
                const contacts = customers
                  .filter((c) => c.companyId === viewingCompany.id)
                  .sort((a, b) => thCompare(a.name, b.name));
                return (
                  <div className="rounded-2xl border border-gray-100 p-5" data-testid="company-contacts">
                    <div className="flex items-center justify-between gap-3 mb-3">
                      <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">
                        ลูกค้าในบริษัทนี้ <span className="text-gray-500 normal-case">({contacts.length})</span>
                      </h3>
                      <button
                        type="button"
                        onClick={() => {
                          const companyId = viewingCompany.id;
                          setViewingCompany(null);
                          setEditingCustomer({ companyId });
                          setCustomerSubmitAttempted(false);
                          setIsCustomerModalOpen(true);
                        }}
                        className="text-sm font-semibold text-orange-600 hover:text-orange-700"
                      >
                        + เพิ่มลูกค้าในบริษัทนี้
                      </button>
                    </div>
                    {contacts.length === 0 ? (
                      <p className="text-sm text-gray-400">ยังไม่มีลูกค้าในบริษัทนี้</p>
                    ) : (
                      <ul className="max-h-56 overflow-y-auto divide-y divide-gray-50 -mx-2">
                        {contacts.map((c) => (
                          <li key={c.id}>
                            <button
                              type="button"
                              onClick={() => { setViewingCompany(null); setViewingCustomer(c); }}
                              className="w-full text-left flex items-center justify-between gap-3 px-2 py-2 rounded-lg hover:bg-gray-50"
                            >
                              <span className="min-w-0">
                                <span className="block font-medium text-gray-900 truncate">{c.name}</span>
                                {c.department && <span className="block text-xs text-gray-500 truncate">{c.department}</span>}
                              </span>
                              <span className="shrink-0 text-sm text-gray-500 tabular-nums">{c.phone || ""}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* Viewing Customer Modal — extracted to CustomerDetailsModal (spec:
          open-customer-profile-in-place) so /crm/alerts can open the exact
          same view without navigating here. */}
      {viewingCustomer && (
        <CustomerDetailsModal
          customer={viewingCustomer}
          onClose={() => setViewingCustomer(null)}
          onSaved={(updated) => {
            setViewingCustomer(updated);
            setCustomers((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
          }}
          showToast={showToast}
        />
      )}

      {/* Viewing Salesperson Modal */}
      {viewingSalesperson && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-gray-900/40 backdrop-blur-sm" onClick={() => setViewingSalesperson(null)}></div>
          <div className="relative bg-white rounded-3xl shadow-2xl max-w-xl w-full p-8 overflow-hidden transform transition-all">
            <div className="absolute top-0 right-0 p-4">
              <button type="button" aria-label="ปิด" onClick={() => setViewingSalesperson(null)} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
              </button>
            </div>
            <div className="flex items-center gap-5 mb-8">
              {/* An icon, not the name's first letter ("ค" for every "คุณ…"). */}
              <div className="w-16 h-16 bg-orange-100 text-orange-600 rounded-2xl flex items-center justify-center shrink-0">
                <svg aria-hidden="true" className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"></path></svg>
              </div>
              <div>
                <h2 className="text-2xl font-bold text-gray-900">{viewingSalesperson.name}</h2>
                <p className="text-orange-600 font-medium">พนักงานขาย</p>
              </div>
            </div>
            
            <div className="space-y-4">
              <div className="flex items-center p-4 bg-gray-50 rounded-2xl border border-gray-100">
                <div className="p-2 bg-white rounded-xl shadow-sm mr-4 text-gray-400">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"></path></svg>
                </div>
                <div>
                  <p className="text-xs font-semibold text-gray-400 uppercase">อีเมล</p>
                  <p className="text-gray-900 font-medium"><CopyText value={viewingSalesperson.email} onCopied={copied} onFailed={copyFailed} /></p>
                </div>
              </div>
              
              <div className="flex items-center p-4 bg-gray-50 rounded-2xl border border-gray-100">
                <div className="p-2 bg-white rounded-xl shadow-sm mr-4 text-gray-400">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"></path></svg>
                </div>
                <div>
                  <p className="text-xs font-semibold text-gray-400 uppercase">เบอร์โทรศัพท์</p>
                  <p className="text-gray-900 font-medium"><CopyText value={viewingSalesperson.phone} onCopied={copied} onFailed={copyFailed} /></p>
                </div>
              </div>

              {viewingSalesperson.note && (
                <div className="bg-orange-50 rounded-2xl p-5 border border-orange-100 mt-4">
                  <h3 className="text-sm font-semibold text-orange-400 uppercase tracking-wider mb-2">หมายเหตุ</h3>
                  <p className="text-orange-900">{viewingSalesperson.note}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Editing Company Form Modal */}
      {isCompanyModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-gray-900/40 backdrop-blur-sm" onClick={() => setIsCompanyModalOpen(false)}></div>
          <div className="relative bg-white rounded-3xl shadow-2xl max-w-3xl w-full max-h-[90vh] flex flex-col overflow-hidden">
            <div className="px-8 py-6 border-b border-gray-100 flex justify-between items-center bg-white z-10">
              <h2 className="text-2xl font-bold text-gray-800">{editingCompany?.id ? "แก้ไขข้อมูลบริษัท" : "เพิ่มบริษัทใหม่"}</h2>
              <button onClick={() => setIsCompanyModalOpen(false)} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
              </button>
            </div>
            
            <div className="overflow-y-auto flex-1 p-8">
              <form id="company-form" onSubmit={handleSaveCompany} onInvalid={() => setCompanySubmitAttempted(true)} className="space-y-6">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">ชื่อบริษัท <span className="text-red-500">*</span></label>
                  <input required type="text" className={`w-full bg-gray-50 border rounded-xl px-4 py-3 outline-none transition-all focus:bg-white focus:ring-2 ${companySubmitAttempted ? 'invalid:border-red-500 invalid:ring-red-500 invalid:bg-red-50 border-gray-200 focus:border-transparent focus:ring-orange-500 focus:invalid:border-red-500 focus:invalid:ring-red-500' : 'border-gray-200 focus:border-transparent focus:ring-orange-500'}`} placeholder="บริษัท เอบีซี จำกัด" value={editingCompany?.name || ""} onChange={e => setEditingCompany({...editingCompany, name: e.target.value})} />
                </div>
                
                <div className="bg-gray-50/50 p-6 rounded-2xl border border-gray-100 space-y-4">
                  <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-4">ข้อมูลที่อยู่</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-2">เลขที่/อาคาร</label>
                      <input type="text" className="w-full bg-white border border-gray-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-orange-500 outline-none transition-all" value={editingCompany?.addressNo || ""} onChange={e => setEditingCompany({...editingCompany, addressNo: e.target.value})} />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-2">หมู่</label>
                      <input type="text" className="w-full bg-white border border-gray-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-orange-500 outline-none transition-all" value={editingCompany?.moo || ""} onChange={e => setEditingCompany({...editingCompany, moo: e.target.value})} />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-2">ซอย</label>
                      <input type="text" className="w-full bg-white border border-gray-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-orange-500 outline-none transition-all" value={editingCompany?.soi || ""} onChange={e => setEditingCompany({...editingCompany, soi: e.target.value})} />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-2">ถนน</label>
                      <input type="text" className="w-full bg-white border border-gray-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-orange-500 outline-none transition-all" value={editingCompany?.road || ""} onChange={e => setEditingCompany({...editingCompany, road: e.target.value})} />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-2">ตำบล/แขวง</label>
                      <input type="text" className="w-full bg-white border border-gray-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-orange-500 outline-none transition-all" value={editingCompany?.subDistrict || ""} onChange={e => setEditingCompany({...editingCompany, subDistrict: e.target.value})} />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-2">อำเภอ/เขต</label>
                      <input type="text" className="w-full bg-white border border-gray-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-orange-500 outline-none transition-all" value={editingCompany?.district || ""} onChange={e => setEditingCompany({...editingCompany, district: e.target.value})} />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-2">จังหวัด</label>
                      <input type="text" className="w-full bg-white border border-gray-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-orange-500 outline-none transition-all" value={editingCompany?.province || ""} onChange={e => setEditingCompany({...editingCompany, province: e.target.value})} />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-2">รหัสไปรษณีย์</label>
                      <input type="text" className="w-full bg-white border border-gray-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-orange-500 outline-none transition-all" value={editingCompany?.postalCode || ""} onChange={e => setEditingCompany({...editingCompany, postalCode: e.target.value})} />
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">เบอร์โทรศัพท์</label>
                  <input type="tel" pattern="[0-9]*" className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 focus:bg-white focus:ring-2 focus:ring-orange-500 outline-none transition-all" value={editingCompany?.phone || ""} onChange={e => setEditingCompany({...editingCompany, phone: e.target.value.replace(/\D/g, "")})} />
                </div>
                
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">หมายเหตุ</label>
                  <textarea rows={2} className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 focus:bg-white focus:ring-2 focus:ring-orange-500 outline-none transition-all resize-none" placeholder="ข้อมูลเพิ่มเติม..." value={editingCompany?.note || ""} onChange={e => setEditingCompany({...editingCompany, note: e.target.value})}></textarea>
                </div>
              </form>
            </div>
            
            <div className="px-8 py-5 border-t border-gray-100 bg-gray-50/50 flex justify-end gap-3 z-10">
              <button type="button" onClick={() => setIsCompanyModalOpen(false)} className="px-6 py-2.5 font-semibold text-gray-600 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 transition-all shadow-sm">ยกเลิก</button>
              <button type="submit" form="company-form" className="px-6 py-2.5 bg-orange-500 text-white font-semibold rounded-xl hover:bg-orange-600 transition-all shadow-sm hover:shadow-md">บันทึกข้อมูล</button>
            </div>
          </div>
        </div>
      )}

      {/* Editing Customer Form Modal */}
      {isCustomerModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-gray-900/40 backdrop-blur-sm" onClick={() => setIsCustomerModalOpen(false)}></div>
          <div className="relative bg-white rounded-3xl shadow-2xl max-w-xl w-full flex flex-col overflow-hidden">
            <div className="px-8 py-5 border-b border-gray-100 flex justify-between items-center bg-white z-10">
              <h2 className="text-2xl font-bold text-gray-800">{editingCustomer?.id ? "แก้ไขข้อมูลลูกค้า" : "เพิ่มลูกค้าใหม่"}</h2>
              <button onClick={() => setIsCustomerModalOpen(false)} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
              </button>
            </div>
            
            <div className="overflow-y-auto flex-1 px-8 py-6">
              <form id="customer-form" onSubmit={handleSaveCustomer} onInvalid={() => setCustomerSubmitAttempted(true)} className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div className="md:col-span-2">
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">ชื่อ-นามสกุล <span className="text-red-500">*</span></label>
                  <input required type="text" className={`w-full bg-gray-50 border rounded-xl px-4 py-2.5 outline-none transition-all focus:bg-white focus:ring-2 ${customerSubmitAttempted ? 'invalid:border-red-500 invalid:ring-red-500 invalid:bg-red-50 border-gray-200 focus:border-transparent focus:ring-orange-500 focus:invalid:border-red-500 focus:invalid:ring-red-500' : 'border-gray-200 focus:border-transparent focus:ring-orange-500'}`} placeholder="สมหญิง ใจดี" value={editingCustomer?.name || ""} onChange={e => setEditingCustomer({...editingCustomer, name: e.target.value})} />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">สังกัดบริษัท <span className="text-red-500">*</span></label>
                  {/* Every dropdown in this project is `SearchableDropdown`,
                      never a native <select> — the OS paints a native one, so on
                      a dark-mode machine it opens as a dark grey popup in the
                      middle of this white form. Two things the native control
                      used to hand us for free are replaced by hand here:
                      • `required` + `invalid:` styling. SearchableDropdown joins
                        neither native form validation nor `:invalid`, so the red
                        state is now an explicit check on the SAME state the form
                        already tracks (`customerSubmitAttempted`, set by the
                        form's `onInvalid` and now also by `handleSaveCustomer`
                        when it rejects a submit), and the block on submitting
                        without a company is `handleSaveCustomer`'s own guard.
                      • The chevron: the inline background-image data-URI is gone
                        because the component draws its own.
                      The list of companies can be long, so the search box stays.
                      Portaling the panel to <body> also means this modal can no
                      longer clip it. */}
                  <SearchableDropdown
                    value={editingCustomer?.companyId || ""}
                    onChange={value => setEditingCustomer({...editingCustomer, companyId: value})}
                    placeholder="-- เลือกบริษัท --"
                    options={companies.map(c => ({ value: c.id, label: c.name }))}
                    buttonClassName={`h-[46px] rounded-xl px-4 py-2.5 !text-base transition-all outline-none focus:ring-2 ${customerSubmitAttempted && !editingCustomer?.companyId ? '!border-red-500 !bg-red-50 focus:border-transparent focus:ring-red-500' : '!border-gray-200 !bg-gray-50 focus:border-transparent focus:ring-orange-500'}`}
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">แผนก</label>
                  <input type="text" className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 focus:bg-white focus:ring-2 focus:ring-orange-500 outline-none transition-all" placeholder="เช่น บัญชี, การตลาด" value={editingCustomer?.department || ""} onChange={e => setEditingCustomer({...editingCustomer, department: e.target.value})} />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">เบอร์โทรศัพท์</label>
                  <input type="tel" pattern="[0-9]*" className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 focus:bg-white focus:ring-2 focus:ring-orange-500 outline-none transition-all" placeholder="08XXXXXXXX" value={editingCustomer?.phone || ""} onChange={e => setEditingCustomer({...editingCustomer, phone: e.target.value.replace(/\D/g, "")})} />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">อีเมล</label>
                  <input type="email" className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 focus:bg-white focus:ring-2 focus:ring-orange-500 outline-none transition-all" placeholder="example@email.com" value={editingCustomer?.email || ""} onChange={e => setEditingCustomer({...editingCustomer, email: e.target.value})} />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">บันทึกลูกค้า</label>
                  <textarea rows={2} className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 focus:bg-white focus:ring-2 focus:ring-orange-500 outline-none transition-all resize-none" placeholder="บันทึกลูกค้า..." value={editingCustomer?.note || ""} onChange={e => setEditingCustomer({...editingCustomer, note: e.target.value})}></textarea>
                </div>
              </form>
            </div>
            
            <div className="px-8 py-5 border-t border-gray-100 bg-gray-50/50 flex justify-end gap-3 z-10">
              <button type="button" onClick={() => setIsCustomerModalOpen(false)} className="px-6 py-2.5 font-semibold text-gray-600 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 transition-all shadow-sm">ยกเลิก</button>
              <button type="submit" form="customer-form" className="px-6 py-2.5 bg-orange-500 text-white font-semibold rounded-xl hover:bg-orange-600 transition-all shadow-sm hover:shadow-md">บันทึกข้อมูล</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Company Confirmation Modal */}
      {deleteConfirmCompany && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-gray-900/40 backdrop-blur-sm" onClick={() => setDeleteConfirmCompany(null)}></div>
          <div className="relative bg-white rounded-3xl shadow-2xl max-w-sm w-full p-6 text-center transform transition-all scale-100 opacity-100">
            {(() => {
              const linkedCustomers = customers.filter(c => c.companyId === deleteConfirmCompany.id);
              if (linkedCustomers.length > 0) {
                return (
                  <>
                    <div className="w-16 h-16 bg-orange-100 text-orange-500 rounded-full flex items-center justify-center mx-auto mb-4">
                      <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
                    </div>
                    <h3 className="text-xl font-bold text-gray-900 mb-2">ไม่สามารถลบบริษัทได้</h3>
                    <p className="text-gray-500 mb-6">บริษัท <strong>{deleteConfirmCompany.name}</strong> ยังมีลูกค้าระบุสังกัดอยู่จำนวน {linkedCustomers.length} ราย กรุณาลบหรือย้ายสังกัดลูกค้าก่อนทำการลบบริษัท</p>
                    <div className="flex justify-center">
                      <button onClick={() => setDeleteConfirmCompany(null)} className="px-5 py-2.5 bg-gray-900 hover:bg-gray-800 text-white font-semibold rounded-xl transition-colors shadow-sm w-full">ตกลง</button>
                    </div>
                  </>
                );
              }
              return (
                <>
                  <div className="w-16 h-16 bg-red-100 text-red-500 rounded-full flex items-center justify-center mx-auto mb-4">
                    <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                  </div>
                  <h3 className="text-xl font-bold text-gray-900 mb-2">ยืนยันการลบบริษัท</h3>
                  <p className="text-gray-500 mb-6">คุณแน่ใจหรือไม่ที่จะลบ <strong>{deleteConfirmCompany.name}</strong>? การลบนี้ไม่สามารถกู้คืนได้</p>
                  <div className="flex gap-3 justify-center">
                    <button onClick={() => setDeleteConfirmCompany(null)} className="px-5 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-800 font-semibold rounded-xl transition-colors flex-1">ยกเลิก</button>
                    <button onClick={executeDeleteCompany} className="px-5 py-2.5 bg-red-500 hover:bg-red-600 text-white font-semibold rounded-xl transition-colors shadow-sm hover:shadow-md flex-1">ลบข้อมูล</button>
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      )}

      {/* Delete Customer Confirmation Modal */}
      {deleteConfirmCustomer && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-gray-900/40 backdrop-blur-sm" onClick={() => setDeleteConfirmCustomer(null)}></div>
          <div className="relative bg-white rounded-3xl shadow-2xl max-w-sm w-full p-6 text-center transform transition-all scale-100 opacity-100">
            <div className="w-16 h-16 bg-red-100 text-red-500 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
            </div>
            <h3 className="text-xl font-bold text-gray-900 mb-2">ยืนยันการลบลูกค้า</h3>
            <p className="text-gray-500 mb-6">คุณแน่ใจหรือไม่ที่จะลบ <strong>{deleteConfirmCustomer.name}</strong>? ข้อมูลจะถูกลบอย่างถาวรและไม่สามารถกู้คืนได้</p>
            <div className="flex gap-3 justify-center">
              <button onClick={() => setDeleteConfirmCustomer(null)} className="px-5 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-800 font-semibold rounded-xl transition-colors">ยกเลิก</button>
              <button onClick={executeDeleteCustomer} className="px-5 py-2.5 bg-red-500 hover:bg-red-600 text-white font-semibold rounded-xl transition-colors shadow-sm hover:shadow-md">ลบข้อมูล</button>
            </div>
          </div>
        </div>
      )}

      {/* Editing Salesperson Form Modal */}
      {isSalespersonModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-gray-900/40 backdrop-blur-sm" onClick={() => setIsSalespersonModalOpen(false)}></div>
          <div className="relative bg-white rounded-3xl shadow-2xl max-w-xl w-full flex flex-col overflow-hidden">
            <div className="px-8 py-5 border-b border-gray-100 flex justify-between items-center bg-white z-10">
              <h2 className="text-2xl font-bold text-gray-800">{editingSalesperson?.id ? "แก้ไขข้อมูลพนักงานขาย" : "เพิ่มพนักงานขายใหม่"}</h2>
              <button onClick={() => setIsSalespersonModalOpen(false)} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
              </button>
            </div>
            
            <div className="overflow-y-auto flex-1 px-8 py-6">
              <form id="salesperson-form" onSubmit={handleSaveSalesperson} onInvalid={() => setSalespersonSubmitAttempted(true)} className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div className="md:col-span-2">
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">ชื่อ-นามสกุล <span className="text-red-500">*</span></label>
                  <input required type="text" className={`w-full bg-gray-50 border rounded-xl px-4 py-2.5 outline-none transition-all focus:bg-white focus:ring-2 ${salespersonSubmitAttempted ? 'invalid:border-red-500 invalid:ring-red-500 invalid:bg-red-50 border-gray-200 focus:border-transparent focus:ring-orange-500 focus:invalid:border-red-500 focus:invalid:ring-red-500' : 'border-gray-200 focus:border-transparent focus:ring-orange-500'}`} placeholder="สมชาย ยอดขาย" value={editingSalesperson?.name || ""} onChange={e => setEditingSalesperson({...editingSalesperson, name: e.target.value})} />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">เบอร์โทรศัพท์</label>
                  <input type="tel" pattern="[0-9]*" className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 focus:bg-white focus:ring-2 focus:ring-orange-500 outline-none transition-all" placeholder="08XXXXXXXX" value={editingSalesperson?.phone || ""} onChange={e => setEditingSalesperson({...editingSalesperson, phone: e.target.value.replace(/\D/g, "")})} />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">อีเมล</label>
                  <input type="email" className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 focus:bg-white focus:ring-2 focus:ring-orange-500 outline-none transition-all" placeholder="example@email.com" value={editingSalesperson?.email || ""} onChange={e => setEditingSalesperson({...editingSalesperson, email: e.target.value})} />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">หมายเหตุ</label>
                  <textarea rows={2} className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 focus:bg-white focus:ring-2 focus:ring-orange-500 outline-none transition-all resize-none" placeholder="ข้อมูลเพิ่มเติม..." value={editingSalesperson?.note || ""} onChange={e => setEditingSalesperson({...editingSalesperson, note: e.target.value})}></textarea>
                </div>
              </form>
            </div>
            
            <div className="px-8 py-5 border-t border-gray-100 bg-gray-50/50 flex justify-end gap-3 z-10">
              <button type="button" onClick={() => setIsSalespersonModalOpen(false)} className="px-6 py-2.5 font-semibold text-gray-600 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 transition-all shadow-sm">ยกเลิก</button>
              <button type="submit" form="salesperson-form" className="px-6 py-2.5 bg-orange-500 text-white font-semibold rounded-xl hover:bg-orange-600 transition-all shadow-sm hover:shadow-md">บันทึกข้อมูล</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Salesperson Confirmation Modal */}
      {deleteConfirmSalesperson && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-gray-900/40 backdrop-blur-sm" onClick={() => setDeleteConfirmSalesperson(null)}></div>
          <div className="relative bg-white rounded-3xl shadow-2xl max-w-sm w-full p-6 text-center transform transition-all scale-100 opacity-100">
            <div className="w-16 h-16 bg-red-100 text-red-500 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
            </div>
            <h3 className="text-xl font-bold text-gray-900 mb-2">ยืนยันการลบพนักงานขาย</h3>
            <p className="text-gray-500 mb-6">คุณแน่ใจหรือไม่ที่จะลบ <strong>{deleteConfirmSalesperson.name}</strong>? ข้อมูลจะถูกลบอย่างถาวรและไม่สามารถกู้คืนได้</p>
            <div className="flex gap-3 justify-center">
              <button onClick={() => setDeleteConfirmSalesperson(null)} className="px-5 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-800 font-semibold rounded-xl transition-colors">ยกเลิก</button>
              <button onClick={executeDeleteSalesperson} className="px-5 py-2.5 bg-red-500 hover:bg-red-600 text-white font-semibold rounded-xl transition-colors shadow-sm hover:shadow-md">ลบข้อมูล</button>
            </div>
          </div>
        </div>
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

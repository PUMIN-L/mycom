"use client";

/**
 * QuotationPickerSection — the "อ้างอิงใบเสนอราคา" block of the sale form
 * (`app/dashboard/page.tsx`). Tasks 10.1-10.6, 11.1-11.7, 13.1-13.2.
 *
 * What it owns
 * ------------
 *  • the searchable quotation dropdown + the free-text `quotationRef` input
 *  • the two-stage fetch: `GET /api/quotations` (summaries) on mount, then
 *    `GET /api/quotations/[id]` (+ `/sold`) for the ONE quotation that is picked
 *  • the customer / company dropdowns, their auto-fill markers and the inline
 *    "สร้างลูกค้าใหม่" / "สร้างบริษัทใหม่" forms
 *  • the advisory "ใบนี้บันทึกขายไปแล้ว X/Y รายการ" banner
 *
 * What it does NOT own: the product line editor. It hands the loaded quotation
 * up through `onQuotationSelect` (items + the `/sold` rows) and the line editor
 * decides what to pre-tick — see `buildLineDrafts` in `app/lib/quotationToSale`.
 *
 * Contract with the sale form (all of it is controlled — this component keeps
 * no copy of the form's data, only its own fetch/UI state):
 *
 *   quotationId      "" = nothing picked. Free text alone is a valid state.
 *   quotationRef     the free-text reference; always editable (task 10.3).
 *   customerId       `form.customerId`  — auto-filled here, edited here.
 *   companyId        `form.companyId`   — same.
 *   customers        the `/api/customers` rows the form already loaded.
 *   companies        the `/api/companies` rows the form already loaded.
 *   linesDirty       true once the admin has touched the product lines; makes
 *                    changing quotation ask for confirmation first (task 10.6).
 *   disabled         true while the form is saving.
 *
 *   onQuotationRefChange(ref)     the free-text input changed.
 *   onQuotationSelect(selection)  a quotation finished loading — or `null` when
 *                                 the link was cleared. The parent stores
 *                                 `quotationId` + `quotationRef` (task 10.4) and
 *                                 rebuilds its line drafts from `items`/`sold`.
 *   onCustomerChange(id)          id, or "" when the field must be left blank.
 *   onCompanyChange(id)           same.
 *   onCustomerCreated(customer)   a row was just created inline — append it to
 *   onCompanyCreated(company)     the lookup list (this component also keeps its
 *                                 own copy, so forgetting to is not fatal).
 *
 * Non-negotiables baked in here:
 *  • NOTHING in this section can block a save. Every fetch failure degrades to
 *    a message plus hand-entry (tasks 10.5, 13.1).
 *  • A quotation is never picked for the admin: 0 or several name matches leave
 *    the field blank and say why (tasks 11.4, 11.5).
 *  • Creating a customer/company happens in place — never by navigating away —
 *    so everything already typed into the sale form survives (task 11.6).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import SearchableDropdown from "./SearchableDropdown";
import type { SearchableDropdownOption } from "./SearchableDropdown";
import ConfirmDialog from "./ConfirmDialog";
import {
  AUTOFILL_MARKER,
  buildLineDrafts,
  describeNameMatch,
  resolveAutoFill,
  summarizeSoldLines,
  type AutoFillResult,
  type QuotationLine,
  type SoldQuotationLine,
} from "../lib/quotationToSale";

// ── Public types ────────────────────────────────────────────────────────────

/** One row of `GET /api/quotations` (a `QuotationSummary`). `total` is optional
 * because a row rebuilt from a fetched record does not carry the list's total. */
export interface QuotationSummaryOption {
  id: string;
  docNo: string;
  customer?: string;
  total?: number;
  createdAt?: string;
}

/** Structurally a subset of the sale form's `Customer`, so its array passes
 * straight in. Only `id`/`name` are used for matching; the rest is shown so two
 * people with the same name can be told apart (spec: ชื่อซ้ำกันได้). */
export interface CustomerOption {
  id: string;
  name: string;
  companyId?: string;
  companyName?: string;
  department?: string;
  phone?: string;
}

/** Same idea for `Company`. */
export interface CompanyOption {
  id: string;
  name: string;
  phone?: string;
  district?: string;
  province?: string;
}

/** The quotation `data` blob (`QuoteState` in `app/quotation/page.tsx`). Only
 * the keys this section reads are named; the whole object is passed upward. */
export interface QuotationData {
  items?: QuotationLine[];
  customerContact?: string;
  customerCompany?: string;
  /** Present only on quotations saved after task 14 (D7). */
  customerId?: string;
  companyId?: string;
  warrantyTerms?: string;
  [key: string]: unknown;
}

/** Everything the line editor needs, handed up in one piece. */
export interface QuotationSelection {
  quotationId: string;
  /** docNo — the parent stores this as `quotationRef` (task 10.4). */
  quotationRef: string;
  data: QuotationData;
  items: QuotationLine[];
  /** `items` of `GET /api/quotations/[id]/sold`; `[]` when that call failed. */
  sold: SoldQuotationLine[];
  /** The already-sold banner text, or null (task 13.1). */
  soldMessage: string | null;
  /** Reference text for the warranty inputs (task 12.9). */
  warrantyTerms: string;
}

export interface QuotationPickerSectionProps {
  quotationId: string;
  quotationRef: string;
  customerId: string;
  companyId: string;
  customers: readonly CustomerOption[];
  companies: readonly CompanyOption[];
  linesDirty?: boolean;
  disabled?: boolean;
  onQuotationRefChange: (ref: string) => void;
  onQuotationSelect: (selection: QuotationSelection | null) => void;
  onCustomerChange: (customerId: string) => void;
  onCompanyChange: (companyId: string) => void;
  onCustomerCreated?: (customer: CustomerOption) => void;
  onCompanyCreated?: (company: CompanyOption) => void;
}

// ── Local helpers ───────────────────────────────────────────────────────────

/** Rows fetched per list call. The store's own cap is 2000; asking for a page
 * this size and searching in SQL is what keeps an 18-month-old quotation
 * findable now that retention is 2 years (task 8.3 / spec). */
const LIST_LIMIT = 100;
const SEARCH_DEBOUNCE_MS = 300;

/** Value of the non-selectable row the dropdown shows for fetch state. The
 * panel no longer filters locally (it would blank mid-typing), so anything it
 * has to say about the list has to travel as a disabled option. */
const STATUS_OPTION_VALUE = "__quotation-list-status__";

const fmtMoney = (n: unknown) =>
  Number(n || 0).toLocaleString("th-TH", { maximumFractionDigits: 0 });

function fmtDate(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("th-TH");
}

/** `fetch` + JSON, throwing on any non-2xx so callers only handle one failure
 * shape. Every caller here turns that throw into a message, never a blocked
 * save. */
async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string"
        ? (body as { error: string }).error
        : "";
    throw new Error(message);
  }
  return body as T;
}

const inputClass =
  "w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm bg-white focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 outline-none disabled:bg-gray-50 disabled:text-gray-400";
const labelClass = "block text-sm font-semibold text-gray-700 mb-1.5";

/** The "เติมจากใบเสนอราคา — กรุณาตรวจสอบ" chip (tasks 11.3, 11.7). */
function AutoFillMarker() {
  return (
    <span className="inline-flex items-center gap-1 mt-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[11px] font-semibold">
      ✎ {AUTOFILL_MARKER}
    </span>
  );
}

type CreateTarget = "customer" | "company" | null;
type LoadStatus = "idle" | "loading" | "ready" | "error";

/**
 * A field the system could not resolve is cleared only when clearing it cannot
 * destroy the admin's own work: it was empty, or it still holds the value a
 * previous auto-fill put there. A customer the admin picked by hand before
 * choosing the quotation stays put — the "ไม่พบ…" note is shown next to it
 * instead of overwriting their choice with a blank.
 */
function clearableValue(current: string, previousAutoFill: string, touched: boolean): boolean {
  return current === "" || (!touched && current === previousAutoFill);
}

// ── Component ───────────────────────────────────────────────────────────────

export default function QuotationPickerSection({
  quotationId,
  quotationRef,
  customerId,
  companyId,
  customers,
  companies,
  linesDirty = false,
  disabled = false,
  onQuotationRefChange,
  onQuotationSelect,
  onCustomerChange,
  onCompanyChange,
  onCustomerCreated,
  onCompanyCreated,
}: QuotationPickerSectionProps) {
  // Summary list (stage 1). The result carries the request key it answers, so
  // "loading" is DERIVED from "the answer I hold is not for the question I am
  // asking" instead of being set synchronously inside the effect.
  const [search, setSearch] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [reloadToken, setReloadToken] = useState(0);
  const [listResult, setListResult] = useState<{
    key: string;
    status: "ready" | "error";
    rows: QuotationSummaryOption[];
  }>({ key: "", status: "ready", rows: [] });
  const listSeq = useRef(0);
  const listKey = `${reloadToken}|${searchTerm}`;
  const listStatus: LoadStatus = listResult.key === listKey ? listResult.status : "loading";
  const summaries = listResult.rows;

  // Full record (stage 2)
  const [pickedSummary, setPickedSummary] = useState<QuotationSummaryOption | null>(null);
  const [recordStatus, setRecordStatus] = useState<LoadStatus>("idle");
  const [recordError, setRecordError] = useState("");
  const [pendingId, setPendingId] = useState("");
  const [soldMessage, setSoldMessage] = useState<string | null>(null);
  const recordSeq = useRef(0);

  // Auto-fill (task 11)
  const [autoCustomer, setAutoCustomer] = useState<AutoFillResult<CustomerOption> | null>(null);
  const [autoCompany, setAutoCompany] = useState<AutoFillResult<CompanyOption> | null>(null);
  const [autoFilledCustomerId, setAutoFilledCustomerId] = useState("");
  const [autoFilledCompanyId, setAutoFilledCompanyId] = useState("");
  const [customerTouched, setCustomerTouched] = useState(false);
  const [companyTouched, setCompanyTouched] = useState(false);

  // Rows created inline here (task 11.6). Kept locally as well as pushed up, so
  // the new row is selectable the instant it exists even if the parent's lookup
  // list has not been refreshed yet.
  const [newCustomers, setNewCustomers] = useState<CustomerOption[]>([]);
  const [newCompanies, setNewCompanies] = useState<CompanyOption[]>([]);
  const [createTarget, setCreateTarget] = useState<CreateTarget>(null);
  const [createName, setCreateName] = useState("");
  const [createPhone, setCreatePhone] = useState("");
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState("");

  // Task 10.6 — the quotation the admin asked to switch to, held until they
  // confirm discarding the line edits they already made.
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const allCustomers = useMemo(
    () => [...newCustomers, ...customers],
    [newCustomers, customers]
  );
  const allCompanies = useMemo(
    () => [...newCompanies, ...companies],
    [newCompanies, companies]
  );

  // ── Stage 1: the summary list, searched server-side ───────────────────────
  useEffect(() => {
    const handle = setTimeout(() => setSearchTerm(search.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [search]);

  useEffect(() => {
    const seq = ++listSeq.current;
    const controller = new AbortController();
    const key = `${reloadToken}|${searchTerm}`;
    const url =
      `/api/quotations?limit=${LIST_LIMIT}` +
      (searchTerm ? `&search=${encodeURIComponent(searchTerm)}` : "");
    fetchJson<QuotationSummaryOption[]>(url, { signal: controller.signal })
      .then((rows) => {
        if (seq !== listSeq.current) return;
        setListResult({ key, status: "ready", rows: Array.isArray(rows) ? rows : [] });
      })
      .catch(() => {
        // An aborted request is this effect superseding itself, not a failure.
        if (seq !== listSeq.current || controller.signal.aborted) return;
        // Keep whatever rows were already on screen — a failed refresh must not
        // empty a list the admin was using (task 10.5).
        setListResult((prev) => ({ key, status: "error", rows: prev.rows }));
      });
    return () => controller.abort();
  }, [searchTerm, reloadToken]);

  // Reopening a saved sale: the linked quotation's label comes from the list as
  // soon as it contains that row — derived, so no second fetch and no effect.
  const selectedSummary =
    pickedSummary ??
    (quotationId ? summaries.find((q) => q.id === quotationId) ?? null : null);

  /** The state line shown inside the panel, right under its search box. Empty
   * when the list on screen is simply the answer to what was typed. */
  const listStatusLabel = useMemo(() => {
    if (listStatus === "loading") return "กำลังค้นหา...";
    if (listStatus === "error") return "โหลดรายการไม่สำเร็จ — พิมพ์เลขที่เองด้านล่างได้";
    if (summaries.length === 0) {
      return searchTerm ? `ไม่พบใบเสนอราคาที่ตรงกับ «${searchTerm}»` : "ยังไม่มีใบเสนอราคาในระบบ";
    }
    if (summaries.length >= LIST_LIMIT) {
      return `แสดง ${LIST_LIMIT} ใบแรก — พิมพ์ค้นหาเพื่อหาใบที่ต้องการ`;
    }
    return "";
  }, [listStatus, searchTerm, summaries.length]);

  const options = useMemo<SearchableDropdownOption[]>(() => {
    const rows = summaries.slice();
    // A search narrows the list; the quotation already linked must stay
    // visible (and keep its label) even when it falls outside the results.
    if (selectedSummary && !rows.some((q) => q.id === selectedSummary.id)) {
      rows.unshift(selectedSummary);
    }
    return [
      { value: "", label: "— ไม่อ้างอิงใบเสนอราคา (พิมพ์เลขที่เอง) —" },
      // Kept at the top so it is readable without scrolling a full page of
      // still-visible results: while a new search is in flight the rows below
      // are the previous answer, and this line says so.
      ...(listStatusLabel
        ? [{ value: STATUS_OPTION_VALUE, label: listStatusLabel, disabled: true }]
        : []),
      ...rows.map((q) => {
        const total = typeof q.total === "number" ? ` (${fmtMoney(q.total)} บาท)` : "";
        const created = fmtDate(q.createdAt);
        return {
          value: q.id,
          label: `${q.docNo || "(ไม่มีเลขที่)"} — ${q.customer || "-"}${total}`,
          subLabel: created ? `ออกเมื่อ ${created}` : undefined,
        };
      }),
    ];
  }, [summaries, selectedSummary, listStatusLabel]);

  // ── Auto-fill (tasks 11.1-11.5) ───────────────────────────────────────────

  const applyAutoFill = useCallback(
    (data: QuotationData) => {
      const customer = resolveAutoFill<CustomerOption>({
        id: data.customerId,
        name: data.customerContact,
        list: allCustomers,
      });
      const company = resolveAutoFill<CompanyOption>({
        id: data.companyId,
        name: data.customerCompany,
        list: allCompanies,
      });

      setAutoCustomer(customer);
      setAutoCompany(company);
      setCustomerTouched(false);
      setCompanyTouched(false);

      if (customer.selectedId) {
        setAutoFilledCustomerId(customer.selectedId);
        onCustomerChange(customer.selectedId);
      } else {
        setAutoFilledCustomerId("");
        if (clearableValue(customerId, autoFilledCustomerId, customerTouched)) {
          onCustomerChange("");
        }
      }

      if (company.selectedId) {
        setAutoFilledCompanyId(company.selectedId);
        onCompanyChange(company.selectedId);
      } else {
        setAutoFilledCompanyId("");
        if (clearableValue(companyId, autoFilledCompanyId, companyTouched)) {
          onCompanyChange("");
        }
      }
    },
    [
      allCustomers,
      allCompanies,
      autoFilledCustomerId,
      autoFilledCompanyId,
      companyId,
      companyTouched,
      customerId,
      customerTouched,
      onCompanyChange,
      onCustomerChange,
    ]
  );

  const resetAutoFill = useCallback(() => {
    setAutoCustomer(null);
    setAutoCompany(null);
    setAutoFilledCustomerId("");
    setAutoFilledCompanyId("");
    setCustomerTouched(false);
    setCompanyTouched(false);
  }, []);

  // ── Stage 2: the full record + the advisory /sold lookup ──────────────────
  const loadQuotation = useCallback(
    async (id: string) => {
      const seq = ++recordSeq.current;
      setPendingId(id);
      setRecordStatus("loading");
      setRecordError("");

      const [recordResult, soldResult] = await Promise.allSettled([
        fetchJson<{ id?: string; docNo?: string; data?: unknown }>(
          `/api/quotations/${encodeURIComponent(id)}`
        ),
        fetchJson<{ items?: SoldQuotationLine[] }>(
          `/api/quotations/${encodeURIComponent(id)}/sold`
        ),
      ]);
      if (seq !== recordSeq.current) return; // a newer pick already won
      setPendingId("");

      if (recordResult.status !== "fulfilled" || !recordResult.value) {
        // Task 10.5 / spec "โหลดเรกคอร์ดเต็มไม่สำเร็จ": say so, change nothing
        // else. Whatever the admin already typed stays, and the save button is
        // untouched.
        setRecordStatus("error");
        setRecordError("ไม่สามารถโหลดข้อมูลใบเสนอราคาได้ — กรอกข้อมูลเองแล้วบันทึกได้ตามปกติ");
        return;
      }

      const record = recordResult.value;
      const data = (record.data ?? {}) as QuotationData;
      const items: QuotationLine[] = Array.isArray(data.items) ? data.items : [];
      // Tasks 13.1/13.2: advisory only. A failed /sold means "nothing known to
      // be sold" — no banner, no pre-tick change, and never a blocked save.
      const sold: SoldQuotationLine[] =
        soldResult.status === "fulfilled" && Array.isArray(soldResult.value?.items)
          ? soldResult.value.items
          : [];
      const message = summarizeSoldLines(buildLineDrafts({ items, sold })).message;
      const docNo = String(record.docNo ?? "").trim();

      setRecordStatus("ready");
      setSoldMessage(message);
      setPickedSummary((prev) =>
        prev && prev.id === id
          ? { ...prev, docNo }
          : {
              id,
              docNo,
              customer: data.customerCompany || data.customerContact || "-",
            }
      );

      onQuotationSelect({
        quotationId: id,
        quotationRef: docNo,
        data,
        items,
        sold,
        soldMessage: message,
        warrantyTerms: String(data.warrantyTerms ?? ""),
      });
      applyAutoFill(data);
    },
    [applyAutoFill, onQuotationSelect]
  );

  const applySelect = useCallback(
    (nextId: string) => {
      if (!nextId) {
        recordSeq.current += 1; // cancel any in-flight load
        setPendingId("");
        setPickedSummary(null);
        setRecordStatus("idle");
        setRecordError("");
        setSoldMessage(null);
        resetAutoFill();
        onQuotationSelect(null);
        return;
      }
      const hit = summaries.find((q) => q.id === nextId);
      if (hit) setPickedSummary(hit);
      void loadQuotation(nextId);
    },
    [loadQuotation, onQuotationSelect, resetAutoFill, summaries]
  );

  const currentId = pendingId || quotationId || selectedSummary?.id || "";

  /** Task 10.6 — swapping quotations throws away the line edits the admin has
   * already made, so ask first. Nothing is fetched until they confirm. */
  const requestSelect = (nextId: string) => {
    if (nextId === STATUS_OPTION_VALUE) return; // the disabled state row
    if (nextId === currentId) return;
    if (linesDirty) {
      setConfirmId(nextId);
      return;
    }
    applySelect(nextId);
  };

  // ── Customer / company selection by hand (task 11.7) ──────────────────────
  const selectCustomer = (id: string) => {
    setCustomerTouched(true);
    onCustomerChange(id);
    // Same rule the sale form already uses: a customer carries its company.
    const picked = allCustomers.find((c) => c.id === id);
    if (picked?.companyId && picked.companyId !== companyId) {
      setCompanyTouched(true);
      onCompanyChange(picked.companyId);
    }
  };

  const selectCompany = (id: string) => {
    setCompanyTouched(true);
    onCompanyChange(id);
  };

  const openCreate = (target: Exclude<CreateTarget, null>) => {
    setCreateTarget(target);
    setCreateName(
      (target === "customer" ? autoCustomer?.query : autoCompany?.query) || ""
    );
    setCreatePhone("");
    setCreateError("");
  };

  /**
   * Task 11.6 — create the row over the API and select it, all without leaving
   * the form: this is a POST and two state updates, never a navigation, so
   * every other field the admin has filled in survives untouched.
   */
  const submitCreate = async () => {
    if (!createTarget || createBusy) return;
    const name = createName.trim();
    if (!name) {
      setCreateError("กรุณากรอกชื่อ");
      return;
    }
    // `POST /api/customers` requires a company — surfaced in Thai here rather
    // than as a 400 from the API.
    if (createTarget === "customer" && !companyId) {
      setCreateError("กรุณาเลือกบริษัทก่อน จึงจะสร้างลูกค้าใหม่ได้");
      return;
    }
    const phone = createPhone.trim();
    setCreateBusy(true);
    setCreateError("");
    try {
      const url = createTarget === "customer" ? "/api/customers" : "/api/companies";
      const payload =
        createTarget === "customer" ? { name, companyId, phone } : { name, phone };
      const created = await fetchJson<{ id?: string }>(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const id = String(created?.id ?? "").trim();
      if (!id) throw new Error();

      if (createTarget === "customer") {
        const row: CustomerOption = {
          id,
          name,
          companyId,
          companyName: allCompanies.find((c) => c.id === companyId)?.name,
          phone,
        };
        setNewCustomers((prev) => [row, ...prev]);
        onCustomerCreated?.(row);
        setCustomerTouched(true);
        onCustomerChange(id);
      } else {
        const row: CompanyOption = { id, name, phone };
        setNewCompanies((prev) => [row, ...prev]);
        onCompanyCreated?.(row);
        setCompanyTouched(true);
        onCompanyChange(id);
      }
      setCreateTarget(null);
      setCreateName("");
      setCreatePhone("");
    } catch (err) {
      const fallback =
        createTarget === "customer" ? "สร้างลูกค้าใหม่ไม่สำเร็จ" : "สร้างบริษัทใหม่ไม่สำเร็จ";
      const detail = err instanceof Error ? err.message : "";
      setCreateError(detail ? `${fallback} (${detail})` : fallback);
    } finally {
      setCreateBusy(false);
    }
  };

  // ── Derived UI bits ───────────────────────────────────────────────────────
  const customerOptions = useMemo<SearchableDropdownOption[]>(
    () => [
      { value: "", label: "— ไม่ระบุลูกค้า —" },
      ...allCustomers.map((c) => ({
        value: c.id,
        label: c.name || "(ไม่มีชื่อ)",
        subLabel: [c.companyName, c.department, c.phone].filter(Boolean).join(" · ") || undefined,
      })),
    ],
    [allCustomers]
  );

  const companyOptions = useMemo<SearchableDropdownOption[]>(
    () => [
      { value: "", label: "— ไม่ระบุบริษัท —" },
      ...allCompanies.map((c) => ({
        value: c.id,
        label: c.name || "(ไม่มีชื่อ)",
        subLabel: [c.phone, c.district, c.province].filter(Boolean).join(" · ") || undefined,
      })),
    ],
    [allCompanies]
  );

  const showCustomerMarker =
    !!autoFilledCustomerId && customerId === autoFilledCustomerId && !customerTouched;
  const showCompanyMarker =
    !!autoFilledCompanyId && companyId === autoFilledCompanyId && !companyTouched;

  const customerNote = autoCustomer ? describeNameMatch(autoCustomer, "ลูกค้า") : null;
  const companyNote = autoCompany ? describeNameMatch(autoCompany, "บริษัท") : null;

  const linkedDocNo = selectedSummary?.docNo || "";
  const refDiffersFromLink =
    !!linkedDocNo && !!quotationRef.trim() && quotationRef.trim() !== linkedDocNo;

  return (
    <div className="border border-dashed border-indigo-300 rounded-xl bg-indigo-50/40 p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h4 className="text-sm font-bold text-indigo-800">📄 อ้างอิงใบเสนอราคา</h4>
        {recordStatus === "loading" && (
          <span className="text-xs font-semibold text-indigo-600 animate-pulse">
            กำลังโหลดข้อมูลใบเสนอราคา...
          </span>
        )}
      </div>

      {/* One search box, and it is the dropdown's own (report 1). Typing in it
          drives the server's ?search= rather than sifting the page already
          fetched — with 2 years of retention the list outgrows one page, so a
          local-only filter would hide older quotations entirely. The panel's
          local filter is therefore switched off (`filterOptions={false}`): the
          rows it is handed are already the answer, and re-filtering them by the
          text typed so far would blank the list between keystrokes. */}
      <div>
        <label className={labelClass}>ใบเสนอราคา</label>
        <SearchableDropdown
          options={options}
          value={currentId}
          onChange={requestSelect}
          onSearchChange={setSearch}
          filterOptions={false}
          placeholder="เลือกใบเสนอราคา..."
          buttonClassName={`py-2.5 rounded-xl border-gray-200 ${disabled ? "pointer-events-none opacity-60" : ""}`}
        />
        {/* Repeated below the closed dropdown, where the panel's own status row
            is not visible. The retry lives here for the same reason. */}
        {listStatus === "loading" && (
          <p className="text-xs text-gray-500 mt-1 animate-pulse">กำลังโหลดรายการใบเสนอราคา...</p>
        )}
        {listStatus === "error" && (
          <p className="text-xs text-amber-700 mt-1 flex items-center gap-2">
            โหลดรายการใบเสนอราคาไม่สำเร็จ — พิมพ์เลขที่ใบเสนอราคาเองด้านล่างแล้วบันทึกได้ตามปกติ
            <button
              type="button"
              onClick={() => setReloadToken((n) => n + 1)}
              className="px-2 py-0.5 rounded-md border border-amber-300 bg-white font-semibold hover:bg-amber-50"
            >
              ลองใหม่
            </button>
          </p>
        )}
        {listStatus === "ready" && summaries.length === 0 && searchTerm && (
          <p className="text-xs text-gray-500 mt-1">ไม่พบใบเสนอราคาที่ตรงกับ «{searchTerm}»</p>
        )}
        <p className="text-xs text-gray-500 mt-1">
          กดเลือกแล้วพิมพ์ในช่องค้นหาของรายการ — ค้นเลขที่เอกสาร หรือชื่อลูกค้า/บริษัท
          จากใบเสนอราคาทั้งหมดในระบบ (เก็บย้อนหลัง 2 ปี)
        </p>
      </div>

      {/* Task 13.1 — advisory banner only. */}
      {soldMessage && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 font-semibold">
          ⚠️ {soldMessage} — ระบบติ๊กให้เฉพาะรายการที่ยังไม่เคยขาย ติ๊กรายการที่ขายแล้วได้แต่จะถามยืนยันก่อนบันทึก
        </div>
      )}

      {recordStatus === "error" && recordError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {recordError}
        </div>
      )}

      {/* Task 10.3 — the escape hatch. Always editable, with or without a link. */}
      <div>
        <label className={labelClass} htmlFor="quotation-ref">
          เลขที่ใบเสนอราคา
        </label>
        <input
          id="quotation-ref"
          type="text"
          value={quotationRef}
          onChange={(e) => onQuotationRefChange(e.target.value)}
          disabled={disabled}
          placeholder="เลขที่ใบเสนอราคา (พิมพ์เองได้)"
          className={inputClass}
        />
        {linkedDocNo ? (
          <p className="text-xs text-emerald-700 mt-1">✅ เชื่อมกับใบ {linkedDocNo}</p>
        ) : (
          <p className="text-xs text-gray-500 mt-1">
            ไม่เลือกจากรายการก็ได้ — พิมพ์เลขที่เองแล้วบันทึกการขายได้ตามปกติ
          </p>
        )}
        {refDiffersFromLink && (
          <p className="text-xs text-amber-700 mt-1">
            เลขที่ที่พิมพ์ไม่ตรงกับใบที่เชื่อม ({linkedDocNo}) — ระบบจะบันทึกตามที่พิมพ์
          </p>
        )}
      </div>

      {/* ── Customer / company (task 11) ─────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
        <div>
          <label className={labelClass}>ลูกค้า</label>
          <SearchableDropdown
            options={customerOptions}
            value={customerId}
            onChange={selectCustomer}
            placeholder="เลือกลูกค้า..."
            buttonClassName={`py-2.5 rounded-xl border-gray-200 ${disabled ? "pointer-events-none opacity-60" : ""}`}
          />
          {showCustomerMarker && <AutoFillMarker />}
          {customerNote && (
            <p className="text-xs text-amber-700 mt-1">{customerNote}</p>
          )}
          {autoCustomer?.status === "ambiguous" && (
            <div className="mt-1 space-y-1">
              {autoCustomer.matches.slice(0, 5).map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => selectCustomer(c.id)}
                  disabled={disabled}
                  className="block w-full text-left px-2 py-1 rounded-md border border-gray-200 bg-white text-xs text-gray-700 hover:bg-indigo-50"
                >
                  {c.name}
                  {[c.companyName, c.department, c.phone].filter(Boolean).length > 0 && (
                    <span className="text-gray-500">
                      {" "}
                      · {[c.companyName, c.department, c.phone].filter(Boolean).join(" · ")}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
          {autoCustomer && autoCustomer.status !== "matched" && (
            <button
              type="button"
              onClick={() => openCreate("customer")}
              disabled={disabled}
              className="mt-1 text-xs font-semibold text-indigo-600 hover:text-indigo-800"
            >
              + สร้างลูกค้าใหม่
            </button>
          )}
        </div>

        <div>
          <label className={labelClass}>บริษัท</label>
          <SearchableDropdown
            options={companyOptions}
            value={companyId}
            onChange={selectCompany}
            placeholder="เลือกบริษัท..."
            buttonClassName={`py-2.5 rounded-xl border-gray-200 ${disabled ? "pointer-events-none opacity-60" : ""}`}
          />
          {showCompanyMarker && <AutoFillMarker />}
          {companyNote && <p className="text-xs text-amber-700 mt-1">{companyNote}</p>}
          {autoCompany?.status === "ambiguous" && (
            <div className="mt-1 space-y-1">
              {autoCompany.matches.slice(0, 5).map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => selectCompany(c.id)}
                  disabled={disabled}
                  className="block w-full text-left px-2 py-1 rounded-md border border-gray-200 bg-white text-xs text-gray-700 hover:bg-indigo-50"
                >
                  {c.name}
                  {[c.phone, c.district, c.province].filter(Boolean).length > 0 && (
                    <span className="text-gray-500">
                      {" "}
                      · {[c.phone, c.district, c.province].filter(Boolean).join(" · ")}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
          {autoCompany && autoCompany.status !== "matched" && (
            <button
              type="button"
              onClick={() => openCreate("company")}
              disabled={disabled}
              className="mt-1 text-xs font-semibold text-indigo-600 hover:text-indigo-800"
            >
              + สร้างบริษัทใหม่
            </button>
          )}
        </div>
      </div>

      {/* Inline create form (task 11.6) — in place, never a navigation. */}
      {createTarget && (
        <div className="rounded-xl border border-indigo-200 bg-white p-3 space-y-2">
          <p className="text-sm font-bold text-gray-800">
            {createTarget === "customer" ? "สร้างลูกค้าใหม่" : "สร้างบริษัทใหม่"}
          </p>
          <input
            type="text"
            value={createName}
            onChange={(e) => setCreateName(e.target.value)}
            placeholder={createTarget === "customer" ? "ชื่อผู้ติดต่อ" : "ชื่อบริษัท"}
            className={inputClass}
            disabled={createBusy}
          />
          <input
            type="text"
            value={createPhone}
            onChange={(e) => setCreatePhone(e.target.value)}
            placeholder="เบอร์โทร (ไม่บังคับ)"
            className={inputClass}
            disabled={createBusy}
          />
          {createTarget === "customer" && !companyId && (
            <p className="text-xs text-amber-700">
              ลูกค้าต้องผูกกับบริษัทเสมอ — กรุณาเลือกบริษัท (หรือสร้างบริษัทใหม่) ก่อน
            </p>
          )}
          {createError && <p className="text-xs text-red-600">{createError}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={submitCreate}
              disabled={createBusy || (createTarget === "customer" && !companyId)}
              className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 transition disabled:opacity-50"
            >
              {createBusy ? "กำลังบันทึก..." : "บันทึกและเลือก"}
            </button>
            <button
              type="button"
              onClick={() => {
                setCreateTarget(null);
                setCreateError("");
              }}
              disabled={createBusy}
              className="px-3 py-1.5 rounded-lg border border-gray-300 text-gray-700 text-xs font-semibold hover:bg-gray-50 transition disabled:opacity-50"
            >
              ยกเลิก
            </button>
          </div>
          <p className="text-xs text-gray-500">
            สร้างในหน้านี้ได้เลย ข้อมูลที่กรอกไว้ในฟอร์มขายจะไม่หาย
          </p>
        </div>
      )}

      {/* Task 10.6 — confirm before the new quotation replaces edited lines. */}
      {confirmId !== null && (
        <ConfirmDialog
          title="เปลี่ยนใบเสนอราคา"
          message={
            confirmId
              ? "การเปลี่ยนใบเสนอราคาจะล้างรายการสินค้าและข้อมูลที่แก้ไว้ทั้งหมด ต้องการดำเนินการต่อหรือไม่?"
              : "การยกเลิกการเชื่อมใบเสนอราคาจะล้างรายการสินค้าและข้อมูลที่แก้ไว้ทั้งหมด ต้องการดำเนินการต่อหรือไม่?"
          }
          confirmText={confirmId ? "เปลี่ยนใบเสนอราคา" : "ยกเลิกการเชื่อม"}
          loadingText="กำลังโหลด..."
          cancelText="ยกเลิก"
          onConfirm={() => {
            const next = confirmId;
            setConfirmId(null);
            applySelect(next);
          }}
          onCancel={() => setConfirmId(null)}
        />
      )}
    </div>
  );
}

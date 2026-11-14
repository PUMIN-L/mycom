"use client";
import { useState, useEffect, useRef, useCallback, useMemo, Suspense } from "react";
import AdminHomeButton from "../components/AdminHomeButton";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "../context/AuthContext";
import Toast from "../components/Toast";
import ConfirmDialog from "../components/ConfirmDialog";
import SortableTh from "../components/SortableTh";
import CopyText from "../components/CopyText";
import RowActions, { openOnKey } from "../components/RowActions";
import { nextSort, type SortState } from "../customers/listHelpers";
import { Supplier } from "../lib/types";
import SupplierDetailsModal from "./SupplierDetailsModal";
import { taxIdWarning } from "../lib/thaiTaxId";
import {
  SUPPLIER_LIMITS,
  deleteConfirmMessage,
  errorMessageOf,
  findDuplicateSuppliers,
  isSupplierDirty,
  matchesSupplierSearch,
  missingPoFields,
  sortSuppliers,
  supplierErrors,
  toSupplierDraft,
  type SupplierDraft,
  type SupplierSortKey,
} from "./supplierHelpers";

/** The same look as /customers and /product-specs: a light header band,
 *  compact rows, one orange primary button. */
const TH = "px-4 py-3 text-xs font-semibold";
const TD = "px-4 py-3";
const ROW_FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-orange-300";
const PRIMARY_BUTTON =
  "bg-orange-500 hover:bg-orange-600 text-white px-5 py-2.5 rounded-xl font-medium transition-all shadow-sm hover:shadow-md flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed";
const SEARCH_INPUT =
  "w-full bg-gray-50 border border-gray-200 rounded-xl pl-11 pr-10 py-2.5 focus:bg-white focus:ring-2 focus:ring-orange-500 outline-none transition-all";

const MISSING_LABEL: Record<"address" | "taxId", string> = { address: "ไม่มีที่อยู่", taxId: "ไม่มีเลขภาษี" };

/** The form's fields, as /product-specs draws them. */
const LABEL = "block text-sm font-semibold text-gray-700 mb-1.5";
function fieldClass(invalid = false) {
  return `w-full border rounded-xl px-4 py-2.5 outline-none transition-all focus:bg-white focus:ring-2 ${
    invalid ? "bg-red-50 border-red-500 focus:ring-red-500" : "bg-gray-50 border-gray-200 focus:ring-orange-500"
  }`;
}

interface Editor {
  /** Absent for a new supplier. */
  id?: string;
  /** What the form opened with. */
  original: SupplierDraft;
  draft: SupplierDraft;
}

const LOAD_FAILED = "โหลดรายชื่อซัพพลายเออร์ไม่สำเร็จ";

/** At most this many names in a "มีอยู่แล้ว" warning, then "และอีก n ราย". */
const DUPLICATE_NAMES_MAX = 3;
function namesOf(list: readonly Supplier[]): string {
  const shown = list.slice(0, DUPLICATE_NAMES_MAX).map((s) => s.companyName).join(", ");
  return list.length > DUPLICATE_NAMES_MAX ? `${shown} และอีก ${list.length - DUPLICATE_NAMES_MAX} ราย` : shown;
}

function SuppliersInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isLoggedIn, isLoading } = useAuth();

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [isLoadingData, setIsLoadingData] = useState(true);
  // A failed first load is not an empty list: it used to show "ไม่พบข้อมูล
  // ผู้ผลิต", as if there were no suppliers at all.
  const [loadError, setLoadError] = useState<string | null>(null);
  const hasLoadedRef = useRef(false);
  const loadSeqRef = useRef(0);
  // The router through a ref: loadData must never change, or the effect that
  // runs it would run again on every render that hands back a new router.
  const routerRef = useRef(router);
  useEffect(() => {
    routerRef.current = router;
  }, [router]);

  const [editor, setEditor] = useState<Editor | null>(null);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const savingRef = useRef(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const companyNameRef = useRef<HTMLInputElement>(null);
  // The form scrolls: a refusal shown at its top went by unseen when the
  // admin had scrolled down to the note. Each failed save brings it into
  // view — from an effect, so after the message is on the page.
  const editorBodyRef = useRef<HTMLDivElement>(null);
  const [revealProblem, setRevealProblem] = useState(0);
  useEffect(() => {
    if (!revealProblem) return;
    editorBodyRef.current?.querySelector<HTMLElement>("[data-problem]")?.scrollIntoView?.({ block: "nearest" });
  }, [revealProblem]);

  const [viewingSupplier, setViewingSupplier] = useState<Supplier | null>(null);
  // Stable, so the detail window's Esc listener is not re-added every render.
  const closeView = useCallback(() => setViewingSupplier(null), []);
  const [deleteTarget, setDeleteTarget] = useState<Supplier | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const deletingRef = useRef(false);
  const [query, setQuery] = useState("");
  // null: the API's order, newest first — until a header is clicked.
  const [sort, setSort] = useState<SortState<SupplierSortKey> | null>(null);

  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // One timer at a time, so a second toast is not cut short by the first's.
  const showToast = useCallback((message: string, type: "success" | "error" = "success") => {
    setToast({ message, type });
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 3000);
  }, []);
  useEffect(
    () => () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    },
    []
  );

  useEffect(() => {
    if (!isLoading && !isLoggedIn) {
      router.replace("/login");
    }
  }, [isLoggedIn, isLoading, router]);

  const loadData = useCallback(async () => {
    // Only the latest load is applied: a save and then a quick delete start
    // two, and the first answering last would bring the deleted one back.
    const seq = ++loadSeqRef.current;
    const isLatest = () => seq === loadSeqRef.current;
    let message = LOAD_FAILED;
    try {
      const res = await fetch("/api/suppliers");
      if (!isLatest()) return;
      if (res.status === 401) {
        routerRef.current.replace("/login");
        return;
      }
      if (!res.ok) {
        message = await errorMessageOf(res, LOAD_FAILED);
        throw new Error(message);
      }
      const body = await res.json();
      if (!isLatest()) return;
      if (!Array.isArray(body)) throw new Error(message);
      setSuppliers(body);
      setLoadError(null);
      hasLoadedRef.current = true;
    } catch (error) {
      if (!isLatest()) return;
      console.error("Failed to load suppliers", error);
      // A reload after a save that fails keeps the list on screen and says
      // so; only a first load with nothing to show becomes the error state.
      if (hasLoadedRef.current) showToast("โหลดข้อมูลล่าสุดไม่สำเร็จ กรุณาลองใหม่", "error");
      else setLoadError(message);
    } finally {
      if (isLatest()) setIsLoadingData(false);
    }
  }, [showToast]);

  useEffect(() => {
    if (isLoggedIn) loadData();
  }, [isLoggedIn, loadData]);

  const retryLoad = () => {
    setLoadError(null);
    setIsLoadingData(true);
    loadData();
  };

  useEffect(() => {
    const id = searchParams.get("id");
    if (id && suppliers.length > 0) {
      const s = suppliers.find(sup => sup.id === id);
      if (s) {
        setViewingSupplier(s);
        // Optional: clear the URL so it doesn't reopen on refresh
        window.history.replaceState({}, '', '/suppliers');
      }
    }
  }, [searchParams, suppliers]);

  // ── Editor ──────────────────────────────────────────────────────────────
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  /** Whatever had focus when the form opened (a row, a button): it gets it
   *  back on close, rather than the keyboard landing at the top of the page. */
  const returnFocusRef = useRef<HTMLElement | null>(null);
  // The tax ID's warning waits until the admin has left the box — not "3 of
  // 13 digits" at every keystroke.
  const [taxIdFocused, setTaxIdFocused] = useState(false);

  const openEditor = (id: string | undefined, draft: SupplierDraft, returnFocus?: HTMLElement | null) => {
    returnFocusRef.current =
      returnFocus !== undefined ? returnFocus : document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setEditor({ id, original: draft, draft });
    setSubmitAttempted(false);
    setSaveError(null);
    setConfirmDiscard(false);
    setTaxIdFocused(false);
  };
  const openAddModal = () => openEditor(undefined, toSupplierDraft());
  const openEditModal = (s: Supplier, returnFocus?: HTMLElement | null) => openEditor(s.id, toSupplierDraft(s), returnFocus);
  const setDraft = (patch: Partial<SupplierDraft>) =>
    setEditor((ed) => (ed ? { ...ed, draft: { ...ed.draft, ...patch } } : ed));
  const closeEditor = () => {
    if (savingRef.current) return;
    setEditor(null);
    setConfirmDiscard(false);
    const back = returnFocusRef.current;
    returnFocusRef.current = null;
    if (back?.isConnected) back.focus();
  };
  const editorDirty = editor ? isSupplierDirty(editor.original, editor.draft) : false;
  /** Esc, the backdrop, ✕ and ยกเลิก: asks first when there is typing to lose. */
  const requestClose = () => {
    if (!editor || savingRef.current) return;
    if (editorDirty) setConfirmDiscard(true);
    else closeEditor();
  };
  // A refresh or a closed tab with typing in the form gets the browser's own
  // warning, as on the product pages.
  useEffect(() => {
    if (!editorDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [editorDirty]);

  const errors = editor ? supplierErrors(editor.draft) : {};
  const duplicates = editor ? findDuplicateSuppliers(suppliers, editor.draft, editor.id) : null;
  const taxWarning = editor && !taxIdFocused ? taxIdWarning(editor.draft.taxId) : null;

  const handleSaveSupplier = async () => {
    if (!editor || savingRef.current) return;
    setSubmitAttempted(true);
    if (Object.keys(supplierErrors(editor.draft)).length > 0) {
      // Said under the field, and the cursor put there: a pink box alone
      // did not say what was wrong.
      companyNameRef.current?.focus();
      return;
    }
    // Guarded by a ref as well as the disabled button: a double click on a
    // slow line used to POST twice and add the same supplier twice.
    savingRef.current = true;
    setIsSaving(true);
    setSaveError(null);
    const { id, draft } = editor;
    const isNew = !id;
    let failed: string | null = null;
    let stored: Supplier | null = null;
    try {
      const res = await fetch(isNew ? "/api/suppliers" : `/api/suppliers/${encodeURIComponent(id)}`, {
        method: isNew ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...draft, companyName: draft.companyName.trim() }),
      });
      if (!res.ok) failed = await errorMessageOf(res, isNew ? "เพิ่มซัพพลายเออร์ไม่สำเร็จ" : "บันทึกการแก้ไขไม่สำเร็จ");
      else stored = await res.json().catch(() => null);
    } catch {
      failed = "บันทึกไม่สำเร็จ ตรวจสอบการเชื่อมต่อแล้วลองใหม่";
    } finally {
      savingRef.current = false;
      setIsSaving(false);
    }
    if (failed) {
      // Inside the form, which stays open with what was typed.
      setSaveError(failed);
      setRevealProblem((n) => n + 1);
      return;
    }
    // Shown at once, as the API stored it; the reload below then confirms it.
    if (stored && typeof stored.id === "string") {
      const saved = stored;
      setSuppliers((prev) => (isNew ? [saved, ...prev] : prev.map((s) => (s.id === saved.id ? saved : s))));
    }
    closeEditor();
    showToast(isNew ? "เพิ่มซัพพลายเออร์แล้ว" : "บันทึกการแก้ไขแล้ว");
    loadData();
  };

  const onEditorKeyDown = (e: React.KeyboardEvent<HTMLFormElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      requestClose();
    } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      // From the address or the note too, where Enter is a new line.
      e.preventDefault();
      handleSaveSupplier();
    }
  };

  // ── Delete ──────────────────────────────────────────────────────────────
  const handleDelete = async () => {
    if (!deleteTarget || deletingRef.current) return;
    deletingRef.current = true;
    setIsDeleting(true);
    const target = deleteTarget;
    let failed: string | null = null;
    let gone = false;
    try {
      const res = await fetch(`/api/suppliers/${encodeURIComponent(target.id)}`, { method: "DELETE" });
      if (res.ok) gone = true;
      else if (res.status === 404) {
        // Already deleted (another tab): off the list too, or it could be
        // "deleted" again and again.
        gone = true;
        failed = "ซัพพลายเออร์นี้ถูกลบไปแล้ว";
      } else failed = await errorMessageOf(res, "ลบซัพพลายเออร์ไม่สำเร็จ");
    } catch {
      failed = "ลบซัพพลายเออร์ไม่สำเร็จ ตรวจสอบการเชื่อมต่อแล้วลองใหม่";
    } finally {
      deletingRef.current = false;
      setIsDeleting(false);
    }
    if (gone) {
      setSuppliers((prev) => prev.filter((s) => s.id !== target.id));
      setDeleteTarget(null);
      setViewingSupplier((v) => (v?.id === target.id ? null : v));
      loadData();
    }
    if (failed) showToast(failed, "error");
    else showToast("ลบซัพพลายเออร์แล้ว");
  };

  // ── The list ────────────────────────────────────────────────────────────
  const searching = query.trim() !== "";
  const shown = useMemo(
    () => sortSuppliers(suppliers.filter((s) => matchesSupplierSearch(s, query)), sort),
    [suppliers, query, sort]
  );
  const sortBy = (key: SupplierSortKey) => setSort((s) => nextSort(s, key, key === "products" ? "desc" : "asc"));
  const dirOf = (key: SupplierSortKey) => (sort?.key === key ? sort.dir : null);
  const copied = () => showToast("คัดลอกแล้ว");
  const copyFailed = () => showToast("คัดลอกไม่สำเร็จ", "error");

  if (isLoading || !isLoggedIn) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <div className="w-8 h-8 border-4 border-orange-500 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  const nameInvalid = submitAttempted && !!errors.companyName;
  const listReady = !isLoadingData && !loadError;

  return (
    // pb-32: the admin bell floats over the bottom-left corner, and it used to
    // cover the last row's company name.
    <div className="min-h-screen bg-[#F8FAFC] pt-12 pb-32 font-sans">
      {toast && <Toast message={toast.message} type={toast.type} />}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header — the same as /customers and /product-specs. */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-10 gap-4">
          <div>
            <h1 className="text-4xl font-extrabold text-gray-900 tracking-tight">ซัพพลายเออร์</h1>
            <p className="text-gray-500 mt-2 text-lg">บริษัทที่เราสั่งซื้อสินค้า ใช้เลือกในใบสั่งซื้อ และผูกกับสินค้าได้</p>
          </div>
          <AdminHomeButton />
        </div>

        <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-6">
          <div className="flex flex-wrap justify-between items-center gap-3 mb-5">
            <div className="flex items-center gap-3">
              <div className="bg-orange-100 text-orange-600 p-2.5 rounded-xl">
                <svg aria-hidden="true" className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"></path></svg>
              </div>
              <h2 className="text-xl font-bold text-gray-800">
                ซัพพลายเออร์ทั้งหมด
                {listReady && (
                  <span className="text-gray-400 text-base font-normal tabular-nums" data-testid="supplier-count">
                    {" "}({searching ? `พบ ${shown.length} จาก ${suppliers.length}` : suppliers.length})
                  </span>
                )}
              </h2>
            </div>
            <button type="button" onClick={openAddModal} className={PRIMARY_BUTTON}>
              <svg aria-hidden="true" className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4"></path></svg>
              เพิ่มซัพพลายเออร์
            </button>
          </div>

          {/* Search: every column a supplier is known by, and its products. */}
          <div className="relative mb-5 w-full md:max-w-xl">
            <svg aria-hidden="true" className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-4.35-4.35M10.5 18a7.5 7.5 0 100-15 7.5 7.5 0 000 15z" /></svg>
            <input
              type="text"
              aria-label="ค้นหาซัพพลายเออร์"
              placeholder="ค้นหาชื่อบริษัท ผู้ติดต่อ เบอร์โทร เลขภาษี หรือสินค้า..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className={SEARCH_INPUT}
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="ล้างคำค้น"
                title="ล้างคำค้น"
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <svg aria-hidden="true" className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            )}
          </div>

          {loadError ? (
            <div role="alert" className="py-16 flex flex-col items-center gap-3 text-center">
              <p className="text-gray-800 font-semibold">{loadError}</p>
              <p className="text-sm text-gray-500">ตรวจสอบการเชื่อมต่อแล้วลองใหม่อีกครั้ง</p>
              <button type="button" onClick={retryLoad} className={PRIMARY_BUTTON}>ลองใหม่</button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="bg-gray-50 text-gray-500 uppercase tracking-wider">
                    <SortableTh className={`${TH} rounded-l-xl`} dir={dirOf("name")} onSort={() => sortBy("name")}>ชื่อบริษัท</SortableTh>
                    <SortableTh className={TH} dir={dirOf("contact")} onSort={() => sortBy("contact")}>ผู้ติดต่อ</SortableTh>
                    <th className={TH}>เบอร์โทร</th>
                    <SortableTh className={`${TH} text-right`} dir={dirOf("products")} onSort={() => sortBy("products")}>สินค้า</SortableTh>
                    <th className={`${TH} text-right rounded-r-xl`}>จัดการ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {isLoadingData ? (
                    Array.from({ length: 5 }).map((_, i) => (
                      <tr key={i} className="animate-pulse">
                        <td className={TD}><div className="h-5 bg-gray-200 rounded w-56"></div></td>
                        <td className={TD}><div className="h-5 bg-gray-200 rounded w-32"></div></td>
                        <td className={TD}><div className="h-5 bg-gray-200 rounded w-28"></div></td>
                        <td className={TD}><div className="h-5 bg-gray-200 rounded w-8 ml-auto"></div></td>
                        <td className={TD}><div className="h-5 bg-gray-200 rounded w-12 ml-auto"></div></td>
                      </tr>
                    ))
                  ) : shown.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-14 text-center text-gray-500">
                        <div className="flex flex-col items-center gap-3">
                          {searching ? (
                            <>
                              <p>ไม่พบซัพพลายเออร์ที่ตรงกับคำค้น</p>
                              <button type="button" onClick={() => setQuery("")} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-xl hover:bg-gray-200 transition-all text-sm font-semibold">ล้างคำค้น</button>
                            </>
                          ) : (
                            <>
                              <p>ยังไม่มีซัพพลายเออร์</p>
                              <button type="button" onClick={openAddModal} className={PRIMARY_BUTTON}>+ เพิ่มซัพพลายเออร์รายแรก</button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ) : (
                    shown.map((s) => {
                      const missing = missingPoFields(s);
                      const products = s.linkedProducts?.length ?? 0;
                      return (
                        <tr
                          key={s.id}
                          tabIndex={0}
                          aria-label={`ดูข้อมูล ${s.companyName}`}
                          onClick={() => setViewingSupplier(s)}
                          onKeyDown={openOnKey(() => setViewingSupplier(s))}
                          className={`group cursor-pointer hover:bg-gray-50 ${ROW_FOCUS} transition-colors`}
                        >
                          <td className={TD}>
                            <p className="font-semibold text-gray-900">{s.companyName}</p>
                            {missing.length > 0 && (
                              <div className="mt-1 flex flex-wrap gap-1">
                                {missing.map((field) => (
                                  <span
                                    key={field}
                                    title="ใบสั่งซื้อพิมพ์ที่อยู่และเลขผู้เสียภาษีของซัพพลายเออร์ — กดแก้ไขเพื่อเพิ่ม"
                                    className="inline-flex items-center rounded-md bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-800 ring-1 ring-inset ring-amber-200"
                                  >
                                    {MISSING_LABEL[field]}
                                  </span>
                                ))}
                              </div>
                            )}
                          </td>
                          <td className={`${TD} text-gray-700`}>{s.contactName || "-"}</td>
                          <td className={`${TD} text-gray-700 whitespace-nowrap`}>
                            <CopyText value={s.phone} onCopied={copied} onFailed={copyFailed} />
                          </td>
                          <td className={`${TD} text-right tabular-nums text-gray-700`} data-testid="product-count">
                            {products || "-"}
                          </td>
                          <td className={TD}>
                            <RowActions name={s.companyName} onEdit={() => openEditModal(s)} onDelete={() => setDeleteTarget(s)} />
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Add / edit. Enter saves (Ctrl + Enter from the address or note), Esc
          asks before closing when there is typing to lose. */}
      {editor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-gray-900/40 backdrop-blur-sm" onClick={requestClose} data-testid="supplier-editor-backdrop"></div>
          <form
            role="dialog"
            aria-modal="true"
            aria-labelledby="supplier-editor-title"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              handleSaveSupplier();
            }}
            onKeyDown={onEditorKeyDown}
            className="relative bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden"
          >
            <div className="px-8 py-5 border-b border-gray-100 flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h2 id="supplier-editor-title" className="text-2xl font-bold text-gray-800">
                  {editor.id ? "แก้ไขซัพพลายเออร์" : "เพิ่มซัพพลายเออร์"}
                </h2>
                {/* Which supplier — the title alone did not say. */}
                {editor.id && (
                  <p className="text-sm text-gray-500 mt-0.5 wrap-break-word" data-testid="editor-subject">
                    {editor.original.companyName}
                  </p>
                )}
              </div>
              <button type="button" onClick={requestClose} aria-label="ปิด" className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors shrink-0">
                <svg aria-hidden="true" className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
              </button>
            </div>

            <div ref={editorBodyRef} className="overflow-y-auto overscroll-contain flex-1 px-8 py-6 space-y-5">
              {saveError && (
                <div role="alert" data-problem="" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {saveError}
                </div>
              )}

              <div>
                <label htmlFor="supplier-companyName" className={LABEL}>
                  ชื่อบริษัท <span className="text-red-500">*</span>
                </label>
                <input
                  id="supplier-companyName"
                  ref={companyNameRef}
                  type="text"
                  autoFocus
                  maxLength={SUPPLIER_LIMITS.companyName}
                  value={editor.draft.companyName}
                  onChange={(e) => setDraft({ companyName: e.target.value })}
                  aria-invalid={nameInvalid}
                  aria-describedby={nameInvalid ? "supplier-companyName-error" : undefined}
                  className={fieldClass(nameInvalid)}
                  placeholder="เช่น บริษัท เอบีซี จำกัด"
                />
                {nameInvalid && (
                  <p id="supplier-companyName-error" className="mt-1 text-sm text-red-600">
                    {errors.companyName}
                  </p>
                )}
                {duplicates && duplicates.sameName.length > 0 && (
                  <p className="mt-1 text-sm text-amber-700" data-testid="duplicate-name">
                    มีซัพพลายเออร์ชื่อนี้อยู่แล้ว: {namesOf(duplicates.sameName)}
                  </p>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <div>
                  <label htmlFor="supplier-contactName" className={LABEL}>ผู้ติดต่อ</label>
                  <input
                    id="supplier-contactName"
                    type="text"
                    maxLength={SUPPLIER_LIMITS.contactName}
                    value={editor.draft.contactName}
                    onChange={(e) => setDraft({ contactName: e.target.value })}
                    className={fieldClass()}
                  />
                </div>
                <div>
                  <label htmlFor="supplier-phone" className={LABEL}>เบอร์โทร</label>
                  <input
                    id="supplier-phone"
                    type="text"
                    maxLength={SUPPLIER_LIMITS.phone}
                    value={editor.draft.phone}
                    onChange={(e) => setDraft({ phone: e.target.value })}
                    className={fieldClass()}
                  />
                </div>
              </div>

              <div>
                <label htmlFor="supplier-address" className={LABEL}>ที่อยู่</label>
                <textarea
                  id="supplier-address"
                  maxLength={SUPPLIER_LIMITS.address}
                  value={editor.draft.address}
                  onChange={(e) => setDraft({ address: e.target.value })}
                  className={`${fieldClass()} resize-y`}
                  rows={3}
                  placeholder="สำหรับพิมพ์บนใบสั่งซื้อ"
                />
              </div>

              <div>
                <label htmlFor="supplier-taxId" className={LABEL}>เลขผู้เสียภาษี</label>
                <input
                  id="supplier-taxId"
                  type="text"
                  inputMode="numeric"
                  maxLength={SUPPLIER_LIMITS.taxId}
                  value={editor.draft.taxId}
                  onChange={(e) => setDraft({ taxId: e.target.value })}
                  onFocus={() => setTaxIdFocused(true)}
                  onBlur={() => setTaxIdFocused(false)}
                  className={fieldClass()}
                  placeholder="0-0000-00000-00-0"
                />
                {taxWarning && (
                  <p className="mt-1 text-sm text-amber-700" data-testid="taxid-warning">
                    {taxWarning}
                  </p>
                )}
                {duplicates && duplicates.sameTaxId.length > 0 && (
                  <p className="mt-1 text-sm text-amber-700" data-testid="duplicate-taxid">
                    เลขนี้ใช้กับ {namesOf(duplicates.sameTaxId)} อยู่แล้ว (สำนักงานใหญ่กับสาขาใช้เลขเดียวกันได้)
                  </p>
                )}
                <p className="mt-1.5 text-xs text-gray-500" data-testid="po-note">
                  ที่อยู่และเลขผู้เสียภาษีจะถูกเติมลงใบสั่งซื้อใบใหม่ — แก้ที่นี่ไม่เปลี่ยนใบสั่งซื้อที่ออกไปแล้ว
                </p>
              </div>

              <div>
                <label htmlFor="supplier-note" className={LABEL}>หมายเหตุ</label>
                <textarea
                  id="supplier-note"
                  maxLength={SUPPLIER_LIMITS.note}
                  value={editor.draft.note}
                  onChange={(e) => setDraft({ note: e.target.value })}
                  className={`${fieldClass()} resize-y`}
                  rows={3}
                />
              </div>
            </div>

            <div className="px-8 py-5 border-t border-gray-100 bg-gray-50/50 flex flex-wrap items-center justify-between gap-3">
              <span className="text-xs text-gray-400">Enter บันทึก (ในช่องหลายบรรทัดใช้ Ctrl + Enter) · Esc ปิด</span>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={requestClose}
                  disabled={isSaving}
                  className="px-6 py-2.5 font-semibold text-gray-600 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 transition-all shadow-sm disabled:opacity-60"
                >
                  ยกเลิก
                </button>
                <button type="submit" disabled={isSaving} className={PRIMARY_BUTTON}>
                  {isSaving ? "กำลังบันทึก..." : "บันทึก"}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {confirmDiscard && editor && (
        <ConfirmDialog
          title="ยังไม่ได้บันทึก"
          message="สิ่งที่แก้ไว้จะหายไป ปิดหน้าต่างนี้เลยไหม?"
          confirmText="ปิดโดยไม่บันทึก"
          cancelText="กลับไปแก้ต่อ"
          onConfirm={closeEditor}
          onCancel={() => setConfirmDiscard(false)}
        />
      )}

      {/* Delete confirmation — says what goes with the supplier. */}
      {deleteTarget && (
        <ConfirmDialog
          title="ยืนยันการลบซัพพลายเออร์"
          message={deleteConfirmMessage(deleteTarget)}
          confirmText="ลบ"
          loading={isDeleting}
          onConfirm={handleDelete}
          onCancel={() => {
            if (!deletingRef.current) setDeleteTarget(null);
          }}
        />
      )}

      {/* One supplier: its details, products and what to do next. */}
      {viewingSupplier && (
        <SupplierDetailsModal
          supplier={viewingSupplier}
          onClose={closeView}
          onEdit={(returnFocus) => {
            const s = viewingSupplier;
            setViewingSupplier(null);
            // The form gives the focus back to the row the window came from.
            openEditModal(s, returnFocus);
          }}
          onCopied={copied}
          onFailed={copyFailed}
        />
      )}
    </div>
  );
}

export default function SuppliersPage() {
  return (
    <Suspense>
      <SuppliersInner />
    </Suspense>
  );
}

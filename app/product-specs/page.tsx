"use client";
import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../context/AuthContext";
import Toast from "../components/Toast";
import Link from "next/link";
import SearchableDropdown from "../components/SearchableDropdown";
import ConfirmDialog from "../components/ConfirmDialog";
import RowActions, { openOnKey } from "../components/RowActions";
import { thCompare } from "../lib/thCompare";
import {
  SPEC_DETAIL_MAX,
  SPEC_NAME_MAX,
  copyName,
  detailNeedsClamp,
  groupSpecs,
  isSpecDirty,
  productName,
  productsWithoutSpecs,
  specErrors,
  type ProductSpec,
  type SpecDraft,
  type SpecProduct,
} from "./specHelpers";

/** The same look as /customers: a light header band, compact rows, one
 *  orange primary button. */
const TH = "px-4 py-3 text-xs font-semibold";
const TD = "px-4 py-3";
const ROW_FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-orange-300";
const SEARCH_INPUT =
  "bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 focus:bg-white focus:ring-2 focus:ring-orange-500 outline-none transition-all";
const PRIMARY_BUTTON =
  "bg-orange-500 hover:bg-orange-600 text-white px-5 py-2.5 rounded-xl font-medium transition-all shadow-sm hover:shadow-md flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed";
const SECONDARY_BUTTON =
  "bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 px-4 py-2.5 rounded-xl font-medium transition-all shadow-sm flex items-center gap-2";
const FIELD =
  "w-full bg-gray-50 border rounded-xl px-4 py-2.5 outline-none transition-all focus:bg-white focus:ring-2";

type EditorMode = "new" | "edit" | "copy";
interface Editor {
  mode: EditorMode;
  id?: string;
  /** What the form opened with — closing asks first only if this changed. */
  original: SpecDraft;
  draft: SpecDraft;
}

const EDITOR_TITLE: Record<EditorMode, string> = {
  new: "เพิ่มสเปคใหม่",
  edit: "แก้ไขสเปค",
  copy: "ทำสำเนาสเปค",
};

/** The API's error message, or `fallback` when it sent none. */
async function errorMessageOf(res: Response, fallback: string): Promise<string> {
  try {
    const body = await res.json();
    return typeof body?.error === "string" && body.error ? body.error : fallback;
  } catch {
    return fallback;
  }
}

export default function ProductSpecsPage() {
  const router = useRouter();
  const { isLoggedIn, isLoading } = useAuth();
  const [specs, setSpecs] = useState<ProductSpec[]>([]);
  const [products, setProducts] = useState<SpecProduct[]>([]);
  const [isLoadingData, setIsLoadingData] = useState(true);
  // Kept apart: no specs is an empty list, a failed load is not — it used to
  // say "ยังไม่มีข้อมูลสเปค" either way.
  const [loadError, setLoadError] = useState(false);
  const [productsFailed, setProductsFailed] = useState(false);
  const hasLoadedRef = useRef(false);
  const loadSeqRef = useRef(0);
  // The router through a ref: loadData must never change, or the effect that
  // runs it would run again on every render that hands back a new router.
  const routerRef = useRef(router);
  useEffect(() => {
    routerRef.current = router;
  }, [router]);

  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [query, setQuery] = useState("");
  const [productFilter, setProductFilter] = useState("");
  const [showMissing, setShowMissing] = useState(false);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());

  const [editor, setEditor] = useState<Editor | null>(null);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const savingRef = useRef(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  /** What had focus when the editor opened (a row, a button) — it gets it
   *  back on close, rather than the keyboard landing at the top of the page. */
  const returnFocusRef = useRef<HTMLElement | null>(null);
  // On a short screen the form scrolls, and ยกเลิก / บันทึก sit below the
  // fields: a refusal (shown on top) or "กรุณาเลือกสินค้า" (the first field)
  // went by unseen. Each failed save brings the first problem into view —
  // from an effect, so after the message is on the page.
  const editorBodyRef = useRef<HTMLDivElement>(null);
  const [revealProblem, setRevealProblem] = useState(0);
  useEffect(() => {
    if (!revealProblem) return;
    editorBodyRef.current?.querySelector<HTMLElement>("[data-problem]")?.scrollIntoView?.({ block: "nearest" });
  }, [revealProblem]);

  const [deleteTarget, setDeleteTarget] = useState<ProductSpec | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const deletingRef = useRef(false);

  useEffect(() => {
    if (!isLoading && !isLoggedIn) {
      router.replace("/login");
    }
  }, [isLoggedIn, isLoading, router]);

  // The toast clears itself — it used to stay on screen until the next one.
  // One timer at a time, so a second toast is not cut short by the first's.
  const showToast = useCallback((message: string, type: "success" | "error" = "success") => {
    setToast({ message, type });
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 3000);
  }, []);
  useEffect(() => () => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
  }, []);

  const loadData = useCallback(async () => {
    // Only the latest load is applied: a save and then a quick delete start
    // two, and the first answering last would bring the deleted spec back.
    const seq = ++loadSeqRef.current;
    const isLatest = () => seq === loadSeqRef.current;
    try {
      const [specsRes, productsRes] = await Promise.all([fetch("/api/product-specs"), fetch("/api/products")]);
      if (!isLatest()) return;
      if (specsRes.status === 401) {
        routerRef.current.replace("/login");
        return;
      }
      // The products first, and whatever the specs do: the editor's product
      // picker needs them even when the list could not load.
      let productsOk = productsRes.ok;
      if (productsOk) {
        const productsBody = await productsRes.json().catch(() => null);
        productsOk = Array.isArray(productsBody);
        if (productsOk && isLatest()) setProducts(productsBody);
      }
      if (!isLatest()) return;
      setProductsFailed(!productsOk);
      if (!specsRes.ok) throw new Error(`specs ${specsRes.status}`);
      const specsBody = await specsRes.json();
      if (!isLatest()) return;
      setSpecs(Array.isArray(specsBody?.data) ? specsBody.data : []);
      setLoadError(false);
      hasLoadedRef.current = true;
    } catch (error) {
      if (!isLatest()) return;
      console.error("Failed to load specs", error);
      // A reload after a save that fails keeps the list on screen and says
      // so; only a first load with nothing to show becomes the error state.
      if (hasLoadedRef.current) showToast("โหลดข้อมูลล่าสุดไม่สำเร็จ กรุณาลองใหม่", "error");
      else setLoadError(true);
    } finally {
      if (isLatest()) setIsLoadingData(false);
    }
  }, [showToast]);

  useEffect(() => {
    if (isLoggedIn) loadData();
  }, [isLoggedIn, loadData]);

  const retryLoad = () => {
    setLoadError(false);
    setIsLoadingData(true);
    loadData();
  };

  const groups = useMemo(
    () => groupSpecs(specs, products, { query, productId: productFilter }),
    [specs, products, query, productFilter]
  );
  const shownCount = groups.reduce((n, g) => n + g.specs.length, 0);
  const missing = useMemo(() => productsWithoutSpecs(products, specs, query), [products, specs, query]);
  const sortedProducts = useMemo(
    () => [...products].sort((a, b) => thCompare(productName(a), productName(b))),
    [products]
  );
  const productNameOf = (id: string) => productName(products.find((p) => p.id === id));
  const filtering = query.trim() !== "" || productFilter !== "";
  const clearFilters = () => {
    setQuery("");
    setProductFilter("");
  };

  // ── Editor ────────────────────────────────────────────────────────────────
  const openEditor = (mode: EditorMode, draft: SpecDraft, id?: string) => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setEditor({ mode, id, original: draft, draft });
    setSubmitAttempted(false);
    setSaveError(null);
    setConfirmDiscard(false);
  };
  const openNew = (productId = "") => openEditor("new", { productId, name: "", detail: "" });
  const openEdit = (s: ProductSpec) => openEditor("edit", { productId: s.productId, name: s.name, detail: s.detail }, s.id);
  // A copy starts as a NEW spec of the same product, under a heading not
  // taken yet ("… (สำเนา)"), ready to have the lines that differ changed.
  const openCopy = (s: ProductSpec) =>
    openEditor("copy", {
      productId: s.productId,
      name: copyName(s.name, specs.filter((x) => x.productId === s.productId).map((x) => x.name)),
      detail: s.detail,
    });
  const setDraft = (patch: SpecDraft) => setEditor((ed) => (ed ? { ...ed, draft: { ...ed.draft, ...patch } } : ed));
  const closeEditor = () => {
    setEditor(null);
    setConfirmDiscard(false);
    const back = returnFocusRef.current;
    returnFocusRef.current = null;
    if (back?.isConnected) back.focus();
  };
  /** Esc, the backdrop, ✕ and ยกเลิก: asks first when there is typing to lose. */
  const requestClose = () => {
    if (!editor || savingRef.current) return;
    if (isSpecDirty(editor.original, editor.draft)) setConfirmDiscard(true);
    else closeEditor();
  };

  const errors = editor ? specErrors(editor.draft) : {};

  // Esc and the backdrop ask before throwing typing away; a refresh or a
  // closed tab gets the browser's own warning (as on the product pages).
  const editorDirty = editor ? isSpecDirty(editor.original, editor.draft) : false;
  useEffect(() => {
    if (!editorDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [editorDirty]);

  const handleSave = async () => {
    if (!editor || savingRef.current) return;
    setSubmitAttempted(true);
    if (Object.keys(specErrors(editor.draft)).length > 0) {
      setRevealProblem((n) => n + 1);
      return;
    }
    // Guarded by a ref as well as the disabled button: a double click or a
    // held Ctrl+Enter used to save the same spec twice.
    savingRef.current = true;
    setIsSaving(true);
    setSaveError(null);
    let saved = false;
    try {
      const { draft, id } = editor;
      const res = await fetch(id ? `/api/product-specs/${encodeURIComponent(id)}` : "/api/product-specs", {
        method: id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId: draft.productId, name: (draft.name || "").trim(), detail: draft.detail || "" }),
      });
      if (!res.ok) throw new Error(await errorMessageOf(res, "บันทึกสเปคไม่สำเร็จ"));
      saved = true;
      // Shown at once, as the API stored it (its text is sanitized), not after
      // the reload: on a slow line, a second copy made meanwhile got the same
      // "(สำเนา)" heading as the first. The reload below then confirms it.
      const stored = (await res.json().catch(() => null))?.data as Partial<ProductSpec> | undefined;
      if (stored?.id) {
        setSpecs((prev) =>
          id
            ? prev.map((s) => (s.id === id ? { ...s, ...stored } : s))
            : [...prev, { createdAt: new Date().toISOString(), ...stored } as ProductSpec]
        );
      }
    } catch (error) {
      setSaveError(error instanceof Error && error.message ? error.message : "บันทึกสเปคไม่สำเร็จ");
      setRevealProblem((n) => n + 1);
    } finally {
      // Released when the SAVE is done, not after the reload below: a spec
      // opened meanwhile would otherwise sit at "กำลังบันทึก...".
      savingRef.current = false;
      setIsSaving(false);
    }
    if (saved) {
      closeEditor();
      showToast("บันทึกสเปคแล้ว");
      loadData();
    }
  };

  const onEditorKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    // The product picker's panel is portaled to <body>: React still bubbles
    // its keys here, but they are the picker's, not the form's.
    if (!e.currentTarget.contains(e.target as Node)) return;
    if (e.key === "Escape") {
      e.preventDefault();
      requestClose();
    } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSave();
    }
  };

  // ── Delete ────────────────────────────────────────────────────────────────
  const handleDelete = async () => {
    if (!deleteTarget || deletingRef.current) return;
    deletingRef.current = true;
    setIsDeleting(true);
    let deleted = false;
    try {
      const res = await fetch(`/api/product-specs/${encodeURIComponent(deleteTarget.id)}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await errorMessageOf(res, "ลบสเปคไม่สำเร็จ"));
      deleted = true;
    } catch (error) {
      showToast(error instanceof Error && error.message ? error.message : "ลบสเปคไม่สำเร็จ", "error");
    } finally {
      deletingRef.current = false;
      setIsDeleting(false);
    }
    if (deleted) {
      // Gone at once — a row left until the reload could be deleted again
      // (and answer "ไม่พบสเปกนี้").
      const goneId = deleteTarget.id;
      setSpecs((prev) => prev.filter((s) => s.id !== goneId));
      setDeleteTarget(null);
      showToast("ลบสเปคแล้ว");
      loadData();
    }
  };

  const toggleExpanded = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (isLoading || !isLoggedIn) {
    return <div className="flex h-screen items-center justify-center bg-gray-50"><div className="w-8 h-8 border-4 border-orange-500 border-t-transparent rounded-full animate-spin"></div></div>;
  }

  const detailLines = (editor?.draft.detail || "").split("\n").length;

  return (
    <div className="min-h-screen bg-[#F8FAFC] py-12 font-sans">
      {toast && <Toast message={toast.message} type={toast.type} />}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header — the same as /customers. */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-10 gap-4">
          <div>
            <h1 className="text-4xl font-extrabold text-gray-900 tracking-tight">สเปคสินค้า</h1>
            <p className="text-gray-500 mt-2 text-lg">ข้อความสเปคของแต่ละสินค้า สำหรับเลือกเติมลงใบเสนอราคา</p>
          </div>
          <Link href="/adminpanel" className="px-5 py-2.5 bg-white border border-gray-200 text-gray-700 font-semibold rounded-xl hover:bg-gray-50 hover:shadow-sm transition-all flex items-center gap-2">
            <svg aria-hidden="true" className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"></path></svg>
            ไปที่หน้าระบบจัดการ
          </Link>
        </div>

        <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-6">
          <div className="flex flex-wrap justify-between items-center gap-3 mb-5">
            <div className="flex items-center gap-3">
              <div className="bg-orange-100 text-orange-600 p-2.5 rounded-xl">
                <svg aria-hidden="true" className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
              </div>
              <h2 className="text-xl font-bold text-gray-800">สเปคทั้งหมด <span className="text-gray-400 text-base font-normal">({shownCount})</span></h2>
            </div>
            <button type="button" onClick={() => openNew(productFilter)} className={PRIMARY_BUTTON}>
              <svg aria-hidden="true" className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4"></path></svg>
              เพิ่มสเปค
            </button>
          </div>

          {/* Search, one product, and the products still without a spec. */}
          <div className="flex flex-wrap items-center gap-3 mb-5">
            <input
              type="text"
              placeholder="ค้นหาชื่อสินค้า หัวข้อ หรือรายละเอียด..."
              aria-label="ค้นหาสเปค"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className={`w-full md:w-96 ${SEARCH_INPUT}`}
            />
            <div className="w-full md:w-80" data-testid="product-filter">
              <SearchableDropdown
                className="w-full"
                buttonClassName="h-[46px] !px-4 !rounded-xl !bg-gray-50 !border-gray-200 !shadow-none !text-base"
                placeholder="ทุกสินค้า"
                value={productFilter}
                onChange={setProductFilter}
                options={[{ value: "", label: "ทุกสินค้า" }, ...sortedProducts.map((p) => ({ value: p.id, label: productName(p) }))]}
              />
            </div>
            {!isLoadingData && !loadError && !productsFailed && (
              <button
                type="button"
                onClick={() => setShowMissing((v) => !v)}
                aria-expanded={showMissing}
                className={`${SECONDARY_BUTTON} ml-auto`}
              >
                สินค้าที่ยังไม่มีสเปค
                <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 tabular-nums">{missing.length.toLocaleString("th-TH")}</span>
              </button>
            )}
          </div>

          {showMissing && !isLoadingData && !loadError && !productsFailed && (
            <div className="mb-5 rounded-2xl border border-gray-200 bg-gray-50/60 p-4" data-testid="products-without-specs">
              <p className="text-sm text-gray-500 mb-2">
                ใบเสนอราคาของสินค้าเหล่านี้ยังไม่มีสเปคให้เลือกเติม
              </p>
              {missing.length === 0 ? (
                <p className="text-sm font-medium text-gray-700">{query.trim() ? "ไม่พบสินค้าที่ตรงกับคำค้น" : "สินค้าทุกตัวมีสเปคแล้ว"}</p>
              ) : (
                <ul className="max-h-64 overflow-y-auto divide-y divide-gray-100 bg-white rounded-xl border border-gray-100">
                  {missing.map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-3 px-3 py-2">
                      <span className="text-sm text-gray-800 min-w-0">{productName(p)}</span>
                      <button
                        type="button"
                        onClick={() => openNew(p.id)}
                        aria-label={`เพิ่มสเปคให้ ${productName(p)}`}
                        className="shrink-0 text-sm font-semibold text-orange-600 hover:text-orange-700"
                      >
                        + เพิ่มสเปค
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {productsFailed && !loadError && (
            <div role="alert" className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              <span>โหลดรายชื่อสินค้าไม่สำเร็จ ชื่อสินค้าจึงยังไม่แสดง</span>
              <button type="button" onClick={retryLoad} className="font-semibold text-amber-900 hover:underline">ลองใหม่</button>
            </div>
          )}

          {loadError ? (
            <div role="alert" className="py-16 flex flex-col items-center gap-3 text-center">
              <p className="text-gray-800 font-semibold">โหลดสเปคไม่สำเร็จ</p>
              <p className="text-sm text-gray-500">ตรวจสอบการเชื่อมต่อแล้วลองใหม่อีกครั้ง</p>
              <button type="button" onClick={retryLoad} className={PRIMARY_BUTTON}>ลองใหม่</button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="bg-gray-50 text-gray-500 uppercase tracking-wider">
                    <th className={`${TH} rounded-l-xl w-64`}>หัวข้อสเปค</th>
                    <th className={TH}>รายละเอียด</th>
                    <th className={`${TH} text-right rounded-r-xl w-32`}>จัดการ</th>
                  </tr>
                </thead>
                {isLoadingData ? (
                  <tbody>
                    {Array.from({ length: 4 }).map((_, i) => (
                      <tr key={i} className="animate-pulse border-t border-gray-50">
                        <td className={TD}><div className="h-5 bg-gray-200 rounded w-32"></div></td>
                        <td className={TD}><div className="h-4 bg-gray-200 rounded w-80 mb-1.5"></div><div className="h-4 bg-gray-100 rounded w-64"></div></td>
                        <td className={TD}><div className="h-5 bg-gray-200 rounded w-16 ml-auto"></div></td>
                      </tr>
                    ))}
                  </tbody>
                ) : groups.length === 0 ? (
                  <tbody>
                    <tr>
                      <td colSpan={3} className="px-4 py-14 text-center text-gray-500">
                        <div className="flex flex-col items-center gap-3">
                          {productFilter && !query.trim() ? (
                            <>
                              <p>สินค้านี้ยังไม่มีสเปค</p>
                              <div className="flex gap-2">
                                <button type="button" onClick={() => openNew(productFilter)} className={PRIMARY_BUTTON}>+ เพิ่มสเปคให้สินค้านี้</button>
                                <button type="button" onClick={clearFilters} className={SECONDARY_BUTTON}>ดูทุกสินค้า</button>
                              </div>
                            </>
                          ) : filtering ? (
                            <>
                              <p>ไม่พบสเปคที่ตรงกับคำค้น</p>
                              <button type="button" onClick={clearFilters} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-xl hover:bg-gray-200 transition-all text-sm font-semibold">ล้างคำค้น</button>
                            </>
                          ) : (
                            <>
                              <p>ยังไม่มีสเปค</p>
                              <button type="button" onClick={() => openNew()} className={PRIMARY_BUTTON}>+ เพิ่มสเปคแรก</button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  </tbody>
                ) : (
                  groups.map((g) => (
                    // One product per group: its specs together, in order.
                    <tbody key={g.productId || "_unknown"} data-testid="spec-group">
                      <tr className="bg-orange-50/50 border-t border-orange-100">
                        <th scope="rowgroup" colSpan={3} className="px-4 py-2.5 text-left font-normal">
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2 min-w-0">
                              {g.productName ? (
                                <span className="font-semibold text-gray-900">{g.productName}</span>
                              ) : (
                                <span className="font-semibold text-gray-500">ไม่พบสินค้า</span>
                              )}
                              <span className="shrink-0 text-xs font-semibold px-2 py-0.5 rounded-full bg-white border border-orange-200 text-orange-700 tabular-nums">
                                {g.specs.length} สเปค
                              </span>
                            </div>
                            {g.productName && (
                              <button
                                type="button"
                                onClick={() => openNew(g.productId)}
                                aria-label={`เพิ่มสเปคให้ ${g.productName}`}
                                className="shrink-0 text-sm font-semibold text-orange-600 hover:text-orange-700"
                              >
                                + เพิ่มสเปคให้สินค้านี้
                              </button>
                            )}
                          </div>
                        </th>
                      </tr>
                      {g.specs.map((s) => {
                        const clamp = detailNeedsClamp(s.detail);
                        const open = expanded.has(s.id);
                        return (
                          <tr
                            key={s.id}
                            tabIndex={0}
                            aria-label={`แก้ไขสเปค ${s.name}`}
                            onClick={() => openEdit(s)}
                            // Built inside the event, not during render: openEdit touches a ref.
                            onKeyDown={(e) => openOnKey(() => openEdit(s))(e)}
                            className={`group align-top border-t border-gray-50 cursor-pointer hover:bg-gray-50 ${ROW_FOCUS} transition-colors`}
                          >
                            <td className={`${TD} font-medium text-gray-900 wrap-break-word`}>{s.name}</td>
                            <td className={`${TD} text-sm text-gray-600`}>
                              <p className={`whitespace-pre-line wrap-break-word ${clamp && !open ? "line-clamp-3" : ""}`} data-testid="spec-detail">
                                {s.detail}
                              </p>
                              {clamp && (
                                <button
                                  type="button"
                                  aria-expanded={open}
                                  onClick={(e) => { e.stopPropagation(); toggleExpanded(s.id); }}
                                  className="mt-1 text-xs font-semibold text-orange-600 hover:text-orange-700"
                                >
                                  {open ? "ย่อ" : "ดูเพิ่ม"}
                                </button>
                              )}
                            </td>
                            <td className={TD}>
                              <RowActions
                                name={s.name}
                                onCopy={() => openCopy(s)}
                                onEdit={() => openEdit(s)}
                                onDelete={() => setDeleteTarget(s)}
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  ))
                )}
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Editor — new, edit or copy. */}
      {editor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-gray-900/40 backdrop-blur-sm" onClick={requestClose} data-testid="spec-editor-backdrop"></div>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="spec-editor-title"
            onKeyDown={onEditorKeyDown}
            className="relative bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden"
          >
            <div className="px-8 py-5 border-b border-gray-100 flex justify-between items-center">
              <h2 id="spec-editor-title" className="text-2xl font-bold text-gray-800">{EDITOR_TITLE[editor.mode]}</h2>
              <button type="button" onClick={requestClose} aria-label="ปิด" className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors">
                <svg aria-hidden="true" className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
              </button>
            </div>

            <div ref={editorBodyRef} className="overflow-y-auto flex-1 px-8 py-6 space-y-5">
              {saveError && (
                <div role="alert" data-problem="" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{saveError}</div>
              )}
              <div>
                <span className="block text-sm font-semibold text-gray-700 mb-1.5">สินค้า <span className="text-red-500">*</span></span>
                <SearchableDropdown
                  className="w-full"
                  buttonClassName={`h-[46px] !px-4 !rounded-xl !shadow-none !text-base ${submitAttempted && errors.productId ? "!border-red-500 !bg-red-50" : "!border-gray-200 !bg-gray-50"}`}
                  placeholder="-- เลือกสินค้า --"
                  value={editor.draft.productId || ""}
                  onChange={(val) => setDraft({ productId: val })}
                  options={sortedProducts.map((p) => ({ value: p.id, label: productName(p) }))}
                />
                {submitAttempted && errors.productId && <p data-problem="" className="mt-1 text-sm text-red-600">{errors.productId}</p>}
              </div>
              <div>
                <label htmlFor="spec-name" className="block text-sm font-semibold text-gray-700 mb-1.5">หัวข้อสเปค <span className="text-red-500">*</span></label>
                <input
                  id="spec-name"
                  type="text"
                  autoFocus
                  maxLength={SPEC_NAME_MAX}
                  placeholder="เช่น สเปค 5kN"
                  className={`${FIELD} ${submitAttempted && errors.name ? "border-red-500 bg-red-50 focus:ring-red-500" : "border-gray-200 focus:ring-orange-500"}`}
                  value={editor.draft.name || ""}
                  onChange={(e) => setDraft({ name: e.target.value })}
                />
                <p className="mt-1 text-xs text-gray-400">ชื่อนี้คือสิ่งที่เห็นในช่องเลือกสเปคของใบเสนอราคา</p>
                {submitAttempted && errors.name && <p data-problem="" className="mt-1 text-sm text-red-600">{errors.name}</p>}
              </div>
              <div>
                <label htmlFor="spec-detail" className="block text-sm font-semibold text-gray-700 mb-1.5">รายละเอียด <span className="text-red-500">*</span></label>
                <textarea
                  id="spec-detail"
                  // Grows with the text (8–18 rows): a spec is often a dozen
                  // lines, and five rows meant scrolling inside the box.
                  rows={Math.min(18, Math.max(8, detailLines + 1))}
                  maxLength={SPEC_DETAIL_MAX}
                  placeholder="กรอกรายละเอียดสเปค บรรทัดละหนึ่งรายการ..."
                  className={`${FIELD} resize-y leading-relaxed ${submitAttempted && errors.detail ? "border-red-500 bg-red-50 focus:ring-red-500" : "border-gray-200 focus:ring-orange-500"}`}
                  value={editor.draft.detail || ""}
                  onChange={(e) => setDraft({ detail: e.target.value })}
                />
                <div className="mt-1 flex justify-between gap-3 text-xs">
                  <span className="text-red-600 text-sm" data-problem={submitAttempted && errors.detail ? "" : undefined}>{submitAttempted && errors.detail ? errors.detail : ""}</span>
                  <span className="text-gray-400 tabular-nums shrink-0" data-testid="spec-detail-count">
                    {(editor.draft.detail || "").length.toLocaleString("th-TH")} / {SPEC_DETAIL_MAX.toLocaleString("th-TH")}
                  </span>
                </div>
              </div>
            </div>

            <div className="px-8 py-5 border-t border-gray-100 bg-gray-50/50 flex flex-wrap items-center justify-between gap-3">
              <span className="text-xs text-gray-400">Ctrl + Enter บันทึก · Esc ปิด</span>
              <div className="flex gap-3">
                <button type="button" onClick={requestClose} disabled={isSaving} className="px-6 py-2.5 font-semibold text-gray-600 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 transition-all shadow-sm disabled:opacity-60">ยกเลิก</button>
                <button type="button" onClick={handleSave} disabled={isSaving} className={PRIMARY_BUTTON}>
                  {isSaving ? "กำลังบันทึก..." : "บันทึก"}
                </button>
              </div>
            </div>
          </div>
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

      {deleteTarget && (
        <ConfirmDialog
          title="ยืนยันการลบสเปค"
          message={`ลบ "${deleteTarget.name}"${productNameOf(deleteTarget.productId) ? ` ของ ${productNameOf(deleteTarget.productId)}` : ""}? ลบแล้วกู้คืนไม่ได้`}
          confirmText="ลบ"
          loading={isDeleting}
          onConfirm={handleDelete}
          onCancel={() => { if (!deletingRef.current) setDeleteTarget(null); }}
        />
      )}
    </div>
  );
}

"use client";
import { useState, useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "../context/AuthContext";
import Toast from "../components/Toast";
import ConfirmDialog from "../components/ConfirmDialog";
import SearchableDropdown from "../components/SearchableDropdown";
import { poDocNoPrefix, nextPoDocNo } from "../lib/poNumber";
import { DOCNO_START, pad2 } from "../lib/quotationNumber";
import { toLocalDateString } from "../lib/dateFormat";
import { computeQuoteTotals } from "../lib/quotationTotals";
import type { Supplier } from "../lib/types";

// ── ใบสั่งซื้อ (Purchase Order builder) ──────────────────────────────────────
// Admin-only tool, same shape as app/quotation/page.tsx: fill the form on the
// left, see a live A4 sheet on the right, "ดาวน์โหลด PDF" prints ONLY the
// sheet client-side (html2canvas + jsPDF — no server-side PDF dependency,
// same reason quotations avoid one: it has already broken this app on
// Vercel once).
//
// UNLIKE quotations, a PO is never edited in place once saved (spec:
// add-purchase-order) — reopening one (`?id=`) is always view-only. The only
// ways to change what an issued PO says are "ยกเลิกใบนี้" (cancel — stops it
// counting, keeps the row) and "ออกใบใหม่แทนใบนี้" (supersede — a brand-new
// PO, brand-new number, linked back to the old one), so there is no
// versioning/draft-autosave machinery here the way the quotation builder has.

const COMPANY = {
  name: "บริษัท โปรฟิน แล็บสเกล จำกัด",
  nameEn: "PROFIN LAB SCALE CO., LTD.",
  address:
    "93 ซอยงามวงศ์วาน 6 แยก 19 ถนนงามวงศ์วาน\nตำบลบางเขน อำเภอเมืองนนทบุรี จ.นนทบุรี 11000",
};

interface PoItem {
  id: string;
  name: string;
  description: string;
  qty: number;
  unit: string;
  unitPrice: number;
  discount?: number;
  discountType?: "amount" | "percent";
}

interface PoState {
  id: string;
  docNo: string;
  docDate: string; // yyyy-mm-dd
  deliveryDate: string; // วันที่ต้องการรับสินค้า
  issuedBy: string; // ผู้จัดทำ/ผู้สั่งซื้อ
  companyTaxId: string;
  supplierId?: string;
  supplierCompany: string;
  supplierContact: string;
  supplierPhone: string;
  supplierAddress: string;
  supplierTaxId: string;
  items: PoItem[];
  discount: number;
  discountType: "amount" | "percent";
  vatEnabled: boolean;
  paymentTerms: string;
  deliveryTerms: string;
  note: string;
}

function randomId(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

function newItem(): PoItem {
  return { id: randomId(), name: "", description: "", qty: 1, unit: "ชิ้น", unitPrice: 0 };
}

function emptyState(): PoState {
  return {
    id: "",
    docNo: "",
    docDate: "",
    deliveryDate: "",
    issuedBy: "",
    companyTaxId: "",
    supplierCompany: "",
    supplierContact: "",
    supplierPhone: "",
    supplierAddress: "",
    supplierTaxId: "",
    items: [],
    discount: 0,
    discountType: "amount",
    vatEnabled: true,
    paymentTerms: "ชำระเงิน 100% ก่อนส่งมอบสินค้า",
    deliveryTerms: "30-45 วัน หลังยืนยันคำสั่งซื้อ",
    note: "",
  };
}

const fmt = (n: number) =>
  n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const thaiDate = (iso: string) => {
  if (!iso) return "-";
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const months = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
  return `${d} ${months[m - 1]} ${y + 543}`;
};

// A number field that keeps the user's RAW text (so partial values like "0.5"
// aren't clobbered by controlled-input reconciliation). Same component
// quotation's builder uses.
function NumberInput({
  value,
  onChange,
  className,
  placeholder,
  ariaLabel,
}: {
  value: number;
  onChange: (value: number) => void;
  className?: string;
  placeholder?: string;
  ariaLabel?: string;
}) {
  const [text, setText] = useState(value === 0 ? "" : String(value));
  useEffect(() => {
    if ((Number(text) || 0) !== value) setText(value === 0 ? "" : String(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <input
      type="text"
      inputMode="decimal"
      aria-label={ariaLabel}
      className={className}
      placeholder={placeholder}
      value={text}
      onChange={(e) => {
        const raw = e.target.value;
        if (raw !== "" && !/^\d*\.?\d*$/.test(raw)) return;
        setText(raw);
        onChange(Math.max(0, Number(raw) || 0));
      }}
    />
  );
}

interface PoSummary {
  id: string;
  docNo: string;
  docDate: string;
  createdAt: string;
  supplier: string;
  total: number;
  cancelledAt: string | null;
  supersededById: string | null;
}

const inputCls =
  "w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-orange-500/20 outline-none transition-all disabled:bg-gray-50 disabled:text-gray-500";
const labelCls = "block text-xs font-semibold text-gray-600 mb-1";

export default function PurchaseOrderPage() {
  const router = useRouter();
  const { isLoggedIn, isLoading } = useAuth();
  const [po, setPo] = useState<PoState>(emptyState);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [viewMode, setViewMode] = useState(false);
  const [loadedMeta, setLoadedMeta] = useState<{ cancelledAt: string | null; supersededById: string | null } | null>(null);
  const [supersedeOf, setSupersedeOf] = useState<string | null>(null);
  const [recent, setRecent] = useState<PoSummary[]>([]);
  const [recentSearch, setRecentSearch] = useState("");
  const [loadingRecord, setLoadingRecord] = useState(false);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);

  const [cancelling, setCancelling] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const hydratedRef = useRef(false);

  useEffect(() => {
    if (!isLoading && !isLoggedIn) router.replace("/login");
  }, [isLoggedIn, isLoading, router]);

  const showToast = (message: string, type: "success" | "error") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  const fetchSuppliers = async () => {
    try {
      const res = await fetch("/api/suppliers");
      if (res.ok) setSuppliers(await res.json());
    } catch {
      /* the supplier picker just stays empty — typing the fields by hand still works */
    }
  };

  const fetchRecent = async () => {
    try {
      const res = await fetch("/api/purchase-orders");
      if (res.ok) setRecent(await res.json());
    } catch {
      /* the recent-list panel just stays empty */
    }
  };

  /** The next free PO number for `isoDate`, read from the non-windowed ledger
   *  (never the 7-day one — see quotationNumber.ts's header for why minting
   *  from a windowed list can hand back a number the ledger already owns). */
  async function mintDocNo(isoDate: string): Promise<string> {
    const prefix = poDocNoPrefix(isoDate);
    try {
      const res = await fetch(`/api/purchase-orders/docnos?base=${encodeURIComponent(prefix)}`);
      if (res.ok) {
        const list = await res.json();
        const used = (Array.isArray(list) ? list : []).map((d: { docNo?: string }) => d.docNo || "");
        return nextPoDocNo(isoDate, used);
      }
    } catch {
      /* fall through to the un-checked starting number below */
    }
    return `${prefix}${pad2(DOCNO_START)}`;
  }

  async function seedFresh() {
    const iso = toLocalDateString(new Date());
    const docNo = await mintDocNo(iso);
    setPo({ ...emptyState(), id: randomId(), docDate: iso, docNo, items: [newItem()] });
    setViewMode(false);
    setLoadedMeta(null);
    setSupersedeOf(null);
  }

  async function loadExisting(id: string) {
    setLoadingRecord(true);
    try {
      const res = await fetch(`/api/purchase-orders/${encodeURIComponent(id)}`);
      if (!res.ok) {
        showToast("ไม่พบใบสั่งซื้อ", "error");
        await seedFresh();
        return;
      }
      const rec = await res.json();
      setPo({ ...emptyState(), ...(rec.data || {}), id: rec.id, docNo: rec.docNo || "" });
      setLoadedMeta({ cancelledAt: rec.cancelledAt ?? null, supersededById: rec.supersededById ?? null });
      setViewMode(true);
      setSupersedeOf(null);
    } catch {
      showToast("โหลดใบสั่งซื้อไม่สำเร็จ", "error");
      await seedFresh();
    } finally {
      setLoadingRecord(false);
    }
  }

  // Hydrate ONCE on mount: reopen a saved PO (?id=…) or seed a fresh one.
  // Reads window.location.search directly (not useSearchParams) so this page
  // never needs a Suspense boundary — same trick app/quotation/page.tsx uses.
  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    fetchSuppliers();
    fetchRecent();
    const params = new URLSearchParams(window.location.search);
    const id = params.get("id");
    if (id) {
      loadExisting(id);
    } else {
      seedFresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function set<K extends keyof PoState>(key: K, value: PoState[K]) {
    setPo((prev) => ({ ...prev, [key]: value }));
  }

  function updateItem(id: string, patch: Partial<PoItem>) {
    setPo((prev) => ({
      ...prev,
      items: prev.items.map((it) => (it.id === id ? { ...it, ...patch } : it)),
    }));
  }

  function removeItem(id: string) {
    setPo((prev) => ({ ...prev, items: prev.items.filter((it) => it.id !== id) }));
  }

  function addItem() {
    setPo((prev) => ({ ...prev, items: [...prev.items, newItem()] }));
  }

  function pickSupplier(id: string) {
    const s = suppliers.find((x) => x.id === id);
    if (!s) return;
    setPo((prev) => ({
      ...prev,
      supplierId: s.id,
      supplierCompany: s.companyName,
      supplierContact: s.contactName || "",
      supplierPhone: s.phone || "",
      supplierAddress: s.address || "",
      supplierTaxId: s.taxId || "",
    }));
  }

  const totals = useMemo(() => computeQuoteTotals(po), [po]);
  const filteredRecent = useMemo(() => {
    const term = recentSearch.trim().toLowerCase();
    if (!term) return recent;
    return recent.filter(
      (r) => r.docNo.toLowerCase().includes(term) || r.supplier.toLowerCase().includes(term)
    );
  }, [recent, recentSearch]);
  const { subtotal, lines, lineDiscountTotal, afterLineDiscounts, discountValue, afterDiscount, vat, grandTotal } = totals;
  const hasLineDiscounts = lines.some((l) => l.discountValue > 0);

  const isCancelled = Boolean(loadedMeta?.cancelledAt);
  const isSuperseded = Boolean(loadedMeta?.supersededById);
  const isReadOnly = viewMode && !supersedeOf;

  /** The 409 path both create and supersede share: re-read the day's
   *  non-windowed ledger and advance past the taken number. NOT
   *  auto-resubmitted — the number is printed on a document a supplier
   *  receives, so the admin sees the new one before it is committed. */
  async function handleDocNoConflict(serverMessage?: string | null) {
    const taken = po.docNo.trim();
    const next = await mintDocNo(po.docDate || toLocalDateString(new Date()));
    if (!next || next === taken) {
      showToast(serverMessage || "เลขที่ใบสั่งซื้อซ้ำ กรุณาเปลี่ยนเลขที่", "error");
      return;
    }
    setPo((prev) => (prev.docNo.trim() === taken ? { ...prev, docNo: next } : prev));
    showToast(
      `เลขที่ ${taken} ถูกใช้ไปแล้ว ระบบเปลี่ยนเป็น ${next} ให้อัตโนมัติ — กรุณากดบันทึกอีกครั้ง`,
      "error"
    );
  }

  async function handleSave(): Promise<boolean> {
    if (saving) return false;
    if (po.items.length === 0) {
      showToast("กรุณาเพิ่มรายการสินค้าอย่างน้อย 1 รายการ", "error");
      return false;
    }
    setSaving(true);
    try {
      const endpoint = supersedeOf
        ? `/api/purchase-orders/${encodeURIComponent(supersedeOf)}/supersede`
        : "/api/purchase-orders";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: po.id, docNo: po.docNo, data: po }),
      });
      if (res.status === 409) {
        const data = await res.json().catch(() => null);
        await handleDocNoConflict(data?.error);
        return false;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        showToast(data?.error || "บันทึกใบสั่งซื้อไม่สำเร็จ", "error");
        return false;
      }
      showToast(supersedeOf ? "ออกใบสั่งซื้อใหม่แทนใบเดิมสำเร็จ" : "บันทึกใบสั่งซื้อสำเร็จ", "success");
      setViewMode(true);
      setLoadedMeta({ cancelledAt: null, supersededById: null });
      setSupersedeOf(null);
      router.replace(`/purchase-order?id=${encodeURIComponent(po.id)}`);
      fetchRecent();
      return true;
    } catch {
      showToast("เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ กรุณาลองใหม่", "error");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function handleCancel() {
    if (cancelling) return;
    setCancelling(true);
    try {
      const res = await fetch(`/api/purchase-orders/${encodeURIComponent(po.id)}/cancel`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        showToast(data?.error || "ยกเลิกใบสั่งซื้อไม่สำเร็จ", "error");
        return;
      }
      setLoadedMeta((prev) => (prev ? { ...prev, cancelledAt: new Date().toISOString() } : prev));
      showToast("ยกเลิกใบสั่งซื้อสำเร็จ", "success");
      setShowCancelConfirm(false);
      fetchRecent();
    } catch {
      showToast("เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ กรุณาลองใหม่", "error");
    } finally {
      setCancelling(false);
    }
  }

  async function handleDelete(id: string) {
    if (deletingId) return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/purchase-orders/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        showToast(data?.error || "ลบใบสั่งซื้อไม่สำเร็จ", "error");
        return;
      }
      // Remove from the local list immediately
      setRecent((prev) => prev.filter((r) => r.id !== id));
      showToast("ลบใบสั่งซื้อสำเร็จ", "success");
      setPendingDeleteId(null);
      // If currently viewing the deleted PO, reset to a fresh form
      if (po.id === id) {
        seedFresh();
        router.replace("/purchase-order");
      }
    } catch {
      showToast("เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ กรุณาลองใหม่", "error");
    } finally {
      setDeletingId(null);
    }
  }

  async function startSupersede() {
    const oldId = po.id;
    const iso = toLocalDateString(new Date());
    const docNo = await mintDocNo(iso);
    setPo((prev) => ({ ...prev, id: randomId(), docNo, docDate: iso }));
    setSupersedeOf(oldId);
    setViewMode(false);
    setLoadedMeta(null);
    showToast(`สร้างใบสั่งซื้อใหม่ ${docNo} แทนใบเดิม — แก้ไขแล้วกดบันทึก`, "success");
  }

  // ── PDF — client-side html2canvas + jsPDF, paginated to A4. Same algorithm
  // app/quotation/page.tsx's generatePdf() uses, with the PO sheet's element
  // ids substituted in. ──────────────────────────────────────────────────────
  async function generatePdf() {
    const originalSheet = document.getElementById("po-sheet");
    if (!originalSheet) return;

    const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
      import("html2canvas-pro"),
      import("jspdf"),
    ]);

    const container = document.createElement("div");
    container.style.position = "absolute";
    container.style.left = "-9999px";
    container.style.top = "0";
    container.style.width = originalSheet.style.width;
    document.body.appendChild(container);

    const A4_HEIGHT_PX = originalSheet.offsetWidth * (297 / 210);
    const paddingBottomPx = originalSheet.offsetWidth * (14 / 210);
    const PAGE_MAX_HEIGHT = A4_HEIGHT_PX - paddingBottomPx;

    const tbody = document.getElementById("po-tbody");
    const rows = Array.from(tbody?.querySelectorAll("tr") || []);
    const rowHeights = rows.map((r) => (r as HTMLElement).offsetHeight);

    const headerHeightFirstPage = document.getElementById("po-header")?.offsetHeight || 0;
    const supplierInfoHeight = document.getElementById("po-supplier-info")?.offsetHeight || 0;
    const headerHeightSubsequentPages = headerHeightFirstPage - supplierInfoHeight;

    const tableHeaderHeight = document.getElementById("po-table")?.querySelector("thead")?.offsetHeight || 0;
    const footerHeight = document.getElementById("po-footer")?.offsetHeight || 0;
    const signaturesHeight = document.getElementById("po-signatures")?.offsetHeight || 0;
    const extraFooterHeight = footerHeight + signaturesHeight + 80;

    const pages: HTMLElement[] = [];

    const hideFooter = (clone: HTMLElement) => {
      const f = clone.querySelector("#po-footer") as HTMLElement;
      const s = clone.querySelector("#po-signatures") as HTMLElement;
      if (f) f.style.display = "none";
      if (s) s.style.display = "none";
    };
    const hideSupplierInfo = (clone: HTMLElement) => {
      const c = clone.querySelector("#po-supplier-info") as HTMLElement;
      if (c) c.style.display = "none";
    };

    let currentClone = originalSheet.cloneNode(true) as HTMLElement;
    currentClone.style.height = "297mm";
    currentClone.style.minHeight = "297mm";
    currentClone.style.overflow = "hidden";
    currentClone.style.backgroundColor = "white";
    currentClone.id = "";

    let currentTbody = currentClone.querySelector("#po-tbody") as HTMLElement;
    currentTbody.innerHTML = "";

    const paddingTopPx = originalSheet.offsetWidth * (12 / 210);
    let currentHeight = headerHeightFirstPage + tableHeaderHeight + paddingTopPx;

    let i = 0;
    while (i < rows.length) {
      const rh = rowHeights[i];
      if (currentHeight + rh > PAGE_MAX_HEIGHT && currentTbody.children.length > 0) {
        hideFooter(currentClone);
        pages.push(currentClone);

        currentClone = originalSheet.cloneNode(true) as HTMLElement;
        currentClone.style.height = "297mm";
        currentClone.style.minHeight = "297mm";
        currentClone.style.overflow = "hidden";
        currentClone.style.backgroundColor = "white";
        currentClone.id = "";
        hideSupplierInfo(currentClone);
        currentTbody = currentClone.querySelector("#po-tbody") as HTMLElement;
        currentTbody.innerHTML = "";
        currentHeight = headerHeightSubsequentPages + tableHeaderHeight + paddingTopPx;
      } else {
        currentTbody.appendChild(rows[i].cloneNode(true));
        currentHeight += rh;
        i++;
      }
    }

    if (currentHeight + extraFooterHeight > PAGE_MAX_HEIGHT && currentTbody.children.length > 0) {
      hideFooter(currentClone);
      pages.push(currentClone);

      currentClone = originalSheet.cloneNode(true) as HTMLElement;
      currentClone.style.height = "297mm";
      currentClone.style.minHeight = "297mm";
      currentClone.style.overflow = "hidden";
      currentClone.style.backgroundColor = "white";
      currentClone.id = "";
      hideSupplierInfo(currentClone);
      currentTbody = currentClone.querySelector("#po-tbody") as HTMLElement;
      currentTbody.innerHTML = "";
      pages.push(currentClone);
    } else {
      pages.push(currentClone);
    }

    if (pages.length > 1) {
      pages.forEach((page, idx) => {
        const topRightDiv = page.querySelector(".text-right.shrink-0");
        if (topRightDiv) {
          const pageNum = document.createElement("div");
          pageNum.className = "text-[11px] text-gray-500 mt-2 font-bold text-right";
          pageNum.innerText = `หน้า ${idx + 1}/${pages.length}`;
          topRightDiv.appendChild(pageNum);
        }
      });
    }

    for (const p of pages) container.appendChild(p);

    const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();

    for (let pIdx = 0; pIdx < pages.length; pIdx++) {
      const canvas = await html2canvas(pages[pIdx], { scale: 2, useCORS: true, backgroundColor: "#ffffff" });
      const imgData = canvas.toDataURL("image/jpeg", 0.95);
      if (pIdx > 0) pdf.addPage();
      pdf.addImage(imgData, "JPEG", 0, 0, pageW, pageH);
    }

    pdf.save(`PO-${(po.docNo || "document").replace(/[^\w.-]/g, "_")}.pdf`);
    document.body.removeChild(container);
  }

  async function handleDownloadPdf() {
    if (generating) return;
    setGenerating(true);
    try {
      // A PO that hasn't been saved yet (or is being superseded) is saved
      // first — a PDF is the copy a supplier keeps, so it must correspond to
      // a real record.
      if (!viewMode || supersedeOf) {
        const saved = await handleSave();
        if (!saved) return;
      }
      await generatePdf();
    } catch {
      showToast("สร้าง PDF ไม่สำเร็จ กรุณาลองใหม่", "error");
    } finally {
      setGenerating(false);
    }
  }



  const supplierOptions = suppliers.map((s) => ({
    value: s.id,
    label: s.companyName,
    subLabel: s.contactName || undefined,
  }));

  if (isLoading || !isLoggedIn) {
    return (
      <div className="flex justify-center items-center h-screen bg-gray-50">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-600"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50/50">
      {toast && (
        <div className="fixed top-6 right-6 z-[100] animate-in slide-in-from-top-4 fade-in">
          <Toast message={toast.message} type={toast.type} />
        </div>
      )}

      <div className="bg-white border-b border-gray-100 sticky top-0 z-30">
        <div className="max-w-[1560px] mx-auto px-4 sm:px-6 py-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
          <div>
            <Link href="/adminpanel" className="inline-flex items-center gap-1.5 text-sm font-semibold text-gray-500 hover:text-gray-800 transition-colors mb-1">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              กลับไประบบจัดการ
            </Link>
            <h1 className="text-xl font-bold text-gray-900">📝 ใบสั่งซื้อ (Purchase Order)</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {isReadOnly && !isCancelled && !isSuperseded && (
              <button
                onClick={startSupersede}
                className="px-4 py-2 bg-white border border-gray-200 text-gray-700 font-semibold rounded-xl hover:bg-gray-50 text-sm shadow-sm"
              >
                ✏️ ออกใบใหม่แทนใบนี้
              </button>
            )}
            {isReadOnly && !isCancelled && !isSuperseded && (
              <button
                onClick={() => setShowCancelConfirm(true)}
                className="px-4 py-2 bg-white border border-red-200 text-red-600 font-semibold rounded-xl hover:bg-red-50 text-sm shadow-sm"
              >
                ยกเลิกใบนี้
              </button>
            )}
            <button
              onClick={() => seedFresh()}
              className="px-4 py-2 bg-white border border-gray-200 text-gray-700 font-semibold rounded-xl hover:bg-gray-50 text-sm shadow-sm"
            >
              + สร้างใบใหม่
            </button>
            {!isReadOnly && (
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-2 bg-gray-800 hover:bg-gray-900 text-white font-semibold rounded-xl text-sm shadow-sm disabled:opacity-50"
              >
                {saving ? "กำลังบันทึก..." : "บันทึก"}
              </button>
            )}

            <button
              onClick={handleDownloadPdf}
              disabled={generating}
              className="px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white font-semibold rounded-xl text-sm shadow-sm disabled:opacity-50"
            >
              {generating ? "กำลังสร้าง..." : "⬇️ ดาวน์โหลด PDF"}
            </button>
          </div>
        </div>
      </div>

      {(isCancelled || isSuperseded) && (
        <div className={`max-w-[1560px] mx-auto px-4 sm:px-6 pt-4`}>
          <div className={`rounded-xl border px-4 py-3 text-sm font-semibold ${isCancelled ? "bg-red-50 border-red-200 text-red-700" : "bg-amber-50 border-amber-200 text-amber-700"}`}>
            {isCancelled ? "⚠️ ใบสั่งซื้อนี้ถูกยกเลิกแล้ว" : "ℹ️ ใบสั่งซื้อนี้ถูกออกใบใหม่แทนไปแล้ว"}
          </div>
        </div>
      )}

      <div className={`max-w-[1560px] mx-auto px-4 sm:px-6 py-6 ${isReadOnly ? "flex flex-col items-center" : "grid grid-cols-1 xl:grid-cols-[380px_1fr] 2xl:grid-cols-[400px_1fr]"} gap-6 items-start`}>
        {/* ══ LEFT: form ══ */}
        {!isReadOnly && (
          <div className="space-y-5">
            <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-4">
              <h2 className="font-bold text-gray-800">ข้อมูลเอกสาร</h2>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>เลขที่ใบสั่งซื้อ</label>
                  <input
                    aria-label="เลขที่ใบสั่งซื้อ"
                    className={inputCls}
                    value={po.docNo}
                    onChange={(e) => set("docNo", e.target.value)}
                  />
                </div>
                <div>
                  <label className={labelCls}>วันที่ออกเอกสาร</label>
                  <input type="date" className={inputCls} value={po.docDate} onChange={(e) => set("docDate", e.target.value)} />
                </div>
                <div>
                  <label className={labelCls}>วันที่ต้องการรับสินค้า</label>
                  <input type="date" className={inputCls} value={po.deliveryDate} onChange={(e) => set("deliveryDate", e.target.value)} />
                </div>
                <div>
                  <label className={labelCls}>ผู้จัดทำ/ผู้สั่งซื้อ</label>
                  <input className={inputCls} value={po.issuedBy} onChange={(e) => set("issuedBy", e.target.value)} placeholder="ชื่อผู้สั่งซื้อ" />
                </div>
                <div className="col-span-2">
                  <label className={labelCls}>เลขประจำตัวผู้เสียภาษี (ผู้ซื้อ)</label>
                  <input className={inputCls} value={po.companyTaxId} onChange={(e) => set("companyTaxId", e.target.value)} placeholder="0-0000-00000-00-0" />
                </div>
              </div>
            </section>

            <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-4">
              <h2 className="font-bold text-gray-800">ผู้ขาย / ซัพพลายเออร์</h2>
              <div>
                <label className={labelCls}>เลือกจากรายชื่อซัพพลายเออร์ (ไม่บังคับ)</label>
                <SearchableDropdown
                  options={supplierOptions}
                  value={po.supplierId || ""}
                  onChange={pickSupplier}
                  placeholder="ค้นหาซัพพลายเออร์..."
                />
              </div>
              <div>
                <label className={labelCls}>ชื่อบริษัท</label>
                <input
                  aria-label="ชื่อบริษัทซัพพลายเออร์"
                  className={inputCls}
                  value={po.supplierCompany}
                  onChange={(e) => set("supplierCompany", e.target.value)}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>ผู้ติดต่อ</label>
                  <input className={inputCls} value={po.supplierContact} onChange={(e) => set("supplierContact", e.target.value)} />
                </div>
                <div>
                  <label className={labelCls}>เบอร์โทร</label>
                  <input className={inputCls} value={po.supplierPhone} onChange={(e) => set("supplierPhone", e.target.value)} />
                </div>
              </div>
              <div>
                <label className={labelCls}>ที่อยู่</label>
                <textarea className={inputCls} rows={2} value={po.supplierAddress} onChange={(e) => set("supplierAddress", e.target.value)} />
              </div>
              <div>
                <label className={labelCls}>เลขประจำตัวผู้เสียภาษี</label>
                <input className={inputCls} value={po.supplierTaxId} onChange={(e) => set("supplierTaxId", e.target.value)} placeholder="0-0000-00000-00-0" />
              </div>
            </section>

            <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="font-bold text-gray-800">รายการสินค้า</h2>
                <button onClick={addItem} className="px-3 py-1.5 bg-orange-50 text-orange-700 font-semibold rounded-lg text-sm hover:bg-orange-100">
                  + เพิ่มรายการ
                </button>
              </div>
              <div className="space-y-3">
                {po.items.map((it, idx) => (
                  <div key={it.id} className="border border-gray-100 rounded-xl p-3 space-y-2">
                    <div className="flex items-start gap-2">
                      <span className="text-xs font-bold text-gray-400 mt-2 w-4">{idx + 1}</span>
                      <div className="flex-1 space-y-2">
                        <input
                          aria-label={`ชื่อรายการ ${idx + 1}`}
                          className={inputCls}
                          placeholder="ชื่อรายการ"
                          value={it.name}
                          onChange={(e) => updateItem(it.id, { name: e.target.value })}
                        />
                        <textarea
                          className={inputCls}
                          placeholder="รายละเอียดเพิ่มเติม (ไม่บังคับ)"
                          rows={2}
                          value={it.description}
                          onChange={(e) => updateItem(it.id, { description: e.target.value })}
                        />
                        <div className="grid grid-cols-3 gap-2">
                          <div>
                            <label className={labelCls}>จำนวน</label>
                            <NumberInput
                              ariaLabel={`จำนวน ${idx + 1}`}
                              className={inputCls}
                              value={it.qty}
                              onChange={(v) => updateItem(it.id, { qty: v })}
                            />
                          </div>
                          <div>
                            <label className={labelCls}>หน่วย</label>
                            <input className={inputCls} value={it.unit} onChange={(e) => updateItem(it.id, { unit: e.target.value })} />
                          </div>
                          <div>
                            <label className={labelCls}>ราคา/หน่วย</label>
                            <NumberInput
                              ariaLabel={`ราคาต่อหน่วย ${idx + 1}`}
                              className={inputCls}
                              value={it.unitPrice}
                              onChange={(v) => updateItem(it.id, { unitPrice: v })}
                            />
                          </div>
                        </div>
                      </div>
                      <button
                        onClick={() => removeItem(it.id)}
                        className="p-2 text-gray-400 hover:text-red-500 rounded-lg hover:bg-red-50"
                        title="ลบรายการ"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </div>
                ))}
                {po.items.length === 0 && (
                  <p className="text-center text-gray-400 text-sm py-6">ยังไม่มีรายการสินค้า — กด &quot;เพิ่มรายการ&quot;</p>
                )}
              </div>
            </section>

            <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-4">
              <h2 className="font-bold text-gray-800">ส่วนลด / ภาษี</h2>
              <div className="grid grid-cols-2 gap-3 items-end">
                <div>
                  <label className={labelCls}>ส่วนลดท้ายใบ</label>
                  <NumberInput className={inputCls} value={po.discount} onChange={(v) => set("discount", v)} />
                </div>
                <SearchableDropdown
                  searchable={false}
                  className="w-full"
                  buttonClassName={`${inputCls} h-[38px]`}
                  value={po.discountType}
                  options={[
                    { value: "amount", label: "บาท (฿)" },
                    { value: "percent", label: "เปอร์เซ็นต์ (%)" },
                  ]}
                  onChange={(val) => set("discountType", val as "amount" | "percent")}
                />
              </div>
              <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
                <input type="checkbox" checked={po.vatEnabled} onChange={(e) => set("vatEnabled", e.target.checked)} />
                คิดภาษีมูลค่าเพิ่ม 7%
              </label>
            </section>

            <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-4">
              <h2 className="font-bold text-gray-800">เงื่อนไข / หมายเหตุ</h2>
              <div>
                <label className={labelCls}>เงื่อนไขการชำระเงิน</label>
                <input className={inputCls} value={po.paymentTerms} onChange={(e) => set("paymentTerms", e.target.value)} />
              </div>
              <div>
                <label className={labelCls}>เงื่อนไขการส่งมอบ</label>
                <input className={inputCls} value={po.deliveryTerms} onChange={(e) => set("deliveryTerms", e.target.value)} />
              </div>
              <div>
                <label className={labelCls}>หมายเหตุเพิ่มเติม</label>
                <textarea className={inputCls} rows={2} value={po.note} onChange={(e) => set("note", e.target.value)} />
              </div>
            </section>
          </div>
        )}

        {/* ══ RIGHT: A4 sheet + recent list (view mode uses the full width) ══ */}
        <div className={isReadOnly ? "w-full max-w-[210mm]" : "min-w-0 w-full"}>
          <div className="overflow-x-auto rounded-sm pb-2">
            <div
              id="po-sheet"
              className="bg-white shadow-lg border border-gray-200 rounded-sm mx-auto text-gray-900"
              style={{ width: "210mm", minHeight: "297mm", padding: "12mm 14mm", fontSize: "13px", lineHeight: 1.55 }}
            >
              <div id="po-header">
                <div className="flex justify-between items-start gap-4 pb-3 border-b-2 border-gray-800">
                  <div className="flex items-start gap-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src="/images/profin-logo-3.png"
                      alt="Profin Lab Scale"
                      className="shrink-0 object-contain"
                      style={{ width: "11mm", height: "auto" }}
                    />
                    <div>
                      <div className="text-lg font-bold">{COMPANY.name}</div>
                      <div className="text-xs text-gray-600">{COMPANY.nameEn}</div>
                      <div className="text-xs mt-1 max-w-[95mm] whitespace-pre-line">{COMPANY.address}</div>
                      {po.companyTaxId && <div className="text-xs mt-0.5">เลขประจำตัวผู้เสียภาษี {po.companyTaxId}</div>}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-2xl font-bold tracking-wide">ใบสั่งซื้อ</div>
                    <div className="text-sm text-gray-500 tracking-widest">PURCHASE ORDER</div>
                  </div>
                </div>

                <div id="po-supplier-info" className="flex justify-between gap-6 mt-3 text-[12.5px]">
                  <div className="flex-1">
                    <div className="font-bold text-gray-700 mb-1">ผู้ขาย (Supplier)</div>
                    <div className="font-semibold">{po.supplierCompany || "-"}</div>
                    {po.supplierContact && <div>ผู้ติดต่อ: {po.supplierContact}</div>}
                    {po.supplierAddress && <div className="whitespace-pre-line text-gray-700">{po.supplierAddress}</div>}
                    {po.supplierPhone && <div className="text-gray-700">โทร {po.supplierPhone}</div>}
                    {po.supplierTaxId && <div className="text-gray-700">เลขผู้เสียภาษี {po.supplierTaxId}</div>}
                  </div>
                  <table className="shrink-0 self-start text-[12.5px]">
                    <tbody>
                      <tr>
                        <td className="pr-3 py-0.5 font-bold text-gray-700 text-right">เลขที่ (No.)</td>
                        <td className="py-0.5 text-right">{po.docNo || "-"}</td>
                      </tr>
                      <tr>
                        <td className="pr-3 py-0.5 font-bold text-gray-700 text-right">วันที่ (Date)</td>
                        <td className="py-0.5 text-right">{thaiDate(po.docDate)}</td>
                      </tr>
                      <tr>
                        <td className="pr-3 py-0.5 font-bold text-gray-700 text-right">กำหนดรับสินค้า</td>
                        <td className="py-0.5 text-right">{po.deliveryDate ? thaiDate(po.deliveryDate) : "-"}</td>
                      </tr>
                      {po.issuedBy && (
                        <tr>
                          <td className="pr-3 py-0.5 font-bold text-gray-700 text-right">ผู้สั่งซื้อ</td>
                          <td className="py-0.5 text-right">{po.issuedBy}</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <table id="po-table" className="w-full mt-4 border-collapse text-[12.5px]">
                <thead>
                  <tr className="bg-gray-800 text-white">
                    <th className="border border-gray-800 px-2 py-1.5 w-[8mm]">ลำดับ</th>
                    <th className="border border-gray-800 px-2 py-1.5 text-left">รายการ</th>
                    <th className="border border-gray-800 px-2 py-1.5 w-[14mm]">จำนวน</th>
                    <th className="border border-gray-800 px-2 py-1.5 w-[14mm]">หน่วย</th>
                    <th className="border border-gray-800 px-2 py-1.5 w-[24mm]">ราคา/หน่วย</th>
                    {hasLineDiscounts && <th className="border border-gray-800 px-2 py-1.5 w-[22mm]">ส่วนลด</th>}
                    <th className="border border-gray-800 px-2 py-1.5 w-[26mm]">จำนวนเงิน (บาท)</th>
                  </tr>
                </thead>
                <tbody id="po-tbody">
                  {po.items.length === 0 && (
                    <tr>
                      <td colSpan={hasLineDiscounts ? 7 : 6} className="border border-gray-300 px-2 py-6 text-center text-gray-400">
                        — ยังไม่มีรายการสินค้า —
                      </td>
                    </tr>
                  )}
                  {po.items.map((it, idx) => (
                    <tr key={it.id} className="align-top">
                      <td className="border border-gray-300 px-2 py-1.5 text-center">{idx + 1}</td>
                      <td className="border border-gray-300 px-2 py-1.5">
                        <div className="font-semibold">{it.name || "-"}</div>
                        {it.description && <div className="mt-1 text-gray-600 whitespace-pre-line text-[11.5px]">{it.description}</div>}
                      </td>
                      <td className="border border-gray-300 px-2 py-1.5 text-center">{it.qty}</td>
                      <td className="border border-gray-300 px-2 py-1.5 text-center">{it.unit}</td>
                      <td className="border border-gray-300 px-2 py-1.5 text-right">{fmt(it.unitPrice)}</td>
                      {hasLineDiscounts && (
                        <td className="border border-gray-300 px-2 py-1.5 text-right">
                          {(lines[idx]?.discountValue ?? 0) > 0 ? (
                            <>
                              -{fmt(lines[idx].discountValue)}
                              {it.discountType === "percent" && <div className="text-[11px] text-gray-500">({it.discount}%)</div>}
                            </>
                          ) : (
                            "-"
                          )}
                        </td>
                      )}
                      <td className="border border-gray-300 px-2 py-1.5 text-right">
                        {fmt(hasLineDiscounts ? lines[idx].netAmount : it.qty * it.unitPrice)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div id="po-footer" className="flex justify-between gap-6 mt-3">
                <div className="flex-1 text-[12px]">
                  {po.note && (
                    <div className="mt-3 space-y-0.5 text-gray-700">
                      <div className="font-bold text-gray-800">หมายเหตุ</div>
                      <div className="whitespace-pre-line">{po.note}</div>
                    </div>
                  )}
                </div>
                <table className="shrink-0 self-start w-[70mm] text-[12.5px]">
                  <tbody>
                    {hasLineDiscounts ? (
                      <>
                        <tr>
                          <td className="py-1 pr-2">รวมราคาก่อนหักส่วนลด</td>
                          <td className="py-1 text-right">{fmt(subtotal)}</td>
                        </tr>
                        <tr>
                          <td className="py-1 pr-2">ส่วนลดรายรายการ</td>
                          <td className="py-1 text-right">-{fmt(lineDiscountTotal)}</td>
                        </tr>
                        <tr>
                          <td className="py-1 pr-2">รวมเป็นเงิน</td>
                          <td className="py-1 text-right">{fmt(afterLineDiscounts)}</td>
                        </tr>
                      </>
                    ) : (
                      <tr>
                        <td className="py-1 pr-2">รวมเป็นเงิน</td>
                        <td className="py-1 text-right">{fmt(subtotal)}</td>
                      </tr>
                    )}
                    {discountValue > 0 && (
                      <>
                        <tr>
                          <td className="py-1 pr-2">
                            {hasLineDiscounts ? "ส่วนลดท้ายใบ" : "ส่วนลด"}
                            {po.discountType === "percent" ? ` ${po.discount}%` : ""}
                          </td>
                          <td className="py-1 text-right">-{fmt(discountValue)}</td>
                        </tr>
                        <tr>
                          <td className="py-1 pr-2">ยอดหลังหักส่วนลด</td>
                          <td className="py-1 text-right">{fmt(afterDiscount)}</td>
                        </tr>
                      </>
                    )}
                    {po.vatEnabled && (
                      <tr>
                        <td className="py-1 pr-2">ภาษีมูลค่าเพิ่ม 7%</td>
                        <td className="py-1 text-right">{fmt(vat)}</td>
                      </tr>
                    )}
                    <tr className="font-bold text-[14px] border-t-2 border-gray-800">
                      <td className="py-1.5 pr-2">จำนวนเงินรวมทั้งสิ้น</td>
                      <td className="py-1.5 text-right">{fmt(grandTotal)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div id="po-signatures" className="grid grid-cols-2 gap-16 mt-10 text-center text-[12px] max-w-[75%] mx-auto">
                {[
                  { title: "ผู้สั่งซื้อ", name: po.issuedBy },
                  { title: "ผู้อนุมัติ", name: "" },
                ].map((s) => (
                  <div key={s.title}>
                    <div className="border-b border-gray-400 h-12 mb-2" />
                    <div className="min-h-[18px] mt-2 text-gray-800">{s.name}</div>
                    <div className="font-bold mt-2">{s.title}</div>
                    <div className="text-gray-500 mt-2">วันที่ ______ / ______ / ______</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Recent POs — click to open in place */}
          <div className="mt-6 bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <div className="flex items-center justify-between gap-3 mb-4">
              <h2 className="text-base font-bold text-gray-800">📋 ใบสั่งซื้อล่าสุด</h2>
              {recent.length > 0 && (
                <input
                  type="text"
                  value={recentSearch}
                  onChange={(e) => setRecentSearch(e.target.value)}
                  placeholder="🔍 ค้นหาเลขที่/ผู้ขาย..."
                  className="px-3 py-2 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-orange-500/20 focus:border-orange-300 outline-none w-64 bg-gray-50/50 transition"
                />
              )}
            </div>
            {recent.length === 0 ? (
              <div className="text-center py-8">
                <div className="text-3xl mb-2">📭</div>
                <p className="text-sm text-gray-400">ยังไม่มีใบสั่งซื้อที่บันทึกไว้</p>
              </div>
            ) : filteredRecent.length === 0 ? (
              <div className="text-center py-8">
                <div className="text-3xl mb-2">🔍</div>
                <p className="text-sm text-gray-400">ไม่พบใบสั่งซื้อที่ตรงกับคำค้นหา</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs uppercase tracking-wider text-gray-500 border-b-2 border-gray-100">
                      <th className="py-2.5 pr-3 text-left font-semibold">เลขที่</th>
                      <th className="py-2.5 pr-3 text-left font-semibold">ผู้ขาย</th>
                      <th className="py-2.5 pr-3 text-left font-semibold">วันที่</th>
                      <th className="py-2.5 pr-3 text-right font-semibold">ยอดรวม</th>
                      <th className="py-2.5 pr-3 text-left font-semibold">สถานะ</th>
                      <th className="py-2.5 w-10"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {filteredRecent.map((r) => (
                      <tr
                        key={r.id}
                        className="hover:bg-orange-50/40 cursor-pointer transition-colors"
                        onClick={() => {
                          router.replace(`/purchase-order?id=${encodeURIComponent(r.id)}`);
                          loadExisting(r.id);
                        }}
                      >
                        <td className="py-2.5 pr-3 font-mono font-semibold text-gray-800">{r.docNo || "-"}</td>
                        <td className="py-2.5 pr-3 text-gray-600">{r.supplier || "-"}</td>
                        <td className="py-2.5 pr-3 text-gray-500 text-xs">{r.docDate ? thaiDate(r.docDate) : "-"}</td>
                        <td className="py-2.5 pr-3 text-right font-medium text-gray-800">{fmt(r.total)}</td>
                        <td className="py-2.5 pr-3">
                          {r.cancelledAt ? (
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-red-50 text-red-600 border border-red-100">ยกเลิกแล้ว</span>
                          ) : r.supersededById ? (
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-600 border border-amber-100">ออกใบใหม่แทนแล้ว</span>
                          ) : (
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-600 border border-emerald-100">ใช้งานอยู่</span>
                          )}
                        </td>
                        <td className="py-2.5 text-right">
                          <button
                            id={`delete-po-${r.id}`}
                            aria-label={`ลบใบสั่งซื้อ ${r.docNo}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setPendingDeleteId(r.id);
                            }}
                            disabled={deletingId === r.id}
                            className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors disabled:opacity-40"
                          >
                            {deletingId === r.id ? (
                              <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-red-400 border-t-transparent" />
                            ) : (
                              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                                <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                              </svg>
                            )}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>

      {loadingRecord && (
        <div className="fixed inset-0 z-[90] bg-white/60 flex items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-600"></div>
        </div>
      )}

      {showCancelConfirm && (
        <ConfirmDialog
          title="ยกเลิกใบสั่งซื้อ"
          message={`ต้องการยกเลิกใบสั่งซื้อ "${po.docNo}" ใช่หรือไม่? เอกสารจะยังอยู่ในระบบแต่จะไม่นับเป็นรายการที่ใช้งานอยู่`}
          confirmText="ยืนยันการยกเลิก"
          loadingText="กำลังยกเลิก..."
          onConfirm={handleCancel}
          onCancel={() => setShowCancelConfirm(false)}
          loading={cancelling}
        />
      )}

      {pendingDeleteId && (
        <ConfirmDialog
          title="ลบใบสั่งซื้อ"
          message={`ต้องการลบใบสั่งซื้อ "${recent.find((r) => r.id === pendingDeleteId)?.docNo || pendingDeleteId}" ออกจากระบบถาวรใช่หรือไม่? การกระทำนี้ไม่สามารถย้อนกลับได้`}
          confirmText="ลบถาวร"
          loadingText="กำลังลบ..."
          onConfirm={() => handleDelete(pendingDeleteId)}
          onCancel={() => setPendingDeleteId(null)}
          loading={deletingId === pendingDeleteId}
        />
      )}
    </div>
  );
}

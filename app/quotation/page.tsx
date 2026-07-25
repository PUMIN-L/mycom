"use client";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "../context/AuthContext";
import Toast from "../components/Toast";
import { DOCNO_START, pad2, nextDocNo } from "../lib/quotationNumber";
import { computeQuoteTotals } from "../lib/quotationTotals";
import { stripHtml } from "../lib/stripHtml";
import SearchableDropdown from "../components/SearchableDropdown";
import ConfirmDialog from "../components/ConfirmDialog";

// ── ใบเสนอราคา (Quotation builder) ──────────────────────────────────────────
// Admin-only tool: fill the form on the left, see a live A4 sheet on the right,
// then "ดาวน์โหลด PDF" prints ONLY the sheet via the browser's Save-as-PDF —
// vector output with perfect Thai text and zero server-side PDF dependencies
// (deliberate: heavy PDF/DOM libs have already broken this app on Vercel once).
// A draft autosaves to localStorage so a refresh doesn't lose work.

// Seller identity (fixed per the business):
const COMPANY = {
  name: "บริษัท โปรฟิน แล็บสเกล จำกัด",
  nameEn: "PROFIN LAB SCALE CO., LTD.",
  address:
    "93 ซอยงามวงศ์วาน 6 แยก 19 ถนนงามวงศ์วาน\nตำบลบางเขน อำเภอเมืองนนทบุรี จ.นนทบุรี 11000",
};

interface QuoteItem {
  id: string;
  productId?: string; // Links back to product for specs
  name: string; // ชื่อเครื่อง / รุ่น
  description: string; // สเปค / รายละเอียดเพิ่มเติม
  imageUrl: string;
  imageUploaded: boolean; // true = uploaded for this quote (deletable); false = from catalog
  qty: number;
  unit: string; // เครื่อง / ชุด / ตัว
  unitPrice: number;
}

interface QuoteState {
  id: string; // stable key for the saved-quotation record
  docNo: string;
  docDate: string; // yyyy-mm-dd (input[type=date])
  validDays: number; // ยืนราคา (วัน)
  sellerName: string;
  sellerPhone: string;
  sellerEmail: string;
  companyPhone: string;
  companyEmail: string;
  companyTaxId: string;
  customerContact: string;
  customerCompany: string;
  customerAddress: string;
  customerPhone: string;
  customerEmail: string;
  items: QuoteItem[];
  discount: number;
  discountType: "amount" | "percent";
  vatEnabled: boolean;
  paymentTerms?: string;
  deliveryTerms?: string;
  warrantyTerms?: string;
  conditions: { id: string; label: string; value: string }[];
  note: string;
}

interface ProductItem {
  id: string;
  title_th: string;
  title_en: string;
  image: string;
}

const DRAFT_KEY = "quotation-draft-v1";

function newItem(): QuoteItem {
  return {
    id: crypto.randomUUID(),
    name: "",
    description: "",
    imageUrl: "",
    imageUploaded: false,
    qty: 1,
    unit: "เครื่อง",
    unitPrice: 0,
  };
}

const emptyState = (): QuoteState => ({
  id: "",
  docNo: "",
  docDate: "",
  validDays: 30,
  sellerName: "",
  sellerPhone: "",
  sellerEmail: "",
  companyPhone: "",
  companyEmail: "",
  companyTaxId: "",
  customerContact: "",
  customerCompany: "",
  customerAddress: "",
  customerPhone: "",
  customerEmail: "",
  items: [],
  discount: 0,
  discountType: "amount",
  vatEnabled: true,
  conditions: [
    { id: crypto.randomUUID(), label: "เงื่อนไขชำระเงิน", value: "ชำระเงิน 100% ก่อนส่งมอบสินค้า" },
    { id: crypto.randomUUID(), label: "กำหนดส่งมอบ", value: "30-45 วัน หลังยืนยันการสั่งซื้อ" },
    { id: crypto.randomUUID(), label: "การรับประกัน", value: "รับประกันสินค้า 1 ปี" },
  ],
  note: "",
});

const fmt = (n: number) =>
  n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function migrateQuoteState(state: any): QuoteState {
  if (!state.conditions || !Array.isArray(state.conditions)) {
    const conditions = [];
    if (state.paymentTerms) conditions.push({ id: crypto.randomUUID(), label: "เงื่อนไขชำระเงิน", value: state.paymentTerms });
    if (state.deliveryTerms) conditions.push({ id: crypto.randomUUID(), label: "กำหนดส่งมอบ", value: state.deliveryTerms });
    if (state.warrantyTerms) conditions.push({ id: crypto.randomUUID(), label: "การรับประกัน", value: state.warrantyTerms });
    state.conditions = conditions.length > 0 ? conditions : emptyState().conditions;
  }
  return state as QuoteState;
}

// A number field that keeps the user's RAW text (so partial values like "0.5"
// aren't clobbered by controlled-input reconciliation) and shows a placeholder
// when empty instead of a pre-filled 0. Emits a clamped (>= 0) number.
function NumberInput({
  value,
  onChange,
  className,
  placeholder,
}: {
  value: number;
  onChange: (value: number) => void;
  className?: string;
  placeholder?: string;
}) {
  const [text, setText] = useState(value === 0 ? "" : String(value));
  useEffect(() => {
    // Resync when the value changes from outside (reset / reopen / autofill).
    if ((Number(text) || 0) !== value) setText(value === 0 ? "" : String(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <input
      type="text"
      inputMode="decimal"
      className={className}
      placeholder={placeholder}
      value={text}
      onChange={(e) => {
        const raw = e.target.value;
        if (raw !== "" && !/^\d*\.?\d*$/.test(raw)) return; // digits + one dot
        setText(raw);
        onChange(Math.max(0, Number(raw) || 0));
      }}
    />
  );
}

const thaiDate = (iso: string) => {
  if (!iso) return "-";
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const months = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
  return `${d} ${months[m - 1]} ${y + 543}`;
};

function formatAddress(comp: any) {
  const parts = [];
  if (comp.addressNo) parts.push(comp.addressNo);
  if (comp.moo) parts.push(`ม.${comp.moo}`);
  if (comp.soi) parts.push(`ซ.${comp.soi}`);
  if (comp.road) parts.push(`ถ.${comp.road}`);
  if (comp.subDistrict) parts.push(`ต.${comp.subDistrict}`);
  if (comp.district) parts.push(`อ.${comp.district}`);
  if (comp.province) parts.push(`จ.${comp.province}`);
  if (comp.postalCode) parts.push(comp.postalCode);
  return parts.join(' ');
}

function formatPhone(phone: string) {
  if (!phone) return phone;
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  if (digits.length === 9) {
    return `${digits.slice(0, 2)}-${digits.slice(2, 5)}-${digits.slice(5)}`;
  }
  return phone;
}

export default function QuotationPage() {
  const router = useRouter();
  const { isLoggedIn, isLoading } = useAuth();
  const [q, setQ] = useState<QuoteState>(emptyState);
  const [products, setProducts] = useState<ProductItem[]>([]);
  const [dbCompanies, setDbCompanies] = useState<any[]>([]);
  const [dbCustomers, setDbCustomers] = useState<any[]>([]);
  const [dbSalespeople, setDbSalespeople] = useState<any[]>([]);
  const [dbProductSpecs, setDbProductSpecs] = useState<any[]>([]);
  const [existingDocs, setExistingDocs] = useState<{ id: string; docNo: string }[]>([]);
  const [uploadingItemId, setUploadingItemId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false); // building the PDF
  const [savePrompt, setSavePrompt] = useState(false); // "keep 30d or delete now?" after download
  const [deletingQuote, setDeletingQuote] = useState(false);
  const [savingQuote, setSavingQuote] = useState(false); // "เซฟ" (save without printing)
  const [showResetConfirm, setShowResetConfirm] = useState(false); // reset form modal
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const uploadTargetRef = useRef<string | null>(null);
  const hydratedRef = useRef(false);
  // A brand-new quote (not a reopened/restored one) — eligible to auto-advance
  // its running number once the reserved-numbers ledger loads.
  const isFreshRef = useRef(false);

  // Redirect if not logged in (same client gate as the other admin pages)
  useEffect(() => {
    if (!isLoading && !isLoggedIn) router.replace("/login");
  }, [isLoggedIn, isLoading, router]);

  // Hydrate: reopen a saved quotation (?id=…), else restore the draft, else seed
  // a fresh one. In an effect (not render) — Date.now()/localStorage during
  // render violate purity rules.
  useEffect(() => {
    const now = new Date();
    const iso = now.toISOString().slice(0, 10);

    const seedFresh = () => {
      isFreshRef.current = true;
      setQ({
        ...emptyState(),
        id: crypto.randomUUID(),
        docDate: iso,
        docNo: `QT${iso.replace(/-/g, "")}-${pad2(DOCNO_START)}`,
        items: [newItem()],
      });
    };

    const reopenId = new URLSearchParams(window.location.search).get("id");
    if (reopenId) {
      // Reopen a saved record. Auth is via the session cookie, so this works
      // regardless of the client auth-context loading state.
      fetch(`/api/quotations/${encodeURIComponent(reopenId)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((rec) => {
          if (rec?.data && Array.isArray(rec.data.items)) {
            setQ(migrateQuoteState({ ...emptyState(), ...rec.data, id: rec.id || reopenId }));
          } else {
            showToast("ไม่พบใบเสนอราคานี้ — เริ่มใบใหม่แทน", "error");
            seedFresh();
          }
        })
        .catch(() => seedFresh())
        .finally(() => {
          hydratedRef.current = true;
        });
      return;
    }

    let draft: QuoteState | null = null;
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) draft = JSON.parse(raw);
    } catch {
      /* corrupted draft — start fresh */
    }
    if (draft && Array.isArray(draft.items)) {
      // Older drafts may lack id — mint one so save/delete has a stable key.
      setQ(migrateQuoteState({ ...emptyState(), ...draft, id: draft.id || crypto.randomUUID() }));
    } else {
      seedFresh();
    }
    hydratedRef.current = true;
  }, []);

  // Autosave draft (skip until hydrated so we don't clobber it with the empty state)
  useEffect(() => {
    if (!hydratedRef.current) return;
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(q));
    } catch {
      /* storage full/blocked — nonfatal */
    }
  }, [q]);

  // Product list for the "เลือกจากสินค้า" autofill
  useEffect(() => {
    if (!isLoggedIn) return;
    fetch("/api/products")
      .then((r) => (r.ok ? r.json() : []))
      .then((list) => setProducts(Array.isArray(list) ? list : []))
      .catch(() => {});
      
    fetch("/api/companies")
      .then((r) => (r.ok ? r.json() : []))
      .then((list) => setDbCompanies(Array.isArray(list) ? list : []))
      .catch(() => {});

    fetch("/api/customers")
      .then((r) => (r.ok ? r.json() : []))
      .then((list) => setDbCustomers(Array.isArray(list) ? list : []))
      .catch(() => {});

    fetch("/api/salespeople")
      .then((r) => (r.ok ? r.json() : []))
      .then((list) => setDbSalespeople(Array.isArray(list) ? list : []))
      .catch(() => {});

    fetch("/api/product-specs")
      .then((r) => (r.ok ? r.json() : null))
      .then((res) => setDbProductSpecs(Array.isArray(res?.data) ? res.data : []))
      .catch(() => {});
  }, [isLoggedIn]);

  // Reserved quotation numbers (last ~2 days) — for the duplicate warning and
  // the auto-running number. Survives deletion (separate ledger).
  useEffect(() => {
    if (!isLoggedIn) return;
    fetch("/api/quotations/docnos")
      .then((r) => (r.ok ? r.json() : []))
      .then((list) =>
        setExistingDocs(
          Array.isArray(list)
            ? list.map((x: { quotationId: string; docNo: string }) => ({
                id: x.quotationId,
                docNo: x.docNo,
              }))
            : []
        )
      )
      .catch(() => {});
  }, [isLoggedIn]);

  // Once the ledger is loaded, bump a fresh quote's still-default docNo to the
  // next free trailing number (e.g. today's -01 is taken → -02).
  useEffect(() => {
    if (!isFreshRef.current) return;
    setQ((prev) => {
      const prefix = `QT${prev.docDate.replace(/-/g, "")}-`;
      if (prev.docNo !== `${prefix}${pad2(DOCNO_START)}`) return prev; // user edited it
      const next = nextDocNo(prefix, existingDocs.map((u) => u.docNo));
      return next === prev.docNo ? prev : { ...prev, docNo: next };
    });
  }, [existingDocs]);

  function showToast(message: string, type: "success" | "error") {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }

  const set = <K extends keyof QuoteState>(key: K, value: QuoteState[K]) =>
    setQ((prev) => ({ ...prev, [key]: value }));

  const setItem = (id: string, updates: Partial<QuoteItem>) =>
    setQ((prev) => ({
      ...prev,
      items: prev.items.map((it) => (it.id === id ? { ...it, ...updates } : it)),
    }));

  const addItem = () => setQ((prev) => ({ ...prev, items: [...prev.items, newItem()] }));
  const removeItem = (id: string) =>
    setQ((prev) => ({ ...prev, items: prev.items.filter((it) => it.id !== id) }));
  const moveItem = (id: string, dir: -1 | 1) =>
    setQ((prev) => {
      const idx = prev.items.findIndex((it) => it.id === id);
      const to = idx + dir;
      if (idx < 0 || to < 0 || to >= prev.items.length) return prev;
      const items = [...prev.items];
      [items[idx], items[to]] = [items[to], items[idx]];
      return { ...prev, items };
    });

  // Autofill an item from a catalog product. imageUploaded:false marks the
  // image as a shared catalog asset — it must NOT be deleted on quote delete.
  const applyProduct = (itemId: string, productId: string) => {
    const p = products.find((x) => x.id === productId);
    if (p) {
      setItem(itemId, {
        productId: p.id,
        name: stripHtml(p.title_th || p.title_en),
        description: "",
        imageUrl: p.image,
        imageUploaded: false,
      });
    }
  };

  // Upload a custom image for an item (reuses the existing Cloudinary route)
  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    const itemId = uploadTargetRef.current;
    e.target.value = "";
    if (!file || !itemId) return;
    setUploadingItemId(itemId);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      if (!res.ok) throw new Error();
      const { url } = await res.json();
      // imageUploaded:true → this image was created for this quote and will be
      // removed from Cloudinary if the quotation is deleted/expires.
      setItem(itemId, { imageUrl: url, imageUploaded: true });
    } catch {
      showToast("อัปโหลดรูปไม่สำเร็จ", "error");
    } finally {
      setUploadingItemId(null);
      uploadTargetRef.current = null;
    }
  }

  // ── Totals ──────────────────────────────────────────────────────────────
  const { subtotal, discountValue, afterDiscount, vat, grandTotal } =
    computeQuoteTotals(q);

  // Duplicate doc-number guard: is this docNo already used by a DIFFERENT saved
  // quotation? (Same id = editing the same one, allowed.)
  const trimmedDocNo = q.docNo.trim();
  const docNoDup =
    trimmedDocNo !== "" &&
    existingDocs.some((d) => d.docNo === trimmedDocNo && d.id !== q.id);

  // Render the A4 sheet to a real .pdf file and download it (no print dialog).
  // Libraries are dynamically imported so they only load on click and never run
  // on the server. html2canvas-pro (vs html2canvas) supports Tailwind v4's oklch
  // colors. The sheet is rasterized, then sliced across A4 pages if it's tall.
  async function generatePdf() {
    const el = document.getElementById("quote-sheet");
    if (!el) return;
    const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
      import("html2canvas-pro"),
      import("jspdf"),
    ]);
    const canvas = await html2canvas(el, {
      scale: 2, // sharper text/images
      useCORS: true, // include Cloudinary/product images
      backgroundColor: "#ffffff",
    });
    const imgData = canvas.toDataURL("image/jpeg", 0.95);
    const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const imgH = (canvas.height * pageW) / canvas.width;
    // Page count with a small tolerance: the sheet's minHeight is exactly one A4,
    // so rounding used to spill a near-blank 2nd page. The tolerance only ever
    // trims the very bottom (inside the sheet's 12mm bottom padding), never
    // content, while genuine overflow still paginates.
    const TOLERANCE_MM = 4;
    const pageCount = Math.max(1, Math.ceil((imgH - TOLERANCE_MM) / pageH));
    for (let i = 0; i < pageCount; i++) {
      if (i > 0) pdf.addPage();
      pdf.addImage(imgData, "JPEG", 0, -i * pageH, pageW, imgH);
    }
    pdf.save(`Quotation-${(q.docNo || "document").replace(/[^\w.-]/g, "_")}.pdf`);
  }

  // ── Download → save record → generate PDF → ask keep/delete ───────────────
  async function handleDownload() {
    if (generating) return;
    if (docNoDup) {
      showToast("เลขที่ใบเสนอราคานี้ซ้ำกับใบที่บันทึกไว้ กรุณาเปลี่ยนเลขที่ก่อน", "error");
      return;
    }
    setGenerating(true);
    // Persist first so the record exists for the keep/delete prompt and the
    // 30-day auto-purge. Only images uploaded for THIS quote are deletable.
    const uploadedImages = q.items
      .filter((it) => it.imageUploaded && it.imageUrl)
      .map((it) => it.imageUrl);
    let saved = false;
    try {
      const res = await fetch("/api/quotations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: q.id, docNo: q.docNo, data: q, uploadedImages }),
      });
      if (res.status === 409) {
        // Another quotation grabbed this number since the page loaded.
        const data = await res.json().catch(() => null);
        showToast(data?.error ?? "เลขที่ใบเสนอราคาซ้ำ กรุณาเปลี่ยนเลขที่", "error");
        setGenerating(false);
        return;
      }
      saved = res.ok;
    } catch {
      /* save is best-effort — never block the download */
    }
    try {
      await generatePdf();
    } catch {
      showToast("สร้าง PDF ไม่สำเร็จ กรุณาลองใหม่", "error");
      setGenerating(false);
      return;
    }
    setGenerating(false);
    if (saved) {
      // Reserve the number locally (mirrors handleSave) and settle it, so a
      // later reset/new quote advances past it and the dup-check stays accurate.
      settleDocNo();
      setSavePrompt(true);
    } else {
      showToast("ดาวน์โหลดแล้ว (แต่บันทึกประวัติไม่สำเร็จ)", "error");
    }
  }

  // After a quote is persisted, reserve its number locally and stop the
  // auto-running effect from re-firing (which would silently renumber it).
  function settleDocNo() {
    isFreshRef.current = false;
    const doc = q.docNo.trim();
    if (doc) {
      setExistingDocs((prev) => [
        ...prev.filter((d) => d.docNo !== doc),
        { id: q.id, docNo: doc },
      ]);
    }
  }

  // ── Save only (no PDF) — blocked while the docNo is a duplicate ────────────
  async function handleSave() {
    if (savingQuote) return;
    if (docNoDup) {
      showToast("เลขที่ใบเสนอราคานี้ซ้ำกับใบที่บันทึกไว้ กรุณาเปลี่ยนเลขที่ก่อน", "error");
      return;
    }
    setSavingQuote(true);
    const uploadedImages = q.items
      .filter((it) => it.imageUploaded && it.imageUrl)
      .map((it) => it.imageUrl);
    try {
      const res = await fetch("/api/quotations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: q.id, docNo: q.docNo, data: q, uploadedImages }),
      });
      if (res.status === 409) {
        const data = await res.json().catch(() => null);
        showToast(data?.error ?? "เลขที่ใบเสนอราคาซ้ำ กรุณาเปลี่ยนเลขที่", "error");
        return;
      }
      if (res.ok) {
        settleDocNo(); // reserve locally + stop the auto-running effect renumbering it
        showToast("บันทึกใบเสนอราคาแล้ว (เก็บไว้ 30 วัน)", "success");
      } else {
        showToast("บันทึกไม่สำเร็จ", "error");
      }
    } catch {
      showToast("เกิดข้อผิดพลาดในการบันทึก", "error");
    } finally {
      setSavingQuote(false);
    }
  }

  async function handleDeleteQuotation() {
    setDeletingQuote(true);
    try {
      const res = await fetch(`/api/quotations/${q.id}`, { method: "DELETE" });
      if (res.ok) {
        // The uploaded images are now gone from Cloudinary — detach from the
        // deleted record (new id) and strip those dead image refs so a later
        // re-download can't recreate a record pointing at destroyed assets.
        // Catalog images (imageUploaded:false) stay.
        setQ((prev) => ({
          ...prev,
          id: crypto.randomUUID(),
          items: prev.items.map((it) =>
            it.imageUploaded ? { ...it, imageUrl: "", imageUploaded: false } : it
          ),
        }));
        showToast("ลบใบเสนอราคาและรูปที่อัปโหลดออกจากคลาวด์แล้ว", "success");
      } else {
        showToast("ลบไม่สำเร็จ", "error");
      }
    } catch {
      showToast("เกิดข้อผิดพลาดในการลบ", "error");
    } finally {
      setDeletingQuote(false);
      setSavePrompt(false);
    }
  }

  if (isLoading || !isLoggedIn) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-gray-500">Loading...</p>
      </div>
    );
  }

  const inputCls =
    "w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 text-sm";
  const labelCls = "block text-xs font-semibold text-gray-600 mb-1";

  return (
    <div className="min-h-screen bg-gray-100">
      {toast && <Toast message={toast.message} type={toast.type} />}

      {showResetConfirm && (
        <ConfirmDialog
          title="ยืนยันการล้างข้อมูล"
          message="คุณต้องการล้างข้อมูลทั้งหมดและเริ่มทำใบเสนอราคาใหม่ใช่หรือไม่? ข้อมูลปัจจุบันที่ยังไม่ได้บันทึกจะสูญหาย"
          confirmText="เริ่มใหม่"
          cancelText="ยกเลิก"
          onConfirm={() => {
            setShowResetConfirm(false);
            localStorage.removeItem(DRAFT_KEY);
            const iso = new Date().toISOString().slice(0, 10);
            const prefix = `QT${iso.replace(/-/g, "")}-`;
            isFreshRef.current = true;
            setQ({ ...emptyState(), id: crypto.randomUUID(), docDate: iso, docNo: nextDocNo(prefix, existingDocs.map((u) => u.docNo)), items: [newItem()] });
          }}
          onCancel={() => setShowResetConfirm(false)}
        />
      )}

      <input ref={imageInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />

      {/* Keep-or-delete prompt shown after download */}
      {savePrompt && (
        <div className="no-print fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6">
            <h3 className="text-lg font-bold text-gray-900 mb-2">ดาวน์โหลดเรียบร้อย ✅</h3>
            <p className="text-sm text-gray-600 mb-5">
              ต้องการเก็บใบเสนอราคานี้ไว้ในระบบไหม? ถ้าเก็บไว้ ระบบจะ
              <span className="font-semibold"> ลบให้อัตโนมัติเมื่อครบ 30 วัน</span>
              {" "}หรือจะลบทันทีเลยก็ได้ (รูปที่อัปโหลดสำหรับใบนี้จะถูกลบออกจากคลาวด์ด้วย — รูปสินค้าจาก catalog ไม่ถูกลบ)
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setSavePrompt(false)}
                disabled={deletingQuote}
                className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 font-semibold hover:bg-gray-50 transition text-sm disabled:opacity-60"
              >
                เก็บไว้ 30 วัน
              </button>
              <button
                onClick={handleDeleteQuotation}
                disabled={deletingQuote}
                className="px-4 py-2 rounded-lg bg-red-500 text-white font-semibold hover:bg-red-600 transition text-sm disabled:opacity-60 flex items-center gap-2"
              >
                {deletingQuote && (
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                )}
                🗑️ ลบทันที
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Number inputs: typeable, no up/down spinner buttons */}
      <style>{`
        .quote-form input[type="number"]::-webkit-inner-spin-button,
        .quote-form input[type="number"]::-webkit-outer-spin-button {
          -webkit-appearance: none;
          margin: 0;
        }
        .quote-form input[type="number"] {
          -moz-appearance: textfield;
          appearance: textfield;
        }
      `}</style>

      {/* ── Toolbar ── */}
      <div className="no-print sticky top-0 z-20 bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-[1400px] mx-auto px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
          <h1 className="text-xl font-bold text-gray-900">🧾 สร้างใบเสนอราคา</h1>
          <div className="flex items-center gap-2 flex-wrap">
            <Link href="/showcase" className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm font-semibold hover:bg-gray-50 transition">
              ← กลับ
            </Link>
            <Link href="/quotation/saved" className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm font-semibold hover:bg-gray-50 transition">
              📋 ใบที่บันทึกไว้
            </Link>
            <button
              onClick={() => setShowResetConfirm(true)}
              className="px-4 py-2 rounded-lg border border-red-300 text-red-500 text-sm font-semibold hover:bg-red-50 transition"
            >
              ↺ เริ่มทำใบเสนอราคาใบใหม่
            </button>
            <button
              onClick={handleSave}
              disabled={savingQuote || docNoDup}
              className="px-5 py-2 rounded-lg border border-green-500 text-green-600 text-sm font-bold hover:bg-green-50 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {savingQuote ? "กำลังเซฟ..." : "💾 เซฟ"}
            </button>
            <button
              onClick={handleDownload}
              disabled={docNoDup}
              className="px-5 py-2 rounded-lg bg-orange-500 text-white text-sm font-bold hover:bg-orange-600 transition shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              ⬇️ ดาวน์โหลด PDF
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-[1400px] mx-auto px-4 py-6 grid grid-cols-1 xl:grid-cols-[420px_1fr] gap-6 items-start">
        {/* ══ LEFT: form ══ */}
        <div className="quote-form space-y-4">
          {/* เอกสาร */}
          <section className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 space-y-3">
            <h2 className="font-bold text-gray-800">ข้อมูลเอกสาร</h2>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>เลขที่ (No.)</label>
                <input
                  className={`${inputCls} ${docNoDup ? "border-red-400 ring-1 ring-red-300" : ""}`}
                  value={q.docNo}
                  onChange={(e) => set("docNo", e.target.value)}
                />
                {docNoDup && (
                  <p className="mt-1 text-xs text-red-500 font-semibold">
                    ⚠ เลขที่นี้ซ้ำกับใบที่บันทึกไว้ — กรุณาเปลี่ยน
                  </p>
                )}
              </div>
              <div>
                <label className={labelCls}>วันที่ (Date)</label>
                <input type="date" className={inputCls} value={q.docDate} onChange={(e) => set("docDate", e.target.value)} />
              </div>
              <div>
                <label className={labelCls}>ยืนราคา (วัน)</label>
                <input type="number" min={0} className={inputCls} value={q.validDays}
                  onChange={(e) => set("validDays", Math.max(0, Number(e.target.value)))} />
              </div>
              <div>
                <label className={labelCls}>เลขผู้เสียภาษี (บริษัทเรา)</label>
                <input className={inputCls} placeholder="0-0000-00000-00-0" value={q.companyTaxId}
                  onChange={(e) => set("companyTaxId", e.target.value)} />
              </div>
              <div>
                <label className={labelCls}>โทรบริษัท</label>
                <input className={inputCls} value={q.companyPhone} onChange={(e) => set("companyPhone", e.target.value)} />
              </div>
              <div>
                <label className={labelCls}>อีเมลบริษัท</label>
                <input className={inputCls} value={q.companyEmail} onChange={(e) => set("companyEmail", e.target.value)} />
              </div>
            </div>
          </section>

          {/* เซลล์ */}
          <section className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 space-y-3 relative z-30">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <h2 className="font-bold text-gray-800">พนักงานขาย (Sales)</h2>
              <SearchableDropdown
                className="w-[240px]"
                placeholder="+ เลือกพนักงานขาย"
                value={q.sellerId || ""}
                options={dbSalespeople.map(s => ({
                  value: s.id,
                  label: s.name,
                  subLabel: s.phone || s.email || ""
                }))}
                onChange={(val) => {
                  const s = dbSalespeople.find(x => x.id === val);
                  if (s) {
                    set("sellerId", val);
                    setQ(prev => ({
                      ...prev,
                      sellerName: s.name,
                      sellerPhone: s.phone || prev.sellerPhone,
                      sellerEmail: s.email || prev.sellerEmail
                    }));
                  }
                }}
                buttonClassName="!bg-blue-50 !border-blue-300 !text-blue-700 hover:!bg-blue-100 font-medium transition-colors"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className={labelCls}>ชื่อเซลล์</label>
                <input className={inputCls} value={q.sellerName} onChange={(e) => set("sellerName", e.target.value)} />
              </div>
              <div>
                <label className={labelCls}>โทร</label>
                <input className={inputCls} value={q.sellerPhone} onChange={(e) => set("sellerPhone", e.target.value)} />
              </div>
              <div>
                <label className={labelCls}>อีเมล</label>
                <input className={inputCls} value={q.sellerEmail} onChange={(e) => set("sellerEmail", e.target.value)} />
              </div>
            </div>
          </section>

          {/* ลูกค้า */}
          <section className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <h2 className="font-bold text-gray-800">ข้อมูลลูกค้า</h2>
              <div className="flex flex-wrap gap-2 relative z-20">
                <SearchableDropdown
                  className="w-[240px]"
                  placeholder="+ เลือกลูกค้าจากระบบ"
                  value=""
                  options={dbCustomers.map(c => ({
                    value: c.id,
                    label: c.name,
                    subLabel: c.companyName || ""
                  }))}
                  onChange={(val) => {
                    const c = dbCustomers.find(x => x.id === val);
                    if (c) {
                      const comp = dbCompanies.find(x => x.id === c.companyId);
                      setQ(prev => ({
                        ...prev,
                        customerContact: c.name,
                        customerCompany: c.companyName || comp?.name || "",
                        customerAddress: comp ? formatAddress(comp) : prev.customerAddress,
                        customerPhone: c.phone || comp?.phone || prev.customerPhone,
                        customerEmail: c.email || prev.customerEmail
                      }));
                    }
                  }}
                  buttonClassName="!bg-emerald-50 !border-emerald-300 !text-emerald-700 hover:!bg-emerald-100 font-medium transition-colors"
                />
                <SearchableDropdown
                  className="w-[240px]"
                  placeholder="+ เลือกบริษัทจากระบบ"
                  value=""
                  options={dbCompanies.map(c => ({
                    value: c.id,
                    label: c.name
                  }))}
                  onChange={(val) => {
                    const comp = dbCompanies.find(x => x.id === val);
                    if (comp) {
                      setQ(prev => ({
                        ...prev,
                        customerCompany: comp.name,
                        customerAddress: formatAddress(comp),
                        customerPhone: comp.phone || prev.customerPhone
                      }));
                    }
                  }}
                  buttonClassName="!bg-purple-50 !border-purple-300 !text-purple-700 hover:!bg-purple-100 font-medium transition-colors"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>ชื่อผู้ติดต่อ</label>
                <input className={inputCls} value={q.customerContact} onChange={(e) => set("customerContact", e.target.value)} />
              </div>
              <div>
                <label className={labelCls}>บริษัทลูกค้า</label>
                <input className={inputCls} value={q.customerCompany} onChange={(e) => set("customerCompany", e.target.value)} />
              </div>
              <div className="col-span-2">
                <label className={labelCls}>ที่อยู่บริษัทลูกค้า</label>
                <textarea rows={2} className={inputCls} value={q.customerAddress} onChange={(e) => set("customerAddress", e.target.value)} />
              </div>
              <div>
                <label className={labelCls}>โทร</label>
                <input className={inputCls} value={q.customerPhone} onChange={(e) => set("customerPhone", e.target.value)} />
              </div>
              <div>
                <label className={labelCls}>อีเมล</label>
                <input className={inputCls} value={q.customerEmail} onChange={(e) => set("customerEmail", e.target.value)} />
              </div>
            </div>
          </section>

          {/* รายการสินค้า */}
          <section className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-gray-800">รายการสินค้า ({q.items.length})</h2>
              <button onClick={addItem} className="px-3 py-1.5 rounded-lg bg-orange-500 text-white text-sm font-bold hover:bg-orange-600 transition">
                + เพิ่มรายการ
              </button>
            </div>
            {q.items.map((it, idx) => (
              <div key={it.id} className="border border-dashed border-gray-300 rounded-lg p-3 space-y-2 relative">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-gray-400">#{idx + 1}</span>
                  <div className="flex gap-1">
                    <button onClick={() => moveItem(it.id, -1)} disabled={idx === 0} title="เลื่อนขึ้น"
                      className="w-7 h-7 rounded bg-gray-100 text-gray-600 hover:bg-gray-200 disabled:opacity-30 text-xs">↑</button>
                    <button onClick={() => moveItem(it.id, 1)} disabled={idx === q.items.length - 1} title="เลื่อนลง"
                      className="w-7 h-7 rounded bg-gray-100 text-gray-600 hover:bg-gray-200 disabled:opacity-30 text-xs">↓</button>
                    <button onClick={() => removeItem(it.id)} title="ลบรายการ"
                      className="w-7 h-7 rounded bg-red-100 text-red-500 hover:bg-red-500 hover:text-white text-xs font-bold">✕</button>
                  </div>
                </div>
                <SearchableDropdown
                  className="w-full"
                  buttonClassName={inputCls}
                  placeholder="📦 เลือกจากสินค้าในระบบ (autofill ชื่อ+รูป)…"
                  value=""
                  onChange={(val) => applyProduct(it.id, val)}
                  options={products.map((p) => ({
                    value: p.id,
                    label: stripHtml(p.title_th || p.title_en)
                  }))}
                />
                {it.productId && dbProductSpecs.filter(s => s.productId === it.productId).length > 0 && (
                  <SearchableDropdown
                    className="w-full"
                    buttonClassName={`${inputCls} !bg-blue-50 !border-blue-200 !text-blue-800 font-medium`}
                    placeholder="📋 เลือกสเปคเพื่อเติมข้อความอัตโนมัติ (Optional)"
                    value=""
                    onChange={(val) => {
                      const spec = dbProductSpecs.find(s => s.id === val);
                      if (spec) setItem(it.id, { description: spec.detail });
                    }}
                    options={dbProductSpecs.filter(s => s.productId === it.productId).map(s => ({
                      value: s.id,
                      label: s.name
                    }))}
                  />
                )}
                <input className={inputCls} placeholder="ชื่อเครื่อง / รุ่น" value={it.name}
                  onChange={(e) => setItem(it.id, { name: e.target.value })} />
                <textarea rows={2} className={inputCls} placeholder="รายละเอียด / สเปค (ถ้ามี)" value={it.description}
                  onChange={(e) => setItem(it.id, { description: e.target.value })} />
                <div className="flex items-center gap-2">
                  {it.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={it.imageUrl} alt="" className="w-12 h-12 object-contain border border-gray-200 rounded bg-white" />
                  ) : (
                    <div className="w-12 h-12 border border-dashed border-gray-300 rounded flex items-center justify-center text-gray-300 text-xs">รูป</div>
                  )}
                  <button
                    onClick={() => { uploadTargetRef.current = it.id; imageInputRef.current?.click(); }}
                    disabled={uploadingItemId === it.id}
                    className="px-3 py-1.5 text-xs rounded-lg bg-orange-100 text-orange-600 hover:bg-orange-200 transition font-semibold border border-orange-300 disabled:opacity-50"
                  >
                    {uploadingItemId === it.id ? "กำลังอัปโหลด..." : "📷 อัปโหลดรูป"}
                  </button>
                  {it.imageUrl && (
                    <button onClick={() => setItem(it.id, { imageUrl: "", imageUploaded: false })}
                      className="px-3 py-1.5 text-xs rounded-lg text-gray-500 hover:text-red-500 transition font-semibold">
                      เอารูปออก
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className={labelCls}>จำนวน</label>
                    <input type="number" min={0} className={inputCls} value={it.qty}
                      onChange={(e) => setItem(it.id, { qty: Math.max(0, Number(e.target.value)) })} />
                  </div>
                  <div>
                    <label className={labelCls}>หน่วย</label>
                    <input className={inputCls} value={it.unit} onChange={(e) => setItem(it.id, { unit: e.target.value })} />
                  </div>
                  <div>
                    <label className={labelCls}>ราคา/หน่วย (฿)</label>
                    <NumberInput className={inputCls} placeholder="0.00"
                      value={it.unitPrice}
                      onChange={(v) => setItem(it.id, { unitPrice: v })} />
                  </div>
                </div>
              </div>
            ))}
          </section>

          {/* สรุปยอด + เงื่อนไข */}
          <section className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 space-y-3">
            <h2 className="font-bold text-gray-800">ส่วนลด / VAT / เงื่อนไข</h2>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>ส่วนลด</label>
                <NumberInput className={inputCls} placeholder="0"
                  value={q.discount}
                  onChange={(v) => set("discount", v)} />
              </div>
              <div>
                <label className={labelCls}>ประเภทส่วนลด</label>
                <select className={inputCls} value={q.discountType}
                  onChange={(e) => set("discountType", e.target.value as "amount" | "percent")}>
                  <option value="amount">บาท (฿)</option>
                  <option value="percent">เปอร์เซ็นต์ (%)</option>
                </select>
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-700 font-medium">
              <input type="checkbox" checked={q.vatEnabled} onChange={(e) => set("vatEnabled", e.target.checked)}
                className="w-4 h-4 accent-orange-500" />
              คิดภาษีมูลค่าเพิ่ม (VAT 7%)
            </label>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="font-bold text-gray-800">เงื่อนไขอื่นๆ</label>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setQ(prev => ({ ...prev, conditions: emptyState().conditions }))}
                    className="text-gray-500 hover:text-gray-700 text-sm font-medium flex items-center gap-1"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
                    คืนค่าเริ่มต้น
                  </button>
                  <button
                    type="button"
                    onClick={() => setQ(prev => ({
                      ...prev,
                      conditions: [...(prev.conditions || []), { id: crypto.randomUUID(), label: "", value: "" }]
                    }))}
                    className="text-orange-600 hover:text-orange-700 text-sm font-medium flex items-center gap-1"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4"/></svg>
                    เพิ่มเงื่อนไข
                  </button>
                </div>
              </div>
              
              {(q.conditions || []).map((cond, idx) => (
                <div key={cond.id} className="p-3 bg-gray-50 border border-gray-200 rounded-lg space-y-2 relative">
                  <button
                    type="button"
                    onClick={() => setQ(prev => ({
                      ...prev,
                      conditions: (prev.conditions || []).filter(c => c.id !== cond.id)
                    }))}
                    className="absolute top-2 right-2 text-gray-400 hover:text-red-500"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"/></svg>
                  </button>
                  <div className="pr-8 space-y-2">
                    <input 
                      placeholder="หัวข้อ (เช่น เงื่อนไขชำระเงิน)" 
                      className={`${inputCls} font-bold text-gray-800`}
                      value={cond.label} 
                      onChange={(e) => {
                        const newConds = [...(q.conditions || [])];
                        newConds[idx].label = e.target.value;
                        set("conditions", newConds);
                      }} 
                    />
                    <textarea 
                      rows={2} 
                      placeholder="รายละเอียด"
                      className={inputCls} 
                      value={cond.value} 
                      onChange={(e) => {
                        const newConds = [...(q.conditions || [])];
                        newConds[idx].value = e.target.value;
                        set("conditions", newConds);
                      }} 
                    />
                  </div>
                </div>
              ))}
            </div>
            <div>
              <label className={labelCls}>หมายเหตุเพิ่มเติม</label>
              <textarea rows={2} className={inputCls} value={q.note} onChange={(e) => set("note", e.target.value)} />
            </div>
          </section>
        </div>

        {/* ══ RIGHT: A4 sheet (what gets printed) ══ */}
        <div className="overflow-x-auto xl:sticky xl:top-[90px] xl:max-h-[calc(100vh-100px)] xl:overflow-y-auto rounded-sm">
          <div
            id="quote-sheet"
            className="bg-white shadow-lg border border-gray-200 rounded-sm mx-auto text-gray-900"
            style={{ width: "210mm", minHeight: "297mm", padding: "12mm 14mm", fontSize: "13px", lineHeight: 1.55 }}
          >
            {/* Header */}
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
                  <div className="text-xs mt-0.5">
                    {q.companyPhone && <>โทร {q.companyPhone} </>}
                    {q.companyEmail && <>อีเมล {q.companyEmail}</>}
                  </div>
                  {q.companyTaxId && (
                    <div className="text-xs">เลขประจำตัวผู้เสียภาษี {q.companyTaxId}</div>
                  )}
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-2xl font-bold tracking-wide">ใบเสนอราคา</div>
                <div className="text-sm text-gray-500 tracking-widest">QUOTATION</div>
              </div>
            </div>

            {/* Doc info + customer */}
            <div className="flex justify-between gap-6 mt-3 text-[12.5px]">
              <div className="flex-1">
                <div className="font-bold text-gray-700 mb-1">เรียน (To)</div>
                <div className="font-semibold">{q.customerContact || "-"}</div>
                {q.customerCompany && <div>{q.customerCompany}</div>}
                {q.customerAddress && <div className="whitespace-pre-line text-gray-700">{q.customerAddress}</div>}
                {q.customerPhone && <div className="text-gray-700">โทร {formatPhone(q.customerPhone)}</div>}
                {q.customerEmail && <div className="text-gray-700 break-all">อีเมล {q.customerEmail}</div>}
              </div>
              <table className="shrink-0 self-start text-[12.5px]">
                <tbody>
                  <tr>
                    <td className="pr-3 py-0.5 font-bold text-gray-700 text-right">เลขที่ (No.)</td>
                    <td className="py-0.5 text-right">{q.docNo || "-"}</td>
                  </tr>
                  <tr>
                    <td className="pr-3 py-0.5 font-bold text-gray-700 text-right">วันที่ (Date)</td>
                    <td className="py-0.5 text-right">{thaiDate(q.docDate)}</td>
                  </tr>
                  <tr>
                    <td className="pr-3 py-0.5 font-bold text-gray-700 text-right">ยืนราคา (Valid)</td>
                    <td className="py-0.5 text-right">{q.validDays} วัน</td>
                  </tr>
                  <tr>
                    <td className="pr-3 py-0.5 font-bold text-gray-700 align-top text-right">พนักงานขาย</td>
                    <td className="py-0.5 text-right">
                      <div className="text-gray-900">{q.sellerName || "-"}</div>
                    </td>
                  </tr>
                  {(q.sellerPhone || q.sellerEmail) && (
                    <tr>
                      <td colSpan={2} className="py-0.5 text-right">
                        <div className="text-[11.5px] text-gray-500 mt-0.5 flex flex-col items-end">
                          {q.sellerPhone && <div>โทร: {formatPhone(q.sellerPhone)}</div>}
                          {q.sellerEmail && <div className="break-all text-right">อีเมล: {q.sellerEmail}</div>}
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Items table */}
            <table className="w-full mt-4 border-collapse text-[12.5px]">
              <thead>
                <tr className="bg-gray-800 text-white">
                  <th className="border border-gray-800 px-2 py-1.5 w-[8mm]">ลำดับ</th>
                  <th className="border border-gray-800 px-2 py-1.5 text-left">รายการ</th>
                  <th className="border border-gray-800 px-2 py-1.5 w-[14mm]">จำนวน</th>
                  <th className="border border-gray-800 px-2 py-1.5 w-[14mm]">หน่วย</th>
                  <th className="border border-gray-800 px-2 py-1.5 w-[24mm]">ราคา/หน่วย</th>
                  <th className="border border-gray-800 px-2 py-1.5 w-[26mm]">จำนวนเงิน (บาท)</th>
                </tr>
              </thead>
              <tbody>
                {q.items.length === 0 && (
                  <tr>
                    <td colSpan={6} className="border border-gray-300 px-2 py-6 text-center text-gray-400">
                      — ยังไม่มีรายการสินค้า —
                    </td>
                  </tr>
                )}
                {q.items.map((it, idx) => (
                  <tr key={it.id} className="align-top">
                    <td className="border border-gray-300 px-2 py-1.5 text-center">{idx + 1}</td>
                    <td className="border border-gray-300 px-2 py-1.5">
                      <div className="font-semibold">{it.name || "-"}</div>
                      {it.description && (
                        <div className="mt-1 text-gray-600 whitespace-pre-line text-[11.5px]">{it.description}</div>
                      )}
                      {/* Image sits below the description, only when one was added */}
                      {it.imageUrl && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={it.imageUrl} alt="" className="mt-1.5 object-contain" style={{ maxWidth: "40mm", maxHeight: "32mm" }} />
                      )}
                    </td>
                    <td className="border border-gray-300 px-2 py-1.5 text-center">{it.qty}</td>
                    <td className="border border-gray-300 px-2 py-1.5 text-center">{it.unit}</td>
                    <td className="border border-gray-300 px-2 py-1.5 text-right">{fmt(it.unitPrice)}</td>
                    <td className="border border-gray-300 px-2 py-1.5 text-right">{fmt(it.qty * it.unitPrice)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Totals */}
            <div className="flex justify-between gap-6 mt-3">
              <div className="flex-1 text-[12px]">
                <div className="space-y-0.5 text-gray-700">
                  <div className="font-bold text-gray-800">เงื่อนไข</div>
                  {(q.conditions || []).map((cond) => (
                    (cond.label || cond.value) ? (
                      <div key={cond.id} className="whitespace-pre-line">
                        • {cond.label}{cond.label && cond.value ? ': ' : ''}{cond.value}
                      </div>
                    ) : null
                  ))}
                </div>
                {q.note && (
                  <div className="mt-3 space-y-0.5 text-gray-700">
                    <div className="font-bold text-gray-800">หมายเหตุ</div>
                    <div className="whitespace-pre-line">{q.note}</div>
                  </div>
                )}
              </div>
              <table className="shrink-0 self-start w-[70mm] text-[12.5px]">
                <tbody>
                  <tr>
                    <td className="py-1 pr-2">รวมเป็นเงิน</td>
                    <td className="py-1 text-right">{fmt(subtotal)}</td>
                  </tr>
                  {discountValue > 0 && (
                    <>
                      <tr>
                        <td className="py-1 pr-2">
                          ส่วนลด{q.discountType === "percent" ? ` ${q.discount}%` : ""}
                        </td>
                        <td className="py-1 text-right">-{fmt(discountValue)}</td>
                      </tr>
                      <tr>
                        <td className="py-1 pr-2">ยอดหลังหักส่วนลด</td>
                        <td className="py-1 text-right">{fmt(afterDiscount)}</td>
                      </tr>
                    </>
                  )}
                  {q.vatEnabled && (
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

            {/* Signatures */}
            <div className="grid grid-cols-3 gap-6 mt-10 text-center text-[12px]">
              {[
                { title: "ผู้เสนอราคา", name: q.sellerName },
                null,
                { title: "ผู้สั่งซื้อ (ลูกค้า)", name: "" },
              ].map((s, idx) => 
                s ? (
                  <div key={s.title}>
                    <div className="border-b border-gray-400 h-12 mb-2" />
                    <div className="min-h-[18px] mt-2 text-gray-800">{s.name}</div>
                    <div className="font-bold mt-2">{s.title}</div>
                    <div className="text-gray-500 mt-2">วันที่ ______ / ______ / ______</div>
                  </div>
                ) : (
                  <div key={`empty-${idx}`} />
                )
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

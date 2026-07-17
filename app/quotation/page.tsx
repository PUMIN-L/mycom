"use client";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "../context/AuthContext";
import Toast from "../components/Toast";
import { bahtText } from "../lib/bahtText";

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
    "93 ซอยงามวงศ์วาน 6 แยก 19 ถนนงามวงศ์วาน ตำบลบางเขน อำเภอเมืองนนทบุรี จ.นนทบุรี 11000",
};

interface QuoteItem {
  id: string;
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
  paymentTerms: string;
  deliveryTerms: string;
  warrantyTerms: string;
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
  paymentTerms: "ชำระเงิน 100% ก่อนส่งมอบสินค้า",
  deliveryTerms: "30-45 วัน หลังยืนยันการสั่งซื้อ",
  warrantyTerms: "รับประกันสินค้า 1 ปี",
  note: "",
});

const fmt = (n: number) =>
  n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const thaiDate = (iso: string) => {
  if (!iso) return "-";
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const months = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
  return `${d} ${months[m - 1]} ${y + 543}`;
};

export default function QuotationPage() {
  const router = useRouter();
  const { isLoggedIn, isLoading } = useAuth();
  const [q, setQ] = useState<QuoteState>(emptyState);
  const [products, setProducts] = useState<ProductItem[]>([]);
  const [uploadingItemId, setUploadingItemId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false); // building the PDF
  const [savePrompt, setSavePrompt] = useState(false); // "keep 30d or delete now?" after download
  const [deletingQuote, setDeletingQuote] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const uploadTargetRef = useRef<string | null>(null);
  const hydratedRef = useRef(false);

  // Redirect if not logged in (same client gate as the other admin pages)
  useEffect(() => {
    if (!isLoading && !isLoggedIn) router.replace("/login");
  }, [isLoggedIn, isLoading, router]);

  // Hydrate: restore draft, else seed docNo/date. In an effect (not render) —
  // Date.now()/localStorage during render violate purity rules.
  useEffect(() => {
    const now = new Date();
    const iso = now.toISOString().slice(0, 10);
    let draft: QuoteState | null = null;
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) draft = JSON.parse(raw);
    } catch {
      /* corrupted draft — start fresh */
    }
    if (draft && Array.isArray(draft.items)) {
      // Older drafts may lack id — mint one so save/delete has a stable key.
      setQ({ ...emptyState(), ...draft, id: draft.id || crypto.randomUUID() });
    } else {
      setQ((prev) => ({
        ...prev,
        id: crypto.randomUUID(),
        docDate: iso,
        docNo: `QT${iso.replace(/-/g, "")}-01`,
        items: [newItem()],
      }));
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
  }, [isLoggedIn]);

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
    if (!p) return;
    setItem(itemId, { name: p.title_th || p.title_en, imageUrl: p.image, imageUploaded: false });
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
  const subtotal = q.items.reduce((sum, it) => sum + (it.qty || 0) * (it.unitPrice || 0), 0);
  const discountValue =
    q.discountType === "percent"
      ? (subtotal * Math.min(Math.max(q.discount || 0, 0), 100)) / 100
      : Math.min(Math.max(q.discount || 0, 0), subtotal);
  const afterDiscount = subtotal - discountValue;
  const vat = q.vatEnabled ? afterDiscount * 0.07 : 0;
  const grandTotal = afterDiscount + vat;

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
    let heightLeft = imgH;
    let position = 0;
    pdf.addImage(imgData, "JPEG", 0, position, pageW, imgH);
    heightLeft -= pageH;
    while (heightLeft > 0) {
      position -= pageH;
      pdf.addPage();
      pdf.addImage(imgData, "JPEG", 0, position, pageW, imgH);
      heightLeft -= pageH;
    }
    pdf.save(`Quotation-${(q.docNo || "document").replace(/[^\w.-]/g, "_")}.pdf`);
  }

  // ── Download → save record → generate PDF → ask keep/delete ───────────────
  async function handleDownload() {
    if (generating) return;
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
    if (saved) setSavePrompt(true);
    else showToast("ดาวน์โหลดแล้ว (แต่บันทึกประวัติไม่สำเร็จ)", "error");
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

      {/* Print rules: show ONLY the A4 sheet */}
      <style>{`
        @media print {
          @page { size: A4; margin: 10mm 12mm; }
          body * { visibility: hidden; }
          #quote-sheet, #quote-sheet * { visibility: visible; }
          #quote-sheet {
            position: absolute; left: 0; top: 0; width: 100%;
            margin: 0 !important; box-shadow: none !important;
            border: none !important; border-radius: 0 !important;
          }
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
            <button
              onClick={() => {
                if (window.confirm("ล้างข้อมูลทั้งหมดและเริ่มใหม่?")) {
                  localStorage.removeItem(DRAFT_KEY);
                  const iso = new Date().toISOString().slice(0, 10);
                  setQ({ ...emptyState(), id: crypto.randomUUID(), docDate: iso, docNo: `QT${iso.replace(/-/g, "")}-01`, items: [newItem()] });
                }
              }}
              className="px-4 py-2 rounded-lg border border-red-300 text-red-500 text-sm font-semibold hover:bg-red-50 transition"
            >
              ↺ เริ่มใหม่
            </button>
            <button
              onClick={handleDownload}
              className="px-5 py-2 rounded-lg bg-orange-500 text-white text-sm font-bold hover:bg-orange-600 transition shadow-sm"
            >
              ⬇️ ดาวน์โหลด PDF
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-[1400px] mx-auto px-4 py-6 grid grid-cols-1 xl:grid-cols-[420px_1fr] gap-6 items-start">
        {/* ══ LEFT: form ══ */}
        <div className="no-print space-y-4">
          {/* เอกสาร */}
          <section className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 space-y-3">
            <h2 className="font-bold text-gray-800">ข้อมูลเอกสาร</h2>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>เลขที่ (No.)</label>
                <input className={inputCls} value={q.docNo} onChange={(e) => set("docNo", e.target.value)} />
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
          <section className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 space-y-3">
            <h2 className="font-bold text-gray-800">พนักงานขาย (Sales)</h2>
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
            <h2 className="font-bold text-gray-800">ข้อมูลลูกค้า</h2>
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
                <select className={inputCls} value="" onChange={(e) => applyProduct(it.id, e.target.value)}>
                  <option value="" disabled>📦 เลือกจากสินค้าในระบบ (autofill ชื่อ+รูป)…</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>{p.title_th || p.title_en}</option>
                  ))}
                </select>
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
                    <input type="number" min={0} step="0.01" className={inputCls} value={it.unitPrice}
                      onChange={(e) => setItem(it.id, { unitPrice: Math.max(0, Number(e.target.value)) })} />
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
                <input type="number" min={0} step="0.01" className={inputCls} value={q.discount}
                  onChange={(e) => set("discount", Math.max(0, Number(e.target.value)))} />
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
            <div>
              <label className={labelCls}>เงื่อนไขชำระเงิน</label>
              <input className={inputCls} value={q.paymentTerms} onChange={(e) => set("paymentTerms", e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>กำหนดส่งมอบ</label>
              <input className={inputCls} value={q.deliveryTerms} onChange={(e) => set("deliveryTerms", e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>การรับประกัน</label>
              <input className={inputCls} value={q.warrantyTerms} onChange={(e) => set("warrantyTerms", e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>หมายเหตุเพิ่มเติม</label>
              <textarea rows={2} className={inputCls} value={q.note} onChange={(e) => set("note", e.target.value)} />
            </div>
          </section>
        </div>

        {/* ══ RIGHT: A4 sheet (what gets printed) ══ */}
        <div className="overflow-x-auto">
          <div
            id="quote-sheet"
            className="bg-white shadow-lg border border-gray-200 rounded-sm mx-auto text-gray-900"
            style={{ width: "210mm", minHeight: "297mm", padding: "12mm 14mm", fontSize: "13px", lineHeight: 1.55 }}
          >
            {/* Header */}
            <div className="flex justify-between items-start gap-4 pb-3 border-b-2 border-gray-800">
              <div>
                <div className="text-lg font-bold">{COMPANY.name}</div>
                <div className="text-xs text-gray-600">{COMPANY.nameEn}</div>
                <div className="text-xs mt-1 max-w-[95mm]">{COMPANY.address}</div>
                <div className="text-xs mt-0.5">
                  {q.companyPhone && <>โทร {q.companyPhone} </>}
                  {q.companyEmail && <>อีเมล {q.companyEmail}</>}
                </div>
                {q.companyTaxId && (
                  <div className="text-xs">เลขประจำตัวผู้เสียภาษี {q.companyTaxId}</div>
                )}
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
                {q.customerPhone && <div className="text-gray-700">โทร {q.customerPhone}</div>}
                {q.customerEmail && <div className="text-gray-700 break-all">อีเมล {q.customerEmail}</div>}
              </div>
              <table className="shrink-0 self-start text-[12.5px]">
                <tbody>
                  <tr>
                    <td className="pr-3 py-0.5 font-bold text-gray-700">เลขที่ (No.)</td>
                    <td className="py-0.5">{q.docNo || "-"}</td>
                  </tr>
                  <tr>
                    <td className="pr-3 py-0.5 font-bold text-gray-700">วันที่ (Date)</td>
                    <td className="py-0.5">{thaiDate(q.docDate)}</td>
                  </tr>
                  <tr>
                    <td className="pr-3 py-0.5 font-bold text-gray-700">ยืนราคา (Valid)</td>
                    <td className="py-0.5">{q.validDays} วัน</td>
                  </tr>
                  <tr>
                    <td className="pr-3 py-0.5 font-bold text-gray-700">พนักงานขาย</td>
                    <td className="py-0.5">{q.sellerName || "-"}</td>
                  </tr>
                  {(q.sellerPhone || q.sellerEmail) && (
                    <tr>
                      <td className="pr-3 py-0.5 align-top" />
                      <td className="py-0.5 text-gray-600">
                        {q.sellerPhone && <div>{q.sellerPhone}</div>}
                        {q.sellerEmail && <div className="break-all">{q.sellerEmail}</div>}
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
                      {/* Image sits below the name, only when one was added */}
                      {it.imageUrl && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={it.imageUrl} alt="" className="mt-1.5 object-contain" style={{ maxWidth: "40mm", maxHeight: "32mm" }} />
                      )}
                      {it.description && (
                        <div className="mt-1 text-gray-600 whitespace-pre-line text-[11.5px]">{it.description}</div>
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
                <div className="border border-gray-300 rounded p-2 bg-gray-50">
                  <span className="font-bold">จำนวนเงิน (ตัวอักษร): </span>
                  {bahtText(grandTotal)}
                </div>
                <div className="mt-3 space-y-0.5 text-gray-700">
                  <div className="font-bold text-gray-800">เงื่อนไข</div>
                  {q.paymentTerms && <div>• การชำระเงิน: {q.paymentTerms}</div>}
                  {q.deliveryTerms && <div>• กำหนดส่งมอบ: {q.deliveryTerms}</div>}
                  {q.warrantyTerms && <div>• การรับประกัน: {q.warrantyTerms}</div>}
                  <div>• กำหนดยืนราคา {q.validDays} วัน นับจากวันที่เสนอราคา</div>
                  {q.note && <div className="whitespace-pre-line">• {q.note}</div>}
                </div>
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
                { title: "ผู้อนุมัติ", name: "" },
                { title: "ผู้สั่งซื้อ (ลูกค้า)", name: "" },
              ].map((s) => (
                <div key={s.title}>
                  <div className="border-b border-gray-400 h-12 mb-1" />
                  <div>( {s.name || " ".repeat(20)} )</div>
                  <div className="font-bold">{s.title}</div>
                  <div className="text-gray-500">วันที่ ______ / ______ / ______</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

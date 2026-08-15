"use client";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "../context/AuthContext";
import Toast from "../components/Toast";
import SearchableDropdown from "../components/SearchableDropdown";
import { computeQuoteTotals } from "../lib/quotationTotals";
import {
  BILLING_LABELS,
  BILLING_PREFIX,
  nextBillingDocNo,
} from "../lib/billingNumber";
import type { BillingDocType } from "../lib/billingNumber";

// ── Billing Document Builder ────────────────────────────────────────────────
// Admin-only tool to create Invoice / Billing Note / Receipt.
// Can optionally link to a saved Quotation to auto-fill all data.
// Uses the same QuoteState shape and PDF generation as the quotation builder.

const COMPANY = {
  name: "บริษัท โปรฟิน แล็บสเกล จำกัด",
  nameEn: "PROFIN LAB SCALE CO., LTD.",
  address:
    "93 ซอยงามวงศ์วาน 6 แยก 19 ถนนงามวงศ์วาน\nตำบลบางเขน อำเภอเมืองนนทบุรี จ.นนทบุรี 11000",
};

interface QuoteItem {
  id: string;
  name: string;
  description: string;
  imageUrl: string;
  qty: number;
  unit: string;
  unitPrice: number;
}

interface BillingState {
  id: string;
  docType: BillingDocType;
  docNo: string;
  docDate: string;
  linkedQuotationId: string | null;
  linkedQuotationDocNo: string;
  sellerName: string;
  sellerPhone: string;
  sellerEmail: string;
  companyPhone: string;
  companyEmail: string;
  companyTaxId: string;
  customerContact: string;
  customerCompany: string;
  customerTaxId: string;
  customerAddress: string;
  customerPhone: string;
  customerEmail: string;
  items: QuoteItem[];
  discount: number;
  discountType: "amount" | "percent";
  vatEnabled: boolean;
  note: string;
  // Receipt-specific
  paymentMethod: string;
  paymentDate: string;
  paymentRef: string;
}

interface QuotationOption {
  id: string;
  docNo: string;
  customer: string;
  total: number;
}

const fmt = (n: number) =>
  n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const emptyState = (): BillingState => {
  const now = new Date();
  const iso = now.toISOString().slice(0, 10);
  return {
    id: crypto.randomUUID(),
    docType: "invoice",
    docNo: "",
    docDate: iso,
    linkedQuotationId: null,
    linkedQuotationDocNo: "",
    sellerName: "",
    sellerPhone: "",
    sellerEmail: "",
    companyPhone: "",
    companyEmail: "",
    companyTaxId: "",
    customerContact: "",
    customerCompany: "",
    customerTaxId: "",
    customerAddress: "",
    customerPhone: "",
    customerEmail: "",
    items: [],
    discount: 0,
    discountType: "amount",
    vatEnabled: true,
    note: "",
    paymentMethod: "โอนเงิน",
    paymentDate: iso,
    paymentRef: "",
  };
};

const thaiDate = (iso: string) => {
  if (!iso) return "-";
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const months = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
  return `${d} ${months[m - 1]} ${y + 543}`;
};

const DOC_TYPE_OPTIONS: { value: BillingDocType; label: string }[] = [
  { value: "invoice", label: "🧾 ใบแจ้งหนี้ / ใบกำกับภาษี (Invoice / Tax Invoice)" },
  { value: "billing_note", label: "📋 ใบวางบิล (Billing Note)" },
  { value: "receipt", label: "🧾 ใบเสร็จรับเงิน (Receipt)" },
];

const PAYMENT_METHODS = [
  "โอนเงิน",
  "เงินสด",
  "เช็ค",
  "บัตรเครดิต",
  "อื่นๆ",
];

export default function BillingPage() {
  const router = useRouter();
  const { isLoggedIn, isLoading } = useAuth();
  const [b, setB] = useState<BillingState>(emptyState);
  const [quotations, setQuotations] = useState<QuotationOption[]>([]);
  const [existingDocs, setExistingDocs] = useState<{ docNo: string }[]>([]);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadingQuotation, setLoadingQuotation] = useState(false);
  const [isViewOnly, setIsViewOnly] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  // A brand-new doc (not reopened) — eligible to auto-advance its docNo.
  const isFreshRef = useRef(true);
  const lastAutoDocNoRef = useRef<string>("");

  useEffect(() => {
    if (!isLoading && !isLoggedIn) router.replace("/login");
  }, [isLoggedIn, isLoading, router]);

  // Load quotation list for linking
  useEffect(() => {
    if (!isLoggedIn) return;
    fetch("/api/quotations")
      .then((r) => (r.ok ? r.json() : []))
      .then((list) =>
        setQuotations(
          Array.isArray(list)
            ? list.map((q: any) => ({
                id: q.id,
                docNo: q.docNo,
                customer: q.customer,
                total: q.total,
              }))
            : []
        )
      )
      .catch(() => {});

    // Load existing docNos for duplicate check
    fetch("/api/billing")
      .then((r) => (r.ok ? r.json() : []))
      .then((list) =>
        setExistingDocs(Array.isArray(list) ? list.map((x: any) => ({ docNo: x.docNo })) : [])
      )
      .catch(() => {});
  }, [isLoggedIn]);

  // Check if reopening from ?id=...
  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const reopenId = searchParams.get("id");
    const isView = searchParams.get("view") === "1";
    const initialType = searchParams.get("type") as BillingDocType | null;

    if (isView) setIsViewOnly(true);

    if (initialType && ["invoice", "billing_note", "receipt"].includes(initialType) && !reopenId) {
      setB(prev => ({ ...prev, docType: initialType }));
    }

    if (reopenId) {
      setIsEditing(true);
      isFreshRef.current = false; // reopening — don't overwrite docNo
      fetch(`/api/billing/${reopenId}`)
        .then((r) => (r.ok ? r.json() : null))
        .then(async (doc) => {
          if (doc?.data) {
            const isClone = new URLSearchParams(window.location.search).get("action") === "clone";
            let newDocNo = doc.docNo || "";
            let newId = doc.id;
            
            if (isClone) {
              const baseDocNo = newDocNo.replace(/(?:-V|v)\d+$/i, "");
              
              // Fetch docs directly to avoid race condition with existingDocs state
              let maxV = 0;
              try {
                const res = await fetch("/api/billing");
                const list = await res.json();
                const docs = Array.isArray(list) ? list : [];
                docs.forEach(d => {
                  if (d.docNo && d.docNo.startsWith(baseDocNo)) {
                    const match = d.docNo.match(/(?:-V|v)(\d+)$/i);
                    if (match) {
                      const v = parseInt(match[1], 10);
                      if (v > maxV) maxV = v;
                    } else if (d.docNo === baseDocNo) {
                      if (maxV === 0) maxV = 0;
                    }
                  }
                });
              } catch (e) {
                // If fetch fails, fallback to simple increment
                const vMatch = newDocNo.match(/(?:-V|v)(\d+)$/i);
                if (vMatch) maxV = parseInt(vMatch[1], 10);
              }
              
              newDocNo = `${baseDocNo}v${maxV + 1}`;
              
              // safe fallback for crypto.randomUUID
              newId = typeof crypto !== 'undefined' && crypto.randomUUID 
                ? crypto.randomUUID() 
                : Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
            }

            setB({
              ...emptyState(),
              ...doc.data,
              id: newId,
              docType: doc.docType,
              docNo: newDocNo,
              linkedQuotationId: doc.linkedQuotationId,
              paymentMethod: doc.paymentMethod ?? "โอนเงิน",
              paymentDate: doc.paymentDate ?? "",
              paymentRef: doc.paymentRef ?? "",
            });
          }
        })
        .catch(() => {});
    }
  }, []);

  // Auto-generate docNo when type or date changes — ONLY for fresh (new) documents.
  // Reopened docs keep their saved docNo.
  useEffect(() => {
    if (!isFreshRef.current || !b.docDate) return;
    const next = nextBillingDocNo(
      b.docType,
      b.docDate,
      existingDocs.map((d) => d.docNo)
    );
    setB((prev) => {
      // Allow update if the current docNo is empty (initial) or matches the last auto-generated one
      if (prev.docNo === "" || prev.docNo === lastAutoDocNoRef.current) {
        lastAutoDocNoRef.current = next;
        return next === prev.docNo ? prev : { ...prev, docNo: next };
      }
      return prev; // user manually edited it
    });
  }, [b.docType, b.docDate, existingDocs]);

  function showToast(message: string, type: "success" | "error") {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }

  const set = <K extends keyof BillingState>(key: K, value: BillingState[K]) =>
    setB((prev) => ({ ...prev, [key]: value }));

  // Link to a quotation → auto-fill all data
  async function linkQuotation(quotationId: string) {
    if (!quotationId) {
      setB((prev) => ({ ...prev, linkedQuotationId: null, linkedQuotationDocNo: "" }));
      return;
    }
    setLoadingQuotation(true);
    try {
      const res = await fetch(`/api/quotations/${quotationId}`);
      if (!res.ok) throw new Error();
      const rec = await res.json();
      const data = rec.data || {};
      setB((prev) => ({
        ...prev,
        linkedQuotationId: quotationId,
        linkedQuotationDocNo: rec.docNo || "",
        sellerName: data.sellerName || prev.sellerName,
        sellerPhone: data.sellerPhone || prev.sellerPhone,
        sellerEmail: data.sellerEmail || prev.sellerEmail,
        companyPhone: data.companyPhone || prev.companyPhone,
        companyEmail: data.companyEmail || prev.companyEmail,
        companyTaxId: data.companyTaxId || prev.companyTaxId,
        customerContact: data.customerContact || prev.customerContact,
        customerCompany: data.customerCompany || prev.customerCompany,
        customerTaxId: data.customerTaxId || prev.customerTaxId,
        customerAddress: data.customerAddress || prev.customerAddress,
        customerPhone: data.customerPhone || prev.customerPhone,
        customerEmail: data.customerEmail || prev.customerEmail,
        items: Array.isArray(data.items)
          ? data.items.map((it: any) => ({
              id: crypto.randomUUID(),
              name: it.name || "",
              description: it.description || "",
              imageUrl: it.imageUrl || "",
              qty: it.qty || 1,
              unit: it.unit || "เครื่อง",
              unitPrice: it.unitPrice || 0,
            }))
          : prev.items,
        discount: data.discount ?? prev.discount,
        discountType: data.discountType || prev.discountType,
        vatEnabled: data.vatEnabled ?? prev.vatEnabled,
        note: data.note || prev.note,
      }));
      showToast(`นำเข้าข้อมูลจากใบเสนอราคา ${rec.docNo} แล้ว`, "success");
    } catch {
      showToast("ไม่สามารถโหลดข้อมูลใบเสนอราคาได้", "error");
    } finally {
      setLoadingQuotation(false);
    }
  }

  // Totals
  const { subtotal, discountValue, afterDiscount, vat, grandTotal } =
    computeQuoteTotals(b);

  // Duplicate docNo check
  const trimmedDocNo = b.docNo.trim();
  const docNoDup =
    trimmedDocNo !== "" &&
    existingDocs.some((d) => d.docNo === trimmedDocNo);

  // Save billing document
  async function handleSave() {
    if (docNoDup) {
      showToast("เลขที่เอกสารซ้ำ กรุณาเปลี่ยน", "error");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/billing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: b.id,
          docType: b.docType,
          docNo: b.docNo,
          linkedQuotationId: b.linkedQuotationId,
          data: b,
          paymentMethod: b.paymentMethod,
          paymentDate: b.paymentDate,
          paymentRef: b.paymentRef,
        }),
      });
      if (res.status === 409) {
        const data = await res.json().catch(() => null);
        showToast(data?.error ?? "เลขที่เอกสารซ้ำ", "error");
        return;
      }
      if (!res.ok) throw new Error();
      showToast("บันทึกสำเร็จ", "success");
      router.push(`/billing/saved?tab=${b.docType}`);
    } catch {
      showToast("บันทึกไม่สำเร็จ กรุณาลองใหม่", "error");
    } finally {
      setSaving(false);
    }
  }

  // Generate PDF
  async function handleDownload() {
    if (generating) return;
    if (docNoDup) {
      showToast("เลขที่เอกสารซ้ำ กรุณาเปลี่ยน", "error");
      return;
    }
    setGenerating(true);
    // Save first
    try {
      await fetch("/api/billing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: b.id,
          docType: b.docType,
          docNo: b.docNo,
          linkedQuotationId: b.linkedQuotationId,
          data: b,
          paymentMethod: b.paymentMethod,
          paymentDate: b.paymentDate,
          paymentRef: b.paymentRef,
        }),
      });
    } catch { /* best-effort */ }

    try {
      const sheet = document.getElementById("billing-sheet");
      if (!sheet) throw new Error("Sheet not found");

      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
        import("html2canvas-pro"),
        import("jspdf"),
      ]);

      const canvas = await html2canvas(sheet, {
        scale: 2,
        useCORS: true,
        backgroundColor: "#ffffff",
      });

      const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const imgData = canvas.toDataURL("image/jpeg", 0.95);
      pdf.addImage(imgData, "JPEG", 0, 0, pageW, pageH);

      const prefix = BILLING_PREFIX[b.docType];
      pdf.save(`${prefix}-${(b.docNo || "document").replace(/[^\w.-]/g, "_")}.pdf`);
      showToast("ดาวน์โหลด PDF สำเร็จ", "success");
    } catch {
      showToast("สร้าง PDF ไม่สำเร็จ กรุณาลองใหม่", "error");
    } finally {
      setGenerating(false);
    }
  }

  if (isLoading || !isLoggedIn) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin h-8 w-8 border-4 border-orange-400 border-t-transparent rounded-full" />
      </div>
    );
  }

  const label = BILLING_LABELS[b.docType];

  return (
    <div className="min-h-screen bg-gray-100 quote-form">
      {toast && <Toast message={toast.message} type={toast.type} />}

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
        @media print {
          .no-print { display: none !important; }
        }
      `}</style>

      {/* ── Toolbar ── */}
      <div className="no-print sticky top-0 z-20 bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-[1400px] mx-auto px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold text-gray-900">
              📄 สร้าง{label?.th || "เอกสาร"}
            </h1>
            <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded bg-orange-100 text-orange-700 border border-orange-200">
              {b.docType.replace("_", " ")}
            </span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {!isEditing && (
              <Link href="/quotation" className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm font-semibold hover:bg-gray-50 transition">
                ← ใบเสนอราคา
              </Link>
            )}
            {isEditing && (
              <Link href="/showcase" className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm font-semibold hover:bg-gray-50 transition">
                🏠 ระบบจัดการ
              </Link>
            )}
            <Link href="/billing/saved" className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm font-semibold hover:bg-gray-50 transition">
              📋 เอกสารที่บันทึกไว้
            </Link>

            {!isViewOnly && (
              <button
                onClick={handleSave}
                disabled={saving || docNoDup}
                className="px-5 py-2 rounded-lg border border-green-500 text-green-600 text-sm font-bold hover:bg-green-50 transition disabled:opacity-50"
              >
                {saving ? "กำลังบันทึก..." : "💾 บันทึก"}
              </button>
            )}
            {isViewOnly && (
              <Link
                href={`/billing?id=${encodeURIComponent(b.id)}&action=clone`}
                className="px-5 py-2 rounded-lg border border-blue-500 text-blue-600 text-sm font-bold hover:bg-blue-50 transition"
              >
                ✏️ แก้ไข (New Ver.)
              </Link>
            )}
            {isViewOnly && (
              <button
                onClick={handleDownload}
                disabled={generating || docNoDup}
                className="px-5 py-2 rounded-lg bg-orange-500 text-white text-sm font-bold hover:bg-orange-600 transition shadow-sm disabled:opacity-50"
              >
                {generating ? "กำลังสร้าง..." : "⬇️ ดาวน์โหลด PDF"}
              </button>
            )}
          </div>
        </div>
      </div>

      <div className={`max-w-[1400px] mx-auto px-4 py-6 flex gap-6 flex-col lg:flex-row ${isViewOnly ? "justify-center" : ""}`}>
        {/* ── Left: Form ── */}
        {!isViewOnly && (
        <div className="no-print w-full lg:w-[440px] shrink-0 space-y-4">
          {/* Link to Quotation */}
          <div className="bg-white rounded-xl shadow-sm p-4 space-y-3">
            <h2 className="font-bold text-gray-800">🔗 เชื่อมกับใบเสนอราคา</h2>
            <SearchableDropdown
              value={b.linkedQuotationId ?? ""}
              onChange={(val) => linkQuotation(val)}
              options={[
                { value: "", label: "-- ไม่เชื่อม --" },
                ...quotations.map((q) => ({
                  value: q.id,
                  label: `${q.docNo} — ${q.customer} (${fmt(q.total)})`,
                })),
              ]}
              placeholder="ค้นหาใบเสนอราคา..."
            />
            {loadingQuotation && (
              <p className="text-sm text-orange-600 animate-pulse">กำลังโหลดข้อมูล...</p>
            )}
            {b.linkedQuotationDocNo && (
              <p className="text-xs text-green-600">✅ เชื่อมกับ: {b.linkedQuotationDocNo}</p>
            )}
          </div>

          {/* Document Info */}
          <div className="bg-white rounded-xl shadow-sm p-4 space-y-3">
            <h2 className="font-bold text-gray-800">📋 ข้อมูลเอกสาร</h2>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">เลขที่เอกสาร</label>
              <input
                value={b.docNo}
                onChange={(e) => set("docNo", e.target.value)}
                className={`w-full px-3 py-2 border rounded-lg text-sm ${
                  docNoDup ? "border-red-400 bg-red-50" : "border-gray-300"
                }`}
              />
              {docNoDup && (
                <p className="text-xs text-red-500 mt-1">⚠️ เลขที่ซ้ำ</p>
              )}
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">วันที่</label>
              <input
                type="date"
                value={b.docDate}
                onChange={(e) => set("docDate", e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              />
            </div>
          </div>

          {/* Customer Info */}
          <div className="bg-white rounded-xl shadow-sm p-4 space-y-3">
            <h2 className="font-bold text-gray-800">👤 ข้อมูลลูกค้า</h2>
            {[
              { key: "customerCompany" as const, label: "บริษัท/ชื่อลูกค้า" },
              { key: "customerTaxId" as const, label: "เลขประจำตัวผู้เสียภาษี" },
              { key: "customerContact" as const, label: "ผู้ติดต่อ" },
              { key: "customerAddress" as const, label: "ที่อยู่" },
              { key: "customerPhone" as const, label: "โทรศัพท์" },
              { key: "customerEmail" as const, label: "อีเมล" },
            ].map((f) => (
              <div key={f.key}>
                <label className="block text-xs font-semibold text-gray-500 mb-1">{f.label}</label>
                {f.key === "customerAddress" ? (
                  <textarea
                    value={b[f.key]}
                    onChange={(e) => set(f.key, e.target.value)}
                    rows={2}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  />
                ) : (
                  <input
                    value={b[f.key]}
                    onChange={(e) => set(f.key, e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  />
                )}
              </div>
            ))}
          </div>

          {/* Seller Info */}
          <div className="bg-white rounded-xl shadow-sm p-4 space-y-3">
            <h2 className="font-bold text-gray-800">🏢 ข้อมูลผู้ขาย</h2>
            {[
              { key: "companyPhone" as const, label: "เบอร์โทรบริษัท" },
              { key: "companyEmail" as const, label: "อีเมลบริษัท" },
              { key: "companyTaxId" as const, label: "เลขประจำตัวผู้เสียภาษี" },
              { key: "sellerName" as const, label: "ชื่อพนักงานขาย" },
              { key: "sellerPhone" as const, label: "เบอร์พนักงานขาย" },
            ].map((f) => (
              <div key={f.key}>
                <label className="block text-xs font-semibold text-gray-500 mb-1">{f.label}</label>
                <input
                  value={b[f.key]}
                  onChange={(e) => set(f.key, e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                />
              </div>
            ))}
          </div>

          {/* Payment Info (Receipt only) */}
          {b.docType === "receipt" && (
            <div className="bg-white rounded-xl shadow-sm p-4 space-y-3">
              <h2 className="font-bold text-gray-800">💳 ข้อมูลการชำระเงิน</h2>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">ช่องทางชำระเงิน</label>
                <SearchableDropdown
                  value={b.paymentMethod}
                  onChange={(val) => set("paymentMethod", val)}
                  options={PAYMENT_METHODS.map((m) => ({ value: m, label: m }))}
                  placeholder="เลือกช่องทาง..."
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">วันที่ชำระเงิน</label>
                <input
                  type="date"
                  value={b.paymentDate}
                  onChange={(e) => set("paymentDate", e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">เลขอ้างอิง</label>
                <input
                  value={b.paymentRef}
                  onChange={(e) => set("paymentRef", e.target.value)}
                  placeholder="เลขที่โอน / เลขที่เช็ค"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                />
              </div>
            </div>
          )}

          {/* Note */}
          <div className="bg-white rounded-xl shadow-sm p-4 space-y-3">
            <h2 className="font-bold text-gray-800">📝 หมายเหตุ</h2>
            <textarea
              value={b.note}
              onChange={(e) => set("note", e.target.value)}
              rows={3}
              placeholder="หมายเหตุเพิ่มเติม..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
            />
          </div>
        </div>
        )}

        {/* ── Right: A4 Preview ── */}
        <div className={`flex-1 flex ${isViewOnly ? "justify-center" : "justify-start"} overflow-x-auto`}>
          <div
            id="billing-sheet"
            className="bg-white shadow-lg border border-gray-200 rounded-sm mx-auto text-gray-900"
            style={{
              width: "210mm",
              minHeight: "297mm",
              padding: "12mm 14mm",
              fontSize: "13px",
              lineHeight: "1.55",
            }}
          >
            {/* ── Accent color strip at top ── */}
            <div
              className="rounded-t-sm"
              style={{
                height: "4px",
                marginTop: "-12mm",
                marginLeft: "-14mm",
                marginRight: "-14mm",
                marginBottom: "10mm",
                background: b.docType === "invoice"
                  ? "linear-gradient(90deg, #1e40af, #3b82f6)"
                  : b.docType === "billing_note"
                    ? "linear-gradient(90deg, #6b21a8, #a855f7)"
                    : "linear-gradient(90deg, #15803d, #22c55e)",
              }}
            />

            {/* ── Header ── */}
            <div className="flex justify-between items-start gap-4 pb-3" style={{ borderBottom: "2.5px solid #1f2937" }}>
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
                    {b.companyPhone && <>โทร {b.companyPhone} </>}
                    {b.companyEmail && <>อีเมล {b.companyEmail}</>}
                  </div>
                  {b.companyTaxId && (
                    <div className="text-xs">เลขประจำตัวผู้เสียภาษี {b.companyTaxId}</div>
                  )}
                </div>
              </div>
              <div className="text-right shrink-0">
                <div
                  className="text-2xl font-bold tracking-wide"
                  style={{
                    color: b.docType === "invoice"
                      ? "#1e40af"
                      : b.docType === "billing_note"
                        ? "#6b21a8"
                        : "#15803d",
                  }}
                >
                  {label.th}
                </div>
                <div className="text-sm text-gray-500 tracking-widest">{label.en}</div>
              </div>
            </div>

            {/* ── Doc info + Customer ── */}
            <div id="billing-customer-info" className="flex justify-between gap-6 mt-3 text-[12.5px]">
              <div className="flex-1">
                <div className="font-bold text-gray-700 mb-1">เรียน (To)</div>
                <div className="font-semibold">{b.customerContact || "-"}</div>
                {b.customerCompany && <div>{b.customerCompany}</div>}
                {b.customerAddress && <div className="whitespace-pre-line text-gray-700">{b.customerAddress}</div>}
                {b.customerPhone && <div className="text-gray-700">โทร {b.customerPhone}</div>}
                {b.customerEmail && <div className="text-gray-700 break-all">อีเมล {b.customerEmail}</div>}
                {b.customerTaxId && <div className="text-gray-700">เลขประจำตัวผู้เสียภาษี: {b.customerTaxId}</div>}
              </div>
              <table className="shrink-0 self-start text-[12.5px]">
                <tbody>
                  <tr>
                    <td className="pr-3 py-0.5 font-bold text-gray-700 text-right">เลขที่ (No.)</td>
                    <td className="py-0.5 text-right font-semibold">{b.docNo || "-"}</td>
                  </tr>
                  <tr>
                    <td className="pr-3 py-0.5 font-bold text-gray-700 text-right">วันที่ (Date)</td>
                    <td className="py-0.5 text-right">{thaiDate(b.docDate)}</td>
                  </tr>
                  {b.linkedQuotationDocNo && (
                    <tr>
                      <td className="pr-3 py-0.5 font-bold text-gray-700 text-right">อ้างอิง (Ref.)</td>
                      <td className="py-0.5 text-right">{b.linkedQuotationDocNo}</td>
                    </tr>
                  )}
                  {b.sellerName && (
                    <tr>
                      <td className="pr-3 py-0.5 font-bold text-gray-700 align-top text-right pt-1.5">พนักงานขาย</td>
                      <td className="py-0.5 text-right pt-1.5">
                        <div className="text-gray-900">{b.sellerName}</div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* ── Items Table ── */}
            <table id="billing-table" className="w-full mt-4 border-collapse text-[12.5px]">
              <thead>
                <tr className="text-white" style={{ backgroundColor: b.docType === "invoice" ? "#1e40af" : b.docType === "billing_note" ? "#6b21a8" : "#15803d" }}>
                  <th className="border border-gray-800 px-2 py-1.5 w-[8mm] border-r-white/20">ลำดับ</th>
                  <th className="border border-gray-800 px-2 py-1.5 text-left border-r-white/20">รายการ</th>
                  <th className="border border-gray-800 px-2 py-1.5 w-[14mm] border-r-white/20">จำนวน</th>
                  <th className="border border-gray-800 px-2 py-1.5 w-[14mm] border-r-white/20">หน่วย</th>
                  <th className="border border-gray-800 px-2 py-1.5 w-[24mm] border-r-white/20">ราคา/หน่วย</th>
                  <th className="border border-gray-800 px-2 py-1.5 w-[26mm]">จำนวนเงิน</th>
                </tr>
              </thead>
              <tbody id="billing-tbody">
                {b.items.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="border border-gray-300 px-3 py-8 text-center text-gray-400">
                      — ยังไม่มีรายการ — เชื่อมกับใบเสนอราคาเพื่อนำเข้า
                    </td>
                  </tr>
                ) : (
                  b.items.map((item, idx) => (
                    <tr key={item.id} className="align-top">
                      <td className="border border-gray-300 px-2 py-1.5 text-center">{idx + 1}</td>
                      <td className="border border-gray-300 px-2 py-1.5">
                        <div className="font-bold text-gray-800">{item.name || "-"}</div>
                        {item.description && (
                          <div className="mt-0.5 text-gray-600 whitespace-pre-line leading-snug text-[11.5px]">{item.description}</div>
                        )}
                      </td>
                      <td className="border border-gray-300 px-2 py-1.5 text-center">{item.qty}</td>
                      <td className="border border-gray-300 px-2 py-1.5 text-center">{item.unit}</td>
                      <td className="border border-gray-300 px-2 py-1.5 text-right">{fmt(item.unitPrice)}</td>
                      <td className="border border-gray-300 px-2 py-1.5 text-right">{fmt(item.qty * item.unitPrice)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>

            {/* ── Totals + Note / Payment ── */}
            <div id="billing-footer" className="flex justify-between gap-6 mt-3">
              <div className="flex-1 text-[12px]">
                {b.docType === "receipt" && (
                  <div className="mb-4 space-y-0.5 text-gray-700">
                    <div className="font-bold text-gray-800">การชำระเงิน / Payment</div>
                    <div><span className="font-semibold">ช่องทาง:</span> {b.paymentMethod || "-"}</div>
                    <div><span className="font-semibold">วันที่ชำระ:</span> {b.paymentDate ? thaiDate(b.paymentDate) : "-"}</div>
                    {b.paymentRef && <div><span className="font-semibold">เลขอ้างอิง:</span> {b.paymentRef}</div>}
                  </div>
                )}
                {b.note && (
                  <div className="mt-3 space-y-0.5 text-gray-700">
                    <div className="font-bold text-gray-800">หมายเหตุ</div>
                    <div className="whitespace-pre-line">{b.note}</div>
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
                          ส่วนลด{b.discountType === "percent" ? ` ${b.discount}%` : ""}
                        </td>
                        <td className="py-1 text-right">-{fmt(discountValue)}</td>
                      </tr>
                      <tr>
                        <td className="py-1 pr-2">ยอดหลังหักส่วนลด</td>
                        <td className="py-1 text-right">{fmt(afterDiscount)}</td>
                      </tr>
                    </>
                  )}
                  {b.vatEnabled && (
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

            {/* ── Signatures ── */}
            <div id="billing-signatures" className="grid grid-cols-3 gap-6 mt-10 text-center text-[12px]">
              {[
                { title: b.docType === "invoice" ? "ผู้ออกเอกสาร (Authorized Signature)" : b.docType === "billing_note" ? "ผู้วางบิล (Biller)" : "ผู้รับเงิน (Collector)", name: b.sellerName },
                null,
                { title: b.docType === "invoice" ? "ผู้รับเอกสาร (Received By)" : b.docType === "billing_note" ? "ผู้รับบิล (Received By)" : "ผู้จ่ายเงิน (Payer)", name: "" },
              ].map((s, idx) => 
                s ? (
                  <div key={s.title}>
                    <div className="border-b border-gray-400 h-12 mb-2" />
                    <div className="min-h-[18px] mt-2 text-gray-800">{s.name || "(....................................)"}</div>
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

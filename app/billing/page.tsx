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
  { value: "invoice", label: "🧾 ใบแจ้งหนี้ (Invoice)" },
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
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  // A brand-new doc (not reopened) — eligible to auto-advance its docNo.
  const isFreshRef = useRef(true);

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
    fetch("/api/quotations/docnos")
      .then((r) => (r.ok ? r.json() : []))
      .then((list) =>
        setExistingDocs(Array.isArray(list) ? list.map((x: any) => ({ docNo: x.docNo })) : [])
      )
      .catch(() => {});
  }, [isLoggedIn]);

  // Check if reopening from ?id=...
  useEffect(() => {
    const reopenId = new URLSearchParams(window.location.search).get("id");
    if (reopenId) {
      isFreshRef.current = false; // reopening — don't overwrite docNo
      fetch(`/api/billing/${reopenId}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((doc) => {
          if (doc?.data) {
            setB({
              ...emptyState(),
              ...doc.data,
              id: doc.id,
              docType: doc.docType,
              docNo: doc.docNo,
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
    setB((prev) => ({ ...prev, docNo: next }));
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
      // Add to existing docs to prevent duplicate
      setExistingDocs((prev) => [...prev, { docNo: b.docNo }]);
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
          <h1 className="text-xl font-bold text-gray-900">📄 สร้างเอกสาร</h1>
          <div className="flex items-center gap-2 flex-wrap">
            <Link href="/quotation" className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm font-semibold hover:bg-gray-50 transition">
              ← ใบเสนอราคา
            </Link>
            <Link href="/billing/saved" className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm font-semibold hover:bg-gray-50 transition">
              📋 เอกสารที่บันทึกไว้
            </Link>
            <button
              onClick={() => { setB(emptyState()); }}
              className="px-4 py-2 rounded-lg border border-red-300 text-red-500 text-sm font-semibold hover:bg-red-50 transition"
            >
              ↺ เริ่มใหม่
            </button>
            <button
              onClick={handleSave}
              disabled={saving || docNoDup}
              className="px-5 py-2 rounded-lg border border-green-500 text-green-600 text-sm font-bold hover:bg-green-50 transition disabled:opacity-50"
            >
              {saving ? "กำลังบันทึก..." : "💾 บันทึก"}
            </button>
            <button
              onClick={handleDownload}
              disabled={generating || docNoDup}
              className="px-5 py-2 rounded-lg bg-orange-500 text-white text-sm font-bold hover:bg-orange-600 transition shadow-sm disabled:opacity-50"
            >
              {generating ? "กำลังสร้าง..." : "⬇️ ดาวน์โหลด PDF"}
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-[1400px] mx-auto px-4 py-6 flex gap-6 flex-col lg:flex-row">
        {/* ── Left: Form ── */}
        <div className="no-print w-full lg:w-[440px] shrink-0 space-y-4">
          {/* Document Type */}
          <div className="bg-white rounded-xl shadow-sm p-4 space-y-3">
            <h2 className="font-bold text-gray-800">📑 ประเภทเอกสาร</h2>
            <div className="grid grid-cols-1 gap-2">
              {DOC_TYPE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => set("docType", opt.value)}
                  className={`w-full text-left px-4 py-3 rounded-lg border-2 font-semibold text-sm transition ${
                    b.docType === opt.value
                      ? "border-orange-500 bg-orange-50 text-orange-700"
                      : "border-gray-200 text-gray-600 hover:border-gray-300"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

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

        {/* ── Right: A4 Preview ── */}
        <div className="flex-1 flex justify-center">
          <div
            id="billing-sheet"
            className="bg-white shadow-xl rounded-lg"
            style={{
              width: "210mm",
              minHeight: "297mm",
              padding: "14mm 16mm",
              fontFamily: "'Sarabun', sans-serif",
              fontSize: "13px",
              lineHeight: "1.5",
              color: "#1a1a1a",
            }}
          >
            {/* Header */}
            <div className="flex justify-between items-start mb-4">
              <div>
                <div className="text-lg font-bold">{COMPANY.name}</div>
                <div className="text-xs text-gray-500">{COMPANY.nameEn}</div>
                <div className="text-xs text-gray-600 whitespace-pre-line mt-1">{COMPANY.address}</div>
                {b.companyPhone && <div className="text-xs text-gray-600">โทร: {b.companyPhone}</div>}
                {b.companyEmail && <div className="text-xs text-gray-600">Email: {b.companyEmail}</div>}
                {b.companyTaxId && <div className="text-xs text-gray-600">เลขผู้เสียภาษี: {b.companyTaxId}</div>}
              </div>
              <div className="text-right shrink-0">
                <div className="text-2xl font-bold text-orange-600">{label.th}</div>
                <div className="text-sm font-bold text-gray-500">{label.en}</div>
                <div className="text-sm mt-2">เลขที่: <strong>{b.docNo || "-"}</strong></div>
                <div className="text-sm">วันที่: {thaiDate(b.docDate)}</div>
                {b.linkedQuotationDocNo && (
                  <div className="text-xs text-gray-500 mt-1">อ้างอิง: {b.linkedQuotationDocNo}</div>
                )}
              </div>
            </div>

            {/* Customer Info */}
            <div className="border border-gray-300 rounded-lg p-3 mb-4 text-sm">
              <div className="font-bold text-gray-700 mb-1">ลูกค้า / Customer</div>
              {b.customerCompany && <div>บริษัท: {b.customerCompany}</div>}
              {b.customerContact && <div>ผู้ติดต่อ: {b.customerContact}</div>}
              {b.customerAddress && <div>ที่อยู่: {b.customerAddress}</div>}
              {b.customerPhone && <div>โทร: {b.customerPhone}</div>}
              {b.customerEmail && <div>Email: {b.customerEmail}</div>}
            </div>

            {/* Items Table */}
            <table className="w-full border-collapse mb-4">
              <thead>
                <tr className="bg-gray-100">
                  <th className="border border-gray-300 px-2 py-2 text-center text-xs w-10">ลำดับ</th>
                  <th className="border border-gray-300 px-2 py-2 text-left text-xs">รายการ</th>
                  <th className="border border-gray-300 px-2 py-2 text-center text-xs w-16">จำนวน</th>
                  <th className="border border-gray-300 px-2 py-2 text-center text-xs w-16">หน่วย</th>
                  <th className="border border-gray-300 px-2 py-2 text-right text-xs w-24">ราคาต่อหน่วย</th>
                  <th className="border border-gray-300 px-2 py-2 text-right text-xs w-24">จำนวนเงิน</th>
                </tr>
              </thead>
              <tbody>
                {b.items.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="border border-gray-300 px-4 py-6 text-center text-gray-400 text-sm">
                      ยังไม่มีรายการ — เชื่อมกับใบเสนอราคาเพื่อนำเข้า
                    </td>
                  </tr>
                ) : (
                  b.items.map((item, idx) => (
                    <tr key={item.id}>
                      <td className="border border-gray-300 px-2 py-2 text-center text-xs">{idx + 1}</td>
                      <td className="border border-gray-300 px-2 py-2 text-xs">
                        <div className="font-semibold">{item.name || "-"}</div>
                        {item.description && (
                          <div className="text-gray-500 text-[11px]">{item.description}</div>
                        )}
                      </td>
                      <td className="border border-gray-300 px-2 py-2 text-center text-xs">{item.qty}</td>
                      <td className="border border-gray-300 px-2 py-2 text-center text-xs">{item.unit}</td>
                      <td className="border border-gray-300 px-2 py-2 text-right text-xs">{fmt(item.unitPrice)}</td>
                      <td className="border border-gray-300 px-2 py-2 text-right text-xs">{fmt(item.qty * item.unitPrice)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>

            {/* Totals */}
            <div className="flex justify-end mb-4">
              <div className="w-64 space-y-1 text-sm">
                <div className="flex justify-between">
                  <span>รวมเป็นเงิน</span>
                  <span>{fmt(subtotal)}</span>
                </div>
                {discountValue > 0 && (
                  <div className="flex justify-between text-red-600">
                    <span>ส่วนลด</span>
                    <span>-{fmt(discountValue)}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span>หลังหักส่วนลด</span>
                  <span>{fmt(afterDiscount)}</span>
                </div>
                {b.vatEnabled && (
                  <div className="flex justify-between">
                    <span>VAT 7%</span>
                    <span>{fmt(vat)}</span>
                  </div>
                )}
                <div className="flex justify-between font-bold text-base border-t border-gray-400 pt-1">
                  <span>ยอดรวมสุทธิ</span>
                  <span>{fmt(grandTotal)}</span>
                </div>
              </div>
            </div>

            {/* Payment Info (Receipt only) */}
            {b.docType === "receipt" && (
              <div className="border border-gray-300 rounded-lg p-3 mb-4 text-sm">
                <div className="font-bold text-gray-700 mb-1">การชำระเงิน / Payment</div>
                <div>ช่องทาง: {b.paymentMethod || "-"}</div>
                <div>วันที่ชำระ: {b.paymentDate ? thaiDate(b.paymentDate) : "-"}</div>
                {b.paymentRef && <div>เลขอ้างอิง: {b.paymentRef}</div>}
              </div>
            )}

            {/* Note */}
            {b.note && (
              <div className="text-xs text-gray-600 mb-4">
                <span className="font-semibold">หมายเหตุ:</span> {b.note}
              </div>
            )}

            {/* Signatures */}
            <div className="flex justify-between mt-8 pt-4">
              <div className="text-center w-40">
                <div className="border-b border-gray-400 mb-1 h-12" />
                <div className="text-xs text-gray-600">
                  {b.docType === "invoice" && "ผู้แจ้งหนี้"}
                  {b.docType === "billing_note" && "ผู้วางบิล"}
                  {b.docType === "receipt" && "ผู้รับเงิน"}
                </div>
                <div className="text-xs text-gray-500">วันที่ ........./........../.........</div>
              </div>
              <div className="text-center w-40">
                <div className="border-b border-gray-400 mb-1 h-12" />
                <div className="text-xs text-gray-600">
                  {b.docType === "invoice" && "ผู้รับแจ้ง"}
                  {b.docType === "billing_note" && "ผู้รับบิล"}
                  {b.docType === "receipt" && "ผู้จ่ายเงิน"}
                </div>
                <div className="text-xs text-gray-500">วันที่ ........./........../.........</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

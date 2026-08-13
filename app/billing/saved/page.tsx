"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "../../context/AuthContext";
import ConfirmDialog from "../../components/ConfirmDialog";
import Toast from "../../components/Toast";
import ImageDeleteConfirmDialog, { type OrphanedImage } from "../../components/ImageDeleteConfirmDialog";
import { BILLING_LABELS } from "../../lib/billingNumber";
import type { BillingDocType } from "../../lib/billingNumber";

type CombinedDocType = BillingDocType | "quotation";

interface BillingSummary {
  id: string;
  docType: CombinedDocType;
  docNo: string;
  createdAt: string;
  customer: string;
  total: number;
}

const fmt = (n: number) =>
  n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function daysLeft(createdAt: string): number {
  const created = new Date(createdAt).getTime();
  if (!Number.isFinite(created)) return 30;
  const elapsedDays = (Date.now() - created) / (24 * 60 * 60 * 1000);
  return Math.max(0, Math.ceil(30 - elapsedDays));
}

const TAB_OPTIONS: { value: CombinedDocType | "all"; label: string }[] = [
  { value: "all", label: "ทั้งหมด" },
  { value: "invoice", label: "🧾 ใบแจ้งหนี้ / ใบกำกับภาษี" },
  { value: "billing_note", label: "📋 ใบวางบิล" },
  { value: "receipt", label: "🧾 ใบเสร็จ" },
  { value: "quotation", label: "📋 ใบเสนอราคา" },
];

export default function SavedBillingPage() {
  const router = useRouter();
  const { isLoggedIn, isLoading } = useAuth();
  const [items, setItems] = useState<BillingSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [filter, setFilter] = useState<CombinedDocType | "all">("all");
  const [pendingDelete, setPendingDelete] = useState<BillingSummary | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const [orphanedImages, setOrphanedImages] = useState<OrphanedImage[]>([]);

  useEffect(() => {
    if (!isLoading && !isLoggedIn) router.replace("/login");
  }, [isLoggedIn, isLoading, router]);

  async function load() {
    setLoading(true);
    setLoadFailed(false);
    try {
      const [billingRes, quoteRes] = await Promise.all([
        fetch("/api/billing"),
        fetch("/api/quotations")
      ]);
      if (!billingRes.ok || !quoteRes.ok) throw new Error();
      
      const billings: BillingSummary[] = await billingRes.json();
      const quotes: BillingSummary[] = (await quoteRes.json()).map((q: any) => ({
        ...q,
        docType: "quotation"
      }));

      const combined = [...billings, ...quotes].sort((a, b) => 
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      
      setItems(combined);
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (isLoggedIn) load();
  }, [isLoggedIn]);

  function showToast(message: string, type: "success" | "error") {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }

  async function handleDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      const endpoint = pendingDelete.docType === "quotation"
        ? `/api/quotations/${pendingDelete.id}`
        : `/api/billing/${pendingDelete.id}`;

      const res = await fetch(endpoint, { method: "DELETE" });
      if (res.ok) {
        const data = await res.json();
        setItems((prev) => prev.filter((x) => x.id !== pendingDelete.id));
        showToast("ลบเอกสารแล้ว", "success");
        if (data.orphanedImages?.length > 0) {
          setOrphanedImages(data.orphanedImages.map((url: string) => ({
            url,
            reason: "ลบเอกสาร"
          })));
        }
      } else {
        showToast("ลบไม่สำเร็จ", "error");
      }
    } catch {
      showToast("เกิดข้อผิดพลาด", "error");
    } finally {
      setDeleting(false);
      setPendingDelete(null);
    }
  }

  const filtered = filter === "all" ? items : items.filter((i) => i.docType === filter);

  if (isLoading || !isLoggedIn) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin h-8 w-8 border-4 border-orange-400 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <>
    <div className="min-h-screen bg-gray-50">
      {toast && <Toast message={toast.message} type={toast.type} />}

      {/* Header */}
      <div className="sticky top-0 z-20 bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
          <h1 className="text-xl font-bold text-gray-900">📋 เอกสารที่บันทึกไว้</h1>
          <div className="flex items-center gap-2 flex-wrap">
            <Link href="/showcase" className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm font-semibold hover:bg-gray-50 transition">
              🏠 หน้าแรก
            </Link>
            <Link
              href="/billing"
              className="px-4 py-2 rounded-lg bg-orange-500 text-white text-sm font-bold hover:bg-orange-600 transition"
            >
              + สร้างเอกสารใหม่
            </Link>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-6">
        {/* Filter Tabs */}
        <div className="flex gap-2 mb-4 flex-wrap">
          {TAB_OPTIONS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setFilter(tab.value)}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition ${
                filter === tab.value
                  ? "bg-orange-500 text-white shadow-sm"
                  : "bg-white border border-gray-300 text-gray-600 hover:bg-gray-50"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Table */}
        {loading ? (
          <div className="bg-white rounded-xl shadow-sm overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50 border-b">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">ประเภท</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">เลขที่</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">ลูกค้า</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500">ยอดรวม</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500">เหลือ</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: 3 }).map((_, i) => (
                  <tr key={i} className="border-b">
                    <td className="px-4 py-3"><div className="h-4 bg-gray-200 rounded animate-pulse w-20" /></td>
                    <td className="px-4 py-3"><div className="h-4 bg-gray-200 rounded animate-pulse w-32" /></td>
                    <td className="px-4 py-3"><div className="h-4 bg-gray-200 rounded animate-pulse w-28" /></td>
                    <td className="px-4 py-3"><div className="h-4 bg-gray-200 rounded animate-pulse w-24 ml-auto" /></td>
                    <td className="px-4 py-3"><div className="h-4 bg-gray-200 rounded animate-pulse w-12 ml-auto" /></td>
                    <td className="px-4 py-3"><div className="h-4 bg-gray-200 rounded animate-pulse w-16 ml-auto" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : loadFailed ? (
          <div className="text-center py-16">
            <p className="text-red-500 mb-3">โหลดข้อมูลไม่สำเร็จ</p>
            <button onClick={load} className="px-4 py-2 rounded-lg bg-orange-500 text-white font-semibold hover:bg-orange-600 transition">
              ลองใหม่
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <p className="text-4xl mb-3">📄</p>
            <p className="text-lg font-semibold">ยังไม่มีเอกสาร</p>
            <Link href="/billing" className="inline-block mt-3 px-4 py-2 rounded-lg bg-orange-500 text-white font-semibold hover:bg-orange-600 transition">
              สร้างเอกสารใหม่
            </Link>
          </div>
        ) : (
          <div className="bg-white rounded-xl shadow-sm overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50 border-b">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">ประเภท</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">เลขที่</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">ลูกค้า</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500">ยอดรวม</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500">เหลือ</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => {
                  const days = daysLeft(item.createdAt);
                  return (
                    <tr
                      key={item.id}
                      className="border-b hover:bg-gray-50/50 cursor-pointer transition"
                      onClick={() => {
                        if (item.docType === "quotation") router.push(`/quotation?id=${item.id}`);
                        else router.push(`/billing?id=${item.id}`);
                      }}
                    >
                      <td className="px-4 py-3">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-bold ${
                          item.docType === "quotation" ? "bg-orange-100 text-orange-700" :
                          item.docType === "invoice" ? "bg-blue-100 text-blue-700" :
                          item.docType === "billing_note" ? "bg-purple-100 text-purple-700" :
                          "bg-green-100 text-green-700"
                        }`}>
                          {item.docType === "quotation" ? "ใบเสนอราคา" : BILLING_LABELS[item.docType].th}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono text-sm font-semibold text-gray-800">{item.docNo || "-"}</td>
                      <td className="px-4 py-3 text-sm text-gray-700">{item.customer}</td>
                      <td className="px-4 py-3 text-sm text-right font-semibold text-gray-800">{fmt(item.total)}</td>
                      <td className="px-4 py-3 text-right">
                        <span className={`text-xs font-bold ${days <= 5 ? "text-red-500" : "text-gray-400"}`}>
                          {days}d
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-3">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              if (item.docType === "quotation") router.push(`/quotation?id=${item.id}&action=clone`);
                              else router.push(`/billing?id=${item.id}&action=clone`);
                            }}
                            className="text-xs text-blue-500 hover:text-blue-700 font-semibold flex items-center gap-1"
                          >
                            <span>✏️</span> แก้ไข (New Ver.)
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); setPendingDelete(item); }}
                            className="text-xs text-red-500 hover:text-red-700 font-semibold flex items-center gap-1"
                          >
                            <span>🗑️</span> ลบ
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Delete confirmation */}
      {pendingDelete && (
        <ConfirmDialog
          title="ลบเอกสาร"
          message={`ต้องการลบ ${pendingDelete.docNo || "เอกสารนี้"} หรือไม่?`}
          confirmText="ลบ"
          cancelText="ยกเลิก"
          onConfirm={handleDelete}
          onCancel={() => setPendingDelete(null)}
          loading={deleting}
        />
      )}
    </div>

    {orphanedImages.length > 0 && (
      <ImageDeleteConfirmDialog
        images={orphanedImages}
        onComplete={() => setOrphanedImages([])}
      />
    )}
    </>
  );
}

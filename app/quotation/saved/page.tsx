"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "../../context/AuthContext";
import ConfirmDialog from "../../components/ConfirmDialog";
import Toast from "../../components/Toast";

interface QuotationSummary {
  id: string;
  docNo: string;
  createdAt: string;
  customer: string;
  total: number;
}

const fmt = (n: number) =>
  n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Saved quotations are auto-purged after 30 days — show days remaining so the
// admin knows what will disappear.
function daysLeft(createdAt: string): number {
  const created = new Date(createdAt).getTime();
  if (!Number.isFinite(created)) return 30;
  const elapsedDays = (Date.now() - created) / (24 * 60 * 60 * 1000);
  return Math.max(0, Math.ceil(30 - elapsedDays));
}

export default function SavedQuotationsPage() {
  const router = useRouter();
  const { isLoggedIn, isLoading } = useAuth();
  const [items, setItems] = useState<QuotationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<QuotationSummary | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  useEffect(() => {
    if (!isLoading && !isLoggedIn) router.replace("/login");
  }, [isLoggedIn, isLoading, router]);

  async function load() {
    setLoading(true);
    setLoadFailed(false);
    try {
      const res = await fetch("/api/quotations");
      if (!res.ok) throw new Error();
      setItems(await res.json());
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
      const res = await fetch(`/api/quotations/${pendingDelete.id}`, { method: "DELETE" });
      if (res.ok) {
        setItems((prev) => prev.filter((x) => x.id !== pendingDelete.id));
        showToast("ลบใบเสนอราคาแล้ว", "success");
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

  if (isLoading || !isLoggedIn) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-gray-500">Loading...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 py-10">
      {toast && <Toast message={toast.message} type={toast.type} />}
      {pendingDelete && (
        <ConfirmDialog
          message={`ต้องการลบใบเสนอราคา "${pendingDelete.docNo}" ใช่ไหม? รูปที่อัปโหลดสำหรับใบนี้จะถูกลบออกจากคลาวด์ด้วย`}
          onConfirm={handleDelete}
          onCancel={() => setPendingDelete(null)}
          loading={deleting}
        />
      )}

      <div className="max-w-4xl mx-auto px-4">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-6">
          <h1 className="text-3xl font-bold text-gray-900">📋 ใบเสนอราคาที่บันทึกไว้</h1>
          <div className="flex gap-2">
            <Link href="/quotation" className="px-4 py-2 rounded-lg bg-orange-500 text-white text-sm font-bold hover:bg-orange-600 transition">
              + สร้างใหม่
            </Link>
            <Link href="/showcase" className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm font-semibold hover:bg-gray-50 transition">
              ← กลับ
            </Link>
          </div>
        </div>

        <p className="text-sm text-gray-500 mb-4">
          ใบเสนอราคาที่บันทึกไว้จะถูกลบอัตโนมัติเมื่อครบ 30 วัน
        </p>

        {loading ? (
          <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-400">กำลังโหลด...</div>
        ) : loadFailed ? (
          <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
            <p className="text-gray-500 mb-3">โหลดรายการไม่สำเร็จ</p>
            <button onClick={load} className="px-4 py-2 rounded-lg bg-orange-500 text-white text-sm font-bold hover:bg-orange-600 transition">
              ลองใหม่
            </button>
          </div>
        ) : items.length === 0 ? (
          <div className="bg-white rounded-xl border border-dashed border-gray-300 p-12 text-center text-gray-500">
            ยังไม่มีใบเสนอราคาที่บันทึกไว้ — กด &quot;ดาวน์โหลด PDF&quot; แล้วเลือก &quot;เก็บไว้ 30 วัน&quot;
          </div>
        ) : (
          <div className="space-y-3">
            {items.map((it) => (
              <div key={it.id} className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 flex items-center justify-between gap-4 flex-wrap">
                <div className="min-w-0">
                  <div className="font-bold text-gray-900">{it.docNo || "(ไม่มีเลขที่)"}</div>
                  <div className="text-sm text-gray-600 truncate">{it.customer}</div>
                  <div className="text-xs text-gray-400 mt-0.5">
                    {new Date(it.createdAt).toLocaleString("th-TH")} · เหลืออีก {daysLeft(it.createdAt)} วัน
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <div className="text-xs text-gray-400">ยอดรวม</div>
                    <div className="font-bold text-gray-900">฿{fmt(it.total)}</div>
                  </div>
                  <Link
                    href={`/quotation?id=${encodeURIComponent(it.id)}`}
                    className="px-4 py-2 rounded-lg bg-orange-100 text-orange-600 border border-orange-300 text-sm font-semibold hover:bg-orange-200 transition"
                  >
                    เปิด/แก้ไข
                  </Link>
                  <button
                    onClick={() => setPendingDelete(it)}
                    className="px-3 py-2 rounded-lg bg-red-100 text-red-500 text-sm font-semibold hover:bg-red-500 hover:text-white transition"
                  >
                    ลบ
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

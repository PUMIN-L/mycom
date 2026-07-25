"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "../context/AuthContext";
import Toast from "../components/Toast";

// Admin settings (CMS). Client-side redirect gates the UI like the create
// pages; the real protection is requireAuth() on /api/settings/* server-side.
export default function SettingsPage() {
  const router = useRouter();
  const { isLoggedIn, isLoading } = useAuth();

  const [contactEmail, setContactEmail] = useState("");
  const [loading, setLoading] = useState(true);
  // Load failure keeps the field disabled: saving over an unknown current value
  // could silently overwrite the real recipient.
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  // OTP State
  const [showOtpModal, setShowOtpModal] = useState(false);
  const [otp, setOtp] = useState("");

  // Redirect if not logged in
  useEffect(() => {
    if (!isLoading && !isLoggedIn) {
      router.replace("/login");
    }
  }, [isLoggedIn, isLoading, router]);

  async function loadContactEmail() {
    setLoading(true);
    setLoadFailed(false);
    try {
      const res = await fetch("/api/settings/contact-email");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setContactEmail(data.email ?? "");
    } catch {
      setLoadFailed(true);
      showToast("โหลดการตั้งค่าไม่สำเร็จ กรุณาลองใหม่", "error");
    } finally {
      setLoading(false);
    }
  }

  // Load current setting once authenticated
  useEffect(() => {
    if (!isLoggedIn) return;
    loadContactEmail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoggedIn]);

  function showToast(message: string, type: "success" | "error") {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }

  async function handleRequestOtp(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch("/api/settings/contact-email/otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newEmail: contactEmail }),
      });
      if (res.ok) {
        setShowOtpModal(true);
        showToast("ระบบส่งรหัส OTP ไปยังอีเมลเดิมแล้ว", "success");
      } else {
        const data = await res.json().catch(() => null);
        showToast(data?.error ?? "ไม่สามารถขอรหัส OTP ได้", "error");
      }
    } catch {
      showToast("เกิดข้อผิดพลาด กรุณาลองใหม่", "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleVerifyOtp(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch("/api/settings/contact-email", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: contactEmail, otp }),
      });
      if (res.ok) {
        const data = await res.json().catch(() => null);
        setShowOtpModal(false);
        setOtp("");
        setContactEmail(data.email ?? "");
        if (data?.changed && data?.notified) {
          showToast("เปลี่ยนอีเมลสำเร็จ + แจ้งเตือนอีเมลเก่าและใหม่แล้ว", "success");
        } else if (data?.changed && !data?.notified) {
          showToast("เปลี่ยนอีเมลสำเร็จ (แต่แจ้งเตือนไม่ได้ — ยังไม่ตั้งค่า SMTP)", "error");
        } else {
          showToast("บันทึกการตั้งค่าแล้ว", "success");
        }
      } else {
        const data = await res.json().catch(() => null);
        showToast(data?.error ?? "รหัส OTP ไม่ถูกต้องหรือหมดอายุ", "error");
      }
    } catch {
      showToast("เกิดข้อผิดพลาด กรุณาลองใหม่", "error");
    } finally {
      setSaving(false);
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
    <div className="min-h-screen bg-gray-50 py-12 relative">
      {toast && <Toast message={toast.message} type={toast.type} />}
      <div className="max-w-2xl mx-auto px-4">
        <h1 className="text-4xl font-bold mb-2 text-gray-900">ตั้งค่าระบบ (CMS)</h1>
        <p className="text-gray-600 mb-8">การตั้งค่านี้เห็นได้เฉพาะผู้ดูแลระบบที่ login แล้วเท่านั้น</p>

        <form onSubmit={handleRequestOtp} className="bg-white rounded-lg shadow p-6 space-y-4 relative z-10">
          <div>
            <label className="block text-sm font-semibold mb-2 text-gray-700">
              อีเมลรับข้อความจากฟอร์มติดต่อ
            </label>
            <input
              type="text"
              required
              value={loading ? "" : contactEmail}
              placeholder={loading ? "กำลังโหลด..." : "you@example.com"}
              disabled={loading || loadFailed}
              onChange={(e) => setContactEmail(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 disabled:bg-gray-100"
            />
            <p className="mt-2 text-xs text-gray-500">
              * อีเมลปัจจุบันจะถูกซ่อนข้อมูลบางส่วน เพื่อความปลอดภัย หากต้องการเปลี่ยนให้พิมพ์อีเมลใหม่แล้วกดบันทึก (ระบบจะให้ยืนยันรหัสผ่านชั่วคราวทางอีเมลเดิม)
            </p>
            {loadFailed && (
              <button
                type="button"
                onClick={loadContactEmail}
                className="mt-2 text-sm font-semibold text-orange-600 hover:text-orange-700"
              >
                ↻ โหลดค่าปัจจุบันอีกครั้ง
              </button>
            )}
          </div>
          <button
            type="submit"
            disabled={saving || loading || loadFailed || contactEmail.includes("***")}
            className="w-full px-6 py-3 bg-orange-500 text-white font-bold rounded-lg hover:bg-orange-600 transition disabled:opacity-50"
          >
            {saving ? "กำลังดำเนินการ..." : "💾 บันทึกการตั้งค่า"}
          </button>
        </form>

        <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800">
          ℹ️ การส่งอีเมลใช้ SMTP — ต้องตั้งค่า <code className="font-mono">SMTP_USER</code> /{" "}
          <code className="font-mono">SMTP_PASS</code> (Gmail App Password) ใน environment
          ของเซิร์ฟเวอร์ก่อน ระบบจึงจะส่งเมลได้จริง (ตรวจสอบได้ที่ <code className="font-mono">/api/health</code>)
        </div>

        <div className="mt-6 text-center">
          <Link href="/" className="text-gray-600 hover:text-gray-900">
            ← กลับหน้าหลัก
          </Link>
        </div>
      </div>

      {/* OTP Modal */}
      {showOtpModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-sm animate-in fade-in zoom-in duration-200">
            <h2 className="text-xl font-bold text-gray-900 mb-2">ยืนยันตัวตนด้วยรหัส OTP</h2>
            <p className="text-sm text-gray-600 mb-4">
              ระบบได้ส่งรหัสผ่านชั่วคราวไปยังอีเมลเดิมของคุณแล้ว กรุณานำมากรอกเพื่อยืนยันการเปลี่ยนอีเมล
            </p>
            <form onSubmit={handleVerifyOtp} className="space-y-4">
              <div>
                <input
                  type="text"
                  required
                  maxLength={6}
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                  placeholder="รหัสยืนยัน"
                  className="w-full px-4 py-3 text-center text-2xl tracking-widest border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 font-mono"
                />
              </div>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowOtpModal(false)}
                  disabled={saving}
                  className="flex-1 px-4 py-2 bg-gray-100 text-gray-700 font-semibold rounded-lg hover:bg-gray-200 transition disabled:opacity-50"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={saving || otp.length !== 6}
                  className="flex-1 px-4 py-2 bg-orange-500 text-white font-bold rounded-lg hover:bg-orange-600 transition disabled:opacity-50"
                >
                  {saving ? "กำลังยืนยัน..." : "ยืนยัน"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

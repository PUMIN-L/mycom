"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "../context/AuthContext";
import Toast from "../components/Toast";

interface OrphanAsset {
  publicId: string;
  secureUrl: string;
  format: string;
  bytes: number;
  resourceType: string;
  createdAt: string;
}

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

  // Company profile (address/phone shown on the public site) — requires OTP
  // confirmation to email, same as the contact-recipient email above.
  const [companyProfile, setCompanyProfile] = useState({
    phone: "",
    addressDisplay: "",
    addressStreet: "",
    addressLocality: "",
    addressRegion: "",
    addressPostalCode: "",
    addressCountry: "",
  });
  const [companyLoading, setCompanyLoading] = useState(true);
  const [companyLoadFailed, setCompanyLoadFailed] = useState(false);
  const [companySaving, setCompanySaving] = useState(false);
  const [showAddressDetails, setShowAddressDetails] = useState(false);
  // Fields start disabled (grayed out) — must click "แก้ไข" before they can
  // be typed into, so a stray click can't accidentally start editing.
  const [companyEditing, setCompanyEditing] = useState(false);
  const [showCompanyOtpModal, setShowCompanyOtpModal] = useState(false);
  const [companyOtp, setCompanyOtp] = useState("");

  // Orphan Scanner State
  const [orphans, setOrphans] = useState<OrphanAsset[]>([]);
  const [orphanStats, setOrphanStats] = useState<{ total: number; inUse: number; orphanCount: number } | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [selectedOrphans, setSelectedOrphans] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [showDeleteOtpModal, setShowDeleteOtpModal] = useState(false);
  const [deleteOtp, setDeleteOtp] = useState("");
  const [sendingOtp, setSendingOtp] = useState(false);
  const [otpSent, setOtpSent] = useState(false);

  const handleScan = async () => {
    setScanning(true);
    setScanned(false);
    setOrphans([]);
    setOrphanStats(null);
    setSelectedOrphans(new Set());
    try {
      const res = await fetch("/api/cloudinary/orphans");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setOrphans(data.orphans ?? []);
      setOrphanStats({ total: data.total, inUse: data.inUse, orphanCount: data.orphanCount });
      setScanned(true);
    } catch {
      showToast("สแกนไม่สำเร็จ กรุณาลองใหม่", "error");
    } finally {
      setScanning(false);
    }
  };

  const toggleOrphanSelection = (publicId: string) => {
    setSelectedOrphans((prev) => {
      const next = new Set(prev);
      if (next.has(publicId)) next.delete(publicId);
      else next.add(publicId);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedOrphans.size === orphans.length) {
      setSelectedOrphans(new Set());
    } else {
      setSelectedOrphans(new Set(orphans.map((o) => o.publicId)));
    }
  };

  const handleRequestDeleteOtp = async () => {
    setSendingOtp(true);
    try {
      const res = await fetch("/api/cloudinary/orphans/otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageCount: selectedOrphans.size }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        showToast(data?.error ?? "ไม่สามารถส่งรหัสยืนยันได้", "error");
        return;
      }
      setOtpSent(true);
      showToast("ส่งรหัสยืนยันไปทางอีเมลแล้ว", "success");
    } catch {
      showToast("เกิดข้อผิดพลาด กรุณาลองใหม่", "error");
    } finally {
      setSendingOtp(false);
    }
  };

  const handleDeleteOrphans = async () => {
    if (deleteOtp.length !== 5) {
      showToast("กรุณากรอกรหัสยืนยัน 5 หลัก", "error");
      return;
    }
    setDeleting(true);
    try {
      const res = await fetch("/api/cloudinary/orphans", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          otp: deleteOtp,
          items: Array.from(selectedOrphans).map((pid) => {
            const orphan = orphans.find((o) => o.publicId === pid);
            return { publicId: pid, resourceType: orphan?.resourceType ?? "image" };
          }),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        showToast(data?.error ?? "ลบไม่สำเร็จ", "error");
        return;
      }
      showToast(
        `ลบสำเร็จ ${data.deleted} รูป${data.skipped ? ` (ข้าม ${data.skipped} รูปที่ยังใช้อยู่)` : ""}`,
        data.failed ? "error" : "success"
      );
      // Remove deleted items from the list
      setOrphans((prev) => prev.filter((o) => !selectedOrphans.has(o.publicId)));
      setOrphanStats((prev) => prev ? { ...prev, orphanCount: prev.orphanCount - data.deleted } : null);
      setSelectedOrphans(new Set());
      setShowDeleteOtpModal(false);
      setDeleteOtp("");
      setOtpSent(false);
    } catch {
      showToast("ลบไม่สำเร็จ กรุณาลองใหม่", "error");
    } finally {
      setDeleting(false);
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

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

  async function loadCompanyProfile() {
    setCompanyLoading(true);
    setCompanyLoadFailed(false);
    try {
      const res = await fetch("/api/settings/company-profile");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setCompanyProfile({
        phone: data.phone ?? "",
        addressDisplay: data.addressDisplay ?? "",
        addressStreet: data.addressStreet ?? "",
        addressLocality: data.addressLocality ?? "",
        addressRegion: data.addressRegion ?? "",
        addressPostalCode: data.addressPostalCode ?? "",
        addressCountry: data.addressCountry ?? "",
      });
    } catch {
      setCompanyLoadFailed(true);
      showToast("โหลดข้อมูลบริษัทไม่สำเร็จ กรุณาลองใหม่", "error");
    } finally {
      setCompanyLoading(false);
    }
  }

  useEffect(() => {
    if (!isLoggedIn) return;
    loadCompanyProfile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoggedIn]);

  async function handleCancelCompanyEdit() {
    setCompanyEditing(false);
    await loadCompanyProfile(); // discard any unsaved edits
  }

  async function handleRequestCompanyOtp(e: React.FormEvent) {
    e.preventDefault();
    setCompanySaving(true);
    try {
      const res = await fetch("/api/settings/company-profile/otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(companyProfile),
      });
      if (res.ok) {
        setShowCompanyOtpModal(true);
        showToast("ระบบส่งรหัส OTP ไปยังอีเมลติดต่อแล้ว", "success");
      } else {
        const data = await res.json().catch(() => null);
        showToast(data?.error ?? "ไม่สามารถขอรหัส OTP ได้", "error");
      }
    } catch {
      showToast("เกิดข้อผิดพลาด กรุณาลองใหม่", "error");
    } finally {
      setCompanySaving(false);
    }
  }

  async function handleVerifyCompanyOtp(e: React.FormEvent) {
    e.preventDefault();
    setCompanySaving(true);
    try {
      const res = await fetch("/api/settings/company-profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ otp: companyOtp }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        showToast(data?.error ?? "รหัส OTP ไม่ถูกต้องหรือหมดอายุ", "error");
        return;
      }
      setCompanyProfile({
        phone: data.phone ?? "",
        addressDisplay: data.addressDisplay ?? "",
        addressStreet: data.addressStreet ?? "",
        addressLocality: data.addressLocality ?? "",
        addressRegion: data.addressRegion ?? "",
        addressPostalCode: data.addressPostalCode ?? "",
        addressCountry: data.addressCountry ?? "",
      });
      setShowCompanyOtpModal(false);
      setCompanyOtp("");
      setCompanyEditing(false);
      showToast("บันทึกข้อมูลบริษัทแล้ว", "success");
    } catch {
      showToast("เกิดข้อผิดพลาด กรุณาลองใหม่", "error");
    } finally {
      setCompanySaving(false);
    }
  }

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
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-2">
          <h1 className="text-4xl font-bold text-gray-900">ตั้งค่าระบบ (CMS)</h1>
          <Link href="/adminpanel" className="px-4 py-2 bg-white border border-gray-200 text-gray-700 font-semibold rounded-xl hover:bg-gray-50 hover:shadow-sm transition-all text-sm flex items-center gap-1.5 shadow-sm w-fit">
            🏠 กลับไประบบจัดการ
          </Link>
        </div>
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

        {/* Company profile — shown on the public site (Contact page, Footer,
            Organization JSON-LD). Requires OTP confirmation to the contact
            email before changes are applied. */}
        <form onSubmit={handleRequestCompanyOtp} className="mt-8 bg-white rounded-lg shadow p-6 space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                🏢 ข้อมูลบริษัท
              </h2>
              <p className="text-sm text-gray-600 mt-1">
                แสดงบนหน้าติดต่อเรา, ท้ายเว็บทุกหน้า และข้อมูลโครงสร้างสำหรับ Google — แก้ที่นี่แทนการแก้โค้ด
                (การเปลี่ยนแปลงต้องยืนยันด้วยรหัส OTP ที่ส่งไปทางอีเมลก่อน)
              </p>
            </div>
            {!companyEditing && (
              <button
                type="button"
                onClick={() => setCompanyEditing(true)}
                disabled={companyLoading || companyLoadFailed}
                className="shrink-0 px-4 py-2 rounded-lg border border-orange-400 text-orange-600 font-semibold hover:bg-orange-50 transition text-sm disabled:opacity-50"
              >
                ✏️ แก้ไข
              </button>
            )}
          </div>

          <div>
            <label className="block text-sm font-semibold mb-2 text-gray-700">เบอร์โทรศัพท์</label>
            <input
              type="text"
              required
              value={companyLoading ? "" : companyProfile.phone}
              placeholder={companyLoading ? "กำลังโหลด..." : "062-012-9895"}
              disabled={companyLoading || companyLoadFailed || !companyEditing}
              onChange={(e) => setCompanyProfile((p) => ({ ...p, phone: e.target.value }))}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 disabled:bg-gray-100 disabled:text-gray-400"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold mb-2 text-gray-700">
              ที่อยู่ (แสดงบนหน้าติดต่อเราและท้ายเว็บ)
            </label>
            <textarea
              required
              rows={2}
              value={companyLoading ? "" : companyProfile.addressDisplay}
              placeholder={companyLoading ? "กำลังโหลด..." : "93 ซอยงามวงศ์วาน 6 แยก 19 ..."}
              disabled={companyLoading || companyLoadFailed || !companyEditing}
              onChange={(e) => setCompanyProfile((p) => ({ ...p, addressDisplay: e.target.value }))}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 disabled:bg-gray-100 disabled:text-gray-400 resize-none"
            />
          </div>

          {companyLoadFailed && (
            <button
              type="button"
              onClick={loadCompanyProfile}
              className="text-sm font-semibold text-orange-600 hover:text-orange-700"
            >
              ↻ โหลดค่าปัจจุบันอีกครั้ง
            </button>
          )}

          <button
            type="button"
            onClick={() => setShowAddressDetails((v) => !v)}
            className="text-sm font-semibold text-gray-500 hover:text-gray-700 flex items-center gap-1"
          >
            {showAddressDetails ? "▾" : "▸"} ที่อยู่แบบละเอียด (สำหรับ Google Maps และ SEO)
          </button>

          {showAddressDetails && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 bg-gray-50 rounded-lg">
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold mb-1 text-gray-600">ถนน/ซอย (ภาษาอังกฤษ)</label>
                <input
                  type="text"
                  value={companyProfile.addressStreet}
                  disabled={companyLoading || companyLoadFailed || !companyEditing}
                  onChange={(e) => setCompanyProfile((p) => ({ ...p, addressStreet: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 disabled:bg-gray-100 disabled:text-gray-400"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1 text-gray-600">อำเภอ/เขต</label>
                <input
                  type="text"
                  value={companyProfile.addressLocality}
                  disabled={companyLoading || companyLoadFailed || !companyEditing}
                  onChange={(e) => setCompanyProfile((p) => ({ ...p, addressLocality: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 disabled:bg-gray-100 disabled:text-gray-400"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1 text-gray-600">จังหวัด</label>
                <input
                  type="text"
                  value={companyProfile.addressRegion}
                  disabled={companyLoading || companyLoadFailed || !companyEditing}
                  onChange={(e) => setCompanyProfile((p) => ({ ...p, addressRegion: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 disabled:bg-gray-100 disabled:text-gray-400"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1 text-gray-600">รหัสไปรษณีย์</label>
                <input
                  type="text"
                  value={companyProfile.addressPostalCode}
                  disabled={companyLoading || companyLoadFailed || !companyEditing}
                  onChange={(e) => setCompanyProfile((p) => ({ ...p, addressPostalCode: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 disabled:bg-gray-100 disabled:text-gray-400"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1 text-gray-600">รหัสประเทศ (2 ตัวอักษร)</label>
                <input
                  type="text"
                  maxLength={2}
                  value={companyProfile.addressCountry}
                  disabled={companyLoading || companyLoadFailed || !companyEditing}
                  onChange={(e) => setCompanyProfile((p) => ({ ...p, addressCountry: e.target.value.toUpperCase() }))}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 disabled:bg-gray-100 disabled:text-gray-400"
                />
              </div>
            </div>
          )}

          {companyEditing && (
            <div className="flex gap-3">
              <button
                type="button"
                onClick={handleCancelCompanyEdit}
                disabled={companySaving}
                className="px-6 py-3 rounded-lg border border-gray-300 text-gray-700 font-semibold hover:bg-gray-50 transition disabled:opacity-50"
              >
                ยกเลิก
              </button>
              <button
                type="submit"
                disabled={companySaving || companyLoading || companyLoadFailed}
                className="flex-1 px-6 py-3 bg-orange-500 text-white font-bold rounded-lg hover:bg-orange-600 transition disabled:opacity-50"
              >
                {companySaving ? "กำลังดำเนินการ..." : "💾 บันทึกข้อมูลบริษัท"}
              </button>
            </div>
          )}
        </form>

        {/* Cloudinary Orphan Scanner */}
        <div className="mt-8 bg-white rounded-lg shadow p-6 space-y-4">
          <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            🧹 Cloudinary — รูปภาพที่ไม่ได้ใช้งาน
          </h2>
          <p className="text-sm text-gray-600">
            สแกนหารูปภาพใน Cloudinary ที่ไม่ได้ถูกใช้โดยสินค้า, เอกสาร, หรือเนื้อหาใดๆ ในระบบ
          </p>

          <button
            onClick={handleScan}
            disabled={scanning}
            className="w-full px-6 py-3 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700 transition disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {scanning ? (
              <>
                <svg className="animate-spin h-5 w-5 text-white" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                กำลังสแกน Cloudinary...
              </>
            ) : (
              "🔍 สแกนหารูปที่ไม่ได้ใช้"
            )}
          </button>

          {/* Stats */}
          {orphanStats && scanned && (
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="p-3 bg-gray-50 rounded-lg">
                <div className="text-2xl font-bold text-gray-800">{orphanStats.total}</div>
                <div className="text-xs text-gray-500">ทั้งหมดใน Cloudinary</div>
              </div>
              <div className="p-3 bg-green-50 rounded-lg">
                <div className="text-2xl font-bold text-green-700">{orphanStats.inUse}</div>
                <div className="text-xs text-green-600">ใช้งานอยู่</div>
              </div>
              <div className="p-3 bg-red-50 rounded-lg">
                <div className="text-2xl font-bold text-red-700">{orphanStats.orphanCount}</div>
                <div className="text-xs text-red-600">ไม่ได้ใช้งาน</div>
              </div>
            </div>
          )}

          {/* No orphans */}
          {scanned && orphans.length === 0 && (
            <div className="p-6 text-center bg-green-50 border border-green-200 rounded-lg">
              <span className="text-2xl">✅</span>
              <p className="mt-2 font-semibold text-green-800">ไม่พบรูปภาพที่ไม่ได้ใช้งาน</p>
              <p className="text-sm text-green-600">Cloudinary สะอาดดี!</p>
            </div>
          )}

          {/* Orphan list */}
          {orphans.length > 0 && (
            <div className="space-y-3">
              {/* Toolbar */}
              <div className="flex items-center justify-between flex-wrap gap-2">
                <label className="flex items-center gap-2 text-sm font-medium text-gray-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedOrphans.size === orphans.length && orphans.length > 0}
                    onChange={toggleSelectAll}
                    className="w-4 h-4 rounded border-gray-300 text-red-600 focus:ring-red-500"
                  />
                  เลือกทั้งหมด ({orphans.length} รูป
                  {orphans.length > 0 && (
                    <> — {formatBytes(orphans.reduce((s, o) => s + o.bytes, 0))}</>  
                  )})
                </label>
                {selectedOrphans.size > 0 && (
                  <button
                    onClick={() => setShowDeleteOtpModal(true)}
                    disabled={deleting}
                    className="px-4 py-2 bg-red-600 text-white text-sm font-bold rounded-lg hover:bg-red-700 transition disabled:opacity-50 flex items-center gap-1"
                  >
                    {deleting ? (
                      <>
                        <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                        กำลังลบ...
                      </>
                    ) : (
                      `🗑️ ลบรูปที่เลือก (${selectedOrphans.size})`
                    )}
                  </button>
                )}
              </div>

              {/* Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 max-h-[500px] overflow-y-auto pr-1">
                {orphans.map((orphan) => (
                  <div
                    key={orphan.publicId}
                    onClick={() => toggleOrphanSelection(orphan.publicId)}
                    className={`relative rounded-lg border-2 overflow-hidden cursor-pointer transition-all ${
                      selectedOrphans.has(orphan.publicId)
                        ? "border-red-500 ring-2 ring-red-200"
                        : "border-gray-200 hover:border-gray-400"
                    }`}
                  >
                    {/* Checkbox */}
                    <div className="absolute top-2 left-2 z-10">
                      <input
                        type="checkbox"
                        checked={selectedOrphans.has(orphan.publicId)}
                        onChange={() => toggleOrphanSelection(orphan.publicId)}
                        onClick={(e) => e.stopPropagation()}
                        className="w-4 h-4 rounded border-gray-300 text-red-600 focus:ring-red-500"
                      />
                    </div>

                    {/* Thumbnail */}
                    {orphan.resourceType === "image" ? (
                      <img
                        src={orphan.secureUrl}
                        alt={orphan.publicId.split("/").pop() || ""}
                        className="w-full h-28 object-cover bg-gray-100"
                        loading="lazy"
                      />
                    ) : (
                      <div className="w-full h-28 bg-gray-100 flex items-center justify-center">
                        <span className="text-3xl">📄</span>
                      </div>
                    )}

                    {/* Info */}
                    <div className="p-2 bg-white">
                      <p className="text-xs text-gray-600 truncate" title={orphan.publicId}>
                        {orphan.publicId.split("/").pop()}
                      </p>
                      <p className="text-xs text-gray-400">
                        {formatBytes(orphan.bytes)} · {orphan.format || orphan.resourceType}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
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

      {/* Company Profile OTP Modal */}
      {showCompanyOtpModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-sm animate-in fade-in zoom-in duration-200">
            <h2 className="text-xl font-bold text-gray-900 mb-2">ยืนยันตัวตนด้วยรหัส OTP</h2>
            <p className="text-sm text-gray-600 mb-4">
              ระบบได้ส่งรหัสผ่านชั่วคราวไปยังอีเมลติดต่อของคุณแล้ว กรุณานำมากรอกเพื่อยืนยันการเปลี่ยนข้อมูลบริษัท
            </p>
            <form onSubmit={handleVerifyCompanyOtp} className="space-y-4">
              <div>
                <input
                  type="text"
                  required
                  maxLength={6}
                  value={companyOtp}
                  onChange={(e) => setCompanyOtp(e.target.value.replace(/\D/g, ""))}
                  placeholder="รหัสยืนยัน"
                  className="w-full px-4 py-3 text-center text-2xl tracking-widest border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 font-mono"
                />
              </div>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setShowCompanyOtpModal(false);
                    setCompanyOtp("");
                  }}
                  disabled={companySaving}
                  className="flex-1 px-4 py-2 bg-gray-100 text-gray-700 font-semibold rounded-lg hover:bg-gray-200 transition disabled:opacity-50"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={companySaving || companyOtp.length !== 6}
                  className="flex-1 px-4 py-2 bg-orange-500 text-white font-bold rounded-lg hover:bg-orange-600 transition disabled:opacity-50"
                >
                  {companySaving ? "กำลังยืนยัน..." : "ยืนยัน"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Orphans OTP Modal */}
      {showDeleteOtpModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-sm animate-in fade-in zoom-in duration-200">
            <h2 className="text-xl font-bold text-gray-900 mb-2">⚠️ ยืนยันการลบ</h2>
            <p className="text-sm text-gray-600 mb-1">
              คุณต้องการลบ <strong>{selectedOrphans.size} รูป</strong> ออกจาก Cloudinary
            </p>
            <p className="text-sm text-gray-500 mb-4">
              การกระทำนี้ไม่สามารถย้อนกลับได้ ระบบจะส่งรหัสยืนยัน 5 หลักไปทางอีเมลที่ตั้งค่าไว้
            </p>

            {!otpSent ? (
              <button
                type="button"
                onClick={handleRequestDeleteOtp}
                disabled={sendingOtp}
                className="w-full px-4 py-3 bg-orange-500 text-white font-bold rounded-lg hover:bg-orange-600 transition disabled:opacity-50 flex items-center justify-center gap-2 mb-3"
              >
                {sendingOtp ? (
                  <>
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    กำลังส่งรหัส...
                  </>
                ) : (
                  "📧 ส่งรหัสยืนยันทางอีเมล"
                )}
              </button>
            ) : (
              <div className="space-y-3 mb-3">
                <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-800">
                  ✉️ ส่งรหัสยืนยันไปทางอีเมลแล้ว กรุณาตรวจสอบกล่องขาเข้าของคุณ (รหัสมีอายุ 10 นาที)
                </div>
                <input
                  type="text"
                  required
                  maxLength={5}
                  value={deleteOtp}
                  onChange={(e) => setDeleteOtp(e.target.value.replace(/\D/g, ""))}
                  placeholder="รหัสยืนยัน 5 หลัก"
                  className="w-full px-4 py-3 text-center text-2xl tracking-widest border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 font-mono"
                />
                <button
                  type="button"
                  onClick={handleDeleteOrphans}
                  disabled={deleting || deleteOtp.length !== 5}
                  className="w-full px-4 py-3 bg-red-600 text-white font-bold rounded-lg hover:bg-red-700 transition disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {deleting ? (
                    <>
                      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      กำลังลบ...
                    </>
                  ) : (
                    `🗑️ ยืนยันและลบ ${selectedOrphans.size} รูป`
                  )}
                </button>
                <button
                  type="button"
                  onClick={handleRequestDeleteOtp}
                  disabled={sendingOtp}
                  className="w-full text-sm text-orange-600 hover:text-orange-700 font-semibold"
                >
                  {sendingOtp ? "กำลังส่ง..." : "↻ ส่งรหัสใหม่"}
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={() => {
                setShowDeleteOtpModal(false);
                setDeleteOtp("");
                setOtpSent(false);
              }}
              disabled={deleting}
              className="w-full px-4 py-2 bg-gray-100 text-gray-700 font-semibold rounded-lg hover:bg-gray-200 transition disabled:opacity-50"
            >
              ยกเลิก
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

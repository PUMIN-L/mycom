"use client";
import { useState } from "react";
import { useAuth } from "../context/AuthContext";
import { MIN_PASSWORD_LENGTH, newPasswordProblem } from "../lib/passwordRules";

// /settings → "เปลี่ยนรหัสผ่าน". Two steps: the current and new password, then
// "ส่งรหัส OTP" emails a 6-digit code to the admin's fixed address; the code
// (and, while 2FA is on, a code from the app) completes it. The rules are
// server-side (/api/auth/password, lib/passwordReset.ts); the checks here only
// save a round trip. On success every OTHER device is logged out — the server
// re-issues this browser's session, so the admin stays in here.

type ShowToast = (msg: string, type: "success" | "error") => void;

const inputClass =
  "w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500";
const labelClass = "block text-sm font-semibold text-gray-700 mb-1";

async function errorFrom(res: Response, fallback: string): Promise<string> {
  // requireAuth() answers an English "Unauthorized"; say it in Thai.
  if (res.status === 401) return "เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่แล้วลองอีกครั้ง";
  const data = await res.json().catch(() => null);
  return typeof data?.error === "string" && data.error ? data.error : fallback;
}

export default function PasswordSettings({ showToast }: { showToast: ShowToast }) {
  const { user } = useAuth();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [otp, setOtp] = useState("");
  const [code, setCode] = useState("");
  /** Where the code went, once it has been sent; null before. */
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [needsCode, setNeedsCode] = useState(false);
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setCurrentPassword("");
    setNewPassword("");
    setConfirm("");
    setOtp("");
    setCode("");
    setSentTo(null);
    setNeedsCode(false);
  };

  /** The new password as the server will judge it, or the reason it will not. */
  const localProblem = (): string | null =>
    newPasswordProblem(newPassword, user?.username ?? "") ??
    (newPassword !== confirm ? "รหัสผ่านใหม่ทั้งสองช่องไม่ตรงกัน" : null) ??
    (newPassword === currentPassword ? "รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านเดิม" : null);

  async function sendOtp() {
    if (busy) return;
    if (!currentPassword) return showToast("กรุณากรอกรหัสผ่านปัจจุบัน", "error");
    const problem = localProblem();
    if (problem) return showToast(problem, "error");
    setBusy(true);
    try {
      const res = await fetch("/api/auth/password/otp", { method: "POST" });
      if (!res.ok) {
        showToast(await errorFrom(res, "ส่งรหัส OTP ไม่สำเร็จ"), "error");
        return;
      }
      const data = await res.json().catch(() => null);
      setSentTo(typeof data?.sentTo === "string" ? data.sentTo : "อีเมลผู้ดูแลระบบ");
      setNeedsCode(data?.twoFactorRequired === true);
      setOtp("");
      showToast("ส่งรหัส OTP แล้ว กรุณาตรวจสอบอีเมล", "success");
    } catch {
      showToast("เกิดข้อผิดพลาด กรุณาลองใหม่", "error");
    } finally {
      setBusy(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (sentTo === null) return sendOtp();
    const problem = localProblem();
    if (problem) return showToast(problem, "error");
    setBusy(true);
    try {
      const res = await fetch("/api/auth/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword, otp: otp.trim(), code: code.trim() }),
      });
      if (!res.ok) {
        showToast(await errorFrom(res, "เปลี่ยนรหัสผ่านไม่สำเร็จ"), "error");
        return;
      }
      reset();
      showToast("เปลี่ยนรหัสผ่านแล้ว — อุปกรณ์อื่นทุกเครื่องถูกออกจากระบบ (เครื่องนี้ยังเข้าสู่ระบบอยู่)", "success");
    } catch {
      showToast("เกิดข้อผิดพลาด กรุณาลองใหม่", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div id="password" className="mt-8 bg-white rounded-lg shadow p-6 space-y-4 scroll-mt-24">
      <div>
        <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">🔒 เปลี่ยนรหัสผ่าน</h2>
        <p className="text-sm text-gray-600 mt-1">
          ต้องใช้รหัสผ่านปัจจุบัน และรหัส OTP 6 หลักที่ส่งไปที่อีเมลของผู้ดูแลระบบ
          (ถ้าเปิดการยืนยันตัวตน 2 ขั้นไว้ ต้องใช้รหัสจากแอปด้วย) เมื่อเปลี่ยนแล้ว อุปกรณ์อื่นทุกเครื่องจะถูกออกจากระบบ
        </p>
      </div>

      <form onSubmit={submit} className="space-y-4 max-w-md">
        {/* Still editable once the code is sent: a mistyped current password
            is fixed and sent again with the SAME code, not a new email. */}
        <div className="space-y-4">
          <div>
            <label htmlFor="password-current" className={labelClass}>รหัสผ่านปัจจุบัน</label>
            <input
              id="password-current"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
              autoComplete="current-password"
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="password-new" className={labelClass}>รหัสผ่านใหม่</label>
            <input
              id="password-new"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              autoComplete="new-password"
              className={inputClass}
            />
            <p className="text-xs text-gray-500 mt-1">อย่างน้อย {MIN_PASSWORD_LENGTH} ตัวอักษร</p>
          </div>
          <div>
            <label htmlFor="password-confirm" className={labelClass}>ยืนยันรหัสผ่านใหม่</label>
            <input
              id="password-confirm"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              autoComplete="new-password"
              className={inputClass}
            />
          </div>
        </div>

        {sentTo === null ? (
          <button
            type="submit"
            disabled={busy}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg font-semibold hover:bg-indigo-700 disabled:opacity-60"
          >
            {busy ? "กำลังส่ง..." : "ส่งรหัส OTP ไปที่อีเมล"}
          </button>
        ) : (
          <>
            <p className="text-sm text-green-700">✅ ส่งรหัส OTP ไปที่ {sentTo} แล้ว (มีอายุ 10 นาที)</p>
            <div>
              <label htmlFor="password-otp" className={labelClass}>รหัส OTP จากอีเมล (6 หลัก)</label>
              <input
                id="password-otp"
                type="text"
                inputMode="numeric"
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
                required
                maxLength={6}
                autoComplete="one-time-code"
                className={`${inputClass} font-mono tracking-widest`}
              />
            </div>
            {needsCode && (
              <div>
                <label htmlFor="password-2fa" className={labelClass}>รหัสยืนยันตัวตน 2 ขั้น</label>
                <input
                  id="password-2fa"
                  type="text"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  required
                  maxLength={12}
                  autoComplete="one-time-code"
                  placeholder="รหัส 6 หลักจากแอป หรือรหัสสำรอง"
                  className={`${inputClass} font-mono tracking-widest`}
                />
              </div>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="submit"
                disabled={busy}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg font-semibold hover:bg-indigo-700 disabled:opacity-60"
              >
                {busy ? "กำลังบันทึก..." : "เปลี่ยนรหัสผ่าน"}
              </button>
              <button
                type="button"
                onClick={sendOtp}
                disabled={busy}
                className="text-sm text-indigo-600 font-semibold hover:underline disabled:opacity-60"
              >
                ขอรหัสใหม่
              </button>
              <button
                type="button"
                onClick={reset}
                disabled={busy}
                className="text-sm text-gray-500 hover:underline disabled:opacity-60"
              >
                ยกเลิก
              </button>
            </div>
          </>
        )}
      </form>
    </div>
  );
}

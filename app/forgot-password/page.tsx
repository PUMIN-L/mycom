"use client";

import { useState } from "react";
import { MIN_PASSWORD_LENGTH, newPasswordProblem } from "../lib/passwordRules";

// "ลืมรหัสผ่าน" — public. Step one asks for the username and has a 6-digit
// code emailed to the admin's fixed address; step two takes that code, the
// new password and — for an account with 2FA on — a code from the app or a
// backup code. The rules are server-side (/api/auth/forgot-password); the
// checks here only save a round trip.

type Step = "username" | "reset" | "done";

const inputClass =
  "w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-gray-600 focus:outline-none focus:border-orange-500/50 transition";
const labelClass = "block text-sm font-medium text-gray-300 mb-2";

async function errorFrom(res: Response, fallback: string): Promise<{ message: string; twoFactorRequired: boolean }> {
  const data = await res.json().catch(() => null);
  return {
    message: typeof data?.error === "string" && data.error ? data.error : fallback,
    twoFactorRequired: data?.twoFactorRequired === true,
  };
}

export default function ForgotPasswordPage() {
  const [step, setStep] = useState<Step>("username");
  const [username, setUsername] = useState("");
  const [otp, setOtp] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [code, setCode] = useState("");
  const [needsCode, setNeedsCode] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function post(path: string, body: unknown): Promise<Response> {
    return fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  async function requestCode(e?: React.FormEvent) {
    e?.preventDefault();
    if (busy) return;
    setError("");
    setNotice("");
    setBusy(true);
    try {
      const res = await post("/api/auth/forgot-password/otp", { username });
      if (!res.ok) {
        setError((await errorFrom(res, "ส่งรหัสไม่สำเร็จ กรุณาลองใหม่")).message);
        return;
      }
      const data = await res.json().catch(() => null);
      setNotice(typeof data?.message === "string" ? data.message : "ส่งรหัสแล้ว");
      setOtp("");
      setStep("reset");
    } catch {
      setError("เกิดข้อผิดพลาด กรุณาลองใหม่");
    } finally {
      setBusy(false);
    }
  }

  async function resetPassword(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError("");
    const problem = newPasswordProblem(newPassword, username);
    if (problem) return setError(problem);
    if (newPassword !== confirm) return setError("รหัสผ่านใหม่ทั้งสองช่องไม่ตรงกัน");
    setBusy(true);
    try {
      const res = await post("/api/auth/forgot-password", { username, otp: otp.trim(), newPassword, code: code.trim() });
      if (!res.ok) {
        const { message, twoFactorRequired } = await errorFrom(res, "ตั้งรหัสผ่านใหม่ไม่สำเร็จ");
        if (twoFactorRequired) setNeedsCode(true);
        setError(message);
        return;
      }
      setNewPassword("");
      setConfirm("");
      setOtp("");
      setCode("");
      setStep("done");
    } catch {
      setError("เกิดข้อผิดพลาด กรุณาลองใหม่");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 flex items-center justify-center px-4">
      <div className="relative w-full max-w-md">
        <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl shadow-2xl p-10">
          <div className="text-center mb-8">
            <h1 className="text-2xl font-bold text-white font-serif">ลืมรหัสผ่าน</h1>
            <p className="text-gray-400 text-sm mt-1">
              {step === "username"
                ? "ระบบจะส่งรหัส 6 หลักไปที่อีเมลของผู้ดูแลระบบ"
                : step === "reset"
                  ? "กรอกรหัสจากอีเมล แล้วตั้งรหัสผ่านใหม่"
                  : "ตั้งรหัสผ่านใหม่เรียบร้อยแล้ว"}
            </p>
          </div>

          {step === "username" && (
            <form onSubmit={requestCode} className="space-y-5">
              <div>
                <label htmlFor="forgot-username" className={labelClass}>Username</label>
                <input
                  id="forgot-username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                  autoComplete="username"
                  className={inputClass}
                />
              </div>
              {error && <p role="alert" className="text-sm text-red-400">❌ {error}</p>}
              <button
                type="submit"
                disabled={busy}
                className="w-full py-3.5 bg-orange-500 hover:bg-orange-600 text-white font-bold rounded-xl transition disabled:opacity-60"
              >
                {busy ? "กำลังส่ง..." : "ส่งรหัส OTP"}
              </button>
            </form>
          )}

          {step === "reset" && (
            <form onSubmit={resetPassword} className="space-y-5">
              {notice && <p className="text-sm text-green-400">✅ {notice}</p>}
              <div>
                <label htmlFor="forgot-otp" className={labelClass}>รหัส OTP จากอีเมล (6 หลัก)</label>
                <input
                  id="forgot-otp"
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
              <div>
                <label htmlFor="forgot-new-password" className={labelClass}>รหัสผ่านใหม่</label>
                <input
                  id="forgot-new-password"
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
                <label htmlFor="forgot-confirm" className={labelClass}>ยืนยันรหัสผ่านใหม่</label>
                <input
                  id="forgot-confirm"
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                  autoComplete="new-password"
                  className={inputClass}
                />
              </div>
              <div>
                <label htmlFor="forgot-2fa" className={labelClass}>
                  รหัสยืนยันตัวตน 2 ขั้น{needsCode ? "" : " (ถ้าเปิดใช้งานไว้)"}
                </label>
                <input
                  id="forgot-2fa"
                  type="text"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  required={needsCode}
                  maxLength={12}
                  autoComplete="one-time-code"
                  placeholder="รหัส 6 หลักจากแอป หรือรหัสสำรอง"
                  className={`${inputClass} font-mono tracking-widest`}
                />
              </div>
              {error && <p role="alert" className="text-sm text-red-400">❌ {error}</p>}
              <button
                type="submit"
                disabled={busy}
                className="w-full py-3.5 bg-orange-500 hover:bg-orange-600 text-white font-bold rounded-xl transition disabled:opacity-60"
              >
                {busy ? "กำลังบันทึก..." : "ตั้งรหัสผ่านใหม่"}
              </button>
              <div className="flex justify-between text-sm">
                <button
                  type="button"
                  onClick={() => {
                    setStep("username");
                    setError("");
                    setNotice("");
                  }}
                  className="text-gray-400 hover:text-gray-300 transition"
                >
                  ← เปลี่ยน username
                </button>
                <button
                  type="button"
                  onClick={() => requestCode()}
                  disabled={busy}
                  className="text-orange-400 hover:text-orange-300 transition disabled:opacity-60"
                >
                  ขอรหัสใหม่
                </button>
              </div>
            </form>
          )}

          {step === "done" && (
            <div className="space-y-5 text-center">
              <p className="text-green-400">✅ ตั้งรหัสผ่านใหม่แล้ว อุปกรณ์ที่เคยเข้าสู่ระบบไว้ถูกออกจากระบบทั้งหมด</p>
              <a
                href="/login"
                className="block w-full py-3.5 bg-orange-500 hover:bg-orange-600 text-white font-bold rounded-xl transition"
              >
                ไปหน้าเข้าสู่ระบบ
              </a>
            </div>
          )}

          <p className="text-center text-gray-600 text-sm mt-6">
            <a href="/login" className="hover:text-gray-400 transition">← กลับหน้าเข้าสู่ระบบ</a>
          </p>
        </div>
      </div>
    </div>
  );
}

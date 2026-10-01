"use client";
import { useCallback, useEffect, useState } from "react";

// /settings → "ยืนยันตัวตน 2 ขั้น (2FA)". Turns two-factor login on and off
// and manages backup codes. The rules are server-side (/api/auth/2fa/*, see
// app/lib/twoFactor.ts): every change asks for the password again, and once
// 2FA is on, a code too — a session left open on some desk is not enough.
//
// Backup codes are shown ONCE, straight from the response that created them;
// nothing here can fetch them again, because the server only keeps hashes.

type ShowToast = (msg: string, type: "success" | "error") => void;
type Mode = "idle" | "setup" | "showCodes" | "disable" | "regenerate";

interface Status {
  enabled: boolean;
  backupCodesRemaining: number;
}

interface SetupData {
  secret: string;
  qrDataUrl: string;
}

/** At or below this, the status line turns amber and says "make new ones". */
const LOW_BACKUP_CODES = 3;

async function fetchStatus(): Promise<Status> {
  const res = await fetch("/api/auth/2fa");
  if (!res.ok) throw new Error(`status ${res.status}`);
  const data = await res.json();
  return { enabled: Boolean(data.enabled), backupCodesRemaining: Number(data.backupCodesRemaining) || 0 };
}

async function errorFrom(res: Response, fallback: string): Promise<string> {
  // requireAuth() answers an English "Unauthorized"; say it in Thai.
  if (res.status === 401) return "เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่แล้วลองอีกครั้ง";
  const data = await res.json().catch(() => null);
  return typeof data?.error === "string" && data.error ? data.error : fallback;
}

const inputClass =
  "w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500";

export default function TwoFactorSettings({ showToast }: { showToast: ShowToast }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [mode, setMode] = useState<Mode>("idle");
  const [setup, setSetup] = useState<SetupData | null>(null);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [codesSaved, setCodesSaved] = useState(false);

  /** Re-read after a change, or from the ลองใหม่ button. */
  const loadStatus = useCallback(async () => {
    try {
      setStatus(await fetchStatus());
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    }
  }, []);

  // First load. State is only set once the request settles, never during the
  // effect itself; `cancelled` drops an answer that arrives after unmount.
  useEffect(() => {
    let cancelled = false;
    fetchStatus()
      .then((loaded) => {
        if (!cancelled) setStatus(loaded);
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const clearForm = () => {
    setPassword("");
    setCode("");
  };

  const goIdle = () => {
    clearForm();
    setSetup(null);
    setMode("idle");
  };

  async function post(path: string, body?: unknown): Promise<Response> {
    return fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
  }

  async function startSetup() {
    setBusy(true);
    try {
      const res = await post("/api/auth/2fa/setup");
      if (!res.ok) {
        showToast(await errorFrom(res, "เริ่มตั้งค่าไม่สำเร็จ"), "error");
        return;
      }
      setSetup(await res.json());
      clearForm();
      setMode("setup");
    } catch {
      showToast("เกิดข้อผิดพลาด กรุณาลองใหม่", "error");
    } finally {
      setBusy(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const path =
      mode === "setup"
        ? "/api/auth/2fa/enable"
        : mode === "disable"
          ? "/api/auth/2fa/disable"
          : "/api/auth/2fa/backup-codes";
    setBusy(true);
    try {
      const res = await post(path, { password, code });
      if (!res.ok) {
        showToast(await errorFrom(res, "ดำเนินการไม่สำเร็จ"), "error");
        return;
      }
      const data = await res.json();
      clearForm();
      if (mode === "disable") {
        showToast("ปิดการยืนยันตัวตน 2 ขั้นแล้ว", "success");
        goIdle();
        await loadStatus();
        return;
      }
      if (mode === "setup") {
        showToast("เปิดการยืนยันตัวตน 2 ขั้นแล้ว — อุปกรณ์อื่นทุกเครื่องถูกออกจากระบบ", "success");
      }
      setSetup(null);
      setBackupCodes(Array.isArray(data.backupCodes) ? data.backupCodes : []);
      setCodesSaved(false);
      setMode("showCodes");
    } catch {
      showToast("เกิดข้อผิดพลาด กรุณาลองใหม่", "error");
    } finally {
      setBusy(false);
    }
  }

  async function finishCodes() {
    setBackupCodes([]);
    goIdle();
    await loadStatus();
  }

  async function copyCodes() {
    try {
      await navigator.clipboard.writeText(backupCodes.join("\n"));
      showToast("คัดลอกรหัสสำรองแล้ว", "success");
    } catch {
      showToast("คัดลอกไม่ได้ กรุณาจดด้วยตนเอง", "error");
    }
  }

  function downloadCodes() {
    const text =
      "รหัสสำรองสำหรับยืนยันตัวตน 2 ขั้น (PROFIN)\n" +
      "แต่ละรหัสใช้ได้ครั้งเดียว เก็บไว้ในที่ปลอดภัย\n\n" +
      backupCodes.join("\n") +
      "\n";
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "profin-backup-codes.txt";
    // In the document while clicked (some Firefox versions ignore a click on
    // a detached link), and the URL revoked LATER: the download starts after
    // click() returns, and Safari fails it outright if the blob is already
    // gone. These codes are shown once — a download that silently does
    // nothing is a lockout waiting to happen.
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  const codeField = (label: string, placeholder: string, hint?: string) => (
    <div>
      <label htmlFor="two-factor-settings-code" className="block text-sm font-semibold text-gray-700 mb-1">
        {label}
      </label>
      <input
        id="two-factor-settings-code"
        type="text"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        required
        autoComplete="one-time-code"
        maxLength={12}
        placeholder={placeholder}
        className={`${inputClass} font-mono tracking-widest`}
      />
      {hint && <p className="text-xs text-gray-500 mt-1">{hint}</p>}
    </div>
  );

  const passwordField = (
    <div>
      <label htmlFor="two-factor-settings-password" className="block text-sm font-semibold text-gray-700 mb-1">
        รหัสผ่านปัจจุบัน
      </label>
      <input
        id="two-factor-settings-password"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
        autoComplete="current-password"
        className={inputClass}
      />
    </div>
  );

  return (
    <div id="two-factor" className="mt-8 bg-white rounded-lg shadow p-6 space-y-4 scroll-mt-24">
      <div>
        <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">🔑 ยืนยันตัวตน 2 ขั้น (2FA)</h2>
        <p className="text-sm text-gray-600 mt-1">
          นอกจากรหัสผ่าน ต้องใส่รหัส 6 หลักจากแอปในมือถือทุกครั้งที่เข้าสู่ระบบ — รหัสผ่านรั่วอย่างเดียวจะเข้าระบบไม่ได้
          ใช้แอปฟรีอย่าง Google Authenticator, Microsoft Authenticator หรือ Authy
        </p>
      </div>

      {loadFailed ? (
        <div className="flex items-center gap-3 text-sm">
          <span className="text-red-600">โหลดสถานะไม่สำเร็จ</span>
          <button type="button" onClick={loadStatus} className="text-indigo-600 font-semibold hover:underline">
            ลองใหม่
          </button>
        </div>
      ) : status === null ? (
        <div className="h-10 bg-gray-100 rounded-lg animate-pulse" />
      ) : mode === "idle" ? (
        status.enabled ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-green-100 text-green-800 text-sm font-semibold">
                ✅ เปิดใช้งานอยู่
              </span>
              <span
                className={`text-sm ${
                  status.backupCodesRemaining <= LOW_BACKUP_CODES ? "text-amber-700 font-semibold" : "text-gray-600"
                }`}
              >
                รหัสสำรองเหลือ {status.backupCodesRemaining} ชุด
                {status.backupCodesRemaining <= LOW_BACKUP_CODES && " — ควรสร้างชุดใหม่"}
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  clearForm();
                  setMode("regenerate");
                }}
                className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm font-semibold hover:bg-gray-50 transition"
              >
                สร้างรหัสสำรองชุดใหม่
              </button>
              <button
                type="button"
                onClick={() => {
                  clearForm();
                  setMode("disable");
                }}
                className="px-4 py-2 rounded-lg border border-red-300 text-red-700 text-sm font-semibold hover:bg-red-50 transition"
              >
                ปิดการยืนยันตัวตน 2 ขั้น
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-gray-100 text-gray-700 text-sm font-semibold">
              ยังไม่ได้เปิด
            </span>
            <button
              type="button"
              onClick={startSetup}
              disabled={busy}
              className="w-full px-6 py-3 bg-indigo-600 text-white font-bold rounded-lg hover:bg-indigo-700 transition disabled:opacity-50"
            >
              {busy ? "กำลังเตรียม..." : "เริ่มตั้งค่า"}
            </button>
          </div>
        )
      ) : mode === "setup" && setup ? (
        <form onSubmit={submit} className="space-y-4" aria-label="ตั้งค่าการยืนยันตัวตน 2 ขั้น">
          <ol className="list-decimal pl-5 space-y-1 text-sm text-gray-700">
            <li>ติดตั้งแอป Google Authenticator (หรือแอปยืนยันตัวตนอื่น) บนมือถือ</li>
            <li>ในแอป กด “+” แล้วสแกน QR ด้านล่าง</li>
            <li>กรอกรหัส 6 หลักที่แอปแสดง พร้อมรหัสผ่านปัจจุบัน แล้วกดยืนยัน</li>
          </ol>
          <div className="flex flex-col sm:flex-row items-center gap-4 p-4 bg-gray-50 rounded-lg border border-gray-200">
            {/* eslint-disable-next-line @next/next/no-img-element -- a data: URL drawn by the server; nothing for next/image to optimize */}
            <img
              src={setup.qrDataUrl}
              alt="QR สำหรับสแกนด้วยแอปยืนยันตัวตน"
              width={180}
              height={180}
              className="bg-white rounded border border-gray-200"
            />
            <div className="text-sm text-gray-600 min-w-0">
              <p className="font-semibold text-gray-800">สแกนไม่ได้?</p>
              <p>เลือก “ใส่คีย์ด้วยตนเอง” ในแอป แล้วพิมพ์คีย์นี้:</p>
              <p className="mt-2 font-mono text-base text-gray-900 break-all select-all" aria-label="คีย์สำหรับใส่ด้วยตนเอง">
                {setup.secret.match(/.{1,4}/g)?.join(" ")}
              </p>
              <p className="mt-2 text-xs text-amber-700">
                QR และคีย์นี้คือกุญแจของบัญชี อย่าแคปหน้าจอหรือส่งให้ใคร
              </p>
            </div>
          </div>
          {codeField("รหัส 6 หลักจากแอป", "123456")}
          {passwordField}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy}
              className="flex-1 px-6 py-3 bg-indigo-600 text-white font-bold rounded-lg hover:bg-indigo-700 transition disabled:opacity-50"
            >
              {busy ? "กำลังตรวจสอบ..." : "ยืนยันและเปิดใช้งาน"}
            </button>
            <button
              type="button"
              onClick={goIdle}
              disabled={busy}
              className="px-6 py-3 rounded-lg border border-gray-300 text-gray-700 font-semibold hover:bg-gray-50 transition disabled:opacity-50"
            >
              ยกเลิก
            </button>
          </div>
          <p className="text-xs text-gray-500">
            เมื่อเปิดแล้ว อุปกรณ์อื่นที่เข้าสู่ระบบค้างไว้ทุกเครื่องจะถูกออกจากระบบ และต้องเข้าใหม่ด้วยรหัส 6 หลัก
          </p>
        </form>
      ) : mode === "showCodes" ? (
        <div className="space-y-4" role="region" aria-label="รหัสสำรอง">
          <div className="p-4 rounded-lg border border-amber-300 bg-amber-50 text-sm text-amber-900">
            <p className="font-bold">เก็บรหัสสำรองเหล่านี้ไว้ — จะแสดงครั้งนี้ครั้งเดียว</p>
            <p className="mt-1">
              ใช้แทนรหัส 6 หลักได้เมื่อไม่มีมือถือ รหัสละครั้งเดียว เก็บเหมือนเก็บรหัสผ่าน: อย่าส่งในแชท
              อย่าเก็บในมือถือเครื่องเดียวกับแอปยืนยันตัวตน
            </p>
          </div>
          <ul className="grid grid-cols-2 gap-2 font-mono text-lg text-gray-900">
            {backupCodes.map((backupCode) => (
              <li key={backupCode} className="px-3 py-2 bg-gray-50 border border-gray-200 rounded text-center">
                {backupCode}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={copyCodes}
              className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm font-semibold hover:bg-gray-50 transition"
            >
              📋 คัดลอกทั้งหมด
            </button>
            <button
              type="button"
              onClick={downloadCodes}
              className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm font-semibold hover:bg-gray-50 transition"
            >
              ⬇️ ดาวน์โหลดไฟล์ .txt
            </button>
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
            <input
              type="checkbox"
              checked={codesSaved}
              onChange={(e) => setCodesSaved(e.target.checked)}
              className="w-4 h-4 rounded border-gray-300"
            />
            ฉันเก็บรหัสสำรองไว้ในที่ปลอดภัยแล้ว
          </label>
          <button
            type="button"
            onClick={finishCodes}
            disabled={!codesSaved}
            className="w-full px-6 py-3 bg-indigo-600 text-white font-bold rounded-lg hover:bg-indigo-700 transition disabled:opacity-50"
          >
            เสร็จสิ้น
          </button>
        </div>
      ) : mode === "disable" || mode === "regenerate" ? (
        <form
          onSubmit={submit}
          className="space-y-4"
          aria-label={mode === "disable" ? "ปิดการยืนยันตัวตน 2 ขั้น" : "สร้างรหัสสำรองชุดใหม่"}
        >
          <p className="text-sm text-gray-700">
            {mode === "disable"
              ? "การปิดจะทำให้เข้าสู่ระบบได้ด้วยรหัสผ่านอย่างเดียว ยืนยันด้วยรหัสผ่านและรหัส 6 หลัก (หรือรหัสสำรอง)"
              : "รหัสสำรองชุดเดิมทั้งหมดจะใช้ไม่ได้อีก ยืนยันด้วยรหัสผ่านและรหัส 6 หลัก (หรือรหัสสำรอง)"}
          </p>
          {passwordField}
          {codeField("รหัส 6 หลักจากแอป หรือรหัสสำรอง", "123456 หรือ ABCD-EFGH")}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy}
              className={`flex-1 px-6 py-3 text-white font-bold rounded-lg transition disabled:opacity-50 ${
                mode === "disable" ? "bg-red-600 hover:bg-red-700" : "bg-indigo-600 hover:bg-indigo-700"
              }`}
            >
              {busy ? "กำลังตรวจสอบ..." : mode === "disable" ? "ปิดการยืนยันตัวตน 2 ขั้น" : "สร้างรหัสสำรองชุดใหม่"}
            </button>
            <button
              type="button"
              onClick={goIdle}
              disabled={busy}
              className="px-6 py-3 rounded-lg border border-gray-300 text-gray-700 font-semibold hover:bg-gray-50 transition disabled:opacity-50"
            >
              ยกเลิก
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

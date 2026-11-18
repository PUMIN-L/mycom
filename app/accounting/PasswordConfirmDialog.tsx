"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Spinner from "../components/Spinner";
import { useModalEscape } from "../components/useModalEscape";

/**
 * "Type your password again" before something that matters: changing what
 * every tax invoice prints, deleting an issued document, voiding one. A
 * stolen session alone cannot get past it — the route checks the password
 * (lib/twoFactorReauth.requirePassword, its own lockout after five misses).
 *
 * `onSubmit` sends the request with the password and answers the error to
 * show (a wrong password, a refusal), or null when it went through — the
 * dialog then closes itself through `onDone`.
 */
export default function PasswordConfirmDialog({
  title,
  children,
  confirmText,
  danger = false,
  onSubmit,
  onCancel,
  onDone,
}: {
  title: string;
  /** What is about to happen, above the password field. */
  children?: ReactNode;
  confirmText: string;
  /** Red confirm button (delete / void). */
  danger?: boolean;
  onSubmit: (password: string) => Promise<string | null>;
  onCancel: () => void;
  onDone: () => void;
}) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useModalEscape(dialogRef, () => {
    if (!busy) onCancel();
  });
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = async () => {
    if (busy) return;
    if (!password) {
      setError("กรุณากรอกรหัสผ่าน");
      inputRef.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    let problem: string | null;
    try {
      problem = await onSubmit(password);
    } catch {
      problem = "ส่งข้อมูลไม่สำเร็จ ตรวจสอบการเชื่อมต่อแล้วลองใหม่";
    }
    setBusy(false);
    if (problem) {
      setError(problem);
      setPassword("");
      inputRef.current?.focus();
      return;
    }
    onDone();
  };

  return (
    <div className="fixed inset-0 z-110 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => !busy && onCancel()}></div>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="password-confirm-title"
        className="relative bg-white rounded-2xl shadow-2xl p-6 w-full max-w-md"
      >
        <h2 id="password-confirm-title" className="text-lg font-bold text-gray-900 mb-3">{title}</h2>
        {children && <div className="text-sm text-gray-700 mb-4 space-y-2">{children}</div>}
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <label htmlFor="password-confirm-input" className="block text-sm font-semibold text-gray-700 mb-1.5">
            รหัสผ่านของคุณ (ยืนยันว่าเป็นคุณจริง)
          </label>
          <input
            ref={inputRef}
            id="password-confirm-input"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
            aria-invalid={!!error || undefined}
            aria-describedby={error ? "password-confirm-error" : undefined}
            className={`w-full border rounded-xl px-4 py-2.5 outline-none focus:ring-2 ${
              error ? "border-red-500 bg-red-50 focus:ring-red-500" : "border-gray-200 bg-gray-50 focus:ring-sky-500"
            }`}
          />
          {error && (
            <p id="password-confirm-error" role="alert" className="mt-1.5 text-sm text-red-600">{error}</p>
          )}
          <div className="flex gap-3 mt-6">
            <button
              type="button"
              onClick={onCancel}
              disabled={busy}
              className="flex-1 px-4 py-2.5 rounded-xl border border-gray-300 text-gray-700 font-semibold hover:bg-gray-50 disabled:opacity-60"
            >
              ยกเลิก
            </button>
            <button
              type="submit"
              disabled={busy}
              className={`flex-1 px-4 py-2.5 rounded-xl text-white font-semibold flex justify-center items-center gap-2 disabled:opacity-60 ${
                danger ? "bg-red-600 hover:bg-red-700" : "bg-sky-600 hover:bg-sky-700"
              }`}
            >
              {busy && <Spinner className="h-4 w-4 text-white" />}
              {busy ? "กำลังตรวจสอบ…" : confirmText}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

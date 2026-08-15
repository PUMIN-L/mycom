"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";

/**
 * Hook that guards against losing unsaved changes.
 *
 * Usage:
 *   const { isDirty, setSnapshot, guardedNavigate, LeaveGuardModal } = useLeaveGuard(dataToWatch);
 *
 * - Call `setSnapshot()` after loading or saving to mark the current state as "clean".
 * - Use `guardedNavigate(href)` instead of `router.push(href)` on navigation buttons.
 * - Render `<LeaveGuardModal onSave={handleSave} />` in your JSX.
 */
export function useLeaveGuard<T>(data: T) {
  const router = useRouter();
  const snapshotRef = useRef<string>("");
  const [showModal, setShowModal] = useState(false);
  const [pendingHref, setPendingHref] = useState<string | null>(null);

  const fingerprint = useCallback((d: T) => JSON.stringify(d), []);

  // Auto-set snapshot on first render so isDirty starts clean.
  useEffect(() => {
    if (snapshotRef.current === "") {
      snapshotRef.current = fingerprint(data);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isDirty = snapshotRef.current !== "" && fingerprint(data) !== snapshotRef.current;

  /** Mark the current state as the "saved" baseline. */
  const setSnapshot = useCallback(
    (d?: T) => {
      snapshotRef.current = fingerprint(d ?? data);
    },
    [data, fingerprint]
  );

  // Native browser warning on tab close / refresh
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  /** Navigate if clean; show modal if dirty. */
  const guardedNavigate = useCallback(
    (href: string) => {
      if (isDirty) {
        setPendingHref(href);
        setShowModal(true);
      } else {
        router.push(href);
      }
    },
    [isDirty, router]
  );

  /** Confirm leave (without saving) */
  const confirmLeave = useCallback(() => {
    setShowModal(false);
    snapshotRef.current = fingerprint(data); // prevent re-trigger
    if (pendingHref) router.push(pendingHref);
    setPendingHref(null);
  }, [data, fingerprint, pendingHref, router]);

  /** Cancel — stay on page */
  const cancelLeave = useCallback(() => {
    setShowModal(false);
    setPendingHref(null);
  }, []);

  return {
    isDirty,
    setSnapshot,
    guardedNavigate,
    showModal,
    confirmLeave,
    cancelLeave,
    setShowModal,
  };
}

/**
 * Beautiful modal that asks the user whether to save, discard, or stay.
 *
 * Props:
 *  - `show` — whether the modal is visible
 *  - `onSave` — async callback to save. After it resolves, navigation proceeds.
 *  - `onDiscard` — callback to leave WITHOUT saving.
 *  - `onCancel` — callback to dismiss the modal and stay.
 *  - `saving` — if true, the save button shows a spinner.
 *  - `saveDisabled` — if true, the save button is disabled (e.g. validation error).
 *  - `documentLabel` — optional label like "ใบเสนอราคา", "สินค้า", etc.
 */
export function LeaveGuardModal({
  show,
  onSave,
  onDiscard,
  onCancel,
  saving = false,
  saveDisabled = false,
  documentLabel = "เอกสาร",
}: {
  show: boolean;
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
  saving?: boolean;
  saveDisabled?: boolean;
  documentLabel?: string;
}) {
  if (!show) return null;
  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full mx-4 overflow-hidden animate-fade-in-up">
        <div className="p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-amber-100 flex items-center justify-center text-2xl flex-shrink-0">
              ⚠️
            </div>
            <div>
              <h3 className="text-lg font-bold text-gray-900">
                มีการเปลี่ยนแปลงที่ยังไม่ได้บันทึก
              </h3>
              <p className="text-sm text-gray-500 mt-1">
                คุณต้องการบันทึก{documentLabel}นี้ก่อนออกจากหน้านี้หรือไม่?
              </p>
            </div>
          </div>
        </div>
        <div className="px-6 pb-6 flex flex-col gap-2">
          <button
            onClick={onSave}
            disabled={saving || saveDisabled}
            className="w-full px-4 py-3 rounded-xl bg-green-500 text-white font-bold text-sm hover:bg-green-600 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? "กำลังบันทึก..." : "💾 บันทึกแล้วออก"}
          </button>
          <button
            onClick={onDiscard}
            className="w-full px-4 py-3 rounded-xl bg-red-50 text-red-600 font-bold text-sm hover:bg-red-100 transition border border-red-200"
          >
            🚪 ออกโดยไม่บันทึก
          </button>
          <button
            onClick={onCancel}
            className="w-full px-4 py-3 rounded-xl bg-gray-100 text-gray-700 font-semibold text-sm hover:bg-gray-200 transition"
          >
            ← อยู่ต่อในหน้านี้
          </button>
        </div>
      </div>
    </div>
  );
}

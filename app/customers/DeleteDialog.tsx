"use client";

import { useEffect, useRef, useState } from "react";
import { useModalEscape } from "../components/useModalEscape";
import { errorMessageOf } from "../lib/apiErrorMessage";
import { BLOCKED_HINT, KIND_NOUN, deleteUrl, linkLines, linksUrl, type DeleteKind } from "./linkHelpers";

/** How long the links check may take before the dialog stops waiting for it
 *  and simply asks — DELETE checks the same links again anyway. */
const CHECK_TIMEOUT_MS = 8000;

type Phase =
  | { kind: "checking" }
  | { kind: "confirm" }
  | { kind: "blocked"; lines: string[]; message?: string }
  | { kind: "deleting" };

/**
 * Deleting a customer, a company or a salesperson on /customers.
 *
 * It first asks the server what still points at the record
 * (GET /api/…/[id]/links). Something does → it says what, how many, and what
 * to do about it, with only "ตกลง" — the delete would be refused anyway, and
 * a bare "เกิดข้อผิดพลาดในการลบ" after pressing ลบ was all an admin used to
 * get. Nothing does → the usual "ลบแล้วกู้คืนไม่ได้" question. A refusal the
 * check did not foresee (a link added in between) is shown the same way, in
 * the server's own words.
 */
export default function DeleteDialog({
  kind,
  id,
  name,
  onClose,
  onDeleted,
}: {
  kind: DeleteKind;
  id: string;
  name: string;
  onClose: () => void;
  /** It is gone (the dialog is done; the host closes it). */
  onDeleted: () => void;
}) {
  const noun = KIND_NOUN[kind];
  const [phase, setPhase] = useState<Phase>({ kind: "checking" });
  const [error, setError] = useState<string | null>(null);
  const deletingRef = useRef(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const okRef = useRef<HTMLButtonElement>(null);

  // Ask what still points at it.
  useEffect(() => {
    let unmounted = false;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
    (async () => {
      try {
        const res = await fetch(linksUrl(kind, id), { signal: controller.signal });
        const lines = res.ok ? linkLines(kind, await res.json()) : [];
        if (unmounted) return;
        setPhase(lines.length > 0 ? { kind: "blocked", lines } : { kind: "confirm" });
      } catch {
        // Unanswered (or too slow): ask as usual. The DELETE route refuses
        // for itself.
        if (!unmounted) setPhase({ kind: "confirm" });
      } finally {
        clearTimeout(timer);
      }
    })();
    return () => {
      unmounted = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [kind, id]);

  // Focus inside, so Esc, Tab and Enter act here — on ตกลง once there is
  // nothing to do but read; otherwise on ยกเลิก, the safe button. Whatever
  // had focus (the row's ลบ) gets it back when the dialog goes.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => {
      if (opener?.isConnected) opener.focus();
    };
  }, []);
  useEffect(() => {
    if (phase.kind === "blocked") okRef.current?.focus();
    // Back from a failed delete too: ลบข้อมูล was disabled under the request,
    // which drops the focus to the page.
    else if (phase.kind !== "deleting") cancelRef.current?.focus();
  }, [phase.kind]);

  const close = () => {
    if (!deletingRef.current) onClose();
  };
  useModalEscape(dialogRef, close);

  const handleDelete = async () => {
    if (deletingRef.current || phase.kind !== "confirm") return;
    deletingRef.current = true;
    setPhase({ kind: "deleting" });
    setError(null);
    let failure: { message: string; refused: boolean } | null = null;
    try {
      const res = await fetch(deleteUrl(kind, id), { method: "DELETE" });
      if (!res.ok) {
        failure = {
          message: await errorMessageOf(res, `ลบ${noun.title}ไม่สำเร็จ กรุณาลองใหม่`),
          // 400 is the route refusing (something still points at it); a 401
          // or a 500 is worth another try.
          refused: res.status === 400,
        };
      }
    } catch {
      failure = { message: `ลบ${noun.title}ไม่สำเร็จ ตรวจสอบการเชื่อมต่อแล้วลองใหม่`, refused: false };
    } finally {
      deletingRef.current = false;
    }
    if (!failure) {
      onDeleted();
      return;
    }
    if (failure.refused) {
      setPhase({ kind: "blocked", lines: [], message: failure.message });
    } else {
      setPhase({ kind: "confirm" });
      setError(failure.message);
    }
  };

  const blocked = phase.kind === "blocked";
  const busy = phase.kind === "deleting";
  const titleId = `delete-${kind}-title`;
  const bodyId = `delete-${kind}-body`;

  return (
    <div className="fixed inset-0 z-100 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-gray-900/40 backdrop-blur-sm" onClick={close} data-testid="delete-dialog-backdrop"></div>
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        className="relative bg-white rounded-3xl shadow-2xl max-w-md w-full p-6 text-center"
      >
        <div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 ${blocked ? "bg-orange-100 text-orange-500" : "bg-red-100 text-red-500"}`}>
          {blocked ? (
            <svg aria-hidden="true" className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
          ) : (
            <svg aria-hidden="true" className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
          )}
        </div>
        <h3 id={titleId} className="text-xl font-bold text-gray-900 mb-2">
          {blocked ? noun.refused : `ยืนยันการลบ${noun.title}`}
        </h3>

        <div id={bodyId} className="text-gray-600 mb-6 space-y-3">
          {blocked ? (
            <>
              {phase.lines.length > 0 ? (
                <>
                  <p>
                    <strong className="text-gray-900">{name}</strong> ยังผูกอยู่กับ
                  </p>
                  <ul className="inline-block text-left space-y-1" data-testid="delete-blockers">
                    {phase.lines.map((line) => (
                      <li key={line} className="flex items-center gap-2">
                        <span aria-hidden="true" className="w-1.5 h-1.5 rounded-full bg-orange-400 shrink-0" />
                        {line}
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p data-testid="delete-refusal">{phase.message}</p>
              )}
              <p className="text-sm text-gray-500">{BLOCKED_HINT[kind]}</p>
            </>
          ) : (
            <>
              <p>
                ลบ <strong className="text-gray-900">{name}</strong>? ลบแล้วกู้คืนไม่ได้
              </p>
              {phase.kind === "checking" && (
                <p className="text-sm text-gray-400" role="status">
                  กำลังตรวจสอบข้อมูลที่ผูกอยู่...
                </p>
              )}
              {error && (
                <p role="alert" className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-xl px-4 py-3 whitespace-pre-wrap">
                  {error}
                </p>
              )}
            </>
          )}
        </div>

        <div className="flex gap-3 justify-center">
          {blocked ? (
            // Keyed, all three: React would otherwise recycle ยกเลิก's button
            // as ตกลง, and whether the focus lands on it would be luck.
            <button
              key="ok"
              ref={okRef}
              type="button"
              onClick={close}
              className="px-5 py-2.5 bg-gray-900 hover:bg-gray-800 text-white font-semibold rounded-xl transition-colors shadow-sm w-full"
            >
              ตกลง
            </button>
          ) : (
            <>
              <button
                key="cancel"
                ref={cancelRef}
                type="button"
                onClick={close}
                disabled={busy}
                className="px-5 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-800 font-semibold rounded-xl transition-colors flex-1 disabled:opacity-50"
              >
                ยกเลิก
              </button>
              <button
                key="delete"
                type="button"
                onClick={handleDelete}
                disabled={phase.kind !== "confirm"}
                className="px-5 py-2.5 bg-red-500 hover:bg-red-600 text-white font-semibold rounded-xl transition-colors shadow-sm hover:shadow-md flex-1 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {busy ? "กำลังลบ..." : "ลบข้อมูล"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

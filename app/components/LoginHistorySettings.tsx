"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { formatDisplayDateTime } from "../lib/dateFormat";
import { loginAlertLabel, loginResultLabel, type LoginHistoryEntry } from "../lib/loginHistory";

// /settings → "ประวัติการเข้าสู่ระบบ" (GET /api/auth/login-history,
// lib/loginEvents.ts): every login of every account, newest first, so a
// login nobody here made can be seen — and the new-device email it set off.

/** Lines shown before "ดูทั้งหมด". */
export const LOGIN_HISTORY_SHOWN_AT_FIRST = 10;

interface Loaded {
  entries: LoginHistoryEntry[];
  alertEmail: string;
  retentionDays: number;
}

const LOAD_FAILED = "โหลดประวัติการเข้าสู่ระบบไม่สำเร็จ";

/** A refusal worded for the admin. Anything else thrown on the way (the
 *  browser's own "Failed to fetch", a JSON parse error) is English, and is
 *  shown as LOAD_FAILED instead. */
class LoadError extends Error {}

async function fetchHistory(): Promise<Loaded> {
  const res = await fetch("/api/auth/login-history");
  if (!res.ok) {
    // requireAuth() answers an English "Unauthorized"; say it in Thai.
    throw new LoadError(
      res.status === 401 ? "เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่แล้วลองอีกครั้ง" : LOAD_FAILED
    );
  }
  const data = await res.json();
  return {
    entries: Array.isArray(data?.entries) ? data.entries : [],
    alertEmail: typeof data?.alertEmail === "string" ? data.alertEmail : "",
    retentionDays: Number(data?.retentionDays) || 0,
  };
}

function errorText(error: unknown): string {
  return error instanceof LoadError ? error.message : LOAD_FAILED;
}

function retentionText(days: number): string {
  if (days >= 365 && days % 365 === 0) return `${days / 365} ปี`;
  return `${days} วัน`;
}

function EntryLine({ entry }: { entry: LoginHistoryEntry }) {
  const unfinished = entry.result === "awaiting_2fa";
  const alert = loginAlertLabel(entry.alert);
  return (
    <li className={`px-4 py-3 ${unfinished ? "bg-amber-50" : ""}`}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className={`text-sm font-semibold ${unfinished ? "text-amber-900" : "text-gray-900"}`}>
          {unfinished ? "⚠️ " : ""}
          {loginResultLabel(entry)}
        </span>
        {entry.newDevice && (
          <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-semibold text-orange-800">
            อุปกรณ์ใหม่
          </span>
        )}
      </div>
      <p className="mt-1 text-sm text-gray-700">
        {formatDisplayDateTime(entry.at)} · บัญชี {entry.username}
      </p>
      <p className="text-sm text-gray-600 wrap-break-word">
        {entry.device} · IP {entry.ip ?? "ไม่ทราบ"}
        {entry.location ? ` · ${entry.location}` : ""}
      </p>
      {alert && <p className="mt-0.5 text-xs text-gray-500">{alert}</p>}
      {unfinished && (
        <p className="mt-1 text-xs font-medium text-amber-900">
          ถ้าไม่ใช่คุณ แปลว่ารหัสผ่านรั่ว — เปลี่ยนรหัสผ่านด้านล่างทันที
        </p>
      )}
    </li>
  );
}

export default function LoginHistorySettings() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showAll, setShowAll] = useState(false);

  // Only the NEWEST request's answer is applied. รีเฟรช pressed while the first
  // load is still out would otherwise let whichever answer lands last win — an
  // older list over a newer one, or the first load's failure over a list that
  // did load. Unmounting moves the counter on too, dropping a late answer.
  const latestRequest = useRef(0);

  /** Never rejects; state is only set once the request settles. */
  const request = useCallback(() => {
    const seq = ++latestRequest.current;
    return fetchHistory().then(
      (data) => {
        if (seq !== latestRequest.current) return;
        setLoaded(data);
        setError("");
      },
      (err) => {
        if (seq === latestRequest.current) setError(errorText(err));
      }
    );
  }, []);

  useEffect(() => {
    void request();
    return () => {
      latestRequest.current += 1;
    };
  }, [request]);

  const reload = async () => {
    setBusy(true);
    try {
      await request();
    } finally {
      setBusy(false);
    }
  };

  const entries = loaded?.entries ?? [];
  const shown = showAll ? entries : entries.slice(0, LOGIN_HISTORY_SHOWN_AT_FIRST);

  return (
    <div id="login-history" className="mt-8 bg-white rounded-lg shadow p-6 space-y-4 scroll-mt-24">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">🕒 ประวัติการเข้าสู่ระบบ</h2>
          <p className="text-sm text-gray-600 mt-1">
            ทุกครั้งที่มีการเข้าสู่ระบบ{loaded?.retentionDays ? ` (เก็บไว้ ${retentionText(loaded.retentionDays)})` : ""}
            {" "}— ถ้าเข้าจากอุปกรณ์ที่ไม่เคยเข้ามาก่อน ระบบจะส่งอีเมลแจ้งเตือน
            {loaded?.alertEmail ? `ไปที่ ${loaded.alertEmail} ` : ""}ทันที
          </p>
        </div>
        <button
          type="button"
          onClick={reload}
          disabled={busy}
          className="shrink-0 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          {busy ? "กำลังโหลด..." : "รีเฟรช"}
        </button>
      </div>

      {/* A failed รีเฟรช keeps the list it already had, under the error. */}
      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}{" "}
          <button type="button" onClick={reload} disabled={busy} className="font-semibold underline disabled:opacity-50">
            ลองใหม่
          </button>
        </div>
      )}
      {!loaded ? (
        !error && <p className="text-sm text-gray-500">กำลังโหลดประวัติ...</p>
      ) : entries.length === 0 ? (
        <p className="text-sm text-gray-500">ยังไม่มีประวัติ — ระบบเริ่มบันทึกตั้งแต่การเข้าสู่ระบบครั้งถัดไป</p>
      ) : (
        <>
          <ul className="divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200">
            {shown.map((entry) => (
              <EntryLine key={entry.id} entry={entry} />
            ))}
          </ul>
          {entries.length > LOGIN_HISTORY_SHOWN_AT_FIRST && (
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              className="text-sm font-semibold text-indigo-600 hover:text-indigo-800"
            >
              {showAll ? "แสดงน้อยลง" : `ดูทั้งหมด (${entries.length} รายการ)`}
            </button>
          )}
        </>
      )}

      <p className="text-xs text-gray-500">
        ถ้าเห็นรายการที่ไม่ใช่คุณ: เปลี่ยนรหัสผ่าน (ทุกอุปกรณ์อื่นจะถูกออกจากระบบ) และเปิดการยืนยันตัวตน 2 ขั้น
      </p>
    </div>
  );
}

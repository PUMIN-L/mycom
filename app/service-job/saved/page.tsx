"use client";
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "../../context/AuthContext";
import Toast from "../../components/Toast";
import ConfirmDialog from "../../components/ConfirmDialog";
import SearchableDropdown from "../../components/SearchableDropdown";
import DatePicker from "../../components/DatePicker";
import { toLocalDateString, formatDisplayDate } from "../../lib/dateFormat";
import type { ServiceJobStatus, ServiceJobSummary } from "../../lib/types";

// ── ใบ Job ที่ออกแล้ว ────────────────────────────────────────────────────────
//
// The register of printed job sheets, and the ONE place ปิดงาน is pressed.
//
// ⚠️ ปิดงาน IS THE MOMENT THE SERVICE HISTORY OF EVERY MACHINE ON THE SHEET IS
//    WRITTEN — one `service_logs` row per machine, filed under the job number
//    the customer signed, plus the linked appointment closed. Issuing the sheet
//    wrote none of that on purpose: a sheet printed but never taken is not a
//    visit, and a service record claiming otherwise can never be told from a
//    true one afterwards. That is why the button sits behind a ConfirmDialog
//    that says out loud what it is about to record, and why the confirmation
//    text names the machines it will touch.
//
// Pressing it twice is harmless (completeJob stands down on an already-closed
// sheet), but the dialog is not there for safety against a double click — it is
// there so nobody closes a sheet whose paper has not actually come back.

const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: "", label: "สถานะ: ทั้งหมด" },
  { value: "issued", label: "สถานะ: ออกใบแล้ว (ยังไม่ปิดงาน)" },
  { value: "completed", label: "สถานะ: ปิดงานแล้ว" },
  { value: "cancelled", label: "สถานะ: ยกเลิกแล้ว" },
];

function StatusBadge({ status }: { status: ServiceJobStatus }) {
  if (status === "completed")
    return (
      <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-green-100 text-green-700">
        ✅ ปิดงานแล้ว
      </span>
    );
  if (status === "cancelled")
    return (
      <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-gray-100 text-gray-500">
        ยกเลิกแล้ว
      </span>
    );
  return (
    <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-amber-100 text-amber-700">
      📄 ออกใบแล้ว
    </span>
  );
}

type PendingAction = {
  kind: "complete" | "cancel" | "delete";
  job: ServiceJobSummary;
};

export default function SavedServiceJobsPage() {
  const router = useRouter();
  const { isLoggedIn, isLoading } = useAuth();

  const [jobs, setJobs] = useState<ServiceJobSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  // Filters. The two dates are inclusive bounds on jobDate — stored (and
  // therefore compared) as "YYYY-MM-DD", which sorts lexically AND
  // chronologically, so the server can range them as plain strings.
  const [statusFilter, setStatusFilter] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  const [pending, setPending] = useState<PendingAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((message: string, type: "success" | "error") => {
    setToast({ message, type });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  }, []);

  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    []
  );

  // Same client auth gate as every other admin page, with the early-return
  // spinner below — without it the list paints customer names for a frame
  // before the redirect lands.
  useEffect(() => {
    if (!isLoading && !isLoggedIn) router.replace("/login");
  }, [isLoggedIn, isLoading, router]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    const params = new URLSearchParams();
    if (statusFilter) params.set("status", statusFilter);
    if (fromDate) params.set("from", fromDate);
    if (toDate) params.set("to", toDate);
    if (debouncedSearch) params.set("search", debouncedSearch);
    try {
      const res = await fetch(`/api/service-jobs?${params.toString()}`);
      if (!res.ok) throw new Error();
      const list = await res.json();
      setJobs(Array.isArray(list) ? list : []);
    } catch {
      setLoadFailed(true);
      setJobs([]);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, fromDate, toDate, debouncedSearch]);

  useEffect(() => {
    if (isLoggedIn) load();
  }, [isLoggedIn, load]);

  const isFiltered = Boolean(statusFilter || fromDate || toDate || debouncedSearch);

  const openCount = useMemo(
    () => jobs.filter((j) => j.status === "issued").length,
    [jobs]
  );

  // ── The three actions ─────────────────────────────────────────────────────

  async function runPending() {
    if (!pending || busy) return;
    const { kind, job } = pending;
    setBusy(true);
    try {
      const res = await fetch(
        kind === "delete"
          ? `/api/service-jobs/${encodeURIComponent(job.id)}`
          : `/api/service-jobs/${encodeURIComponent(job.id)}/${kind}`,
        { method: kind === "delete" ? "DELETE" : "POST" }
      );
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        // The store answers a refusal with a THAI message that explains itself
        // ("ใบงานที่ปิดแล้วลบไม่ได้ เพราะเป็นประวัติการเข้าบริการของเครื่อง") —
        // show it as it is rather than a generic failure.
        showToast(data?.error || "ทำรายการไม่สำเร็จ", "error");
        return;
      }
      showToast(
        kind === "complete"
          ? `ปิดงาน ${job.jobNo} แล้ว — บันทึกลงประวัติเครื่อง ${job.equipmentCount} เครื่องเรียบร้อย`
          : kind === "cancel"
            ? `ยกเลิกใบ ${job.jobNo} แล้ว`
            : `ลบใบ ${job.jobNo} แล้ว`,
        "success"
      );
      setPending(null);
      await load();
    } catch {
      showToast("เกิดข้อผิดพลาด กรุณาลองใหม่", "error");
    } finally {
      setBusy(false);
    }
  }

  const confirmCopy = (action: PendingAction) => {
    const machines = `${action.job.equipmentCount} เครื่อง`;
    if (action.kind === "complete")
      return {
        title: "ยืนยันการปิดงาน",
        message: `กระดาษที่เซ็นแล้วของใบ ${action.job.jobNo} กลับมาถึงออฟฟิศแล้วใช่หรือไม่?\n\nเมื่อปิดงาน ระบบจะบันทึกการเข้าบริการครั้งนี้ลงในประวัติของเครื่องทั้ง ${machines} ในใบนี้ (อ้างอิงเลขที่ใบ ${action.job.jobNo}) และปิดนัดหมายที่ผูกไว้ให้ด้วย\n\nใบที่ปิดแล้วจะแก้ไข ยกเลิก หรือลบไม่ได้อีก`,
        confirmText: "ปิดงาน",
        loadingText: "กำลังปิดงาน...",
      };
    if (action.kind === "cancel")
      return {
        title: "ยกเลิกใบงานนี้?",
        message: `ใบ ${action.job.jobNo} จะถูกทำเครื่องหมายว่ายกเลิก (ไม่ได้เข้าไปทำงานจริง) — ประวัติเครื่องจะไม่ถูกบันทึก และเลขที่ใบนี้จะไม่ถูกนำกลับมาใช้ซ้ำ`,
        confirmText: "ยกเลิกใบงาน",
        loadingText: "กำลังยกเลิก...",
      };
    return {
      title: "ลบใบงานนี้?",
      message: `ใบ ${action.job.jobNo} จะถูกลบออกจากระบบ ใช้สำหรับใบที่ออกผิดเท่านั้น — เลขที่ใบนี้จะยังถูกจองไว้และไม่ถูกนำกลับมาใช้ซ้ำ`,
      confirmText: "ลบใบงาน",
      loadingText: "กำลังลบ...",
    };
  };

  if (isLoading || !isLoggedIn) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin h-8 w-8 border-4 border-orange-400 border-t-transparent rounded-full" />
      </div>
    );
  }

  const inputCls =
    "w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 text-sm bg-white";

  return (
    <div className="min-h-screen bg-gray-50">
      {toast && <Toast message={toast.message} type={toast.type} />}

      {/* Header */}
      <div className="sticky top-0 z-20 bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
          <h1 className="text-xl font-bold text-gray-900">🔧 ใบ Job ที่ออกแล้ว</h1>
          <div className="flex items-center gap-2 flex-wrap">
            <Link
              href="/adminpanel"
              className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm font-semibold hover:bg-gray-50 transition"
            >
              🏠 หน้าระบบจัดการ
            </Link>
            <Link
              href="/service-job"
              className="px-4 py-2 rounded-lg bg-orange-500 text-white text-sm font-bold hover:bg-orange-600 transition shadow-sm"
            >
              + สร้างใบ Job ใหม่
            </Link>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-6">
        {/* ── Filters ───────────────────────────────────────────────────────
            The status dropdown is SearchableDropdown with searchable={false}
            (four fixed options make a search box dead weight) — never a native
            <select>, which the OS paints dark on a dark-mode machine. */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 mb-5 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">สถานะ</label>
            <SearchableDropdown
              options={STATUS_FILTERS}
              value={statusFilter}
              onChange={setStatusFilter}
              searchable={false}
              buttonClassName="h-[38px] border-gray-300"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">
              วันที่เข้าบริการ ตั้งแต่
            </label>
            <DatePicker
              selected={fromDate ? new Date(`${fromDate}T00:00:00`) : null}
              onChange={(date) => setFromDate(date ? toLocalDateString(date) : "")}
              placeholderText="ไม่ระบุ"
              isClearable
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">ถึงวันที่</label>
            <DatePicker
              selected={toDate ? new Date(`${toDate}T00:00:00`) : null}
              onChange={(date) => setToDate(date ? toLocalDateString(date) : "")}
              placeholderText="ไม่ระบุ"
              isClearable
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">ค้นหาเลขที่ใบ</label>
            <input
              className={inputCls}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="เช่น JOB0509"
            />
          </div>
        </div>

        {/* A count that answers the question this page exists for: how many
            sheets are out there waiting for their paper to come back. */}
        {!loading && !loadFailed && (
          <div className="flex items-center justify-between gap-3 flex-wrap mb-4 text-sm text-gray-500">
            <div>
              พบ <strong className="text-gray-700">{jobs.length}</strong> ใบ
              {openCount > 0 && (
                <span className="text-amber-600">
                  {" "}
                  · รอปิดงาน <strong>{openCount}</strong> ใบ
                </span>
              )}
            </div>
            {isFiltered && (
              <button
                onClick={() => {
                  setStatusFilter("");
                  setFromDate("");
                  setToDate("");
                  setSearch("");
                }}
                className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition text-xs font-semibold"
              >
                ล้างตัวกรองทั้งหมด
              </button>
            )}
          </div>
        )}

        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="p-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  เลขที่ใบ
                </th>
                <th className="p-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  วันที่เข้าบริการ
                </th>
                <th className="p-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  ลูกค้า / บริษัท
                </th>
                <th className="p-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  เครื่อง
                </th>
                <th className="p-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  ช่าง
                </th>
                <th className="p-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  สถานะ
                </th>
                <th className="p-4" />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i} className="border-b border-gray-50 animate-pulse">
                    <td className="p-4"><div className="h-4 bg-gray-200 rounded w-28" /></td>
                    <td className="p-4"><div className="h-4 bg-gray-200 rounded w-24" /></td>
                    <td className="p-4"><div className="h-4 bg-gray-200 rounded w-40" /></td>
                    <td className="p-4"><div className="h-4 bg-gray-200 rounded w-12" /></td>
                    <td className="p-4"><div className="h-4 bg-gray-200 rounded w-20" /></td>
                    <td className="p-4"><div className="h-4 bg-gray-200 rounded w-20" /></td>
                    <td className="p-4"><div className="h-4 bg-gray-200 rounded w-16" /></td>
                  </tr>
                ))
              ) : loadFailed ? (
                <tr>
                  <td colSpan={7} className="py-16 text-center">
                    <div className="flex flex-col items-center gap-3">
                      <div className="text-5xl">⚠️</div>
                      <p className="text-gray-500">โหลดรายการใบ Job ไม่สำเร็จ</p>
                      <button
                        onClick={load}
                        className="px-4 py-2 bg-gray-100 text-gray-700 rounded-xl hover:bg-gray-200 transition text-sm font-semibold"
                      >
                        ลองใหม่
                      </button>
                    </div>
                  </td>
                </tr>
              ) : jobs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-16 text-center">
                    <div className="flex flex-col items-center gap-3">
                      <div className="text-5xl">🔧</div>
                      <p className="text-gray-400 text-lg">
                        {isFiltered ? "ไม่พบใบ Job ที่ตรงกับตัวกรอง" : "ยังไม่มีใบ Job ในระบบ"}
                      </p>
                      {!isFiltered && (
                        <Link
                          href="/service-job"
                          className="mt-1 px-4 py-2 bg-orange-500 text-white rounded-xl hover:bg-orange-600 transition text-sm font-semibold"
                        >
                          + สร้างใบแรก
                        </Link>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                jobs.map((job) => (
                  <tr key={job.id} className="border-b border-gray-50 hover:bg-gray-50/50 transition">
                    <td className="p-4">
                      <Link
                        href={`/service-job?id=${encodeURIComponent(job.id)}`}
                        className="font-mono font-bold text-gray-800 hover:text-orange-600 transition"
                      >
                        {job.jobNo || "—"}
                      </Link>
                    </td>
                    {/* Every date the user READS goes through formatDisplayDate
                        ("12 Jun 2026"); the stored value stays YYYY-MM-DD. */}
                    <td className="p-4 text-sm text-gray-700">
                      {formatDisplayDate(job.jobDate) || "—"}
                      {job.status === "completed" && job.completedAt && (
                        <div className="text-xs text-gray-400 mt-0.5">
                          ปิดงาน {formatDisplayDate(job.completedAt.slice(0, 10))}
                        </div>
                      )}
                    </td>
                    <td className="p-4">
                      <div className="text-sm font-semibold text-gray-800">
                        {job.customerName || "—"}
                      </div>
                      <div className="text-xs text-gray-400">{job.companyName || ""}</div>
                    </td>
                    <td className="p-4 text-sm text-gray-600">{job.equipmentCount} เครื่อง</td>
                    <td className="p-4 text-sm text-gray-600">
                      {job.technicianName || (
                        <span className="text-gray-400" title="เว้นไว้ให้ช่างเขียนชื่อเองบนกระดาษ">
                          (เขียนเองหน้างาน)
                        </span>
                      )}
                    </td>
                    <td className="p-4">
                      <StatusBadge status={job.status} />
                    </td>
                    <td className="p-4">
                      <div className="flex items-center justify-end gap-1.5 flex-wrap">
                        <Link
                          href={`/service-job?id=${encodeURIComponent(job.id)}`}
                          target="_blank"
                          title="ดูตัวอย่างใบงาน"
                          className="p-1.5 text-gray-400 hover:text-orange-600 rounded-lg hover:bg-orange-50 transition"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                          </svg>
                        </Link>
                        <Link
                          href={`/service-job?id=${encodeURIComponent(job.id)}`}
                          className="px-3 py-1.5 bg-gray-100 text-gray-700 text-xs font-semibold rounded-lg hover:bg-gray-200 transition"
                        >
                          เปิด / พิมพ์
                        </Link>
                        {job.status === "issued" && (
                          <>
                            <button
                              onClick={() => setPending({ kind: "complete", job })}
                              className="px-3 py-1.5 bg-green-500 text-white text-xs font-semibold rounded-lg hover:bg-green-600 transition"
                            >
                              ✅ ปิดงาน
                            </button>
                            <button
                              onClick={() => setPending({ kind: "cancel", job })}
                              className="px-3 py-1.5 bg-white border border-gray-300 text-gray-600 text-xs font-semibold rounded-lg hover:bg-gray-50 transition"
                            >
                              ยกเลิก
                            </button>
                            <button
                              onClick={() => setPending({ kind: "delete", job })}
                              title="ลบใบที่ออกผิด"
                              className="p-1.5 text-gray-400 hover:text-red-500 rounded-lg hover:bg-red-50 transition"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth="2"
                                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                                />
                              </svg>
                            </button>
                          </>
                        )}
                        {job.status === "cancelled" && (
                          <button
                            onClick={() => setPending({ kind: "delete", job })}
                            title="ลบใบที่ยกเลิกแล้ว"
                            className="p-1.5 text-gray-400 hover:text-red-500 rounded-lg hover:bg-red-50 transition"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth="2"
                                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                              />
                            </svg>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {pending && (
        <ConfirmDialog
          {...confirmCopy(pending)}
          cancelText="ยกเลิก"
          loading={busy}
          onConfirm={runPending}
          onCancel={() => {
            if (!busy) setPending(null);
          }}
        />
      )}
    </div>
  );
}

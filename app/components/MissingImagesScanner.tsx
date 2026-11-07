"use client";
import { useEffect, useRef, useState } from "react";
import {
  CHECK_BATCH_SIZE,
  IMAGE_KIND_LABEL,
  checkErrorLabel,
  chunk,
  fileNameOf,
  pagesWithMissingImages,
  type ImageCheckResult,
  type ImageIndex,
} from "../lib/missingImages";

// /settings → "ตรวจหารูปที่หาย" (lib/missingImages.ts): lists every Cloudinary
// file the site shows (GET /api/admin/missing-images), checks them a batch at
// a time (POST …/check) with a progress bar and a stop button, then shows the
// pages with a missing picture or PDF, each with a link to fix it. Reads only:
// nothing is deleted or changed.

/** Batches out at once. Each is CHECK_BATCH_SIZE files, 6 at a time on the server. */
const PARALLEL_BATCHES = 2;
/** "ตรวจไม่ได้" lines shown before "ดูทั้งหมด". */
const ERRORS_SHOWN_AT_FIRST = 10;
/** Pages shown before "ดูทั้งหมด": one missing product picture can be on a hundred quotations. */
export const PAGES_SHOWN_AT_FIRST = 20;
/**
 * Times a batch waits out the check route's rate limit (429 + Retry-After)
 * before its files count as "ตรวจไม่ได้". A big scan meets the limit as a
 * matter of course; that is a pause, not a failure.
 */
const RATE_LIMIT_RETRIES = 3;
const MAX_WAIT_MS = 60_000;

const SESSION_EXPIRED = "เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่แล้วลองอีกครั้ง";

type Phase = "idle" | "loading" | "checking" | "done";

/** A refusal worded for the admin; anything else thrown on the way is shown as the fallback. */
class ScanError extends Error {}

async function loadIndex(): Promise<ImageIndex> {
  const res = await fetch("/api/admin/missing-images");
  if (!res.ok) {
    throw new ScanError(
      res.status === 401
        ? SESSION_EXPIRED
        : res.status === 429
          ? "โหลดรายการรูปบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่"
          : "โหลดรายการรูปไม่สำเร็จ"
    );
  }
  const data = await res.json();
  return {
    pages: Array.isArray(data?.pages) ? data.pages : [],
    images: Array.isArray(data?.images) ? data.images : [],
  };
}

/** Waits `ms`, or less if `abandoned()` turns true meanwhile. */
async function wait(ms: number, abandoned: () => boolean): Promise<void> {
  const until = Date.now() + ms;
  while (!abandoned() && Date.now() < until) {
    await new Promise((r) => setTimeout(r, Math.min(250, until - Date.now())));
  }
}

/**
 * One batch's answers. A refused batch answers "error" for each of its files;
 * a rate-limited one waits as told and asks again (RATE_LIMIT_RETRIES); a
 * lapsed session ends the scan. null: the scan was stopped while it waited.
 */
async function checkBatch(urls: string[], abandoned: () => boolean): Promise<ImageCheckResult[] | null> {
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch("/api/admin/missing-images/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls }),
      });
    } catch {
      return urls.map((url) => ({ url, status: "error", httpStatus: null, detail: "network" }));
    }
    if (res.status === 401) throw new ScanError(SESSION_EXPIRED);
    if (res.status === 429 && attempt < RATE_LIMIT_RETRIES) {
      const seconds = Number(res.headers.get("Retry-After"));
      await wait(Math.min(Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : 5_000, MAX_WAIT_MS), abandoned);
      if (abandoned()) return null;
      continue;
    }
    const data = res.ok ? await res.json().catch(() => null) : null;
    const results: ImageCheckResult[] = Array.isArray(data?.results) ? data.results : [];
    const byUrl = new Map(results.map((r) => [r.url, r]));
    return urls.map((url) => byUrl.get(url) ?? { url, status: "error", httpStatus: null, detail: "network" });
  }
}

export default function MissingImagesScanner() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [index, setIndex] = useState<ImageIndex | null>(null);
  const [results, setResults] = useState<Map<string, ImageCheckResult>>(new Map());
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState("");
  const [stopped, setStopped] = useState(false);
  const [showAllErrors, setShowAllErrors] = useState(false);
  const [showAllPages, setShowAllPages] = useState(false);
  const stopRef = useRef(false);
  // Leaving the page stops the scan: no more batches go out.
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  /** Check `urls` against Cloudinary, merging each batch's answers as they come. */
  const check = async (urls: string[]) => {
    stopRef.current = false;
    setStopped(false);
    setPhase("checking");
    setProgress({ done: 0, total: urls.length });
    const batches = chunk(urls, CHECK_BATCH_SIZE);
    const abandoned = () => stopRef.current || !aliveRef.current;
    let next = 0;
    let fatal = "";
    // A worker never throws: a lapsed session stops the others, and the scan
    // is "done" only once every batch already sent has come back. Ending it
    // earlier let a quick ตรวจใหม่ start while a batch was still out — which
    // then carried on through the old list into the new scan's results.
    const worker = async () => {
      while (next < batches.length) {
        if (abandoned()) return;
        const batch = batches[next++];
        let answers: ImageCheckResult[] | null;
        try {
          answers = await checkBatch(batch, abandoned);
        } catch (err) {
          fatal = err instanceof ScanError ? err.message : "ตรวจรูปไม่สำเร็จ";
          stopRef.current = true;
          return;
        }
        if (!answers) return;
        setResults((prev) => {
          const merged = new Map(prev);
          for (const a of answers) merged.set(a.url, a);
          return merged;
        });
        setProgress((p) => ({ ...p, done: p.done + batch.length }));
      }
    };
    await Promise.all(Array.from({ length: Math.min(PARALLEL_BATCHES, batches.length) }, worker));
    if (fatal) setError(fatal);
    setStopped(stopRef.current);
    setPhase("done");
  };

  const scanAll = async () => {
    setError("");
    setShowAllErrors(false);
    setShowAllPages(false);
    setPhase("loading");
    let loaded: ImageIndex;
    try {
      loaded = await loadIndex();
    } catch (err) {
      setError(err instanceof ScanError ? err.message : "โหลดรายการรูปไม่สำเร็จ");
      setPhase(index ? "done" : "idle");
      return;
    }
    setIndex(loaded);
    setResults(new Map());
    await check(loaded.images.map((i) => i.url));
  };

  const failedUrls = [...results.values()].filter((r) => r.status === "error").map((r) => r.url);
  const retryFailed = async () => {
    setError("");
    await check(failedUrls);
  };

  const busy = phase === "loading" || phase === "checking";
  const missingPages = index ? pagesWithMissingImages(index, results) : [];
  const shownPages = showAllPages ? missingPages : missingPages.slice(0, PAGES_SHOWN_AT_FIRST);
  // "หน้าเนื้อหา 2 · สินค้า 1 · ใบเสนอราคา 150" — the list itself may be cut short.
  const pagesByKind = (Object.keys(IMAGE_KIND_LABEL) as (keyof typeof IMAGE_KIND_LABEL)[])
    .map((kind) => [kind, missingPages.filter((p) => p.kind === kind).length] as const)
    .filter(([, n]) => n > 0)
    .map(([kind, n]) => `${IMAGE_KIND_LABEL[kind]} ${n}`)
    .join(" · ");
  const missingFiles = [...results.values()].filter((r) => r.status === "missing").length;
  const failed = [...results.values()].filter((r) => r.status === "error");
  const checkedCount = results.size;
  const percent = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div id="missing-images" className="mt-8 bg-white rounded-lg shadow p-6 space-y-4 scroll-mt-24">
      <div>
        <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">🖼️ ตรวจหารูปที่หาย</h2>
        <p className="text-sm text-gray-600 mt-1">
          ตรวจทุกรูปและไฟล์ PDF ที่เว็บแสดงอยู่ (หน้าเนื้อหา สินค้า แคตตาล็อก ใบเสนอราคา และเอกสารขาย)
          ว่าไฟล์บน Cloudinary ยังอยู่หรือไม่ — แค่ตรวจ ไม่ลบหรือแก้ไขอะไร
        </p>
      </div>

      {phase === "checking" ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3 text-sm text-gray-700">
            <span>
              กำลังตรวจ {progress.done.toLocaleString("th-TH")} / {progress.total.toLocaleString("th-TH")} ไฟล์
              {missingFiles > 0 && <span className="font-semibold text-red-600"> · พบไฟล์หายแล้ว {missingFiles}</span>}
            </span>
            <button
              type="button"
              onClick={() => {
                stopRef.current = true;
              }}
              className="shrink-0 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-semibold text-gray-700 hover:bg-gray-50"
            >
              หยุด
            </button>
          </div>
          <div
            role="progressbar"
            aria-label="ความคืบหน้าการตรวจรูป"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            className="h-2 w-full overflow-hidden rounded-full bg-gray-100"
          >
            <div className="h-full rounded-full bg-blue-600 transition-all" style={{ width: `${percent}%` }} />
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={scanAll}
          disabled={busy}
          className="w-full px-6 py-3 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700 transition disabled:opacity-50"
        >
          {phase === "loading" ? "กำลังรวบรวมรายการรูป..." : phase === "done" ? "🔍 ตรวจใหม่อีกครั้ง" : "🔍 เริ่มตรวจ"}
        </button>
      )}

      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {phase === "done" && index && (
        <div className="space-y-4">
          {stopped && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
              หยุดตรวจแล้ว — ตรวจไป {checkedCount.toLocaleString("th-TH")} จาก {index.images.length.toLocaleString("th-TH")} ไฟล์
            </p>
          )}

          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="rounded-lg bg-gray-50 p-3">
              <div className="text-2xl font-bold text-gray-900">{index.images.length.toLocaleString("th-TH")}</div>
              <div className="text-xs text-gray-600">ไฟล์ที่เว็บใช้</div>
            </div>
            <div className={`rounded-lg p-3 ${missingFiles > 0 ? "bg-red-50" : "bg-gray-50"}`}>
              <div className={`text-2xl font-bold ${missingFiles > 0 ? "text-red-600" : "text-gray-900"}`}>{missingFiles}</div>
              <div className="text-xs text-gray-600">ไฟล์หาย</div>
            </div>
            <div className={`rounded-lg p-3 ${failed.length > 0 ? "bg-amber-50" : "bg-gray-50"}`}>
              <div className={`text-2xl font-bold ${failed.length > 0 ? "text-amber-700" : "text-gray-900"}`}>{failed.length}</div>
              <div className="text-xs text-gray-600">ตรวจไม่ได้</div>
            </div>
          </div>

          {missingFiles === 0 && failed.length === 0 && !stopped && !error && (
            <p className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm font-semibold text-green-800">
              ✅ ไม่พบรูปที่หาย — ทุกไฟล์ที่เว็บใช้ยังอยู่บน Cloudinary
            </p>
          )}

          {missingPages.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-semibold text-gray-900">
                พบไฟล์หาย {missingFiles} ไฟล์ ใน {missingPages.length} หน้า — เปิดหน้านั้นแล้วอัปโหลดรูปใหม่แทนรูปที่หาย
              </p>
              <p className="text-xs text-gray-600">{pagesByKind}</p>
              <ul className="divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200">
                {shownPages.map((page) => (
                  <li key={`${page.kind}:${page.sourceId}`} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <span className="mr-2 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-700">
                          {IMAGE_KIND_LABEL[page.kind]}
                        </span>
                        <span className="text-sm font-semibold text-gray-900 wrap-break-word">{page.title}</span>
                        {page.hidden && (
                          <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">ซ่อนจากลูกค้า</span>
                        )}
                      </div>
                      {/* A new tab, so the results stay here while the page is fixed. */}
                      <a
                        href={page.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="เปิดในแท็บใหม่"
                        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-semibold text-gray-700 hover:border-orange-300 hover:bg-orange-50 hover:text-orange-700"
                      >
                        เปิดหน้านี้
                        <svg aria-hidden="true" className="h-4 w-4 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                      </a>
                    </div>
                    <ul className="mt-2 space-y-1">
                      {page.missing.map((m, i) => (
                        <li key={`${m.url}-${i}`} className="text-sm text-gray-700">
                          <span className="font-medium text-red-700">{m.where}</span>
                          <span className="text-gray-400"> · </span>
                          <span className="font-mono text-xs text-gray-500 break-all" title={m.url}>
                            {m.fileName}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
              {missingPages.length > PAGES_SHOWN_AT_FIRST && (
                <button
                  type="button"
                  onClick={() => setShowAllPages((v) => !v)}
                  className="text-sm font-semibold text-indigo-600 hover:text-indigo-800"
                >
                  {showAllPages ? "แสดงน้อยลง" : `ดูทั้งหมด (${missingPages.length} หน้า)`}
                </button>
              )}
            </div>
          )}

          {failed.length > 0 && (
            <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-amber-900">ตรวจไม่ได้ {failed.length} ไฟล์ — ยังไม่รู้ว่าหายหรือไม่</p>
                <button
                  type="button"
                  onClick={retryFailed}
                  disabled={busy}
                  className="shrink-0 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-sm font-semibold text-amber-900 hover:bg-amber-100 disabled:opacity-50"
                >
                  ตรวจซ้ำเฉพาะที่ตรวจไม่ได้
                </button>
              </div>
              <ul className="space-y-1">
                {(showAllErrors ? failed : failed.slice(0, ERRORS_SHOWN_AT_FIRST)).map((r) => (
                  <li key={r.url} className="text-xs text-amber-900">
                    <span className="font-mono break-all" title={r.url}>
                      {fileNameOf(r.url)}
                    </span>{" "}
                    — {checkErrorLabel(r)}
                  </li>
                ))}
              </ul>
              {failed.length > ERRORS_SHOWN_AT_FIRST && (
                <button
                  type="button"
                  onClick={() => setShowAllErrors((v) => !v)}
                  className="text-xs font-semibold text-amber-900 underline"
                >
                  {showAllErrors ? "แสดงน้อยลง" : `ดูทั้งหมด (${failed.length} ไฟล์)`}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

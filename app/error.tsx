"use client";

// Route-segment error boundary. Catches errors thrown while rendering any page
// under the root layout (a DB hiccup, an unexpected throw) and shows a branded,
// recoverable page instead of Next's bare default. `unstable_retry()` (Next
// 16.2+) RE-FETCHES and re-renders the failed segment, so a transient
// server-side data error is actually retried — unlike `reset()`, which only
// re-renders without re-fetching and would just re-throw.
import Link from "next/link";
import { useEffect } from "react";

export default function Error({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    // Surfaced to the server via instrumentation.ts / Vercel logs.
    console.error(error);
  }, [error]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 px-6 text-center">
      <div className="text-6xl mb-6">⚠️</div>
      <h1 className="text-3xl font-bold text-gray-900 font-serif mb-3">
        เกิดข้อผิดพลาด
      </h1>
      <p className="text-gray-600 max-w-md mb-8">
        ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง หากยังพบปัญหา โปรดติดต่อเราผ่านหน้า
        ติดต่อเรา
      </p>
      <div className="flex gap-3 flex-wrap justify-center">
        <button
          onClick={() => unstable_retry()}
          className="px-6 py-3 rounded-lg font-semibold text-white bg-[var(--accent)] hover:opacity-90 transition shadow-sm"
        >
          ลองใหม่อีกครั้ง
        </button>
        <Link
          href="/"
          className="px-6 py-3 rounded-lg font-semibold border border-gray-300 text-gray-700 bg-white hover:bg-gray-50 transition shadow-sm"
        >
          กลับหน้าแรก
        </Link>
      </div>
      {error?.digest && (
        <p className="text-xs text-gray-400 mt-8">รหัสอ้างอิง: {error.digest}</p>
      )}
    </div>
  );
}

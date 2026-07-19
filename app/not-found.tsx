// Branded 404 — shown for unknown URLs and every notFound() call (e.g. a missing
// showcase content or document) instead of Next's bare default page.
import Link from "next/link";

export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 px-6 text-center">
      <div className="text-7xl font-bold text-[var(--accent)] font-serif mb-2">
        404
      </div>
      <h1 className="text-2xl font-bold text-gray-900 mb-3">
        ไม่พบหน้าที่คุณค้นหา
      </h1>
      <p className="text-gray-600 max-w-md mb-8">
        หน้านี้อาจถูกย้าย ถูกลบ หรือลิงก์ไม่ถูกต้อง
      </p>
      <div className="flex gap-3 flex-wrap justify-center">
        <Link
          href="/"
          className="px-6 py-3 rounded-lg font-semibold text-white bg-[var(--accent)] hover:opacity-90 transition shadow-sm"
        >
          กลับหน้าแรก
        </Link>
        <Link
          href="/showcase"
          className="px-6 py-3 rounded-lg font-semibold border border-gray-300 text-gray-700 bg-white hover:bg-gray-50 transition shadow-sm"
        >
          ดูเนื้อหาทั้งหมด
        </Link>
      </div>
    </div>
  );
}

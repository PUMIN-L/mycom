import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { getContentByProductId } from "../../../lib/contentStore";
import { getProduct } from "../../../lib/productStore";
import { getSession } from "../../../lib/session";
import { LINE_ID, LINE_URL, lineQrUrl } from "../../../lib/contact";

export const dynamic = "force-dynamic";

// This route is a gateway: product → its linked content page. Keep the gateway
// URL out of the index so the real /showcase/[id] page is the one that ranks.
export const metadata: Metadata = {
  robots: { index: false, follow: true },
};

export default async function ProductContentGateway({
  params,
}: {
  params: Promise<{ productId: string }>;
}) {
  const { productId } = await params;

  // Resolve on the server. If content exists, do a real (server) redirect so
  // crawlers follow it and there is no client-side fetch → redirect → fetch hop.
  const content = await getContentByProductId(productId);
  if (content) {
    redirect(`/showcase/${content.id}`);
  }

  // No content linked yet. Branch on the (server-authoritative) session so we
  // never flash the wrong UI: admins get a "create content" CTA, everyone else
  // gets a LINE QR to ask for more info.
  const [product, session] = await Promise.all([getProduct(productId), getSession()]);
  const productTitle = product
    ? product.title_th || product.title_en || product.title_zh
    : productId;
  const isLoggedIn = !!session;

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4 py-12">
      <div className="max-w-md w-full text-center bg-white rounded-2xl shadow-lg p-10 border border-gray-100">
        <p className="text-orange-500 font-semibold text-sm mb-2 uppercase tracking-widest">
          {productTitle}
        </p>

        {isLoggedIn ? (
          <>
            <h1 className="text-2xl font-bold text-gray-900 mb-3">ยังไม่มีเนื้อหา</h1>
            <p className="text-gray-500 mb-8">
              สินค้านี้ยังไม่มีเนื้อหา — สร้างเนื้อหาเพิ่มเติมได้เลย
            </p>
            <Link
              href={`/create-content?productId=${encodeURIComponent(productId)}`}
              className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-orange-500 text-white font-bold rounded-xl hover:bg-orange-600 transition w-full"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              สร้างเนื้อหา
            </Link>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-bold text-gray-900 mb-3">ยังไม่มีข้อมูล</h1>
            <p className="text-gray-500 mb-6">
              ยังไม่มีข้อมูลเพิ่มเติมสำหรับสินค้านี้ในขณะนี้
            </p>

            <div className="border-t border-gray-100 pt-6 flex flex-col items-center">
              <p className="text-gray-600 mb-4">
                สอบถามข้อมูลเพิ่มเติมได้ที่ LINE
              </p>
              <a
                href={LINE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="block"
              >
                <Image
                  src={lineQrUrl(220)}
                  alt={`LINE QR code ${LINE_ID}`}
                  width={180}
                  height={180}
                  unoptimized
                  className="rounded-xl border border-gray-100 p-2 bg-white"
                />
              </a>
              <a
                href={LINE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-4 inline-flex items-center gap-2 text-lg font-bold text-green-600 hover:text-green-700 transition"
              >
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M19.365 9.863c.349 0 .63.285.63.631 0 .345-.281.63-.63.63H17.61v1.125h1.755c.349 0 .63.283.63.63 0 .344-.281.629-.63.629h-2.386c-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63h2.386c.346 0 .627.285.627.63 0 .349-.281.63-.63.63H17.61v1.125h1.755zm-3.855 3.016c0 .27-.174.51-.432.596-.064.021-.133.031-.199.031-.211 0-.391-.09-.51-.25l-2.443-3.317v2.94c0 .344-.279.629-.631.629-.346 0-.626-.285-.626-.629V8.108c0-.27.173-.51.43-.595.06-.023.136-.033.194-.033.195 0 .375.104.495.254l2.462 3.33V8.108c0-.345.282-.63.63-.63.345 0 .63.285.63.63v4.771zm-5.741 0c0 .344-.282.629-.631.629-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63.346 0 .628.285.628.63v4.771zm-2.466.629H4.917c-.345 0-.63-.285-.63-.629V8.108c0-.345.285-.63.63-.63.348 0 .63.285.63.63v4.141h1.756c.348 0 .629.283.629.63 0 .344-.282.629-.629.629M24 10.314C24 4.943 18.615.572 12 .572S0 4.943 0 10.314c0 4.811 4.27 8.842 10.035 9.608.391.082.923.258 1.058.59.12.301.079.766.038 1.08l-.164 1.02c-.045.301-.24 1.186 1.049.645 1.291-.539 6.916-4.078 9.436-6.975C23.176 14.393 24 12.458 24 10.314" />
                </svg>
                {LINE_ID}
              </a>
            </div>
          </>
        )}

        <Link
          href="/#products"
          className="mt-8 inline-block px-6 py-3 bg-gray-100 text-gray-800 font-bold rounded-xl hover:bg-gray-200 transition"
        >
          ← กลับไปหน้าสินค้า
        </Link>
      </div>
    </div>
  );
}

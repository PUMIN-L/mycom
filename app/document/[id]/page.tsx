import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDocument, isDocumentPublic } from "../../lib/documentStore";
import { getSession } from "../../lib/session";
import { SITE_NAME, SITE_URL } from "../../lib/site";
import { jsonLdHtml } from "../../lib/jsonLd";
import { pageMetadata } from "../../lib/pageMetadata";
import Link from "next/link";
import PdfViewerWrapper from "./PdfViewerWrapper";

export const dynamic = "force-dynamic";

/** The document, or null when there is none — or it is hidden and the viewer
 *  is not an admin: to a visitor a hidden catalog does not exist. */
async function visibleDocument(id: string) {
  const [doc, session] = await Promise.all([getDocument(id), getSession()]);
  if (!doc || (!session && !isDocumentPublic(doc))) return null;
  return doc;
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const doc = await visibleDocument(id);
  if (!doc) return { title: "ไม่พบเอกสาร" };
  // No brand in the title: the root template appends it (this used to add
  // " - Profin Lab Scale" too, so <title> carried the brand twice).
  return pageMetadata({
    title: doc.title,
    description: doc.description || `เอกสารดาวน์โหลด: ${doc.title} จาก ${SITE_NAME}`,
    path: `/document/${id}`,
    image: doc.coverUrl || undefined,
  });
}

export default async function DocumentPreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const doc = await visibleDocument(id);

  if (!doc) {
    notFound();
  }

  // `name` makes the saved file carry the document's title, not "document.pdf".
  const proxyUrl = `/api/documents/proxy?url=${encodeURIComponent(doc.pdfUrl)}&name=${encodeURIComponent(doc.title)}`;
  const downloadUrl = `${proxyUrl}&download=1`;

  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: SITE_URL },
      { "@type": "ListItem", position: 2, name: "แคตตาล็อกสินค้า", item: `${SITE_URL}/catalog` },
      { "@type": "ListItem", position: 3, name: doc.title, item: `${SITE_URL}/document/${doc.id}` },
    ],
  };

  return (
    // h-dvh, not h-screen: on a phone 100vh is the height WITHOUT the
    // browser's bars, so the bottom of the viewer sat behind them. h-screen
    // stays as the fallback: a browser without dvh drops h-dvh, and with no
    // height at all this column — and the PDF viewer in it — collapsed.
    <div className="flex flex-col h-screen supports-[height:100dvh]:h-dvh bg-gray-50">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdHtml(breadcrumbLd) }} />
      {/* Header Bar */}
      {/* min-w-0 down the title's side, so a long title is cut to one line
          (line-clamp) instead of pushing the download button off a phone. */}
      <div className="flex items-center justify-between gap-2 sm:gap-4 px-3 sm:px-6 py-3 sm:py-4 bg-white border-b border-gray-200 shadow-sm shrink-0">
        <div className="flex items-center gap-2 sm:gap-4 min-w-0 flex-1">
          {/* Back to the public catalog this page is opened from. It used to
              go to /adminpanel — login-only, so a visitor landed on /login. */}
          <Link
            href="/catalog"
            className="shrink-0 p-2 text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition"
            title="กลับไปแคตตาล็อก"
            aria-label="กลับไปแคตตาล็อก"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
          </Link>
          <div className="min-w-0">
            <h1 className="text-base sm:text-xl font-bold text-gray-900 line-clamp-1 wrap-break-word">{doc.title}</h1>
            {doc.description && (
              <p className="text-sm text-gray-500 line-clamp-1">{doc.description}</p>
            )}
          </div>
        </div>
        
        <div className="flex items-center gap-3 shrink-0">
          {/* A plain link to the PDF itself: the viewer below loads it with
              JavaScript, so without this a crawler never sees the file. */}
          <a
            href={proxyUrl}
            target="_blank"
            rel="noopener"
            className="hidden sm:flex items-center gap-2 px-4 py-2 text-blue-600 font-bold rounded-lg border border-blue-200 hover:bg-blue-50 transition"
          >
            เปิดไฟล์ PDF
          </a>
          {/* nofollow + the proxy's X-Robots-Tag: noindex — the download is
              the same file under a second URL. */}
          <a
            href={downloadUrl}
            rel="nofollow"
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700 transition shadow-sm"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            <span className="hidden sm:inline">ดาวน์โหลด</span>
          </a>
        </div>
      </div>

      {/* Only an admin reaches a hidden catalog's page (visibleDocument). */}
      {!isDocumentPublic(doc) && (
        <div className="px-3 sm:px-6 py-2 bg-amber-50 border-b border-amber-200 text-amber-800 text-sm font-semibold shrink-0">
          แคตตาล็อกนี้ถูกซ่อนอยู่ ผู้เข้าชมทั่วไปจะไม่เห็นในหน้าแคตตาล็อก และเปิดหน้านี้ไม่ได้
        </div>
      )}

      {/* PDF Viewer */}
      <div className="flex-1 w-full bg-gray-200 overflow-hidden relative">
        <PdfViewerWrapper url={proxyUrl} />
      </div>
    </div>
  );
}

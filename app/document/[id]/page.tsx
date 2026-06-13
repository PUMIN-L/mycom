import { notFound } from "next/navigation";
import { getDocument } from "../../lib/documentStore";
import { SITE_NAME } from "../../lib/site";
import Link from "next/link";
import PdfViewerWrapper from "./PdfViewerWrapper";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const doc = await getDocument(id);
  if (!doc) return { title: "Document Not Found" };
  return {
    title: `${doc.title} - ${SITE_NAME}`,
    description: doc.description || `เอกสารดาวน์โหลด: ${doc.title}`,
  };
}

export default async function DocumentPreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const doc = await getDocument(id);

  if (!doc) {
    notFound();
  }

  const proxyUrl = `/api/documents/proxy?url=${encodeURIComponent(doc.pdfUrl)}`;
  const downloadUrl = `${proxyUrl}&download=1`;

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      {/* Header Bar */}
      <div className="flex items-center justify-between px-6 py-4 bg-white border-b border-gray-200 shadow-sm shrink-0">
        <div className="flex items-center gap-4">
          <Link
            href="/showcase"
            className="p-2 text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition"
            title="กลับไปหน้าหลัก"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
          </Link>
          <div>
            <h1 className="text-xl font-bold text-gray-900 line-clamp-1">{doc.title}</h1>
            {doc.description && (
              <p className="text-sm text-gray-500 line-clamp-1">{doc.description}</p>
            )}
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          <a
            href={downloadUrl}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700 transition shadow-sm"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            <span className="hidden sm:inline">ดาวน์โหลด</span>
          </a>
        </div>
      </div>

      {/* PDF Viewer */}
      <div className="flex-1 w-full bg-gray-200 overflow-hidden relative">
        <PdfViewerWrapper url={proxyUrl} />
      </div>
    </div>
  );
}

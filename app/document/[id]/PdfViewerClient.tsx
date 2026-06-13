"use client";

import { useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

// Configure PDF.js worker using Next.js App Router approach
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

interface PdfViewerClientProps {
  url: string;
}

export default function PdfViewerClient({ url }: PdfViewerClientProps) {
  const [numPages, setNumPages] = useState<number>();
  const [scale, setScale] = useState(1.5);

  function onDocumentLoadSuccess({ numPages }: { numPages: number }) {
    setNumPages(numPages);
  }

  return (
    <div className="flex flex-col h-full w-full bg-gray-200">
      {/* Viewer Toolbar */}
      <div className="flex items-center justify-center gap-4 py-2 bg-gray-800 text-white shrink-0 shadow-md z-10 sticky top-0">
        <span className="font-mono text-sm">
          ทั้งหมด {numPages || "?"} หน้า
        </span>
        
        <div className="w-px h-6 bg-gray-600 mx-2" />
        
        <button
          onClick={() => setScale(s => Math.max(0.5, s - 0.25))}
          className="px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded"
          title="ซูมออก"
        >
          -
        </button>
        <span className="font-mono text-sm min-w-[3rem] text-center">{Math.round(scale * 100)}%</span>
        <button
          onClick={() => setScale(s => Math.min(3, s + 0.25))}
          className="px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded"
          title="ซูมเข้า"
        >
          +
        </button>
      </div>

      {/* Main PDF Canvas */}
      <div className="flex-1 overflow-auto p-4 flex justify-center custom-scrollbar pb-24">
        <Document
          file={url}
          onLoadSuccess={onDocumentLoadSuccess}
          loading={
            <div className="flex flex-col items-center justify-center h-64 text-gray-500 gap-3 w-full">
              <div className="w-8 h-8 border-4 border-gray-300 border-t-blue-500 rounded-full animate-spin" />
              <p>กำลังโหลดเอกสาร...</p>
            </div>
          }
          error={
            <div className="flex flex-col items-center justify-center h-64 text-red-500 gap-3 w-full">
              <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              <p>ไม่สามารถโหลดเอกสารได้</p>
            </div>
          }
          className="flex flex-col gap-8 items-center"
        >
          {Array.from(new Array(numPages || 0), (el, index) => (
            <div key={`page_${index + 1}`} id={`pdf-page-${index + 1}`} className="shadow-2xl">
              <Page
                pageNumber={index + 1}
                scale={scale}
                renderTextLayer={true}
                renderAnnotationLayer={true}
                className="bg-white max-w-full"
              />
            </div>
          ))}
        </Document>
      </div>
      
      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 8px; height: 8px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: rgba(0,0,0,0.05); }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(156, 163, 175, 0.5); border-radius: 4px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(107, 114, 128, 0.8); }
        
        /* Ensure pages don't overflow on small screens */
        .react-pdf__Page { max-width: 100%; }
        .react-pdf__Page__canvas { max-width: 100% !important; height: auto !important; }
      `}</style>
    </div>
  );
}
